"use client";

import { useEffect, useCallback, useRef } from "react";
import { Message, AgentStep, MessageBlock } from "@/lib/types";
import { agentClient } from "@/lib/websocket";
import { MessageList } from "./message-list";
import { InputArea } from "./input-area";
import { McpSidebarPanel } from "./mcp-sidebar-panel";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import Link from "next/link";
import { useChat } from "@/lib/store";
import { ThemeToggle } from "@/components/theme-toggle";

import { PanelRightClose, PanelRightOpen, Settings } from "lucide-react";

export function ChatPanel() {
    const { messages, setMessages, steps, setSteps, isProcessing, setIsProcessing, isSidebarOpen, setIsSidebarOpen, sidebarWidth, setSidebarWidth } = useChat();

    // Initialize connection
    useEffect(() => {
        agentClient.connect().catch((err) => {
            console.warn("WebSocket connection failed, will retry on message send");
        });
    }, []);

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

    // Helper to append content to a text block
    const appendToTextBlock = useCallback((messageId: string, blockId: string, additionalContent: string) => {
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.id === messageId && msg.blocks) {
                    const blocks = msg.blocks.map((block) => {
                        if (block.id === blockId && block.type === 'text') {
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
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.blocks) {
                    const blocks = msg.blocks.map((block) => {
                        if (block.id === blockId) {
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

        if (!approved) {
            toast.info("Permission Denied", { description: "Tool execution was denied" });
        }
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

        // Track active tool calls and current text block
        const activeToolCalls = new Map<string, string>(); // tool_use_id -> block_id
        const toolBlocksInOrder: string[] = []; // Track tool blocks in order for fallback matching
        let currentTextBlockId: string | null = null;
        let hasReceivedStreamingText = false; // Track if we've received text_start/delta/end events
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
            await agentClient.sendMessage({ content }, (event) => {
                const step: AgentStep = {
                    id: crypto.randomUUID(),
                    type: event.type as any,
                    content: event.content,
                    metadata: event.metadata,
                    timestamp: Date.now(),
                };

                const skipTypes = ["text", "text_start", "text_delta", "text_end", "done", "start"];
                if (!skipTypes.includes(event.type)) {
                    setSteps((prev) => [...prev, step]);
                }

                switch (event.type) {
                    case "thinking": {
                        // Remove thinking placeholder now that we have real thinking content
                        removeThinkingPlaceholder();

                        // Create a thinking block
                        const thinkingBlockId = crypto.randomUUID();
                        const thinkingBlock: MessageBlock = {
                            id: thinkingBlockId,
                            type: 'thinking',
                            content: event.content,
                            status: 'streaming',
                        };
                        addBlock(assistantMessageId, thinkingBlock);

                        // Mark as complete after a short delay
                        setTimeout(() => {
                            updateBlock(assistantMessageId, thinkingBlockId, { status: 'success' });
                        }, 100);
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
        <div className="h-screen w-full bg-background flex flex-col overflow-hidden">
            <Group orientation="horizontal" className="flex h-full w-full">
                <Panel id="chat" defaultSize={isSidebarOpen ? (100 - sidebarWidth) : 100} minSize={20}>
                    <div className="flex flex-col h-full overflow-hidden">
                        <header className="px-6 py-3 border-b flex items-center justify-between bg-card/50 backdrop-blur z-10 flex-none">
                            <h1 className="font-semibold text-lg tracking-tight">Claude Agent</h1>
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
                            />
                        </div>

                        <div className="flex-none z-10 bg-background">
                            <InputArea onSend={handleSend} disabled={isProcessing} />
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
                            <McpSidebarPanel />
                        </Panel>
                    </>
                )}
            </Group>
            <Toaster />
        </div>
    );
}

