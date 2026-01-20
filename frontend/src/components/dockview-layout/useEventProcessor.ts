/**
 * useEventProcessor - Unified event processor for streaming and session resume
 * 
 * This hook provides a consistent way to process agent events, whether they come from:
 * - Real-time streaming (new message send)
 * - Session resume (batch processing of cached events)
 * - Continued streaming after resume
 */

import { useCallback, useRef } from 'react';
import type { Message, MessageBlock, TokenUsage } from '@/lib/types';
import type { StreamEvent } from '@/lib/websocket';

interface AskUserContent {
    request_id: string;
    questions: string[];
    timeout?: number;
}

interface EventProcessorState {
    assistantMessageId: string;
    textContent: string;
    currentTextBlockId: string | null;
    currentThinkingBlockId: string | null;
    hasReceivedStreamingThinking: boolean;
    hasReceivedStreamingText: boolean;
    activeToolCalls: Map<string, string>;
    toolBlocksInOrder: string[];
    hasThinkingPlaceholder: boolean;
}

interface UseEventProcessorOptions {
    sessionId: string;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
    setSessionStatus: (sessionId: string, status: { status: string; hasUnread?: boolean }) => void;
    loadSessions: () => void;
    inputAreaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function useEventProcessor(options: UseEventProcessorOptions) {
    const { sessionId, setMessages, setIsProcessing, setSessionStatus, loadSessions, inputAreaRef } = options;

    // Mutable state that persists across events
    const stateRef = useRef<EventProcessorState | null>(null);

    // Initialize or get current state for a session
    const initState = useCallback((messageId?: string): EventProcessorState => {
        const assistantMessageId = messageId || `current-turn-${sessionId}-${Date.now()}`;
        const state: EventProcessorState = {
            assistantMessageId,
            textContent: '',
            currentTextBlockId: null,
            currentThinkingBlockId: null,
            hasReceivedStreamingThinking: false,
            hasReceivedStreamingText: false,
            activeToolCalls: new Map(),
            toolBlocksInOrder: [],
            hasThinkingPlaceholder: true,
        };
        stateRef.current = state;
        return state;
    }, [sessionId]);

    // Get current state or throw
    const getState = (): EventProcessorState => {
        if (!stateRef.current) {
            throw new Error('EventProcessor not initialized. Call initState first.');
        }
        return stateRef.current;
    };

    // Helper: Add a block to the assistant message
    const addBlock = useCallback((block: MessageBlock) => {
        const state = getState();
        setMessages((prev) =>
            prev.map((msg) =>
                msg.id === state.assistantMessageId
                    ? { ...msg, blocks: [...(msg.blocks || []), block] }
                    : msg
            )
        );
    }, [setMessages]);

    // Helper: Update a block in the assistant message
    const updateBlock = useCallback((blockId: string, updates: Partial<MessageBlock>) => {
        const state = getState();
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.id === state.assistantMessageId && msg.blocks) {
                    const blocks = msg.blocks.map((block) =>
                        block.id === blockId ? { ...block, ...updates } : block
                    );
                    return { ...msg, blocks };
                }
                return msg;
            })
        );
    }, [setMessages]);

    // Helper: Append to a text block
    const appendToTextBlock = useCallback((blockId: string, content: string) => {
        const state = getState();
        setMessages((prev) =>
            prev.map((msg) => {
                if (msg.id === state.assistantMessageId && msg.blocks) {
                    const blocks = msg.blocks.map((block) =>
                        block.id === blockId
                            ? { ...block, content: (block.content as string || '') + content }
                            : block
                    );
                    return { ...msg, blocks };
                }
                return msg;
            })
        );
    }, [setMessages]);

    // Helper: Remove thinking placeholder
    const removeThinkingPlaceholder = useCallback(() => {
        const state = getState();
        if (!state.hasThinkingPlaceholder) return;
        state.hasThinkingPlaceholder = false;
        setMessages((prev) =>
            prev.map((msg) =>
                msg.id === state.assistantMessageId && msg.blocks
                    ? { ...msg, blocks: msg.blocks.filter(b => b.id !== 'thinking-placeholder') }
                    : msg
            )
        );
    }, [setMessages]);

    // Process a single event
    const processEvent = useCallback((event: StreamEvent) => {
        const state = getState();

        switch (event.type) {
            case 'thinking_start': {
                removeThinkingPlaceholder();
                state.hasReceivedStreamingThinking = true;
                const thinkingBlockId = crypto.randomUUID();
                const thinkingBlock: MessageBlock = {
                    id: thinkingBlockId,
                    type: 'thinking',
                    content: '',
                    status: 'streaming',
                };
                addBlock(thinkingBlock);
                state.currentThinkingBlockId = thinkingBlockId;
                break;
            }

            case 'thinking_delta': {
                if (state.currentThinkingBlockId) {
                    appendToTextBlock(state.currentThinkingBlockId, event.content as string);
                }
                break;
            }

            case 'thinking_end': {
                if (state.currentThinkingBlockId) {
                    updateBlock(state.currentThinkingBlockId, { status: 'success' });
                    state.currentThinkingBlockId = null;
                }
                break;
            }

            case 'thinking': {
                // Complete thinking event - skip if streaming thinking was already received
                if (state.hasReceivedStreamingThinking) break;
                removeThinkingPlaceholder();
                const thinkingBlockId = crypto.randomUUID();
                const thinkingBlock: MessageBlock = {
                    id: thinkingBlockId,
                    type: 'thinking',
                    content: event.content as string,
                    status: 'success',
                };
                addBlock(thinkingBlock);
                break;
            }

            case 'text_start': {
                removeThinkingPlaceholder();
                state.hasReceivedStreamingText = true;
                const textBlockId = crypto.randomUUID();
                const textBlock: MessageBlock = {
                    id: textBlockId,
                    type: 'text',
                    content: '',
                    status: 'streaming',
                };
                addBlock(textBlock);
                state.currentTextBlockId = textBlockId;
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === state.assistantMessageId ? { ...msg, isStreaming: true } : msg
                    )
                );
                break;
            }

            case 'text_delta': {
                if (state.currentTextBlockId) {
                    appendToTextBlock(state.currentTextBlockId, event.content as string);
                }
                state.textContent += event.content;
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === state.assistantMessageId
                            ? { ...msg, content: msg.content + (event.content as string) }
                            : msg
                    )
                );
                break;
            }

            case 'text_end': {
                if (state.currentTextBlockId) {
                    updateBlock(state.currentTextBlockId, { status: 'success' });
                    state.currentTextBlockId = null;
                }
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === state.assistantMessageId ? { ...msg, isStreaming: false } : msg
                    )
                );
                break;
            }

            case 'text': {
                // Complete text event - skip if streaming text was already received
                removeThinkingPlaceholder();
                if (state.hasReceivedStreamingText) break;
                const textBlockId = crypto.randomUUID();
                const textBlock: MessageBlock = {
                    id: textBlockId,
                    type: 'text',
                    content: event.content as string,
                    status: 'success',
                };
                addBlock(textBlock);
                setMessages((prev) =>
                    prev.map((msg) => {
                        if (msg.id === state.assistantMessageId && msg.content === '') {
                            return { ...msg, content: event.content as string };
                        }
                        return msg;
                    })
                );
                break;
            }

            case 'tool_input_start': {
                removeThinkingPlaceholder();
                if (state.currentTextBlockId) {
                    updateBlock(state.currentTextBlockId, { status: 'success' });
                    state.currentTextBlockId = null;
                }

                const toolName = (event.content as { name?: string })?.name || 'Tool';
                if (toolName === 'AskUserQuestion') break;

                const toolId = event.id || crypto.randomUUID();
                const toolBlockId = `tool-streaming-${toolId}`;

                const toolBlock: MessageBlock = {
                    id: toolBlockId,
                    type: 'tool_use',
                    content: {
                        name: toolName,
                        input: {},
                        inputBuffer: '',
                    },
                    status: 'streaming',
                    metadata: {
                        toolName: toolName,
                        toolCallId: toolId,
                        isStreaming: true,
                    },
                };
                addBlock(toolBlock);

                if (event.id) {
                    state.activeToolCalls.set(event.id, toolBlockId);
                }
                state.toolBlocksInOrder.push(toolBlockId);
                break;
            }

            case 'tool_input_delta': {
                const toolBlockId = event.id ? state.activeToolCalls.get(event.id) : null;
                if (toolBlockId && event.content) {
                    setMessages((prev) =>
                        prev.map((msg) => {
                            if (msg.id === state.assistantMessageId && msg.blocks) {
                                const blocks = msg.blocks.map((block) => {
                                    if (block.id === toolBlockId) {
                                        const currentBuffer = (block.content as { inputBuffer?: string })?.inputBuffer || '';
                                        return {
                                            ...block,
                                            content: {
                                                ...(block.content as object),
                                                inputBuffer: currentBuffer + (event.content as string),
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
                const toolBlockId = event.id ? state.activeToolCalls.get(event.id) : null;
                if (toolBlockId) {
                    updateBlock(toolBlockId, {
                        status: 'executing',
                        metadata: { isStreaming: false },
                    });
                }
                break;
            }

            case 'tool_use': {
                removeThinkingPlaceholder();
                if (state.currentTextBlockId) {
                    updateBlock(state.currentTextBlockId, { status: 'success' });
                    state.currentTextBlockId = null;
                }

                const toolContent = event.content as { name?: string; input?: Record<string, unknown>; id?: string };
                const toolName = toolContent?.name;
                const toolInput = toolContent?.input;
                const toolCallId = toolContent?.id;

                // Special handling for TodoWrite
                if (toolName === 'TodoWrite') {
                    const todos = (toolInput?.todos as Array<{ content?: string; task?: string; status?: string }>) || [];
                    if (todos.length > 0) {
                        const streamingBlockId = toolCallId ? state.activeToolCalls.get(toolCallId) : null;
                        if (toolCallId && streamingBlockId) {
                            state.activeToolCalls.delete(toolCallId);
                        }

                        const planBlockId = `plan-${toolCallId || crypto.randomUUID()}`;
                        const planBlock: MessageBlock = {
                            id: planBlockId,
                            type: 'plan',
                            content: toolInput,
                            status: 'success',
                            metadata: {
                                toolName: 'TodoWrite',
                                toolCallId: toolCallId,
                                todos: todos.map((todo, index) => ({
                                    id: `todo-${index}`,
                                    content: todo.content || todo.task || String(todo),
                                    status: (todo.status || 'pending') as 'pending' | 'in_progress' | 'completed',
                                })),
                            },
                        };

                        setMessages((prev) =>
                            prev.map((msg) => {
                                if (msg.id !== state.assistantMessageId) return msg;
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

                // Check if streaming block already exists
                const existingBlockId = toolCallId ? state.activeToolCalls.get(toolCallId) : null;
                if (existingBlockId) {
                    updateBlock(existingBlockId, {
                        status: 'executing',
                        content: { name: toolName, input: toolInput },
                        metadata: { toolName: toolName, toolCallId: toolCallId, isStreaming: false },
                    });
                    break;
                }

                // Create new tool block
                const toolBlockId = crypto.randomUUID();
                const toolBlock: MessageBlock = {
                    id: toolBlockId,
                    type: 'tool_use',
                    content: { name: toolName, input: toolInput },
                    status: 'executing',
                    metadata: { toolName: toolName, toolCallId: toolCallId },
                };
                addBlock(toolBlock);
                if (toolCallId) {
                    state.activeToolCalls.set(toolCallId, toolBlockId);
                }
                state.toolBlocksInOrder.push(toolBlockId);
                break;
            }

            case 'tool_result': {
                const resultContent = event.content as { tool_use_id?: string; result?: unknown; is_error?: boolean };
                const toolUseId = resultContent?.tool_use_id;
                let blockId = toolUseId ? state.activeToolCalls.get(toolUseId) : null;

                if (!blockId && state.toolBlocksInOrder.length > 0) {
                    blockId = state.toolBlocksInOrder[0];
                    state.toolBlocksInOrder.shift();
                }

                if (blockId) {
                    const isError = resultContent?.is_error === true;
                    setMessages((prev) =>
                        prev.map((msg) => {
                            if (msg.id === state.assistantMessageId && msg.blocks) {
                                const blocks = msg.blocks.map((block) => {
                                    if (block.id === blockId) {
                                        return {
                                            ...block,
                                            status: isError ? 'error' : 'success',
                                            content: {
                                                ...(block.content as object),
                                                result: resultContent?.result,
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
                        state.activeToolCalls.delete(toolUseId);
                    }
                }
                break;
            }

            case 'todos': {
                const todosContent = event.content as { todos?: Array<{ content?: string; task?: string; text?: string; status?: string }> };
                const todos = todosContent?.todos || [];
                if (todos.length > 0) {
                    const planBlockId = `plan-${state.assistantMessageId}`;
                    const planBlock: MessageBlock = {
                        id: planBlockId,
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
                    };

                    setMessages((prev) =>
                        prev.map((msg) => {
                            if (msg.id === state.assistantMessageId) {
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
                    metadata: { requestId: content.request_id },
                };

                setMessages((prev) =>
                    prev.map((msg) => {
                        if (msg.id === state.assistantMessageId) {
                            return { ...msg, blocks: [...(msg.blocks || []), askUserBlock] };
                        }
                        return msg;
                    })
                );
                break;
            }

            case 'permission_request': {
                const permContent = event.content as { request_id: string; tool_name: string; input: unknown };
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
                        if (msg.id === state.assistantMessageId) {
                            return { ...msg, blocks: [...(msg.blocks || []), permBlock] };
                        }
                        return msg;
                    })
                );
                break;
            }

            case 'done': {
                setIsProcessing(false);
                const doneSessionId = event.metadata?.session_id || sessionId;
                if (doneSessionId) {
                    setSessionStatus(doneSessionId, { status: 'idle', hasUnread: false });
                }
                loadSessions();
                setMessages((prev) =>
                    prev.map((msg) => {
                        if (msg.id === state.assistantMessageId && msg.blocks) {
                            const blocks = msg.blocks.map((block) =>
                                block.status === 'executing' || block.status === 'streaming'
                                    ? { ...block, status: 'success' as const }
                                    : block
                            );
                            return { ...msg, blocks, usage: (event as { usage?: TokenUsage }).usage, isStreaming: false };
                        }
                        if (msg.id === state.assistantMessageId) {
                            return { ...msg, usage: (event as { usage?: TokenUsage }).usage, isStreaming: false };
                        }
                        return msg;
                    })
                );
                inputAreaRef?.current?.focus();
                break;
            }

            case 'error': {
                setIsProcessing(false);
                const errorSessionId = event.metadata?.session_id || sessionId;
                if (errorSessionId) {
                    setSessionStatus(errorSessionId, {
                        status: 'error',
                        hasUnread: true
                    });
                }
                break;
            }
        }
    }, [sessionId, setMessages, setIsProcessing, setSessionStatus, loadSessions, inputAreaRef, addBlock, updateBlock, appendToTextBlock, removeThinkingPlaceholder]);

    // Process multiple events in batch (for resume/fast-forward)
    const processEvents = useCallback((events: StreamEvent[]) => {
        for (const event of events) {
            processEvent(event);
        }
    }, [processEvent]);

    // Create initial assistant message
    const createAssistantMessage = useCallback((messageId?: string) => {
        const state = initState(messageId);

        const assistantMessage: Message = {
            id: state.assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            blocks: [{
                id: 'thinking-placeholder',
                type: 'thinking',
                content: '',
                status: 'streaming',
            }],
            isStreaming: true,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setIsProcessing(true);

        return state.assistantMessageId;
    }, [initState, setMessages, setIsProcessing]);

    // Reset processor state
    const reset = useCallback(() => {
        stateRef.current = null;
    }, []);

    // Get current assistant message ID
    const getAssistantMessageId = useCallback(() => {
        return stateRef.current?.assistantMessageId || null;
    }, []);

    return {
        initState,
        processEvent,
        processEvents,
        createAssistantMessage,
        reset,
        getAssistantMessageId,
    };
}
