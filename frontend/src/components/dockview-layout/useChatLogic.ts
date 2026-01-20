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
        currentSessionIdRef,  // Use shared ref from Context
    } = useChat();

    // Compute if CURRENT session is processing (for per-session input blocking)
    const isCurrentSessionProcessing = currentSessionId
        ? getSessionStatus(currentSessionId).status === 'running'
        : false;

    const inputAreaRef = useRef<InputAreaRef>(null);
    // Refs to track state inside async functions without dependency issues
    const isProcessingRef = useRef(isProcessing);
    // NOTE: currentSessionIdRef is now obtained from Context (shared across all hook instances)
    // This is crucial for Dockview portals where multiple useChatLogic instances may exist

    useEffect(() => {
        isProcessingRef.current = isProcessing;
    }, [isProcessing]);

    const [askUserRequest, setAskUserRequest] = useState<AskUserContent | null>(null);
    const [securityMode, setSecurityMode] = useState<SecurityMode>('bypassPermissions');
    const [slashCommands, setSlashCommands] = useState<{ command: string; description: string }[]>([]);



    // Load sessions from API
    // Note: This only sets currentSessionId on INITIAL load or if current session was deleted
    // It does NOT change session during normal operations to avoid conflicts with user actions
    const loadSessions = useCallback(async () => {
        const startSessionId = currentSessionIdRef.current;
        console.log('[loadSessions] Called, startSessionId:', startSessionId);
        try {
            setIsSessionsLoading(true);
            const sessionList = await sessionsApi.list();
            setSessions(sessionList);

            // Re-read ref AFTER async call to get the latest value
            // User may have switched sessions while we were waiting for the API
            const currentActiveId = currentSessionIdRef.current;
            console.log('[loadSessions] After API: currentActiveId:', currentActiveId, 'sessionList length:', sessionList.length);

            if (currentActiveId) {
                const sessionExists = sessionList.some((s: { id: string }) => s.id === currentActiveId);
                console.log('[loadSessions] sessionExists:', sessionExists);
                if (!sessionExists) {
                    // Session was deleted, select first available
                    console.warn(`[loadSessions] Session ${currentActiveId} no longer exists, resetting...`);
                    const nextSessionId = sessionList.length > 0 ? sessionList[0].id : null;
                    currentSessionIdRef.current = nextSessionId;
                    setCurrentSessionId(nextSessionId);
                    setMessages([]);
                }
                // If session exists, do NOT modify currentSessionId - user may have switched
            } else if (sessionList.length > 0 && !currentActiveId) {
                // Initial load - no session selected, pick the first one
                console.log('[loadSessions] No active session, setting to first:', sessionList[0].id);
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
                    blocks = m.blocks.map((b: any, bIndex: number) => {
                        // Special handling for TodoWrite - convert to plan block
                        if (b.type === 'tool_use' && (b.metadata?.toolName === 'TodoWrite' || b.content?.name === 'TodoWrite')) {
                            const input = b.content?.input || b.content || {};
                            const todos = input.todos || [];
                            return {
                                id: b.id || `plan-${mIndex}-${bIndex}`,
                                type: 'plan' as const,
                                content: input,
                                status: b.status || 'success',
                                metadata: {
                                    ...b.metadata,
                                    toolName: 'TodoWrite',
                                    todos: todos.map((todo: any, index: number) => ({
                                        id: `todo-${index}`,
                                        content: todo.content || todo.task || String(todo),
                                        status: (todo.status || 'pending') as 'pending' | 'in_progress' | 'completed',
                                    })),
                                },
                            };
                        }
                        return {
                            id: b.id || `block-${mIndex}-${bIndex}`,
                            type: b.type || 'text',
                            content: b.content,
                            status: b.status || 'success',
                            metadata: b.metadata || {},
                        };
                    });
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
    // Use a ref to avoid re-render loops when this is used as a dependency
    const handleGlobalEventRef = useRef<(event: StreamEvent) => void>(() => { });

    handleGlobalEventRef.current = useCallback((event: StreamEvent) => {
        const sessionId = event.metadata?.session_id;
        if (!sessionId) return;

        const isCurrentSession = sessionId === currentSessionIdRef.current;

        // Handle status events (done/error) for ALL sessions
        if (event.type === 'done') {
            console.log(`[handleGlobalEvent] Done event for ${sessionId}`);
            console.log(`[handleGlobalEvent] isCurrentSession: ${isCurrentSession}`);
            setSessionStatus(sessionId, {
                status: 'idle',
                hasUnread: !isCurrentSession,
            });
            if (isCurrentSession) {
                setIsProcessing(false);
                // Mark current turn message as not streaming
                setMessages(prev => prev.map(msg =>
                    msg.id.startsWith(`current-turn-${sessionId}`)
                        ? { ...msg, isStreaming: false }
                        : msg
                ));
                sessionsApi.markRead(sessionId).catch(err =>
                    console.warn(`Failed to mark session ${sessionId} as read:`, err)
                );
            }
            // Refresh session list to update title (backend may have auto-generated title)
            loadSessions();
            return;
        } else if (event.type === 'error') {
            console.log(`[handleGlobalEvent] Error event for ${sessionId}`);
            setSessionStatus(sessionId, {
                status: 'error',
                hasUnread: true,
                error: event.content?.message || 'An error occurred',
            });
            if (isCurrentSession) {
                setIsProcessing(false);
            }
            return;
        }

        // Content events are handled by handleSend's callback, not here
        // handleGlobalEvent only handles status events (done/error) for all sessions
    }, [setSessionStatus, setIsProcessing, setMessages, loadSessions]);

    // Stable wrapper that always calls the latest handler
    const handleGlobalEvent = useCallback((event: StreamEvent) => {
        handleGlobalEventRef.current(event);
    }, []);

    // Rebuild messages from cached events - MUST be defined before recoverAllSessions
    const rebuildMessagesFromEvents = useCallback((events: unknown[], sessionId: string) => {
        if (!events || events.length === 0) return;

        const assistantMessageId = `replayed-${sessionId}-${Date.now()}`;
        // Track text content accumulation for inline text block creation
        let textContent = '';
        let textBlockIndex = -1;  // Index of current text block in blocks array
        const blocks: MessageBlock[] = [];

        for (const event of events as Array<{ type: string; content?: unknown; id?: string; metadata?: Record<string, unknown> }>) {
            switch (event.type) {
                case 'text':
                case 'text_delta': {
                    const delta = (event.content as string) || '';
                    textContent += delta;
                    // Update or create text block at current position
                    if (textBlockIndex >= 0 && blocks[textBlockIndex]) {
                        blocks[textBlockIndex].content = textContent;
                    } else {
                        textBlockIndex = blocks.length;
                        blocks.push({
                            id: `text-${assistantMessageId}-${blocks.length}`,
                            type: 'text',
                            content: textContent,
                            status: 'streaming',
                        });
                    }
                    break;
                }
                case 'thinking': {
                    // Complete thinking event - only use if no existing block (fallback)
                    // Skip if thinking block already exists (was created by thinking_start/delta)
                    if (!blocks.find(b => b.type === 'thinking')) {
                        blocks.push({
                            id: `thinking-${assistantMessageId}`,
                            type: 'thinking',
                            content: (event.content as string) || '',
                            status: 'success',
                        });
                    }
                    break;
                }
                case 'thinking_delta': {
                    // Incremental thinking - find or create and append
                    const thinkingBlock = blocks.find(b => b.type === 'thinking');
                    if (thinkingBlock) {
                        thinkingBlock.content = ((thinkingBlock.content as string) || '') + ((event.content as string) || '');
                    } else {
                        // Insert thinking at current position (before any text that follows)
                        blocks.push({
                            id: `thinking-${assistantMessageId}`,
                            type: 'thinking',
                            content: (event.content as string) || '',
                            status: 'streaming',
                        });
                    }
                    break;
                }
                case 'thinking_start': {
                    if (!blocks.find(b => b.type === 'thinking')) {
                        blocks.push({
                            id: `thinking-${assistantMessageId}`,
                            type: 'thinking',
                            content: '',
                            status: 'streaming',
                        });
                    }
                    break;
                }
                case 'thinking_end': {
                    const thinkingBlock = blocks.find(b => b.type === 'thinking');
                    if (thinkingBlock) {
                        thinkingBlock.status = 'success';
                    }
                    break;
                }
                case 'tool_use':
                    // Reset text block tracking since tool interrupts text flow
                    textBlockIndex = -1;
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
                case 'todos': {
                    const todos = (event.content as { todos?: Array<{ content?: string; task?: string; text?: string; status?: string }> })?.todos || [];
                    if (todos.length > 0) {
                        blocks.push({
                            id: `plan-${assistantMessageId}`,
                            type: 'plan',
                            content: event.content,
                            status: 'success',
                            metadata: {
                                todos: todos.map((todo, index) => ({
                                    id: `todo-${index}`,
                                    content: todo.content || todo.task || todo.text || String(todo),
                                    status: (todo.status || 'pending') as 'pending' | 'in_progress' | 'completed',
                                })),
                            },
                        });
                    }
                    break;
                }
            }
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

    // Append current turn events to existing messages (for running sessions)
    // This is called AFTER loadSessionMessages, so history is already loaded
    const appendCurrentTurnFromEvents = useCallback((events: unknown[], sessionId: string) => {
        if (!events || events.length === 0) return;

        const assistantMessageId = `current-turn-${sessionId}-${Date.now()}`;
        // Track text content accumulation for inline text block creation
        let textContent = '';
        let textBlockIndex = -1;  // Index of current text block in blocks array
        const blocks: MessageBlock[] = [];

        for (const event of events as Array<{ type: string; content?: unknown; id?: string; metadata?: Record<string, unknown> }>) {
            switch (event.type) {
                case 'text':
                case 'text_delta': {
                    const delta = (event.content as string) || '';
                    textContent += delta;
                    // Update or create text block at current position
                    if (textBlockIndex >= 0 && blocks[textBlockIndex]) {
                        blocks[textBlockIndex].content = textContent;
                    } else {
                        textBlockIndex = blocks.length;
                        blocks.push({
                            id: `text-${assistantMessageId}-${blocks.length}`,
                            type: 'text',
                            content: textContent,
                            status: 'streaming',
                        });
                    }
                    break;
                }
                case 'thinking': {
                    // Complete thinking event - only use if no existing block (fallback)
                    // Skip if thinking block already exists (was created by thinking_start/delta)
                    if (!blocks.find(b => b.type === 'thinking')) {
                        blocks.push({
                            id: `thinking-${assistantMessageId}`,
                            type: 'thinking',
                            content: (event.content as string) || '',
                            status: 'success',
                        });
                    }
                    break;
                }
                case 'thinking_delta': {
                    // Incremental thinking - find or create and append
                    const thinkingBlock = blocks.find(b => b.type === 'thinking');
                    if (thinkingBlock) {
                        thinkingBlock.content = ((thinkingBlock.content as string) || '') + ((event.content as string) || '');
                    } else {
                        blocks.push({
                            id: `thinking-${assistantMessageId}`,
                            type: 'thinking',
                            content: (event.content as string) || '',
                            status: 'streaming',
                        });
                    }
                    break;
                }
                case 'thinking_start': {
                    if (!blocks.find(b => b.type === 'thinking')) {
                        blocks.push({
                            id: `thinking-${assistantMessageId}`,
                            type: 'thinking',
                            content: '',
                            status: 'streaming',
                        });
                    }
                    break;
                }
                case 'thinking_end': {
                    const thinkingBlock = blocks.find(b => b.type === 'thinking');
                    if (thinkingBlock) {
                        thinkingBlock.status = 'success';
                    }
                    break;
                }
                case 'tool_use': {
                    // Reset text block tracking since tool interrupts text flow
                    textBlockIndex = -1;
                    const toolContent = event.content as { name?: string; input?: { todos?: Array<{ content?: string; task?: string; status?: string }> }; id?: string };
                    const toolName = toolContent?.name;

                    // Special handling for TodoWrite - convert to plan block
                    if (toolName === 'TodoWrite') {
                        const todos = toolContent?.input?.todos || [];
                        if (todos.length > 0) {
                            blocks.push({
                                id: `plan-${assistantMessageId}`,
                                type: 'plan',
                                content: toolContent.input,
                                status: 'success',
                                metadata: {
                                    toolName: 'TodoWrite',
                                    toolCallId: toolContent.id,
                                    todos: todos.map((todo, index) => ({
                                        id: `todo-${index}`,
                                        content: todo.content || todo.task || String(todo),
                                        status: (todo.status || 'pending') as 'pending' | 'in_progress' | 'completed',
                                    })),
                                },
                            });
                        }
                        break;
                    }

                    blocks.push({
                        id: event.id || `tool-${blocks.length}`,
                        type: 'tool_use',
                        content: event.content,
                        status: 'executing',
                        metadata: (event.metadata as Record<string, string>) || {},
                    });
                    break;
                }
                case 'tool_result':
                    blocks.push({
                        id: event.id || `result-${blocks.length}`,
                        type: 'tool_result',
                        content: event.content,
                        status: 'success',
                        metadata: (event.metadata as Record<string, string>) || {},
                    });
                    break;
                case 'todos': {
                    const todos = (event.content as { todos?: Array<{ content?: string; task?: string; text?: string; status?: string }> })?.todos || [];
                    if (todos.length > 0) {
                        blocks.push({
                            id: `plan-${assistantMessageId}`,
                            type: 'plan',
                            content: event.content,
                            status: 'success',
                            metadata: {
                                todos: todos.map((todo, index) => ({
                                    id: `todo-${index}`,
                                    content: todo.content || todo.task || todo.text || String(todo),
                                    status: (todo.status || 'pending') as 'pending' | 'in_progress' | 'completed',
                                })),
                            },
                        });
                    }
                    break;
                }
            }
        }

        const assistantMessage: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: textContent,
            timestamp: Date.now(),
            blocks: blocks.length > 0 ? blocks : undefined,
            isStreaming: true,
        };

        // Append to existing messages (history already loaded)
        setMessages(prev => {
            // Check if we already have a current-turn message for this session
            const existingIndex = prev.findIndex(m => m.id.startsWith(`current-turn-${sessionId}`));
            if (existingIndex >= 0) {
                const newPrev = [...prev];
                newPrev[existingIndex] = assistantMessage;
                return newPrev;
            }
            return [...prev, assistantMessage];
        });

        // Mark as processing since we're in a running session
        setIsProcessing(true);
    }, [setMessages, setIsProcessing]);

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

        // Set global event handler to process done/error from ANY session
        // This ensures status icons update even when user is viewing a different session
        sessionClient.setGlobalHandler(handleGlobalEvent);

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
            sessionClient.setGlobalHandler(() => { }); // Clear global handler
        };
    }, [loadSessions, recoverAllSessions, handleGlobalEvent]);

    // Load session messages when currentSessionId changes
    // NOTE: For running sessions, handleSelectSession already handles loading with proper sequencing.
    // This useEffect is for: initial page load, or switching to idle sessions.
    useEffect(() => {
        if (currentSessionId) {
            const status = getSessionStatus(currentSessionId);
            // Skip if running session - handleSelectSession handles these
            if (status.status === 'running') {
                console.log(`[useEffect] Session ${currentSessionId} is running, skipping loadSessionMessages (handled by handleSelectSession)`);
                return;
            }
            loadSessionMessages(currentSessionId);
        }
    }, [currentSessionId, loadSessionMessages, getSessionStatus]);

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
    // NOTE: Uses currentSessionIdRef.current for comparisons to keep callback stable
    // and avoid re-render cascades when currentSessionId state changes
    const handleSelectSession = useCallback(async (id: string) => {
        const currentId = currentSessionIdRef.current;
        console.log(`[handleSelectSession] Called with id: ${id}, currentSessionIdRef.current: ${currentId}`);

        if (id !== currentId) {
            console.log(`[handleSelectSession] Switching from ${currentId} to ${id}`);

            // Only unsubscribe from previous session if it's NOT running
            // Running sessions should stay subscribed to receive done/error events
            if (currentId) {
                const prevStatus = getSessionStatus(currentId);
                console.log(`[handleSelectSession] Previous session status:`, prevStatus);
                if (prevStatus.status !== 'running') {
                    sessionClient.unsubscribe(currentId);
                    console.log(`[handleSelectSession] Unsubscribed from ${currentId}`);
                }
            }

            console.log(`[handleSelectSession] Setting currentSessionIdRef.current = ${id}`);
            currentSessionIdRef.current = id;
            console.log(`[handleSelectSession] Calling setCurrentSessionId(${id})`);
            setCurrentSessionId(id);
            setSteps([]);

            // Check session status
            const sessionStatus = getSessionStatus(id);
            console.log(`[handleSelectSession] New session status:`, sessionStatus);

            // Clear unread status when user selects this session
            if (sessionStatus.hasUnread) {
                setSessionStatus(id, {
                    ...sessionStatus,
                    hasUnread: false,
                });
                // Also persist to backend so it survives refresh
                sessionsApi.markRead(id).catch(err =>
                    console.warn(`Failed to mark session ${id} as read:`, err)
                );
            }

            // Step 1: Load historical messages first (await to prevent race condition)
            console.log(`[handleSelectSession] Loading history for session: ${id}`);
            await loadSessionMessages(id);

            // Step 2: If running, append current turn events and subscribe
            if (sessionStatus.status === 'running') {
                console.log(`[handleSelectSession] Session is running, loading current turn events...`);

                try {
                    // Get cached events from backend (current turn only)
                    const eventsData = await sessionsApi.getEvents(id);
                    console.log(`[handleSelectSession] Got ${eventsData.events?.length || 0} current turn events`);

                    // Append current turn to messages (not replace)
                    if (eventsData.events && eventsData.events.length > 0) {
                        appendCurrentTurnFromEvents(eventsData.events, id);
                    }

                    // Step 3: Subscribe for live updates using global handler
                    sessionClient.subscribe(id, handleGlobalEvent);
                    console.log(`[handleSelectSession] Subscribed for live updates: ${id}`);
                } catch (err) {
                    console.error(`[handleSelectSession] Failed to load events for session ${id}:`, err);
                }
            }

            setTimeout(() => inputAreaRef.current?.focus(), 100);
        } else {
            console.log(`[handleSelectSession] Same session, skipping`);
        }
    }, [setCurrentSessionId, setSteps, getSessionStatus, setSessionStatus, loadSessionMessages, appendCurrentTurnFromEvents, handleGlobalEvent, currentSessionIdRef]);

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
        // Use per-session processing check to allow concurrent sessions
        if (isCurrentSessionProcessing) return;

        // Capture the original session ID at send time
        // This is used to detect new session creation vs background session events
        const originalSessionId = currentSessionIdRef.current;

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
                // Update session ID ONLY for NEW session creation
                // Capture the original session ID at send time - only sync if we started with none
                const eventSessionId = event.metadata?.session_id;

                // CRITICAL FIX: Only sync session ID if:
                // 1. We have an event with a session ID
                // 2. The ORIGINAL session ID at send time was null (new session)
                // 3. The current ref still matches the original (user hasn't switched away)
                // This prevents pulling user back to a background session
                if (eventSessionId && !originalSessionId && currentSessionIdRef.current !== eventSessionId) {
                    // This is a newly created session - sync the ID
                    console.log(`[handleSend] New session created: ${eventSessionId}`);
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
                                const toolCallId = event.content?.id;

                                // Find and remove any streaming tool block for this TodoWrite
                                const streamingBlockId = toolCallId ? activeToolCalls.get(toolCallId) : null;
                                if (toolCallId && streamingBlockId) {
                                    activeToolCalls.delete(toolCallId);
                                }

                                // Each TodoWrite creates a new plan block at its position
                                const planBlockId = `plan-${toolCallId || crypto.randomUUID()}`;
                                const planBlock: MessageBlock = {
                                    id: planBlockId,
                                    type: 'plan',
                                    content: toolInput,
                                    status: 'success',
                                    metadata: {
                                        toolName: 'TodoWrite',
                                        toolCallId: toolCallId,
                                        todos: todos.map((todo: any, index: number) => ({
                                            id: `todo-${index}`,
                                            content: todo.content || todo.task || String(todo),
                                            status: todo.status || 'pending',
                                        })),
                                    },
                                };

                                setMessages((prev) =>
                                    prev.map((msg) => {
                                        if (msg.id !== assistantMessageId) return msg;

                                        // Remove streaming tool block and add plan block
                                        const filteredBlocks = streamingBlockId
                                            ? (msg.blocks || []).filter(b => b.id !== streamingBlockId)
                                            : (msg.blocks || []);

                                        return { ...msg, blocks: [...filteredBlocks, planBlock] };
                                    })
                                );
                            }
                            break;
                        }

                        if (toolName === 'AskUserQuestion') break;

                        const toolCallId = event.content?.id;

                        // Check if a streaming block already exists for this tool (from tool_input_start)
                        const existingBlockId = toolCallId ? activeToolCalls.get(toolCallId) : null;

                        if (existingBlockId) {
                            // Update existing streaming block with complete input and change status
                            updateBlock(assistantMessageId, existingBlockId, {
                                status: 'executing',
                                content: {
                                    name: toolName,
                                    input: toolInput,
                                },
                                metadata: {
                                    toolName: toolName,
                                    toolCallId: toolCallId,
                                    isStreaming: false,
                                },
                            });
                            break;
                        }

                        // No existing block - create new one (fallback for non-streaming tools)
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
                                toolCallId: toolCallId,
                            },
                        };
                        addBlock(assistantMessageId, toolBlock);

                        if (toolCallId) {
                            activeToolCalls.set(toolCallId, toolBlockId);
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
                            // Use functional update to preserve existing content.name and content.input
                            setMessages((prev) =>
                                prev.map((msg) => {
                                    if (msg.id === assistantMessageId && msg.blocks) {
                                        const blocks = msg.blocks.map((block) => {
                                            if (block.id === blockId) {
                                                return {
                                                    ...block,
                                                    status: isError ? 'error' : 'success',
                                                    content: {
                                                        ...block.content,  // Preserve existing name, input, etc.
                                                        result: event.content?.result,
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

                        // Skip creating tool_use block for AskUserQuestion
                        // The ask_user event will handle it with complete question data
                        if (toolName === 'AskUserQuestion') {
                            break;
                        }

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
                        console.log('[tool_input_delta] Event received:', event);
                        // Find the streaming tool block by event.id
                        const toolBlockId = event.id ? activeToolCalls.get(event.id) : null;
                        console.log('[tool_input_delta] Looking for block:', event.id, '→', toolBlockId);
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
                        console.log('[ask_user] Event received:', event);
                        console.log('[ask_user] Content:', content);
                        console.log('[ask_user] Questions:', content?.questions);
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
