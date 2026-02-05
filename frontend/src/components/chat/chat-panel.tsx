"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { Message, AgentStep, MessageBlock } from "@/lib/types";
import { sessionClient, AskUserContent } from "@/lib/websocket";
import { sessionsApi } from "@/lib/sessions-api";
import { buildContextUsageCalibration } from "@/lib/context-usage";
import { MessageList } from "./message-list";
import { InputArea, InputAreaRef, SecurityMode } from "./input-area";
import { McpSidebarPanel } from "./mcp-sidebar-panel";
import { SessionSidebar, SessionSidebarToggle } from "./session-sidebar-new";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import Link from "next/link";
import { useChat } from "@/lib/store";
import { ThemeToggle } from "@/components/theme-toggle";

import { PanelRightClose, PanelRightOpen, Settings } from "lucide-react";

const normalizeUsage = (usage: unknown): { input_tokens: number; output_tokens: number; total_tokens: number } | null => {
    if (!usage || typeof usage !== "object") return null;
    const usageRecord = usage as Record<string, unknown>;
    const inputTokens = Number(usageRecord.input_tokens ?? 0);
    const outputTokens = Number(usageRecord.output_tokens ?? 0);
    const totalTokens = Number(
        typeof usageRecord.total_tokens === "number" ? usageRecord.total_tokens : inputTokens + outputTokens
    );
    if (!Number.isFinite(totalTokens)) return null;
    return {
        input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
        total_tokens: totalTokens,
    };
};

const asRecord = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === "object") {
        return value as Record<string, unknown>;
    }
    return {};
};

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function ChatPanel() {
    const {
        messages, setMessages,
        setSteps,
        isProcessing, setIsProcessing,
        isSidebarOpen, setIsSidebarOpen,
        sidebarWidth, setSidebarWidth,
        sessions, setSessions,
        currentSessionId, setCurrentSessionId,
        isSessionSidebarOpen, setIsSessionSidebarOpen,
        isSessionsLoading, setIsSessionsLoading,
        activeEndpoint, setActiveEndpoint,
        activeModel, setActiveModel,
        setContextUsage,
    } = useChat();

    // Ref for focusing input
    const inputAreaRef = useRef<InputAreaRef>(null);
    const isDraftSessionRef = useRef(false);

    // Ref to track current session ID (for use in callbacks to get latest value)
    const currentSessionIdRef = useRef<string | null>(currentSessionId);
    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    // Security mode state (default to Bypass for compatibility)
    const [securityMode, setSecurityMode] = useState<SecurityMode>('bypassPermissions');

    // Slash commands from SDK (captured from init event)
    const [slashCommands, setSlashCommands] = useState<{ command: string, description: string }[]>([]);
    // Initialize connection and load sessions
    useEffect(() => {
        sessionClient.connect().catch((error) => {
            console.warn("Session WebSocket connection failed, will retry on message send", error);
        });

        // Load sessions on mount
        loadSessions();
    }, [loadSessions]);

    // Load session messages when currentSessionId changes
    useEffect(() => {
        if (currentSessionId) {
            loadSessionMessages(currentSessionId);
        }
    }, [currentSessionId, loadSessionMessages]);

    // Load sessions from API
    const loadSessions = useCallback(async () => {
        try {
            setIsSessionsLoading(true);
            const sessionList = await sessionsApi.list();
            setSessions(sessionList);

            // Validate current session exists, otherwise reset
            if (currentSessionId) {
                const sessionExists = sessionList.some((s) => s.id === currentSessionId);
                if (!sessionExists) {
                    console.warn(`Current session ${currentSessionId} no longer exists, resetting...`);
                    setCurrentSessionId(sessionList.length > 0 ? sessionList[0].id : null);
                    setMessages([]);
                    setContextUsage(null);
                }
            } else if (sessionList.length > 0 && !isDraftSessionRef.current) {
                // If no current session but sessions exist, select the first one
                setCurrentSessionId(sessionList[0].id);
            }
        } catch (error) {
            console.error("Failed to load sessions:", error);
        } finally {
            setIsSessionsLoading(false);
        }
    }, [currentSessionId, setContextUsage, setCurrentSessionId, setIsSessionsLoading, setMessages, setSessions]);

    // Load messages for a specific session
    const loadSessionMessages = useCallback(async (sessionId: string) => {
        try {
            const session = await sessionsApi.get(sessionId);
            // Convert session messages to Message format
            const msgs: Message[] = session.messages.map((m, mIndex) => {
                // Convert blocks to proper MessageBlock format
                let blocks: MessageBlock[] | undefined = undefined;
                if (m.blocks && Array.isArray(m.blocks)) {
                    blocks = m.blocks.map((b, bIndex) => ({
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
                    usage: normalizeUsage(m.usage) || undefined,
                };
            });
            setMessages(msgs);
            setContextUsage(session.context_usage ?? null);

            // Restore session's model and endpoint
            if (session.last_endpoint_name && session.last_model_name) {
                // Note: ModelSelector will validate if endpoint still exists
                setActiveEndpoint(session.last_endpoint_name);
                setActiveModel(session.last_model_name);
            }
            // If session has no model info (old session), ModelSelector will use defaults
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Failed to load session messages:", error);
            // If session not found, reset to no session
            if (message.includes('not found')) {
                console.warn(`Session ${sessionId} not found, resetting...`);
                setCurrentSessionId(null);
                setMessages([]);
                setContextUsage(null);
                // Reload sessions to get fresh list
                loadSessions();
            } else {
                setMessages([]);
                setContextUsage(null);
            }
        }
    }, [loadSessions, setActiveEndpoint, setActiveModel, setContextUsage, setCurrentSessionId, setMessages]);

    // Start a draft session (actual session created on send)
    const handleNewSession = async () => {
        setCurrentSessionId(null);
        isDraftSessionRef.current = true;
        setMessages([]);
        setSteps([]);
        setContextUsage(null);
        setIsProcessing(false);
        setTimeout(() => inputAreaRef.current?.focus(), 100);
    };

    // Select a session
    const handleSelectSession = (id: string) => {
        if (id !== currentSessionId) {
            isDraftSessionRef.current = false;
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
                    setContextUsage(null);
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

        const assistantMessage: Message = {
            id: assistantMessageId,
            role: "assistant",
            content: "", // Keep for legacy compatibility
            timestamp: Date.now(),
            blocks: [],
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
                // Capture the streaming session ID (use event's session_id or the one we sent)
                const streamingSessionId = event.metadata?.session_id || currentSessionId;

                // Update currentSessionId if returned from server (for new sessions)
                if (event.metadata?.session_id && !currentSessionId && isDraftSessionRef.current) {
                    setCurrentSessionId(event.metadata.session_id);
                    // Also update the ref immediately so subsequent checks work
                    currentSessionIdRef.current = event.metadata.session_id;
                    isDraftSessionRef.current = false;
                    // Reload sessions to include the new one
                    loadSessions();
                }

                // CRITICAL: Skip UI updates if user has switched to a different session
                // The streaming continues in the background, but we don't update the current view
                const viewingSessionId = currentSessionIdRef.current;
                if (streamingSessionId && viewingSessionId && streamingSessionId !== viewingSessionId) {
                    // User is viewing a different session - skip UI updates
                    // (but still process system events like init)
                    if ((event.type as string) !== 'system') {
                        return;
                    }
                }

                const step: AgentStep = {
                    id: crypto.randomUUID(),
                    type: event.type as AgentStep["type"],
                    content: event.content,
                    metadata: event.metadata,
                    timestamp: Date.now(),
                };
                setSteps((prev) => [...prev, step]);

                if ((event.type as string) === 'auto_compact_refresh') {
                    if (streamingSessionId) {
                        loadSessionMessages(streamingSessionId);
                    }
                    return;
                }

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

                        const toolContent = asRecord(event.content);
                        const toolName = asString(toolContent.name);
                        const toolInput = toolContent.input;

                        // Special handling for TodoWrite - create/update a plan block
                        if (toolName === 'TodoWrite') {
                            // Extract todos from the input
                            const inputRecord = asRecord(toolInput);
                            const todosValue = inputRecord.todos;
                            const todos = Array.isArray(todosValue) ? todosValue : [];
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
                                        toolCallId: asString(toolContent.id),
                                        todos: todos.map((todo, index) => {
                                            const todoRecord = asRecord(todo);
                                            const content = asString(todoRecord.content)
                                                || asString(todoRecord.task)
                                                || String(todo);
                                            const statusRaw = asString(todoRecord.status) || 'pending';
                                            const status = statusRaw === 'completed' || statusRaw === 'in_progress' || statusRaw === 'pending'
                                                ? statusRaw
                                                : 'pending';
                                            return {
                                                id: `todo-${index}`,
                                                content,
                                                status,
                                            };
                                        }),
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
                            blockId = toolBlocksInOrder[0] ?? null;

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
                            // Merge result into existing content instead of overwriting
                            // This preserves original name and input from tool_use event
                            setMessages((prev) =>
                                prev.map((msg) => {
                                    if (msg.id === assistantMessageId && msg.blocks) {
                                        const blocks = msg.blocks.map((block) => {
                                            if (block.id === blockId) {
                                                return {
                                                    ...block,
                                                    status: isError ? 'error' : 'success',
                                                    content: {
                                                        ...block.content,  // Preserve existing name, input
                                                        result: event.content?.result,
                                                        is_error: isError,
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
                        const todoContent = asRecord(event.content);
                        const todosValue = todoContent.todos;
                        const todos = Array.isArray(todosValue) ? todosValue : [];
                        if (todos.length > 0) {
                            const planBlockId = `plan-${assistantMessageId}`;
                            const planBlock: MessageBlock = {
                                id: planBlockId,
                                type: 'plan',
                                content: todoContent,
                                status: 'success',
                                metadata: {
                                    todos: todos.map((todo, index) => {
                                        const todoRecord = asRecord(todo);
                                        const content = asString(todoRecord.content)
                                            || asString(todoRecord.task)
                                            || asString(todoRecord.text)
                                            || String(todo);
                                        const statusRaw = asString(todoRecord.status) || 'pending';
                                        const status = statusRaw === 'completed' || statusRaw === 'in_progress' || statusRaw === 'pending'
                                            ? statusRaw
                                            : 'pending';
                                        return {
                                            id: `todo-${index}`,
                                            content,
                                            status,
                                        };
                                    }),
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
                        const usage = normalizeUsage(event.usage ?? asRecord(event.content).usage);
                        setIsProcessing(false);
                        // Refresh session list to update title if it was auto-generated
                        loadSessions();
                        // Mark any remaining streaming/executing blocks as success
                        setMessages((prev) => {
                            let candidateContent: string | null = null;
                            const next = prev.map((msg) => {
                                if (msg.id === assistantMessageId && msg.blocks) {
                                    const blocks = msg.blocks.map((block) =>
                                        block.status === 'executing' || block.status === 'streaming'
                                            ? { ...block, status: 'success' as const }
                                            : block
                                    );
                                    candidateContent = msg.content || '';
                                    return {
                                        ...msg,
                                        blocks,
                                        ...(usage ? { usage } : {}),
                                        isStreaming: false
                                    };
                                }
                                if (msg.id === assistantMessageId) {
                                    candidateContent = msg.content || '';
                                    return { ...msg, ...(usage ? { usage } : {}), isStreaming: false };
                                }
                                return msg;
                            });
                            if (candidateContent) {
                                const calibration = buildContextUsageCalibration(
                                    next,
                                    candidateContent,
                                    assistantMessageId
                                );
                                if (calibration) {
                                    setContextUsage(calibration);
                                }
                            }
                            return next;
                        });
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

                    case "auto_compact_status": {
                        const statusContent = event.content as { phase?: string; status?: string; message?: string };
                        const statusBlock: MessageBlock = {
                            id: crypto.randomUUID(),
                            type: 'text',
                            content: statusContent?.message || 'Auto compacting context...',
                            status: 'success',
                            metadata: {
                                isStatus: true,
                                statusKind: 'auto_compact',
                                statusPhase: statusContent?.phase,
                                statusState: statusContent?.status,
                            },
                        };
                        addBlock(assistantMessageId, statusBlock);
                        break;
                    }

                    case "permission_request": {
                        // Create a permission block in the message flow
                        const permContent = asRecord(event.content);
                        const requestId = asString(permContent.request_id) || "";
                        const toolName = asString(permContent.tool_name) || "Tool";
                        const permBlockId = `permission-${requestId}`;

                        const permBlock: MessageBlock = {
                            id: permBlockId,
                            type: 'tool_use',
                            content: {
                                name: toolName,
                                input: permContent.input,
                                description: `Tool "${toolName}" is requesting permission to execute`,
                            },
                            status: 'pending',
                            metadata: {
                                requestId,
                                toolName,
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

                                {/* Center spacer */}
                                <div className="flex-1" />

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
                                <div className="h-full w-full max-w-4xl mx-auto">
                                    <MessageList
                                        messages={messages}
                                        onPermissionResponse={handlePermissionResponse}
                                        onAskUserSubmit={handleAskUserSubmit}
                                        onAskUserSkip={handleAskUserSkip}
                                    />
                                </div>
                            </div>

                            <div className="flex-none z-10">
                                <div className="w-full max-w-4xl mx-auto">
                                    <InputArea
                                        ref={inputAreaRef}
                                        onSend={handleSend}
                                        isRunning={isProcessing}
                                        securityMode={securityMode}
                                        onSecurityModeChange={setSecurityMode}
                                        slashCommands={slashCommands.length > 0 ? slashCommands : undefined}
                                    />
                                </div>
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
                                <McpSidebarPanel onMentionFile={(path) => inputAreaRef.current?.addFileReference(path)} />
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
