"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { Message, AgentStep, MessageBlock, Session } from "@/lib/types";
import { sessionClient, AskUserContent } from "@/lib/websocket";
import { sessionsApi } from "@/lib/sessions-api";
import { MessageList } from "./message-list";
import { InputArea, InputAreaRef, SecurityMode } from "./input-area";
import { McpSidebarPanel } from "./mcp-sidebar-panel";
import { SessionSidebar, SessionSidebarToggle } from "./session-sidebar-new";
import { ModelSelector } from "./model-selector";
import { AskUserDialog } from "./ask-user-dialog";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import Link from "next/link";
import { useChat } from "@/lib/store";
import { ThemeToggle } from "@/components/theme-toggle";

import { PanelRightClose, PanelRightOpen, Settings } from "lucide-react";

export function ChatPanel() {
    const {
        messages, setMessages,
        steps, setSteps,
        isProcessing, setIsProcessing,
        isSidebarOpen, setIsSidebarOpen,
        sidebarWidth, setSidebarWidth,
        sessions, setSessions,
        currentSessionId, setCurrentSessionId,
        isSessionSidebarOpen, setIsSessionSidebarOpen,
        isSessionsLoading, setIsSessionsLoading,
        activeEndpoint, setActiveEndpoint,
        activeModel, setActiveModel,
    } = useChat();

    // Ref for focusing input
    const inputAreaRef = useRef<InputAreaRef>(null);

    // Ask User Question state
    const [askUserRequest, setAskUserRequest] = useState<AskUserContent | null>(null);

    // Security mode state (default to Bypass for compatibility)
    const [securityMode, setSecurityMode] = useState<SecurityMode>('bypassPermissions');

    // Slash commands from SDK (captured from init event)
    const [slashCommands, setSlashCommands] = useState<{ command: string, description: string }[]>([]);
    // Initialize connection and load sessions
    useEffect(() => {
        sessionClient.connect().catch((err) => {
            console.warn("Session WebSocket connection failed, will retry on message send");
        });

        // Load sessions on mount
        loadSessions();
    }, []);

    // Load session messages when currentSessionId changes
    useEffect(() => {
        if (currentSessionId) {
            loadSessionMessages(currentSessionId);
        }
    }, [currentSessionId]);

    // Load sessions from API
    const loadSessions = async () => {
        try {
            setIsSessionsLoading(true);
            const sessionList = await sessionsApi.list();
            setSessions(sessionList);

            // Validate current session exists, otherwise reset
            if (currentSessionId) {
                const sessionExists = sessionList.some((s: any) => s.id === currentSessionId);
                if (!sessionExists) {
                    console.warn(`Current session ${currentSessionId} no longer exists, resetting...`);
                    setCurrentSessionId(sessionList.length > 0 ? sessionList[0].id : null);
                    setMessages([]);
                }
            } else if (sessionList.length > 0) {
                // If no current session but sessions exist, select the first one
                setCurrentSessionId(sessionList[0].id);
            }
        } catch (error) {
            console.error("Failed to load sessions:", error);
        } finally {
            setIsSessionsLoading(false);
        }
    };

    // Load messages for a specific session
    const loadSessionMessages = async (sessionId: string) => {
        try {
            const session = await sessionsApi.get(sessionId);
            // Convert session messages to Message format
            const msgs: Message[] = session.messages.map((m: any, mIndex: number) => {
                // Convert blocks to proper MessageBlock format
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
                    timestamp: m.timestamp * 1000,  // Convert to milliseconds
                    blocks,
                };
            });
            setMessages(msgs);

            // Restore session's model and endpoint
            if (session.last_endpoint_name && session.last_model_name) {
                // Note: ModelSelector will validate if endpoint still exists
                setActiveEndpoint(session.last_endpoint_name);
                setActiveModel(session.last_model_name);
            }
            // If session has no model info (old session), ModelSelector will use defaults
        } catch (error: any) {
            console.error("Failed to load session messages:", error);
            // If session not found, reset to no session
            if (error?.message?.includes('not found')) {
                console.warn(`Session ${sessionId} not found, resetting...`);
                setCurrentSessionId(null);
                setMessages([]);
                // Reload sessions to get fresh list
                loadSessions();
            } else {
                setMessages([]);
            }
        }
    };

    // Create a new session
    const handleNewSession = async () => {
        try {
            const newSession = await sessionsApi.create();
            setSessions((prev) => [newSession, ...prev]);
            setCurrentSessionId(newSession.id);
            setMessages([]);
            setSteps([]);
            // Auto-focus input after creating new session
            setTimeout(() => inputAreaRef.current?.focus(), 100);
        } catch (error) {
            console.error("Failed to create session:", error);
            toast.error("Error", { description: "Failed to create new session" });
        }
    };

    // Select a session
    const handleSelectSession = (id: string) => {
        if (id !== currentSessionId) {
            setCurrentSessionId(id);
            setSteps([]);
            // Auto-focus input after selecting session
            setTimeout(() => inputAreaRef.current?.focus(), 100);
        }
    };

    // Delete a session
    const handleDeleteSession = async (id: string) => {
        try {
            await sessionsApi.delete(id);
            setSessions((prev) => prev.filter((s) => s.id !== id));

            // If deleted current session, switch to another
            if (id === currentSessionId) {
                const remaining = sessions.filter((s) => s.id !== id);
                if (remaining.length > 0) {
                    setCurrentSessionId(remaining[0].id);
                } else {
                    setCurrentSessionId(null);
                    setMessages([]);
                }
            }
            toast.success("Session deleted");
        } catch (error) {
            console.error("Failed to delete session:", error);
            toast.error("Error", { description: "Failed to delete session" });
        }
    };

    // Helper to add a block to the current assistant message
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

    // Helper to update a block's content or status
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

    // Helper to append content to a text or thinking block
    const appendToTextBlock = useCallback((messageId: string, blockId: string, additionalContent: string) => {
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.id === messageId && msg.blocks) {
                    const blocks = msg.blocks.map((block) => {
                        // Support both text and thinking blocks
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

    // Handle permission responses from UI
    const handlePermissionResponse = useCallback((blockId: string, approved: boolean) => {
        // Find the request ID from the block
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

        // Send permission response to backend
        if (requestId) {
            sessionClient.sendPermissionResponse(requestId, approved);
            if (approved) {
                toast.success("Permission Granted", { description: "Tool execution approved" });
            } else {
                toast.info("Permission Denied", { description: "Tool execution was denied" });
            }
        } else {
            // Fallback: try to extract from blockId
            const match = blockId.match(/^permission-(.+)$/);
            if (match) {
                sessionClient.sendPermissionResponse(match[1], approved);
            }
            if (!approved) {
                toast.info("Permission Denied", { description: "Tool execution was denied" });
            }
        }
    }, [setMessages]);

    // Handle AskUser submit from inline block
    const handleAskUserSubmit = useCallback((requestId: string, answers: Record<string, string>) => {
        // Update block status to success with answers
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

        // Send response via WebSocket
        sessionClient.sendUserResponse(requestId, answers);

        // Clear the dialog state
        setAskUserRequest(null);
    }, [setMessages]);

    // Handle AskUser skip from inline block
    const handleAskUserSkip = useCallback((requestId: string) => {
        // Update block status to error (skipped)
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

        // Cancel via sending empty response (same as dialog cancel)
        sessionClient.sendUserResponse(requestId, {});
        setAskUserRequest(null);
    }, [setMessages]);

    const handleSend = async (content: string) => {
        if (isProcessing) return;

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content,
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setSteps([]);
        setIsProcessing(true);

        const assistantMessageId = crypto.randomUUID();
        const thinkingPlaceholderId = `thinking-placeholder-${assistantMessageId}`;

        // Create thinking placeholder block that will be shown immediately
        const thinkingPlaceholderBlock: MessageBlock = {
            id: thinkingPlaceholderId,
            type: 'thinking',
            content: '思考中...',
            status: 'streaming',
            metadata: { isPlaceholder: true },
        };

        const assistantMessage: Message = {
            id: assistantMessageId,
            role: "assistant",
            content: "", // Keep for legacy compatibility
            timestamp: Date.now(),
            blocks: [thinkingPlaceholderBlock], // Start with thinking placeholder
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Track active tool calls and current blocks
        const activeToolCalls = new Map<string, string>(); // tool_use_id -> block_id
        const toolBlocksInOrder: string[] = []; // Track tool blocks in order for fallback matching
        let currentTextBlockId: string | null = null;
        let currentThinkingBlockId: string | null = null; // Track streaming thinking block
        let hasReceivedStreamingText = false; // Track if we've received text_start/delta/end events
        let hasReceivedStreamingThinking = false; // Track if we've received thinking_start/delta/end events
        let hasRemovedThinkingPlaceholder = false; // Track if we've removed the thinking placeholder

        // Helper to remove thinking placeholder on first real event
        const removeThinkingPlaceholder = () => {
            if (hasRemovedThinkingPlaceholder) return;
            hasRemovedThinkingPlaceholder = true;
            setMessages((prev) =>
                prev.map((msg) => {
                    if (msg.id === assistantMessageId && msg.blocks) {
                        const filteredBlocks = msg.blocks.filter(
                            (block) => block.id !== thinkingPlaceholderId
                        );
                        return { ...msg, blocks: filteredBlocks };
                    }
                    return msg;
                })
            );
        };

        try {
            // Include session_id, endpoint, model, and security_mode in the message
            await sessionClient.sendMessage({
                content,
                session_id: currentSessionId || undefined,
                endpoint_name: activeEndpoint || undefined,
                model_name: activeModel || undefined,
                security_mode: securityMode,
            }, (event) => {
                // Update currentSessionId if returned from server (for new sessions)
                if (event.metadata?.session_id && !currentSessionId) {
                    setCurrentSessionId(event.metadata.session_id);
                    // Reload sessions to include the new one
                    loadSessions();
                }
                const step: AgentStep = {
                    id: crypto.randomUUID(),
                    type: event.type as any,
                    content: event.content,
                    metadata: event.metadata,
                    timestamp: Date.now(),
                };
                setSteps((prev) => [...prev, step]);

                // Handle system event (contains slash_commands from SDK init)
                if ((event.type as string) === 'system' && event.metadata?.subtype === 'init') {
                    const cmds = event.content?.slash_commands;
                    if (cmds && Array.isArray(cmds)) {
                        // Convert SDK format to our format
                        const formattedCmds = cmds.map((cmd: string) => ({
                            command: cmd.startsWith('/') ? cmd : `/${cmd}`,
                            description: '',  // SDK doesn't provide descriptions
                        }));
                        setSlashCommands(formattedCmds);
                        console.log('[ChatPanel] Captured slash commands:', formattedCmds);
                    }
                }

                switch (event.type) {
                    case "thinking_start": {
                        // Remove thinking placeholder - real thinking content is arriving
                        removeThinkingPlaceholder();
                        hasReceivedStreamingThinking = true;

                        // Create a new streaming thinking block
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

                    case "thinking_delta": {
                        if (currentThinkingBlockId) {
                            // Append to current thinking block
                            appendToTextBlock(assistantMessageId, currentThinkingBlockId, event.content);
                        }
                        break;
                    }

                    case "thinking_end": {
                        if (currentThinkingBlockId) {
                            updateBlock(assistantMessageId, currentThinkingBlockId, { status: 'success' });
                            currentThinkingBlockId = null;
                        }
                        break;
                    }

                    case "thinking": {
                        // Legacy complete thinking event - skip if we've received streaming events
                        if (hasReceivedStreamingThinking) {
                            break;
                        }

                        // Remove thinking placeholder now that we have real thinking content
                        removeThinkingPlaceholder();

                        // Create a thinking block with complete content
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

                    case "tool_use": {
                        // Remove thinking placeholder - real content is arriving
                        removeThinkingPlaceholder();

                        // End current text block if any
                        if (currentTextBlockId) {
                            updateBlock(assistantMessageId, currentTextBlockId, { status: 'success' });
                            currentTextBlockId = null;
                        }

                        const toolName = event.content?.name;
                        const toolInput = event.content?.input;

                        // Special handling for TodoWrite - create/update a plan block
                        if (toolName === 'TodoWrite') {
                            // Extract todos from the input
                            const todos = toolInput?.todos || [];
                            if (todos.length > 0) {
                                // Look for existing plan block to update, or create new one
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

                                // Try to update existing plan block, or add new one
                                setMessages((prev) =>
                                    prev.map((msg) => {
                                        if (msg.id === assistantMessageId) {
                                            const existingPlanIndex = msg.blocks?.findIndex(b => b.id === planBlockId);
                                            if (existingPlanIndex !== undefined && existingPlanIndex >= 0) {
                                                // Update existing plan block
                                                const newBlocks = [...(msg.blocks || [])];
                                                newBlocks[existingPlanIndex] = planBlock;
                                                return { ...msg, blocks: newBlocks };
                                            } else {
                                                // Add new plan block
                                                return { ...msg, blocks: [...(msg.blocks || []), planBlock] };
                                            }
                                        }
                                        return msg;
                                    })
                                );
                            }
                            break;
                        }

                        // Skip creating tool_use block for AskUserQuestion
                        // (we create a separate ask_user block for it via ask_user event)
                        if (toolName === 'AskUserQuestion') {
                            break;
                        }

                        // Create a tool use block for other tools
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

                        // Track this tool call for result matching
                        if (event.content?.id) {
                            activeToolCalls.set(event.content.id, toolBlockId);
                        }
                        // Also track in order for fallback matching
                        toolBlocksInOrder.push(toolBlockId);
                        break;
                    }

                    case "tool_result": {
                        // Find and update the corresponding tool block
                        const toolUseId = event.content?.tool_use_id;
                        let blockId = toolUseId ? activeToolCalls.get(toolUseId) : null;

                        // Fallback: if no tool_use_id, find the first executing tool block
                        if (!blockId && toolBlocksInOrder.length > 0) {
                            // Find the first tool block that's still executing
                            blockId = toolBlocksInOrder.find(id => {
                                // We need to check current state - use a simpler approach
                                // Just take the first one and remove it
                                return true;
                            }) || null;

                            if (blockId) {
                                // Remove from order tracking
                                const idx = toolBlocksInOrder.indexOf(blockId);
                                if (idx !== -1) {
                                    toolBlocksInOrder.splice(idx, 1);
                                }
                            }
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

                    case "text_start": {
                        // Remove thinking placeholder - real content is arriving
                        removeThinkingPlaceholder();

                        hasReceivedStreamingText = true; // Mark that we're using streaming text

                        // Create a new text block
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

                    case "text_delta": {
                        if (currentTextBlockId) {
                            // Append to current text block
                            appendToTextBlock(assistantMessageId, currentTextBlockId, event.content);
                        }
                        // Also update legacy content field for compatibility
                        setMessages((prev) =>
                            prev.map((msg) =>
                                msg.id === assistantMessageId ? { ...msg, content: msg.content + event.content } : msg
                            )
                        );
                        break;
                    }

                    case "text_end": {
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

                    case "text": {
                        // Remove thinking placeholder - real content is arriving
                        removeThinkingPlaceholder();

                        // Skip legacy text event if we've already received streaming text events
                        // This prevents text duplication when backend sends both streaming and legacy events
                        if (hasReceivedStreamingText) {
                            break;
                        }

                        // Legacy single text event - create a complete text block
                        const textBlockId = crypto.randomUUID();
                        const textBlock: MessageBlock = {
                            id: textBlockId,
                            type: 'text',
                            content: event.content,
                            status: 'success',
                        };
                        addBlock(assistantMessageId, textBlock);

                        // Also update legacy content field
                        setMessages((prev) =>
                            prev.map((msg) => {
                                if (msg.id === assistantMessageId && msg.content === "") {
                                    return { ...msg, content: event.content };
                                }
                                return msg;
                            })
                        );
                        break;
                    }

                    case "todos": {
                        // Todos received from SystemMessage - create/update plan block
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

                            // Add or update plan block
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

                    case "done": {
                        setIsProcessing(false);
                        // Refresh session list to update title if it was auto-generated
                        loadSessions();
                        // Mark any remaining streaming/executing blocks as success
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
                        // Auto-focus input after conversation ends
                        setTimeout(() => inputAreaRef.current?.focus(), 100);
                        break;
                    }

                    case "ask_user": {
                        // Create an ask_user block in the message flow (inline form)
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

                        // Add the ask_user block to the current assistant message
                        setMessages((prev) =>
                            prev.map((msg) => {
                                if (msg.id === assistantMessageId) {
                                    return { ...msg, blocks: [...(msg.blocks || []), askUserBlock] };
                                }
                                return msg;
                            })
                        );

                        // NOTE: Not setting askUserRequest since we disabled the popup dialog
                        // and now use inline block for questions
                        break;
                    }

                    case "permission_request": {
                        // Create a permission block in the message flow
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

                        // Add the permission block to the current assistant message
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

                    case "error":
                        setIsProcessing(false);
                        toast.error("Agent Error", { description: String(event.content) });
                        break;
                }
            });
        } catch (error) {
            console.error("Failed to send message:", error);
            setIsProcessing(false);
            toast.error("Error", { description: "Failed to send message" });
        }
    };

    return (
        <div className="h-screen w-full bg-zinc-50 dark:bg-zinc-900 flex overflow-hidden">
            {/* Left Session Sidebar */}
            <SessionSidebar
                sessions={sessions}
                currentSessionId={currentSessionId}
                isOpen={isSessionSidebarOpen}
                isLoading={isSessionsLoading}
                onToggle={() => setIsSessionSidebarOpen(!isSessionSidebarOpen)}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
            />

            {/* Main Content Area with MCP Sidebar */}
            <div className="flex-1 flex overflow-hidden">
                <Group orientation="horizontal" className="flex h-full w-full">
                    <Panel id="chat" defaultSize={isSidebarOpen ? (100 - sidebarWidth) : 100} minSize={20}>
                        <div className="flex flex-col h-full overflow-hidden">
                            <header className="px-6 py-3 border-b flex items-center justify-between bg-card/50 backdrop-blur z-10 flex-none">
                                <div className="flex items-center gap-2">
                                    <SessionSidebarToggle
                                        isOpen={isSessionSidebarOpen}
                                        onToggle={() => setIsSessionSidebarOpen(true)}
                                    />
                                </div>

                                {/* Model Selector - Center */}
                                <div className="flex-1 flex justify-center">
                                    <ModelSelector />
                                </div>

                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2 mr-4">
                                        <div className={`h-2 w-2 rounded-full ${isProcessing ? 'bg-green-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                        <span className="text-xs text-muted-foreground">{isProcessing ? 'Active' : 'Idle'}</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                        title={isSidebarOpen ? "隐藏 MCP Servers" : "显示 MCP Servers"}
                                    >
                                        {isSidebarOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
                                    </Button>
                                    <ThemeToggle />
                                    <Link href="/settings">
                                        <Button variant="ghost" size="icon">
                                            <Settings className="h-5 w-5" />
                                        </Button>
                                    </Link>
                                </div>
                            </header>

                            <div className="flex-1 min-h-0 flex flex-col">
                                <MessageList
                                    messages={messages}
                                    onPermissionResponse={handlePermissionResponse}
                                    onAskUserSubmit={handleAskUserSubmit}
                                    onAskUserSkip={handleAskUserSkip}
                                />
                            </div>

                            <div className="flex-none z-10 bg-background">
                                <InputArea
                                    ref={inputAreaRef}
                                    onSend={handleSend}
                                    disabled={isProcessing}
                                    securityMode={securityMode}
                                    onSecurityModeChange={setSecurityMode}
                                    slashCommands={slashCommands.length > 0 ? slashCommands : undefined}
                                />
                            </div>
                        </div>
                    </Panel>

                    {isSidebarOpen && (
                        <>
                            <Separator className="bg-border relative flex w-px items-center justify-center" />
                            <Panel
                                id="sidebar"
                                defaultSize={sidebarWidth}
                                minSize={20}
                                onResize={(size) => {
                                    const width = typeof size === 'number' ? size : size.asPercentage;
                                    if (width >= 20) {
                                        setSidebarWidth(width);
                                    }
                                }}
                            >
                                <McpSidebarPanel onMentionFile={(path) => inputAreaRef.current?.insertText(path)} />
                            </Panel>
                        </>
                    )}
                </Group>
            </div>
            <Toaster />

            {/* Ask User Dialog - DISABLED: Using inline block instead
            <AskUserDialog
                open={askUserRequest !== null}
                requestId={askUserRequest?.request_id || ""}
                questions={askUserRequest?.questions || []}
                timeout={askUserRequest?.timeout || 55}
                onSubmit={(requestId, answers) => {
                    sessionClient.sendUserResponse(requestId, answers);
                    setAskUserRequest(null);
                }}
                onCancel={(requestId) => {
                    sessionClient.sendUserResponse(requestId, {});
                    setAskUserRequest(null);
                }}
            />
            */}
        </div>
    );
}

