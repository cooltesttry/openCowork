/**
 * event-processor.ts - Unified event processor for streaming and session resume
 *
 * This module provides a pure function approach to process agent events.
 * The same logic is used for both:
 * - Real-time streaming (process one event at a time)
 * - Session resume (batch process all cached events)
 */

import type { MessageBlock } from '@/lib/types';

// Event type definition (subset of StreamEvent for processing)
export interface ProcessableEvent {
    type: string;
    content?: unknown;
    id?: string;
    metadata?: Record<string, unknown>;
}

// Processor state - mutable during processing, immutable between calls
export interface EventProcessorState {
    blocks: MessageBlock[];
    textContent: string;
    textBlockIndex: number;
    thinkingBlockIndex: number;  // Track current thinking block
    toolCallToBlockIndex: Map<string, number>;
    toolBlocksInOrder: number[];
}

/**
 * Create initial processor state
 */
export function createInitialState(): EventProcessorState {
    return {
        blocks: [],
        textContent: '',
        textBlockIndex: -1,
        thinkingBlockIndex: -1,
        toolCallToBlockIndex: new Map(),
        toolBlocksInOrder: [],
    };
}

/**
 * Clone state for immutability
 */
function cloneState(state: EventProcessorState): EventProcessorState {
    return {
        blocks: [...state.blocks],
        textContent: state.textContent,
        textBlockIndex: state.textBlockIndex,
        thinkingBlockIndex: state.thinkingBlockIndex,
        toolCallToBlockIndex: new Map(state.toolCallToBlockIndex),
        toolBlocksInOrder: [...state.toolBlocksInOrder],
    };
}

/**
 * Process a single event and return new state
 * This is the core pure function - all event handling logic is here
 */
export function processEvent(
    state: EventProcessorState,
    event: ProcessableEvent,
    assistantMessageId: string
): EventProcessorState {
    const newState = cloneState(state);
    const { blocks } = newState;

    switch (event.type) {
        // ==================== Thinking Events ====================
        case 'thinking_start': {
            // Always create a new thinking block (previous one should be complete)
            // Mark previous thinking block as complete if exists
            if (newState.thinkingBlockIndex >= 0 && blocks[newState.thinkingBlockIndex]) {
                blocks[newState.thinkingBlockIndex].status = 'success';
            }
            newState.thinkingBlockIndex = blocks.length;
            blocks.push({
                id: `thinking-${assistantMessageId}-${blocks.length}`,
                type: 'thinking',
                content: '',
                status: 'streaming',
            });
            break;
        }

        case 'thinking_delta': {
            // Use thinkingBlockIndex to find current thinking block
            if (newState.thinkingBlockIndex >= 0 && blocks[newState.thinkingBlockIndex]) {
                blocks[newState.thinkingBlockIndex].content =
                    ((blocks[newState.thinkingBlockIndex].content as string) || '') +
                    ((event.content as string) || '');
            } else {
                // Create new thinking block if none exists
                newState.thinkingBlockIndex = blocks.length;
                blocks.push({
                    id: `thinking-${assistantMessageId}-${blocks.length}`,
                    type: 'thinking',
                    content: (event.content as string) || '',
                    status: 'streaming',
                });
            }
            break;
        }

        case 'thinking_end': {
            if (newState.thinkingBlockIndex >= 0 && blocks[newState.thinkingBlockIndex]) {
                blocks[newState.thinkingBlockIndex].status = 'success';
            }
            // Reset thinking index so next thinking_start creates a new block
            newState.thinkingBlockIndex = -1;
            break;
        }

        case 'thinking': {
            // Complete thinking event - update existing thinking block if any
            const thinkingContent = (event.content as string) || '';

            // Find the last thinking block in the array
            // Update it regardless of status (streaming or success)
            let lastThinkingIdx = -1;
            for (let i = blocks.length - 1; i >= 0; i--) {
                if (blocks[i].type === 'thinking') {
                    lastThinkingIdx = i;
                    break;
                }
            }

            if (lastThinkingIdx >= 0) {
                // Update existing thinking block
                blocks[lastThinkingIdx].content = thinkingContent;
                blocks[lastThinkingIdx].status = 'success';
                break;
            }

            // No existing thinking block - create new one
            newState.thinkingBlockIndex = blocks.length;
            blocks.push({
                id: `thinking-${assistantMessageId}-${blocks.length}`,
                type: 'thinking',
                content: thinkingContent,
                status: 'success',
            });
            break;
        }

        // ==================== Text Events ====================
        case 'text_start': {
            // Reset textContent for new text block
            newState.textContent = '';
            newState.textBlockIndex = blocks.length;
            blocks.push({
                id: `text-${assistantMessageId}-${blocks.length}`,
                type: 'text',
                content: '',
                status: 'streaming',
            });
            break;
        }

        case 'text_delta': {
            const delta = (event.content as string) || '';
            newState.textContent += delta;
            if (newState.textBlockIndex >= 0 && blocks[newState.textBlockIndex]) {
                blocks[newState.textBlockIndex].content = newState.textContent;
            } else {
                newState.textBlockIndex = blocks.length;
                blocks.push({
                    id: `text-${assistantMessageId}-${blocks.length}`,
                    type: 'text',
                    content: newState.textContent,
                    status: 'streaming',
                });
            }
            break;
        }

        case 'text_end': {
            if (newState.textBlockIndex >= 0 && blocks[newState.textBlockIndex]) {
                blocks[newState.textBlockIndex].status = 'success';
            }
            // Reset text index so next text_start creates a new block
            newState.textBlockIndex = -1;
            break;
        }

        case 'text': {
            // Complete text event - update existing text block if any
            const newContent = (event.content as string) || '';

            // Find the last text block in the array
            // Update it regardless of status (streaming or success)
            let lastTextIdx = -1;
            for (let i = blocks.length - 1; i >= 0; i--) {
                if (blocks[i].type === 'text') {
                    lastTextIdx = i;
                    break;
                }
            }

            if (lastTextIdx >= 0) {
                // Update existing text block
                blocks[lastTextIdx].content = newContent;
                blocks[lastTextIdx].status = 'success';
                break;
            }

            // No existing text block - create new one
            newState.textContent = newContent;
            newState.textBlockIndex = blocks.length;
            blocks.push({
                id: `text-${assistantMessageId}-${blocks.length}`,
                type: 'text',
                content: newState.textContent,
                status: 'success',
            });
            break;
        }

        // ==================== Tool Input Streaming Events ====================
        case 'tool_input_start': {
            // Mark current text block as complete
            if (newState.textBlockIndex >= 0 && blocks[newState.textBlockIndex]) {
                blocks[newState.textBlockIndex].status = 'success';
            }
            // Mark current thinking block as complete
            if (newState.thinkingBlockIndex >= 0 && blocks[newState.thinkingBlockIndex]) {
                blocks[newState.thinkingBlockIndex].status = 'success';
            }
            newState.textBlockIndex = -1;
            newState.textContent = '';
            newState.thinkingBlockIndex = -1;

            const toolName = (event.content as { name?: string })?.name || 'Tool';
            const toolId = event.id || `tool-${blocks.length}`;

            // Skip AskUserQuestion - handled separately
            if (toolName === 'AskUserQuestion') break;

            const toolBlockId = `tool-streaming-${toolId}`;
            const blockIndex = blocks.length;
            blocks.push({
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
            });

            if (event.id) {
                newState.toolCallToBlockIndex.set(event.id, blockIndex);
            }
            newState.toolBlocksInOrder.push(blockIndex);
            break;
        }

        case 'tool_input_delta': {
            const toolBlockIdx = event.id ? newState.toolCallToBlockIndex.get(event.id) : undefined;
            if (toolBlockIdx !== undefined && blocks[toolBlockIdx] && event.content) {
                const currentContent = blocks[toolBlockIdx].content as { inputBuffer?: string };
                const currentBuffer = currentContent?.inputBuffer || '';
                blocks[toolBlockIdx].content = {
                    ...(blocks[toolBlockIdx].content as object),
                    inputBuffer: currentBuffer + (event.content as string),
                };
            }
            break;
        }

        case 'tool_input_end': {
            const toolBlockIdx = event.id ? newState.toolCallToBlockIndex.get(event.id) : undefined;
            if (toolBlockIdx !== undefined && blocks[toolBlockIdx]) {
                blocks[toolBlockIdx].status = 'executing';
                blocks[toolBlockIdx].metadata = {
                    ...(blocks[toolBlockIdx].metadata || {}),
                    isStreaming: false,
                };
            }
            break;
        }

        // ==================== Tool Use/Result Events ====================
        case 'tool_use': {
            // Mark current text block as complete
            if (newState.textBlockIndex >= 0 && blocks[newState.textBlockIndex]) {
                blocks[newState.textBlockIndex].status = 'success';
            }
            // Mark current thinking block as complete
            if (newState.thinkingBlockIndex >= 0 && blocks[newState.thinkingBlockIndex]) {
                blocks[newState.thinkingBlockIndex].status = 'success';
            }
            newState.textBlockIndex = -1;
            newState.textContent = '';
            newState.thinkingBlockIndex = -1;

            const toolContent = event.content as {
                name?: string;
                input?: { todos?: Array<{ content?: string; task?: string; status?: string }> };
                id?: string;
            };
            const toolName = toolContent?.name;
            const toolCallId = toolContent?.id;

            // Skip AskUserQuestion - handled by ask_user event
            if (toolName === 'AskUserQuestion') break;

            // Special handling for TodoWrite - convert to plan block
            if (toolName === 'TodoWrite') {
                const todos = toolContent?.input?.todos || [];
                if (todos.length > 0) {
                    // Remove streaming block if exists
                    const streamingBlockIdx = toolCallId ? newState.toolCallToBlockIndex.get(toolCallId) : undefined;
                    if (streamingBlockIdx !== undefined) {
                        blocks.splice(streamingBlockIdx, 1);
                        newState.toolCallToBlockIndex.delete(toolCallId!);
                        // Adjust indices after removal
                        newState.toolBlocksInOrder = newState.toolBlocksInOrder
                            .filter(idx => idx !== streamingBlockIdx)
                            .map(idx => idx > streamingBlockIdx ? idx - 1 : idx);
                    }

                    blocks.push({
                        id: `plan-${toolCallId || assistantMessageId}`,
                        type: 'plan',
                        content: toolContent.input,
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
                    });
                }
                break;
            }

            // Check if streaming block already exists (created by tool_input_start)
            const existingBlockIdx = toolCallId ? newState.toolCallToBlockIndex.get(toolCallId) : undefined;
            if (existingBlockIdx !== undefined && blocks[existingBlockIdx]) {
                // Update existing streaming block with complete content
                blocks[existingBlockIdx].content = event.content;
                blocks[existingBlockIdx].status = 'executing';
                blocks[existingBlockIdx].metadata = {
                    ...(blocks[existingBlockIdx].metadata || {}),
                    toolName: toolName,
                    toolCallId: toolCallId,
                    isStreaming: false,
                };
                break;
            }

            // Create new tool_use block (no streaming block exists)
            const toolBlockId = toolCallId ? `tool-${toolCallId}` : `tool-${blocks.length}`;
            const blockIndex = blocks.length;
            blocks.push({
                id: toolBlockId,
                type: 'tool_use',
                content: event.content,
                status: 'executing',
                metadata: {
                    toolName: toolName,
                    toolCallId: toolCallId,
                    ...(event.metadata as Record<string, unknown> || {}),
                },
            });

            if (toolCallId) {
                newState.toolCallToBlockIndex.set(toolCallId, blockIndex);
            }
            newState.toolBlocksInOrder.push(blockIndex);
            break;
        }

        case 'tool_result': {
            const resultContent = event.content as {
                tool_use_id?: string;
                result?: unknown;
                content?: unknown;
                is_error?: boolean;
            };
            const toolUseId = resultContent?.tool_use_id;

            let blockIndex = toolUseId ? newState.toolCallToBlockIndex.get(toolUseId) : undefined;
            if (blockIndex === undefined && newState.toolBlocksInOrder.length > 0) {
                // Fallback: use first unprocessed tool block
                blockIndex = newState.toolBlocksInOrder.shift();
            } else if (blockIndex !== undefined && toolUseId) {
                newState.toolCallToBlockIndex.delete(toolUseId);
                const orderIdx = newState.toolBlocksInOrder.indexOf(blockIndex);
                if (orderIdx >= 0) newState.toolBlocksInOrder.splice(orderIdx, 1);
            }

            if (blockIndex !== undefined && blocks[blockIndex]) {
                const isError = resultContent?.is_error === true;
                const resultValue = resultContent?.result ?? resultContent?.content;
                blocks[blockIndex].status = isError ? 'error' : 'success';
                blocks[blockIndex].content = {
                    ...(blocks[blockIndex].content as object),
                    result: resultValue,
                };
            }
            break;
        }

        // ==================== Plan/Todos Events ====================
        case 'todos': {
            const todos = (event.content as {
                todos?: Array<{ content?: string; task?: string; text?: string; status?: string }>
            })?.todos || [];
            if (todos.length > 0) {
                blocks.push({
                    id: `plan-${assistantMessageId}-${blocks.length}`,
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

        // ==================== Ask User Events ====================
        case 'ask_user': {
            const askContent = event.content as {
                request_id?: string;
                questions?: unknown[];
                timeout?: number;
            };
            const requestId = askContent?.request_id || event.id || `ask-user-${blocks.length}`;
            blocks.push({
                id: `ask-user-${requestId}`,
                type: 'ask_user',
                content: {
                    input: {
                        questions: askContent?.questions || [],
                        timeout: askContent?.timeout || 60,
                    },
                },
                status: 'pending',
                metadata: {
                    requestId: requestId,
                },
            });
            break;
        }

        case 'ask_user_result': {
            const resultContent = event.content as {
                request_id?: string;
                status?: string;
                answers?: Record<string, unknown>;
            };
            const requestId = resultContent?.request_id;
            if (requestId) {
                const askBlockIndex = blocks.findIndex(b => b.id === `ask-user-${requestId}`);
                if (askBlockIndex >= 0) {
                    const status = resultContent?.status;
                    if (status === 'answered') {
                        blocks[askBlockIndex].status = 'success';
                        blocks[askBlockIndex].metadata = {
                            ...blocks[askBlockIndex].metadata,
                            answers: resultContent?.answers as Record<string, string> | undefined,
                        };
                    } else if (status === 'timeout') {
                        blocks[askBlockIndex].status = 'error';
                    } else if (status === 'skipped') {
                        blocks[askBlockIndex].status = 'success';
                    }
                }
            }
            break;
        }

        // ==================== Permission Events ====================
        case 'permission_request': {
            const permContent = event.content as {
                request_id?: string;
                tool_name?: string;
                input?: unknown;
            };
            const requestId = permContent?.request_id || event.id || `perm-${blocks.length}`;
            blocks.push({
                id: `permission-${requestId}`,
                type: 'tool_use',
                content: {
                    name: permContent?.tool_name || 'Unknown Tool',
                    input: permContent?.input,
                    description: `Tool "${permContent?.tool_name}" is requesting permission to execute`,
                },
                status: 'pending',
                metadata: {
                    requestId: requestId,
                    toolName: permContent?.tool_name,
                    requiresPermission: true,
                },
            });
            break;
        }

        case 'permission_response': {
            const respContent = event.content as {
                request_id?: string;
                allowed?: boolean;
            };
            const requestId = respContent?.request_id;
            if (requestId) {
                const permBlockIndex = blocks.findIndex(b => b.id === `permission-${requestId}`);
                if (permBlockIndex >= 0) {
                    const allowed = respContent?.allowed;
                    blocks[permBlockIndex].status = allowed ? 'success' : 'error';
                    blocks[permBlockIndex].metadata = {
                        ...blocks[permBlockIndex].metadata,
                        allowed: allowed,
                        requiresPermission: false,
                    };
                }
            }
            break;
        }
    }

    return newState;
}

/**
 * Process multiple events in batch (for session resume/fast-forward)
 * Returns the final state after processing all events
 */
export function processEvents(
    events: ProcessableEvent[],
    assistantMessageId: string
): EventProcessorState {
    let state = createInitialState();
    for (const event of events) {
        state = processEvent(state, event, assistantMessageId);
    }
    return state;
}

/**
 * Build a Message object from processor state
 */
export function buildMessageFromState(
    state: EventProcessorState,
    assistantMessageId: string,
    isStreaming: boolean = false
): {
    id: string;
    role: 'assistant';
    content: string;
    timestamp: number;
    blocks: MessageBlock[] | undefined;
    isStreaming: boolean;
} {
    return {
        id: assistantMessageId,
        role: 'assistant',
        content: state.textContent,
        timestamp: Date.now(),
        blocks: state.blocks.length > 0 ? state.blocks : undefined,
        isStreaming,
    };
}
