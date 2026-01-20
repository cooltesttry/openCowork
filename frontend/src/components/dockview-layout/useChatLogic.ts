'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { Message, MessageBlock, AgentStep } from '@/lib/types';
import { sessionClient, AskUserContent, StreamEvent } from '@/lib/websocket';
import { sessionsApi } from '@/lib/sessions-api';
import { useChat } from '@/lib/store';
import { toast } from 'sonner';
import type { InputAreaRef, SecurityMode } from '@/components/chat/input-area';

/**
 * Shared hook containing all the business logic from ChatPanel
 * This allows it to be reused in both the old ChatPanel and new DockviewMain
 */
export function useChatLogic() {
    const {
        messages, setMessages,
        steps, setSteps,
        isProcessing, setIsProcessing,
        sessions, setSessions,
        currentSessionId, setCurrentSessionId,
        isSessionsLoading, setIsSessionsLoading,
        activeEndpoint, setActiveEndpoint,
        activeModel, setActiveModel,
        setSessionStatus,
        getSessionStatus,
    } = useChat();

    // Compute if CURRENT session is processing (for per-session input blocking)
    const isCurrentSessionProcessing = currentSessionId
        ? getSessionStatus(currentSessionId).status === 'running'
        : false;

    const inputAreaRef = useRef<InputAreaRef>(null);
    // Refs to track state inside async functions without dependency issues
    const isProcessingRef = useRef(isProcessing);
    const currentSessionIdRef = useRef(currentSessionId);

    useEffect(() => {
        isProcessingRef.current = isProcessing;
    }, [isProcessing]);

    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    const [askUserRequest, setAskUserRequest] = useState<AskUserContent | null>(null);
    const [securityMode, setSecurityMode] = useState<SecurityMode>('bypassPermissions');
    const [slashCommands, setSlashCommands] = useState<{ command: string; description: string }[]>([]);



    // Load sessions from API
    const loadSessions = useCallback(async () => {
        try {
            setIsSessionsLoading(true);
            const sessionList = await sessionsApi.list();
            setSessions(sessionList);

            const activeSessionId = currentSessionIdRef.current;
            if (activeSessionId) {
                const sessionExists = sessionList.some((s: any) => s.id === activeSessionId);
                if (!sessionExists) {
                    console.warn(`Current session ${activeSessionId} no longer exists, resetting...`);
                    const nextSessionId = sessionList.length > 0 ? sessionList[0].id : null;
                    currentSessionIdRef.current = nextSessionId;
                    setCurrentSessionId(nextSessionId);
                    setMessages([]);
                }
            } else if (sessionList.length > 0) {
                currentSessionIdRef.current = sessionList[0].id;
                setCurrentSessionId(sessionList[0].id);
            }

            // Load session statuses for running/unread indicators
            try {
                const activeStatuses = await sessionsApi.getActiveStatus();
                for (const [sessionId, status] of Object.entries(activeStatuses)) {
                    setSessionStatus(sessionId, {
                        status: status.status,
                        hasUnread: status.has_unread,
                        error: status.error || undefined,
                    });
                }
            } catch (statusError) {
                console.warn('Failed to load session statuses:', statusError);
            }
        } catch (error) {
            console.error('Failed to load sessions:', error);
        } finally {
            setIsSessionsLoading(false);
        }
    }, [setSessions, setCurrentSessionId, setMessages, setIsSessionsLoading, setSessionStatus]);

    // Load messages for a specific session
    const loadSessionMessages = useCallback(async (sessionId: string) => {
        try {
            const session = await sessionsApi.get(sessionId);

            // Note: We always load messages now, even for running sessions.
            // For running sessions, this shows historical messages.
            // Live streaming updates for running sessions require the /ws/multiplexed endpoint.

            const msgs: Message[] = session.messages.map((m: any, mIndex: number) => {
                let blocks: MessageBlock[] | undefined = undefined;
                if (m.blocks && Array.isArray(m.blocks)) {
                    blocks = m.blocks.map((b: any, bIndex: number) => ({
                        id: b.id || `block-${mIndex}-${bIndex}`,
                        type: b.type || 'text',
                        content: b.content,
                        status: b.status || 'success',
                        metadata: b.metadata || {},
                    }));
                }

                return {
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp * 1000,
                    blocks,
                };
            });
            setMessages(msgs);

            if (session.last_endpoint_name && session.last_model_name) {
                setActiveEndpoint(session.last_endpoint_name);
                setActiveModel(session.last_model_name);
            }
        } catch (error: any) {
            console.error('Failed to load session messages:', error);
            if (error?.message?.includes('not found')) {
                console.warn(`Session ${sessionId} not found, resetting...`);
                currentSessionIdRef.current = null;
                setCurrentSessionId(null);
                setMessages([]);
                loadSessions();
            } else {
                setMessages([]);
            }
        }
    }, [loadSessions, setActiveEndpoint, setActiveModel, setCurrentSessionId, setMessages]);

    // Global event handler for processing events from any session
    const handleGlobalEvent = useCallback((event: StreamEvent) => {
        const sessionId = event.metadata?.session_id;
        if (!sessionId) return;

        console.log(`[useChatLogic] Global event for ${sessionId}:`, event.type);

        // Handle task completion/error for ANY session
        if (event.type === 'done') {
            const isCurrentSession = sessionId === currentSessionIdRef.current;
            setSessionStatus(sessionId, {
                status: 'idle',
                hasUnread: !isCurrentSession, // Mark unread if not viewing this session
            });
            setIsProcessing(false);
            loadSessions(); // Refresh titles

            // If it's the current session, reload messages to get final state
            if (isCurrentSession) {
                loadSessionMessages(sessionId);
            }
        } else if (event.type === 'error') {
            setSessionStatus(sessionId, {
                status: 'error',
                hasUnread: true,
                error: event.content?.message || 'An error occurred',
            });
            setIsProcessing(false);
        }
    }, [setSessionStatus, setIsProcessing, loadSessions, loadSessionMessages]);

    // Rebuild messages from cached events - MUST be defined before recoverAllSessions
    const rebuildMessagesFromEvents = useCallback((events: unknown[], sessionId: string) => {
        if (!events || events.length === 0) return;

        const assistantMessageId = `replayed-${sessionId}-${Date.now()}`;
        let textContent = '';
        const blocks: MessageBlock[] = [];

        for (const event of events as Array<{ type: string; content?: unknown; id?: string; metadata?: Record<string, unknown> }>) {
            switch (event.type) {
                case 'text':
                case 'text_delta':
                    textContent += (event.content as string) || '';
                    break;
                case 'tool_use':
                    blocks.push({
                        id: event.id || `tool-${blocks.length}`,
                        type: 'tool_use',
                        content: event.content,
                        status: 'executing',
                        metadata: (event.metadata as Record<string, string>) || {},
                    });
                    break;
                case 'tool_result':
                    blocks.push({
                        id: event.id || `result-${blocks.length}`,
                        type: 'tool_result',
                        content: event.content,
                        status: 'success',
                        metadata: (event.metadata as Record<string, string>) || {},
                    });
                    break;
            }
        }

        if (textContent) {
            blocks.unshift({
                id: `text-${assistantMessageId}`,
                type: 'text',
                content: textContent,
                status: 'streaming',
            });
        }

        const assistantMessage: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: textContent,
            timestamp: Date.now(),
            blocks: blocks.length > 0 ? blocks : undefined,
            isStreaming: true,
        };

        setMessages(prev => {
            // Check if we already have a replayed message for this session
            const existingIndex = prev.findIndex(m => m.id.startsWith(`replayed-${sessionId}`));
            if (existingIndex >= 0) {
                const newPrev = [...prev];
                newPrev[existingIndex] = assistantMessage;
                return newPrev;
            }
            return [...prev, assistantMessage];
        });
    }, [setMessages]);

    // Recover all running sessions - subscribe to their events
    const recoverAllSessions = useCallback(async () => {
        console.log('[useChatLogic] Recovering all session states...');

        try {
            // 1. Get all session statuses
            const activeStatuses = await sessionsApi.getActiveStatus();

            // 2. Update statuses and subscribe to running sessions
            for (const [sessionId, status] of Object.entries(activeStatuses)) {
                setSessionStatus(sessionId, {
                    status: status.status as 'idle' | 'running' | 'error',
                    hasUnread: status.has_unread,
                    error: status.error || undefined,
                });

                // Subscribe to running sessions
                if (status.status === 'running') {
                    console.log(`[useChatLogic] Subscribing to running session: ${sessionId}`);
                    sessionClient.subscribe(sessionId, handleGlobalEvent);
                }
            }

            // 3. If current session is running, load its events
            const currentId = currentSessionIdRef.current;
            if (currentId) {
                const currentStatus = activeStatuses[currentId];
                if (currentStatus?.status === 'running') {
                    console.log(`[useChatLogic] Loading events for current running session: ${currentId}`);
                    const eventsData = await sessionsApi.getEvents(currentId);
                    if (eventsData.events && eventsData.events.length > 0) {
                        rebuildMessagesFromEvents(eventsData.events, currentId);
                    }
                }
            }

            console.log('[useChatLogic] Recovery complete');
        } catch (err) {
            console.error('[useChatLogic] Recovery failed:', err);
        }
    }, [setSessionStatus, handleGlobalEvent, rebuildMessagesFromEvents]);

    // Initialize connection, load sessions, and setup recovery
    useEffect(() => {
        // Connect to WebSocket
        sessionClient.connect().catch((err) => {
            console.warn('Session WebSocket connection failed, will retry on message send', err);
        });

        // Load sessions
        loadSessions();

        // Recover running sessions
        recoverAllSessions();

        // Set reconnect callback
        sessionClient.setOnReconnect(() => {
            console.log('[useChatLogic] WebSocket reconnected, recovering sessions...');
            recoverAllSessions();
        });

        return () => {
            sessionClient.setOnReconnect(null);
        };
    }, [loadSessions, recoverAllSessions]);

    // Load session messages when currentSessionId changes
    useEffect(() => {
        if (currentSessionId) {
            loadSessionMessages(currentSessionId);
        }
    }, [currentSessionId, loadSessionMessages]);

    // Create a new session
    const handleNewSession = useCallback(async () => {
        try {
            const newSession = await sessionsApi.create();
            setSessions((prev) => [newSession, ...prev]);
            currentSessionIdRef.current = newSession.id;
            setCurrentSessionId(newSession.id);
            setMessages([]);
            setSteps([]);
            setTimeout(() => inputAreaRef.current?.focus(), 100);
        } catch (error) {
            console.error('Failed to create session:', error);
            toast.error('Error', { description: 'Failed to create new session' });
        }
    }, [setCurrentSessionId, setMessages, setSessions, setSteps]);

    // Select a session
    const handleSelectSession = useCallback(async (id: string) => {
        if (id !== currentSessionId) {
            // Unsubscribe from previous session's live events
            if (currentSessionId) {
                sessionClient.unsubscribe(currentSessionId);
            }

            currentSessionIdRef.current = id;
            setCurrentSessionId(id);
            setSteps([]);

            // Check if new session is running - if so, load cached events and subscribe
            const sessionStatus = getSessionStatus(id);
            if (sessionStatus.status === 'running') {
                console.log(`[useChatLogic] Loading events for running session: ${id}`);

                try {
                    // Get cached events from backend
                    const eventsData = await sessionsApi.getEvents(id);

                    // Rebuild message state from events using shared function
                    if (eventsData.events && eventsData.events.length > 0) {
                        rebuildMessagesFromEvents(eventsData.events, id);
                    }

                    // Subscribe for live updates using global handler
                    sessionClient.subscribe(id, handleGlobalEvent);
                } catch (err) {
                    console.error(`[useChatLogic] Failed to load events for session ${id}:`, err);
                }
            }

            setTimeout(() => inputAreaRef.current?.focus(), 100);
        }
    }, [currentSessionId, setCurrentSessionId, setSteps, getSessionStatus, rebuildMessagesFromEvents, handleGlobalEvent]);

    // Delete a session
    const handleDeleteSession = useCallback(async (id: string) => {
        try {
            await sessionsApi.delete(id);
            setSessions((prev) => prev.filter((s) => s.id !== id));

            if (id === currentSessionId) {
                const remaining = sessions.filter((s) => s.id !== id);
                if (remaining.length > 0) {
                    currentSessionIdRef.current = remaining[0].id;
                    setCurrentSessionId(remaining[0].id);
                } else {
                    currentSessionIdRef.current = null;
                    setCurrentSessionId(null);
                    setMessages([]);
                }
            }
            toast.success('Session deleted');
        } catch (error) {
            console.error('Failed to delete session:', error);
            toast.error('Error', { description: 'Failed to delete session' });
        }
    }, [currentSessionId, sessions, setCurrentSessionId, setMessages, setSessions]);

    // Helper functions for message blocks
    const addBlock = useCallback((messageId: string, block: MessageBlock) => {
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.id === messageId) {
                    const blocks = msg.blocks || [];
                    return { ...msg, blocks: [...blocks, block] };
                }
                return msg;
            })
        );
    }, [setMessages]);

    const updateBlock = useCallback((messageId: string, blockId: string, updates: Partial<MessageBlock>) => {
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.id === messageId && msg.blocks) {
                    const blocks = msg.blocks.map((block) =>
                        block.id === blockId ? { ...block, ...updates } : block
                    );
                    return { ...msg, blocks };
                }
                return msg;
            })
        );
    }, [setMessages]);

    const appendToTextBlock = useCallback((messageId: string, blockId: string, additionalContent: string) => {
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.id === messageId && msg.blocks) {
                    const blocks = msg.blocks.map((block) => {
                        if (block.id === blockId && (block.type === 'text' || block.type === 'thinking')) {
                            const currentContent = typeof block.content === 'string' ? block.content : '';
                            return { ...block, content: currentContent + additionalContent };
                        }
                        return block;
                    });
                    return { ...msg, blocks };
                }
                return msg;
            })
        );
    }, [setMessages]);

    // Permission response handler
    const handlePermissionResponse = useCallback((blockId: string, approved: boolean) => {
        let requestId: string | null = null;

        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.blocks) {
                    const blocks = msg.blocks.map((block) => {
                        if (block.id === blockId) {
                            requestId = block.metadata?.requestId as string;
                            return {
                                ...block,
                                status: approved ? 'executing' : 'error',
                                metadata: { ...block.metadata, requiresPermission: false }
                            } as MessageBlock;
                        }
                        return block;
                    });
                    return { ...msg, blocks };
                }
                return msg;
            })
        );

        if (requestId) {
            sessionClient.sendPermissionResponse(requestId, approved);
            if (approved) {
                toast.success('Permission Granted', { description: 'Tool execution approved' });
            } else {
                toast.info('Permission Denied', { description: 'Tool execution was denied' });
            }
        }
    }, [setMessages]);

    // AskUser handlers
    const handleAskUserSubmit = useCallback((requestId: string, answers: Record<string, string>) => {
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.blocks) {
                    const blocks = msg.blocks.map((block) => {
                        if (block.metadata?.requestId === requestId) {
                            return {
                                ...block,
                                status: 'success',
                                content: {
                                    ...block.content,
                                    result: answers,
                                },
                            } as MessageBlock;
                        }
                        return block;
                    });
                    return { ...msg, blocks };
                }
                return msg;
            })
        );

        sessionClient.sendUserResponse(requestId, answers);
        setAskUserRequest(null);
    }, [setMessages]);

    const handleAskUserSkip = useCallback((requestId: string) => {
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.blocks) {
                    const blocks = msg.blocks.map((block) => {
                        if (block.metadata?.requestId === requestId) {
                            return {
                                ...block,
                                status: 'error',
                                content: {
                                    ...block.content,
                                    result: 'User did not provide an answer',
                                    is_error: true,
                                },
                            } as MessageBlock;
                        }
                        return block;
                    });
                    return { ...msg, blocks };
                }
                return msg;
            })
        );

        sessionClient.sendUserResponse(requestId, {});
        setAskUserRequest(null);
    }, [setMessages]);

    // Main send handler with FULL WebSocket event handling
    const handleSend = async (content: string) => {
        if (isProcessing) return;

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content,
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setSteps([]);
        setIsProcessing(true);

        // Update session status to running
        if (currentSessionIdRef.current) {
            setSessionStatus(currentSessionIdRef.current, {
                status: 'running',
                hasUnread: false,
            });
        }

        const assistantMessageId = crypto.randomUUID();
        const thinkingPlaceholderId = `thinking-placeholder-${assistantMessageId}`;

        const thinkingPlaceholderBlock: MessageBlock = {
            id: thinkingPlaceholderId,
            type: 'thinking',
            content: '思考中...',
            status: 'streaming',
            metadata: { isPlaceholder: true },
        };

        const assistantMessage: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            blocks: [thinkingPlaceholderBlock],
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Track active tool calls and streaming state
        const activeToolCalls = new Map<string, string>();
        const toolBlocksInOrder: string[] = [];
        let currentTextBlockId: string | null = null;
        let currentThinkingBlockId: string | null = null;
        let hasReceivedStreamingText = false;
        let hasReceivedStreamingThinking = false;
        let hasRemovedThinkingPlaceholder = false;

        const removeThinkingPlaceholder = () => {
            if (hasRemovedThinkingPlaceholder) return;
            hasRemovedThinkingPlaceholder = true;
            setMessages((prev) =>
                prev.map((msg) => {
                    if (msg.id === assistantMessageId && msg.blocks) {
                        const filteredBlocks = msg.blocks.filter((block) => block.id !== thinkingPlaceholderId);
                        return { ...msg, blocks: filteredBlocks };
                    }
                    return msg;
                })
            );
        };

        try {
            await sessionClient.sendMessage({
                content,
                session_id: currentSessionIdRef.current || undefined,
                endpoint_name: activeEndpoint || undefined,
                model_name: activeModel || undefined,
                security_mode: securityMode,
            }, (event) => {
                // Update session ID for new sessions
                const eventSessionId = event.metadata?.session_id;
                if (eventSessionId && eventSessionId !== currentSessionIdRef.current) {
                    // Sync to server session id (new or corrected)
                    currentSessionIdRef.current = eventSessionId;
                    setCurrentSessionId(eventSessionId);
                    // Refresh the session list in background to show the new item
                    loadSessions();
                }

                // IMPORTANT: Do NOT call loadSessions() here for every event, that causes flickering!
                // We only need to load sessions:
                // 1. At the start (handled above)
                // 2. At the end (to update title)

                const step: AgentStep = {
                    id: crypto.randomUUID(),
                    type: event.type as any,
                    content: event.content,
                    metadata: event.metadata,
                    timestamp: Date.now(),
                };
                setSteps((prev) => [...prev, step]);

                // Capture slash commands from init event
                if ((event.type as string) === 'system' && event.metadata?.subtype === 'init') {
                    const cmds = event.content?.slash_commands;
                    if (cmds && Array.isArray(cmds)) {
                        const formattedCmds = cmds.map((cmd: string) => ({
                            command: cmd.startsWith('/') ? cmd : `/${cmd}`,
                            description: '',
                        }));
                        setSlashCommands(formattedCmds);
                    }
                }

                switch (event.type) {
                    case 'thinking_start': {
                        removeThinkingPlaceholder();
                        hasReceivedStreamingThinking = true;
                        const thinkingBlockId = crypto.randomUUID();
                        const thinkingBlock: MessageBlock = {
                            id: thinkingBlockId,
                            type: 'thinking',
                            content: '',
                            status: 'streaming',
                        };
                        addBlock(assistantMessageId, thinkingBlock);
                        currentThinkingBlockId = thinkingBlockId;
                        break;
                    }

                    case 'thinking_delta': {
                        if (currentThinkingBlockId) {
                            appendToTextBlock(assistantMessageId, currentThinkingBlockId, event.content);
                        }
                        break;
                    }

                    case 'thinking_end': {
                        if (currentThinkingBlockId) {
                            updateBlock(assistantMessageId, currentThinkingBlockId, { status: 'success' });
                            currentThinkingBlockId = null;
                        }
                        break;
                    }

                    case 'thinking': {
                        if (hasReceivedStreamingThinking) break;
                        removeThinkingPlaceholder();
                        const thinkingBlockId = crypto.randomUUID();
                        const thinkingBlock: MessageBlock = {
                            id: thinkingBlockId,
                            type: 'thinking',
                            content: event.content,
                            status: 'success',
                        };
                        addBlock(assistantMessageId, thinkingBlock);
                        break;
                    }

                    case 'tool_use': {
                        removeThinkingPlaceholder();
                        if (currentTextBlockId) {
                            updateBlock(assistantMessageId, currentTextBlockId, { status: 'success' });
                            currentTextBlockId = null;
                        }

                        const toolName = event.content?.name;
                        const toolInput = event.content?.input;

                        // Special handling for TodoWrite
                        if (toolName === 'TodoWrite') {
                            const todos = toolInput?.todos || [];
                            if (todos.length > 0) {
                                const planBlockId = `plan-${assistantMessageId}`;
                                const planBlock: MessageBlock = {
                                    id: planBlockId,
                                    type: 'plan',
                                    content: toolInput,
                                    status: 'success',
                                    metadata: {
                                        toolName: 'TodoWrite',
                                        toolCallId: event.content?.id,
                                        todos: todos.map((todo: any, index: number) => ({
                                            id: `todo-${index}`,
                                            content: todo.content || todo.task || String(todo),
                                            status: todo.status || 'pending',
                                        })),
                                    },
                                };

                                setMessages((prev) =>
                                    prev.map((msg) => {
                                        if (msg.id === assistantMessageId) {
                                            const existingPlanIndex = msg.blocks?.findIndex(b => b.id === planBlockId);
                                            if (existingPlanIndex !== undefined && existingPlanIndex >= 0) {
                                                const newBlocks = [...(msg.blocks || [])];
                                                newBlocks[existingPlanIndex] = planBlock;
                                                return { ...msg, blocks: newBlocks };
                                            } else {
                                                return { ...msg, blocks: [...(msg.blocks || []), planBlock] };
                                            }
                                        }
                                        return msg;
                                    })
                                );
                            }
                            break;
                        }

                        if (toolName === 'AskUserQuestion') break;

                        const toolBlockId = crypto.randomUUID();
                        const toolBlock: MessageBlock = {
                            id: toolBlockId,
                            type: 'tool_use',
                            content: {
                                name: toolName,
                                input: toolInput,
                            },
                            status: 'executing',
                            metadata: {
                                toolName: toolName,
                                toolCallId: event.content?.id,
                            },
                        };
                        addBlock(assistantMessageId, toolBlock);

                        if (event.content?.id) {
                            activeToolCalls.set(event.content.id, toolBlockId);
                        }
                        toolBlocksInOrder.push(toolBlockId);
                        break;
                    }

                    case 'tool_result': {
                        const toolUseId = event.content?.tool_use_id;
                        let blockId = toolUseId ? activeToolCalls.get(toolUseId) : null;

                        if (!blockId && toolBlocksInOrder.length > 0) {
                            blockId = toolBlocksInOrder[0];
                            toolBlocksInOrder.shift();
                        }

                        if (blockId) {
                            const isError = event.content?.is_error === true;
                            updateBlock(assistantMessageId, blockId, {
                                status: isError ? 'error' : 'success',
                                content: {
                                    name: event.content?.name,
                                    input: event.content?.input,
                                    result: event.content?.result,
                                },
                            });
                            if (toolUseId) {
                                activeToolCalls.delete(toolUseId);
                            }
                        }
                        break;
                    }

                    // Tool input streaming events - show real-time progress during code generation
                    case 'tool_input_start': {
                        removeThinkingPlaceholder();
                        if (currentTextBlockId) {
                            updateBlock(assistantMessageId, currentTextBlockId, { status: 'success' });
                            currentTextBlockId = null;
                        }

                        const toolName = event.content?.name || 'Tool';
                        const toolId = event.id || crypto.randomUUID();
                        const toolBlockId = `tool-streaming-${toolId}`;

                        const toolBlock: MessageBlock = {
                            id: toolBlockId,
                            type: 'tool_use',
                            content: {
                                name: toolName,
                                input: {},  // Will accumulate via deltas
                                inputBuffer: '',  // Raw JSON buffer for streaming display
                            },
                            status: 'streaming',
                            metadata: {
                                toolName: toolName,
                                toolCallId: toolId,
                                isStreaming: true,
                            },
                        };
                        addBlock(assistantMessageId, toolBlock);

                        // Track this streaming tool block
                        if (event.id) {
                            activeToolCalls.set(event.id, toolBlockId);
                        }
                        toolBlocksInOrder.push(toolBlockId);
                        break;
                    }

                    case 'tool_input_delta': {
                        // Find the streaming tool block by event.id
                        const toolBlockId = event.id ? activeToolCalls.get(event.id) : null;
                        if (toolBlockId && event.content) {
                            // Append partial JSON to the input buffer for display
                            setMessages((prev) =>
                                prev.map((msg) => {
                                    if (msg.id === assistantMessageId && msg.blocks) {
                                        const blocks = msg.blocks.map((block) => {
                                            if (block.id === toolBlockId) {
                                                const currentBuffer = block.content?.inputBuffer || '';
                                                return {
                                                    ...block,
                                                    content: {
                                                        ...block.content,
                                                        inputBuffer: currentBuffer + event.content,
                                                    },
                                                };
                                            }
                                            return block;
                                        });
                                        return { ...msg, blocks };
                                    }
                                    return msg;
                                })
                            );
                        }
                        break;
                    }

                    case 'tool_input_end': {
                        // Mark the streaming tool block as executing (waiting for result)
                        const toolBlockId = event.id ? activeToolCalls.get(event.id) : null;
                        if (toolBlockId) {
                            updateBlock(assistantMessageId, toolBlockId, {
                                status: 'executing',
                                metadata: {
                                    isStreaming: false,
                                },
                            });
                        }
                        break;
                    }

                    case 'text_start': {
                        removeThinkingPlaceholder();
                        hasReceivedStreamingText = true;
                        const textBlockId = crypto.randomUUID();
                        const textBlock: MessageBlock = {
                            id: textBlockId,
                            type: 'text',
                            content: '',
                            status: 'streaming',
                        };
                        addBlock(assistantMessageId, textBlock);
                        currentTextBlockId = textBlockId;
                        setMessages((prev) =>
                            prev.map((msg) =>
                                msg.id === assistantMessageId ? { ...msg, isStreaming: true } : msg
                            )
                        );
                        break;
                    }

                    case 'text_delta': {
                        if (currentTextBlockId) {
                            appendToTextBlock(assistantMessageId, currentTextBlockId, event.content);
                        }
                        setMessages((prev) =>
                            prev.map((msg) =>
                                msg.id === assistantMessageId ? { ...msg, content: msg.content + event.content } : msg
                            )
                        );
                        break;
                    }

                    case 'text_end': {
                        if (currentTextBlockId) {
                            updateBlock(assistantMessageId, currentTextBlockId, { status: 'success' });
                            currentTextBlockId = null;
                        }
                        setMessages((prev) =>
                            prev.map((msg) =>
                                msg.id === assistantMessageId ? { ...msg, isStreaming: false } : msg
                            )
                        );
                        break;
                    }

                    case 'text': {
                        removeThinkingPlaceholder();
                        if (hasReceivedStreamingText) break;
                        const textBlockId = crypto.randomUUID();
                        const textBlock: MessageBlock = {
                            id: textBlockId,
                            type: 'text',
                            content: event.content,
                            status: 'success',
                        };
                        addBlock(assistantMessageId, textBlock);
                        setMessages((prev) =>
                            prev.map((msg) => {
                                if (msg.id === assistantMessageId && msg.content === '') {
                                    return { ...msg, content: event.content };
                                }
                                return msg;
                            })
                        );
                        break;
                    }

                    case 'todos': {
                        const todos = event.content?.todos || [];
                        if (todos.length > 0) {
                            const planBlockId = `plan-${assistantMessageId}`;
                            const planBlock: MessageBlock = {
                                id: planBlockId,
                                type: 'plan',
                                content: event.content,
                                status: 'success',
                                metadata: {
                                    todos: todos.map((todo: any, index: number) => ({
                                        id: `todo-${index}`,
                                        content: todo.content || todo.task || todo.text || String(todo),
                                        status: todo.status || 'pending',
                                    })),
                                },
                            };

                            setMessages((prev) =>
                                prev.map((msg) => {
                                    if (msg.id === assistantMessageId) {
                                        const existingPlanIndex = msg.blocks?.findIndex(b => b.id === planBlockId);
                                        if (existingPlanIndex !== undefined && existingPlanIndex >= 0) {
                                            const newBlocks = [...(msg.blocks || [])];
                                            newBlocks[existingPlanIndex] = planBlock;
                                            return { ...msg, blocks: newBlocks };
                                        } else {
                                            return { ...msg, blocks: [...(msg.blocks || []), planBlock] };
                                        }
                                    }
                                    return msg;
                                })
                            );
                        }
                        break;
                    }

                    case 'done': {
                        setIsProcessing(false);
                        // Update session status to idle (task completed)
                        // Use event's session_id for multiplexed mode
                        const doneSessionId = event.metadata?.session_id || currentSessionIdRef.current;
                        if (doneSessionId) {
                            setSessionStatus(doneSessionId, {
                                status: 'idle',
                                hasUnread: false,
                            });
                        }
                        loadSessions();
                        setMessages((prev) =>
                            prev.map((msg) => {
                                if (msg.id === assistantMessageId && msg.blocks) {
                                    const blocks = msg.blocks.map((block) =>
                                        block.status === 'executing' || block.status === 'streaming'
                                            ? { ...block, status: 'success' as const }
                                            : block
                                    );
                                    return {
                                        ...msg,
                                        blocks,
                                        usage: event.usage,
                                        isStreaming: false
                                    };
                                }
                                if (msg.id === assistantMessageId) {
                                    return { ...msg, usage: event.usage, isStreaming: false };
                                }
                                return msg;
                            })
                        );
                        setTimeout(() => inputAreaRef.current?.focus(), 100);
                        break;
                    }

                    case 'ask_user': {
                        const content = event.content as AskUserContent;
                        const askUserBlockId = `ask-user-${content.request_id}`;
                        const askUserBlock: MessageBlock = {
                            id: askUserBlockId,
                            type: 'ask_user',
                            content: {
                                input: {
                                    questions: content.questions,
                                    timeout: content.timeout,
                                },
                            },
                            status: 'pending',
                            metadata: {
                                requestId: content.request_id,
                            },
                        };

                        setMessages((prev) =>
                            prev.map((msg) => {
                                if (msg.id === assistantMessageId) {
                                    return { ...msg, blocks: [...(msg.blocks || []), askUserBlock] };
                                }
                                return msg;
                            })
                        );
                        break;
                    }

                    case 'permission_request': {
                        const permContent = event.content as { request_id: string; tool_name: string; input: any };
                        const permBlockId = `permission-${permContent.request_id}`;
                        const permBlock: MessageBlock = {
                            id: permBlockId,
                            type: 'tool_use',
                            content: {
                                name: permContent.tool_name,
                                input: permContent.input,
                                description: `Tool "${permContent.tool_name}" is requesting permission to execute`,
                            },
                            status: 'pending',
                            metadata: {
                                requestId: permContent.request_id,
                                toolName: permContent.tool_name,
                                requiresPermission: true,
                            },
                        };

                        setMessages((prev) =>
                            prev.map((msg) => {
                                if (msg.id === assistantMessageId) {
                                    return { ...msg, blocks: [...(msg.blocks || []), permBlock] };
                                }
                                return msg;
                            })
                        );
                        break;
                    }

                    case 'error': {
                        setIsProcessing(false);
                        // Update session status to error
                        // Use event's session_id for multiplexed mode
                        const errorSessionId = event.metadata?.session_id || currentSessionIdRef.current;
                        if (errorSessionId) {
                            const errorMsg = event.content?.message || 'An error occurred';
                            setSessionStatus(errorSessionId, {
                                status: 'error',
                                hasUnread: false,
                                error: errorMsg,
                            });
                        }
                        const errorMessage = event.content?.message || 'An error occurred';
                        toast.error('Error', { description: errorMessage });

                        // Add error block
                        const errorBlockId = crypto.randomUUID();
                        const errorBlock: MessageBlock = {
                            id: errorBlockId,
                            type: 'text',
                            content: `Error: ${errorMessage}`,
                            status: 'error',
                        };
                        addBlock(assistantMessageId, errorBlock);
                        break;
                    }
                }
            });
        } catch (error: any) {
            console.error('Failed to send message:', error);
            setIsProcessing(false);
            toast.error('Error', { description: error.message || 'Failed to send message' });
        }
    };

    return {
        // State
        messages,
        isProcessing,
        isCurrentSessionProcessing, // Per-session processing state
        securityMode,
        slashCommands,
        inputAreaRef,

        // Handlers
        handleNewSession,
        handleSelectSession,
        handleDeleteSession,
        handleSend,
        handlePermissionResponse,
        handleAskUserSubmit,
        handleAskUserSkip,
        setSecurityMode,
        loadSessions,
    };
}
