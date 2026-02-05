'use client';

import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { Message, MessageBlock, AgentStep } from '@/lib/types';
import { sessionClient, AskUserContent, StreamEvent } from '@/lib/websocket';
import { sessionsApi, setWorkspaceMode } from '@/lib/sessions-api';
import { useChat } from '@/lib/store';
import { useWorkspace } from '@/lib/workspace-store';
import { toast } from 'sonner';
import type { InputAreaRef, SecurityMode } from '@/components/chat/input-area';
import {
    createInitialState,
    processEvent,
    processEvents,
    buildMessageFromState,
    ProcessableEvent,
} from '@/lib/event-processor';
import type { EventProcessorState } from '@/lib/event-processor';
import {
    collectFileOperations,
    classifyFileKind,
    normalizePath,
    type FileKind,
} from '@/lib/file-links';
import { buildContextUsageCalibration } from '@/lib/context-usage';
const normalizeUsage = (usage: any): Message["usage"] | null => {
    if (!usage || typeof usage !== "object") return null;
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const totalTokens = Number(
        typeof usage.total_tokens === "number" ? usage.total_tokens : inputTokens + outputTokens
    );
    if (!Number.isFinite(totalTokens)) return null;
    return {
        input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
        total_tokens: totalTokens,
    };
};

const extractUsage = (event: StreamEvent): Message["usage"] | null => {
    return normalizeUsage(event?.usage ?? (event as any)?.content?.usage);
};

/**
 * Shared hook containing all the business logic from ChatPanel
 * This allows it to be reused in both the old ChatPanel and new DockviewMain
 */
export function useChatLogic() {
    const {
        messages, setMessages,
        steps, setSteps,
        isProcessing, setIsProcessing,
        setIsAwaitingFirstToken,
        setAwaitingFirstTokenSessionId,
        sessions, setSessions,
        currentSessionId, setCurrentSessionId,
        isSessionsLoading, setIsSessionsLoading,
        activeEndpoint, setActiveEndpoint,
        activeModel, setActiveModel,
        setContextUsage,
        setSessionStatus,
        getSessionStatus,
        currentSessionIdRef,  // Use shared ref from Context
        openFilePanelCallback,
    } = useChat();

    // Workspace context for session change notifications
    const { registerSessionChangeCallback, currentWorkspace, refreshSessions: refreshWorkspaceSessions, switchSession: switchWorkspaceSession } = useWorkspace();

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

    const autoOpenFileForSession = useCallback((sessionId: string) => {
        if (!openFilePanelCallback) return;

        const state = processorStateRef.current.get(sessionId);
        if (!state) return;

        const operations = collectFileOperations({
            blocks: state.blocks,
            workspaceRoot: currentWorkspace?.path || null,
        });

        if (!operations.length) return;

        const candidates: { path: string; kind: FileKind }[] = [];
        const seen = new Set<string>();
        for (const operation of operations) {
            const path = operation.path;
            if (!path) continue;
            const normalized = normalizePath(path);
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            const kind = classifyFileKind(normalized);
            if (!kind) continue;
            candidates.push({ path: normalized, kind });
        }

        if (candidates.length === 0) return;

        const priority: FileKind[] = ['html', 'image', 'document', 'code'];
        const selected = priority
            .map(kind => candidates.find(candidate => candidate.kind === kind))
            .find(Boolean);

        if (!selected) return;
        const name = selected.path.split('/').pop() || selected.path;

        if (selected.kind === 'image') {
            openFilePanelCallback(
                { path: selected.path, name, is_directory: false },
                { initialMode: 'image', openInAITool: true }
            );
            return;
        }

        if (selected.kind === 'html' || selected.kind === 'document') {
            openFilePanelCallback(
                { path: selected.path, name, is_directory: false },
                { initialMode: 'preview' }
            );
            return;
        }

        openFilePanelCallback(
            { path: selected.path, name, is_directory: false },
            { initialMode: 'editor' }
        );
    }, [openFilePanelCallback, currentWorkspace?.path]);



    // Load sessions from API
    // Note: This only sets currentSessionId on INITIAL load or if current session was deleted
    // It does NOT change session during normal operations to avoid conflicts with user actions
    const loadSessions = useCallback(async () => {
        const startSessionId = currentSessionIdRef.current;
        // console.log('[loadSessions] Called, startSessionId:', startSessionId);
        try {
            setIsSessionsLoading(true);
            const sessionList = await sessionsApi.list();
            setSessions(sessionList);

            // Re-read ref AFTER async call to get the latest value
            // User may have switched sessions while we were waiting for the API
            const currentActiveId = currentSessionIdRef.current;
            // console.log('[loadSessions] After API: currentActiveId:', currentActiveId, 'sessionList length:', sessionList.length);

            if (currentActiveId) {
                const sessionExists = sessionList.some((s: { id: string }) => s.id === currentActiveId);
                // console.log('[loadSessions] sessionExists:', sessionExists);
                if (!sessionExists) {
                    // Session was deleted, select first available
                    console.warn(`[loadSessions] Session ${currentActiveId} no longer exists, resetting...`);
                    const nextSessionId = sessionList.length > 0 ? sessionList[0].id : null;
                    currentSessionIdRef.current = nextSessionId;
                    setCurrentSessionId(nextSessionId);
                    setMessages([]);
                    setContextUsage(null);
                }
                // If session exists, do NOT modify currentSessionId - user may have switched
            } else if (sessionList.length > 0 && !currentActiveId && !isDraftSessionRef.current) {
                // Initial load - no session selected, pick the first one
                // console.log('[loadSessions] No active session, setting to first:', sessionList[0].id);
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
    }, [setSessions, setCurrentSessionId, setMessages, setIsSessionsLoading, setSessionStatus, setContextUsage]);

    // Load messages for a specific session
    const loadSessionMessages = useCallback(async (sessionId: string) => {
        // console.log(`[loadSessionMessages] Loading: ${sessionId}`);
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
                    usage: normalizeUsage(m.usage) || undefined,
                };
            });
            // console.log(`[loadSessionMessages] Loaded ${msgs.length} messages for: ${sessionId}`);
            setMessages(msgs);
            setContextUsage(session.context_usage ?? null);

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
                setContextUsage(null);
                loadSessions();
            } else {
                setMessages([]);
                setContextUsage(null);
            }
        }
    }, [loadSessions, setActiveEndpoint, setActiveModel, setCurrentSessionId, setMessages, setContextUsage]);

    // Track resumed session state for processing events after session switch
    // When user switches to a running session, we store the session ID here
    // handleGlobalEvent will then process content events for this session
    interface ResumeSessionState {
        sessionId: string;
        assistantMessageId: string;
        pendingReplaySkip: number; // Skip replayed cached events after a manual fetch
    }
    const resumeSessionStateRef = useRef<ResumeSessionState | null>(null);
    const processorStateRef = useRef<Map<string, EventProcessorState>>(new Map());
    const eventRateRef = useRef({ count: 0, lastTs: performance.now() });
    const subscribedSessionsRef = useRef<Set<string>>(new Set());
    const isDraftSessionRef = useRef(false);
    const CONTENT_EVENT_TYPES = useMemo(
        () =>
            new Set([
                'thinking_start',
                'thinking_delta',
                'thinking_end',
                'thinking',
                'text_start',
                'text_delta',
                'text_end',
                'text',
                'tool_use',
                'tool_result',
                'tool_input_start',
                'tool_input_delta',
                'tool_input_end',
                'todos',
                'ask_user',
                'ask_user_result',
                'permission_request',
                'permission_response',
            ]),
        []
    );

    // Global event handler for processing events from any session
    // Use a ref to avoid re-render loops when this is used as a dependency
    const handleGlobalEventRef = useRef<(event: StreamEvent) => void>(() => { });

    handleGlobalEventRef.current = useCallback((event: StreamEvent) => {
        const sessionId = event.metadata?.session_id;
        if (!sessionId) return;

        subscribedSessionsRef.current.add(sessionId);

        const isCurrentSession = sessionId === currentSessionIdRef.current;
        const isResumedSession = resumeSessionStateRef.current?.sessionId === sessionId;

        if (isCurrentSession) {
            const now = performance.now();
            const rate = eventRateRef.current;
            rate.count += 1;
            if (now - rate.lastTs >= 1000) {
                console.info(`[chat] event rate: ${rate.count}/s (session ${sessionId})`);
                rate.count = 0;
                rate.lastTs = now;
            }
        }

        // Clear UI placeholder as soon as we see real content for the current session
        if (isCurrentSession && CONTENT_EVENT_TYPES.has(event.type as string)) {
            setIsAwaitingFirstToken(false);
            setAwaitingFirstTokenSessionId(null);
        }

        // Handle status events (done/error) for ALL sessions
        if (event.type === 'done') {
            const usage = extractUsage(event);
            // console.log(`[handleGlobalEvent] Done event for ${sessionId}`);
            // console.log(`[handleGlobalEvent] isCurrentSession: ${isCurrentSession}`);

            if (isCurrentSession) {
                setIsProcessing(false);
                setIsAwaitingFirstToken(false);
                setAwaitingFirstTokenSessionId(null);

                // Mark all streaming/executing blocks as complete (like old implementation)
                // This preserves the incrementally-built content instead of replacing from API
                const finalizedId = `turn-${sessionId}-${Date.now()}`;
                setMessages(prev => {
                    let candidateContent: string | null = null;
                    let candidateId: string | null = null;
                    const next = prev.map(msg => {
                        if (msg.id.startsWith(`current-turn-${sessionId}`)) {
                            const blocks = (msg.blocks || []).map(block =>
                                block.status === 'executing' || block.status === 'streaming'
                                    ? { ...block, status: 'success' as const }
                                    : block
                            );
                            candidateContent = msg.content || '';
                            candidateId = finalizedId;
                            return {
                                ...msg,
                                id: finalizedId,
                                blocks,
                                isStreaming: false,
                                ...(usage ? { usage } : {}),
                            };
                        }
                        if (msg.isStreaming && msg.blocks) {
                            const blocks = msg.blocks.map(block =>
                                block.status === 'executing' || block.status === 'streaming'
                                    ? { ...block, status: 'success' as const }
                                    : block
                            );
                            if (!candidateContent && msg.role === 'assistant') {
                                candidateContent = msg.content || '';
                                candidateId = msg.id;
                            }
                            return { ...msg, blocks, isStreaming: false };
                        }
                        return msg;
                    });
                    if (candidateContent) {
                        const calibration = buildContextUsageCalibration(
                            next,
                            candidateContent,
                            candidateId ?? undefined
                        );
                        if (calibration) {
                            setContextUsage(calibration);
                        }
                    }
                    return next;
                });

                autoOpenFileForSession(sessionId);

                sessionsApi.markRead(sessionId).catch(err =>
                    console.warn(`Failed to mark session ${sessionId} as read:`, err)
                );
                // Focus input after completion
                setTimeout(() => inputAreaRef.current?.focus(), 100);
            }

            // Update session status
            setSessionStatus(sessionId, {
                status: 'idle',
                hasUnread: !isCurrentSession,
            });

            // Clean up processor state AFTER updating messages
            if (isResumedSession) {
                resumeSessionStateRef.current = null;
            }
            processorStateRef.current.delete(sessionId);

            // Refresh session list to update title (but NOT message content)
            loadSessions();
            refreshWorkspaceSessions();
            subscribedSessionsRef.current.delete(sessionId);
            // Also refresh after a delay to catch title updates from backend
            setTimeout(() => {
                loadSessions();
                refreshWorkspaceSessions();
            }, 500);
            return;
        } else if (event.type === 'error') {
            // console.log(`[handleGlobalEvent] Error event for ${sessionId}: ${event.content?.message}`);
            // Clear resume state on error
            if (isResumedSession) {
                resumeSessionStateRef.current = null;
            }
            processorStateRef.current.delete(sessionId);
            const errorMessage = event.content?.message || 'An error occurred';
            setSessionStatus(sessionId, {
                status: 'error',
                hasUnread: !isCurrentSession,
                error: errorMessage,
            });
            if (isCurrentSession) {
                setIsProcessing(false);
                setIsAwaitingFirstToken(false);
                setAwaitingFirstTokenSessionId(null);
                // Show toast for current session errors
                toast.error('Error', { description: errorMessage });
                // Add error block to the message
                const errorBlockId = `error-${crypto.randomUUID()}`;
                setMessages(prev => prev.map(msg => {
                    if (msg.id.startsWith(`current-turn-${sessionId}`) || msg.id.startsWith(`temp-`)) {
                        const errorBlock: MessageBlock = {
                            id: errorBlockId,
                            type: 'text',
                            content: `Error: ${errorMessage}`,
                            status: 'error',
                        };
                        // Also remove thinking placeholder if still present
                        const filteredBlocks = (msg.blocks || []).filter(b => !b.metadata?.isPlaceholder);
                        const finalizedId = msg.id.startsWith(`current-turn-${sessionId}`)
                            ? `turn-${sessionId}-${Date.now()}`
                            : msg.id;
                        return {
                            ...msg,
                            id: finalizedId,
                            blocks: [...filteredBlocks, errorBlock],
                            isStreaming: false,
                        };
                    }
                    return msg;
                }));
            }
            subscribedSessionsRef.current.delete(sessionId);
            return;
        }

        // For sessions with resumeState, process content events incrementally
        if (isResumedSession && isCurrentSession && resumeSessionStateRef.current) {
            if (!CONTENT_EVENT_TYPES.has(event.type as string)) {
                return;
            }

            if (resumeSessionStateRef.current.pendingReplaySkip > 0) {
                resumeSessionStateRef.current.pendingReplaySkip -= 1;
                return;
            }

            const assistantMessageId = resumeSessionStateRef.current.assistantMessageId;
            let state = processorStateRef.current.get(sessionId) ?? createInitialState();
            state = processEvent(state, event, assistantMessageId);
            processorStateRef.current.set(sessionId, state);

            if (!state.blocks.length && !state.textContent) {
                return;
            }

            const assistantMessage = buildMessageFromState(state, assistantMessageId, true);
            setMessages(prev => {
                const existingIndex = prev.findIndex(m => m.id === assistantMessageId);
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                        ...assistantMessage,
                        id: assistantMessageId,
                        isStreaming: true,
                    };
                    return updated;
                }
                return [...prev, assistantMessage];
            });
        }
    }, [setSessionStatus, setIsProcessing, setMessages, loadSessions, refreshWorkspaceSessions, CONTENT_EVENT_TYPES, setIsAwaitingFirstToken, setAwaitingFirstTokenSessionId, autoOpenFileForSession, setContextUsage]);

    // Stable wrapper that always calls the latest handler
    const handleGlobalEvent = useCallback((event: StreamEvent) => {
        handleGlobalEventRef.current(event);
    }, []);

    // Rebuild messages from cached events - MUST be defined before recoverAllSessions
    // Uses the unified event processor for consistent behavior
    const rebuildMessagesFromEvents = useCallback((events: unknown[], sessionId: string) => {
        // Only update UI if this is the current session
        if (sessionId !== currentSessionIdRef.current) {
            return;
        }
        if (!events || events.length === 0) return;

        const assistantMessageId = `replayed-${sessionId}-${Date.now()}`;
        const state = processEvents(events as ProcessableEvent[], assistantMessageId);
        processorStateRef.current.set(sessionId, state);
        const assistantMessage = buildMessageFromState(state, assistantMessageId, true);

        resumeSessionStateRef.current = {
            sessionId,
            assistantMessageId,
            pendingReplaySkip: 0,
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
    // Uses the unified event processor for consistent behavior
    const appendCurrentTurnFromEvents = useCallback((events: unknown[], sessionId: string) => {
        // Only update UI if this is the current session - prevents background sessions
        // from affecting the displayed messages and causing scroll/lag issues
        if (sessionId !== currentSessionIdRef.current) {
            return;
        }
        // Also check if resume state is still valid - if it's null, session has ended
        // and we shouldn't update the message (this prevents overwriting isStreaming: false)
        if (!resumeSessionStateRef.current || resumeSessionStateRef.current.sessionId !== sessionId) {
            return;
        }
        if (!events || events.length === 0) return;

        // Use stable ID without timestamp - crucial for avoiding duplicate keys
        const assistantMessageId = `current-turn-${sessionId}`;
        const state = processEvents(events as ProcessableEvent[], assistantMessageId);
        processorStateRef.current.set(sessionId, state);
        const assistantMessage = buildMessageFromState(state, assistantMessageId, true);

        // Append to existing messages (history already loaded)
        setMessages(prev => {
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
        // console.log('[useChatLogic] Recovering all session states...');

        try {
            // 1. Get all session statuses
            const activeStatuses = await sessionsApi.getActiveStatus();

            // 2. Update statuses and subscribe to running sessions
            const currentId = currentSessionIdRef.current;
            for (const [sessionId, status] of Object.entries(activeStatuses)) {
                setSessionStatus(sessionId, {
                    status: status.status as 'idle' | 'running' | 'error',
                    hasUnread: status.has_unread,
                    error: status.error || undefined,
                });

                // Subscribe to running sessions
                if (status.status === 'running') {
                    if (sessionId === currentId) {
                        continue;
                    }
                    // console.log(`[useChatLogic] Subscribing to running session: ${sessionId}`);
                    if (!subscribedSessionsRef.current.has(sessionId)) {
                        sessionClient.subscribe(sessionId);
                        subscribedSessionsRef.current.add(sessionId);
                    }
                }
            }

            // 3. If current session is running, load its events
            if (currentId) {
                const currentStatus = activeStatuses[currentId];
                if (currentStatus?.status === 'running') {
                    // console.log(`[useChatLogic] Loading events for current running session: ${currentId}`);
                    const eventsData = await sessionsApi.getEvents(currentId);
                    if (eventsData.events && eventsData.events.length > 0) {
                        rebuildMessagesFromEvents(eventsData.events, currentId);
                        if (resumeSessionStateRef.current?.sessionId === currentId) {
                            resumeSessionStateRef.current.pendingReplaySkip = eventsData.events.length;
                        }
                    }
                    if (!subscribedSessionsRef.current.has(currentId)) {
                        sessionClient.subscribe(currentId);
                        subscribedSessionsRef.current.add(currentId);
                    }
                }
            }

            // console.log('[useChatLogic] Recovery complete');
        } catch (err) {
            console.error('[useChatLogic] Recovery failed:', err);
        }
    }, [setSessionStatus, rebuildMessagesFromEvents]);

    // Initialize connection, load sessions, and setup recovery
    useEffect(() => {
        // Sync workspace mode to sessionsApi at initialization
        setWorkspaceMode(currentWorkspace?.id || null);

        // Connect to WebSocket
        sessionClient.connect().catch((err) => {
            console.warn('Session WebSocket connection failed, will retry on message send', err);
        });

        // Set global event handler to process done/error from ANY session
        // This ensures status icons update even when user is viewing a different session
        sessionClient.setGlobalHandler(handleGlobalEvent);

        // Load sessions only if NOT in workspace mode
        // When in workspace mode, the workspace store handles session management
        if (!currentWorkspace) {
            loadSessions();
        }

        // Recover running sessions
        recoverAllSessions();

        // Set reconnect callback
        sessionClient.setOnReconnect(() => {
            // console.log('[useChatLogic] WebSocket reconnected, recovering sessions...');
            subscribedSessionsRef.current.clear();
            recoverAllSessions();
        });

        return () => {
            sessionClient.setOnReconnect(null);
            sessionClient.setGlobalHandler(() => { }); // Clear global handler
        };
    }, [loadSessions, recoverAllSessions, handleGlobalEvent, currentWorkspace]);

    // Track previous workspace ID to detect workspace changes
    const prevWorkspaceIdRef = useRef<string | null | undefined>(undefined);

    // Handle workspace changes - clean up state and sync workspace mode
    useEffect(() => {
        const currentWorkspaceId = currentWorkspace?.id;
        const prevWorkspaceId = prevWorkspaceIdRef.current;

        // Always sync workspace mode to sessionsApi (including initial mount)
        setWorkspaceMode(currentWorkspaceId || null);

        // Handle workspace change (skip on initial mount when prevWorkspaceId is undefined)
        if (prevWorkspaceId !== undefined && prevWorkspaceId !== currentWorkspaceId) {
            // console.log(`[useChatLogic] Workspace changed: ${prevWorkspaceId} -> ${currentWorkspaceId}`);

            // IMPORTANT: Clear messages immediately when workspace changes
            // This prevents old workspace messages from being shown in the new workspace
            // The workspace session callback will then load the correct messages
            setMessages([]);
            setSteps([]);
            setIsProcessing(false);

            // Clear resume state (belongs to old session)
            resumeSessionStateRef.current = null;
            subscribedSessionsRef.current.clear();
            processorStateRef.current.clear();

            // Reset the current session ID ref since we're in a new workspace
            currentSessionIdRef.current = null;
        }

        prevWorkspaceIdRef.current = currentWorkspaceId;
    }, [currentWorkspace?.id, setMessages, setSteps, setIsProcessing]);

    // Load session messages when currentSessionId changes
    // NOTE: For running sessions, handleSelectSession already handles loading with proper sequencing.
    // This useEffect is for: initial page load, or switching to idle sessions.
    // When in workspace mode, this is triggered by the workspace callback through handleSelectSession.
    useEffect(() => {
        // Skip if in workspace mode - workspace callback handles session loading via handleSelectSession
        if (currentWorkspace) {
            return;
        }

        if (currentSessionId) {
            const status = getSessionStatus(currentSessionId);
            // Skip if running session - handleSelectSession handles these
            if (status.status === 'running') {
                // console.log(`[useEffect] Session ${currentSessionId} is running, skipping loadSessionMessages (handled by handleSelectSession)`);
                return;
            }
            loadSessionMessages(currentSessionId);
        }
    }, [currentSessionId, currentWorkspace, loadSessionMessages, getSessionStatus]);

    const switchToDraftSession = useCallback(() => {
        const currentId = currentSessionIdRef.current;
        if (currentId) {
            const currentStatus = getSessionStatus(currentId);
            if (currentStatus.status === 'running') {
                setSessionStatus(currentId, {
                    ...currentStatus,
                    hasUnread: true,
                });
            } else {
                sessionClient.unsubscribe(currentId);
                subscribedSessionsRef.current.delete(currentId);
            }

            if (resumeSessionStateRef.current?.sessionId === currentId) {
                resumeSessionStateRef.current = null;
            }
            processorStateRef.current.delete(currentId);
        }

        currentSessionIdRef.current = null;
        isDraftSessionRef.current = true;
        setCurrentSessionId(null);
        setMessages([]);
        setSteps([]);
        setContextUsage(null);
        setIsProcessing(false);
        isProcessingRef.current = false;
        setTimeout(() => inputAreaRef.current?.focus(), 100);
    }, [getSessionStatus, setSessionStatus, setCurrentSessionId, setMessages, setSteps, setIsProcessing, setContextUsage]);

    // Create a new session (draft only - actual session created on send)
    const handleNewSession = useCallback(async () => {
        switchToDraftSession();
    }, [switchToDraftSession]);

    // Select a session
    // NOTE: Uses currentSessionIdRef.current for comparisons to keep callback stable
    // and avoid re-render cascades when currentSessionId state changes
    const handleSelectSession = useCallback(async (id: string) => {
        const currentId = currentSessionIdRef.current;
        // console.log(`[handleSelectSession] id=${id}, currentId=${currentId}`);

        if (id !== currentId) {
            // console.log(`[handleSelectSession] Switching from ${currentId} to ${id}`);

            // Only unsubscribe from previous session if it's NOT running
            // Running sessions should stay subscribed to receive done/error events
            // and content updates (but content will be filtered by isCurrentSession check)
            if (currentId) {
                const prevStatus = getSessionStatus(currentId);
                if (prevStatus.status !== 'running') {
                    sessionClient.unsubscribe(currentId);
                }
                // Always clear resume state for the old session
                if (resumeSessionStateRef.current?.sessionId === currentId) {
                    resumeSessionStateRef.current = null;
                }
                processorStateRef.current.delete(currentId);
                if (prevStatus.status !== 'running') {
                    subscribedSessionsRef.current.delete(currentId);
                }
            }

            // console.log(`[handleSelectSession] Setting currentSessionIdRef.current = ${id}`);
            currentSessionIdRef.current = id;
            isDraftSessionRef.current = false;
            // console.log(`[handleSelectSession] Ref updated, calling setCurrentSessionId(${id})`);
            setCurrentSessionId(id);
            setSteps([]);

            // Check session status
            const sessionStatus = getSessionStatus(id);
            // console.log(`[handleSelectSession] New session status:`, sessionStatus);

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
            // console.log(`[handleSelectSession] Loading history for session: ${id}`);
            await loadSessionMessages(id);

            // Step 2: Fetch fresh session status from backend
            // This is crucial because local status may be stale (e.g., after returning from Settings page)
            let isRunning = sessionStatus.status === 'running';
            try {
                const activeStatuses = await sessionsApi.getActiveStatus();
                const freshStatus = activeStatuses[id];
                if (freshStatus) {
                    isRunning = freshStatus.status === 'running';
                    // Update local status cache
                    setSessionStatus(id, {
                        status: freshStatus.status as 'idle' | 'running' | 'error',
                        hasUnread: freshStatus.has_unread,
                        error: freshStatus.error || undefined,
                    });
                }
            } catch (err) {
                console.warn('[handleSelectSession] Failed to fetch fresh status, using cached:', err);
            }

            // Step 3: If running, append current turn events and subscribe
            if (isRunning) {
                // console.log(`[handleSelectSession] Session is running, loading current turn events...`);

                try {
                    // Get cached events from backend (current turn only)
                    const eventsData = await sessionsApi.getEvents(id);
                    // console.log(`[handleSelectSession] Got ${eventsData.events?.length || 0} current turn events`);

                    // Set resume state BEFORE calling appendCurrentTurnFromEvents
                    // This is required because appendCurrentTurnFromEvents checks resumeSessionStateRef
                    const wasSubscribed = subscribedSessionsRef.current.has(id);
                    resumeSessionStateRef.current = {
                        sessionId: id,
                        assistantMessageId: `current-turn-${id}`,  // Prefix used by appendCurrentTurnFromEvents
                        pendingReplaySkip: wasSubscribed ? 0 : (eventsData.events?.length || 0),
                    };

                    // Append current turn to messages (not replace) - this does the "fast-forward"
                    if (eventsData.events && eventsData.events.length > 0) {
                        appendCurrentTurnFromEvents(eventsData.events, id);
                    }

                    // Subscribe for live updates (uses global handler via fallback)
                    if (!wasSubscribed) {
                        sessionClient.subscribe(id);
                        subscribedSessionsRef.current.add(id);
                    }
                    // console.log(`[handleSelectSession] Subscribed for live updates: ${id}`);
                } catch (err) {
                    console.error(`[handleSelectSession] Failed to load events for session ${id}:`, err);
                }
            }

            setTimeout(() => inputAreaRef.current?.focus(), 100);
        } else {
            // console.log(`[handleSelectSession] Same session, skipping`);
        }
    }, [setCurrentSessionId, setSteps, getSessionStatus, setSessionStatus, loadSessionMessages, appendCurrentTurnFromEvents, currentSessionIdRef]);

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

    // ==================== Workspace Session Change Listener ====================
    // When a session is selected in the workspace sidebar, sync to chat state
    // This bridges the workspace store with the chat logic
    useEffect(() => {
        const unsubscribe = registerSessionChangeCallback((sessionId: string | null, workspaceId: string) => {
            // CRITICAL: Update sessionsApi workspace mode BEFORE loading session messages
            // This ensures API calls use the correct workspace
            setWorkspaceMode(workspaceId || null);

            const currentId = currentSessionIdRef.current;
            // console.log(`[WorkspaceCallback] sessionId=${sessionId}, workspaceId=${workspaceId}, currentId=${currentId}`);

            if (sessionId === null) {
                switchToDraftSession();
                return;
            }

            // Only process if session actually changed to avoid infinite loops
            if (sessionId !== currentId) {
                // Check if the OLD session (currentId) is running
                // We still want to allow switching away from it
                if (currentId && isProcessingRef.current) {
                    const currentStatus = getSessionStatus(currentId);
                    // Mark the old session as having unread updates since user is leaving
                    if (currentStatus.status === 'running') {
                        setSessionStatus(currentId, {
                            ...currentStatus,
                            hasUnread: true,
                        });
                    }
                }

                // Use handleSelectSession to properly load the new session
                handleSelectSession(sessionId);
            }
        });

        return unsubscribe;
    }, [registerSessionChangeCallback, handleSelectSession, getSessionStatus, setCurrentSessionId, switchToDraftSession]);

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

    // Interrupt a running session
    const handleInterrupt = useCallback(async () => {
        const sessionId = currentSessionIdRef.current;
        if (!sessionId) {
            toast.warning('No active session to interrupt');
            return;
        }

        const status = getSessionStatus(sessionId);
        if (status.status !== 'running') {
            toast.warning('Session is not running');
            return;
        }

        try {
            const result = await sessionsApi.interrupt(sessionId);
            if (result.success) {
                // Update session status to idle
                setSessionStatus(sessionId, { status: 'idle', hasUnread: false });
                setIsProcessing(false);
                setIsAwaitingFirstToken(false);
                setAwaitingFirstTokenSessionId(null);

                // Mark the current turn message as not streaming
                setMessages(prev => prev.map(msg =>
                    msg.id.startsWith(`current-turn-${sessionId}`)
                        ? { ...msg, isStreaming: false }
                        : msg
                ));

                toast.info('Session interrupted');
            } else {
                toast.warning(result.message || 'No running task to interrupt');
            }
        } catch (error: unknown) {
            console.error('Failed to interrupt session:', error);
            toast.error('Failed to interrupt session');
        }
    }, [getSessionStatus, setSessionStatus, setIsProcessing, setMessages, setIsAwaitingFirstToken, setAwaitingFirstTokenSessionId]);

    // Main send handler - UNIFIED streaming path
    // After getting session_id, all events go through handleGlobalEvent → appendCurrentTurnFromEvents
    // This ensures identical behavior between new messages and resumed sessions
    const handleSend = async (content: string) => {
        // Use per-session processing check to allow concurrent sessions
        if (isCurrentSessionProcessing) {
            toast.warning('Session is still running. Press Stop to interrupt first.');
            return;
        }

        // Capture the original session ID at send time
        // This is used to detect new session creation vs background session events
        const originalSessionId = currentSessionIdRef.current;

        setIsAwaitingFirstToken(true);
        setAwaitingFirstTokenSessionId(originalSessionId);

        const sentContent = content;

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content,
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setSteps([]);
        setIsProcessing(true);
        isProcessingRef.current = true;

        // Update session status to running
        if (originalSessionId) {
            setSessionStatus(originalSessionId, {
                status: 'running',
                hasUnread: false,
            });
        }

        // Use stable ID for existing sessions so it matches appendCurrentTurnFromEvents
        // For new sessions (no ID yet), wait until session_id arrives before creating assistant message
        let assistantMessageId: string | null = originalSessionId
            ? `current-turn-${originalSessionId}`
            : null;
        const pendingEvents: ProcessableEvent[] = [];
        let backgroundSessionId: string | null = null;

        // For existing sessions, set up resumeState immediately so globalHandler can process events
        if (originalSessionId) {
            resumeSessionStateRef.current = {
                sessionId: originalSessionId,
                assistantMessageId: assistantMessageId,
                pendingReplaySkip: 0,
            };
            processorStateRef.current.set(originalSessionId, createInitialState());
        }

        try {
            await sessionClient.sendMessage({
                content,
                session_id: originalSessionId || undefined,
                workspace_id: currentWorkspace?.id || undefined,
                endpoint_name: activeEndpoint || undefined,
                model_name: activeModel || undefined,
                security_mode: securityMode,
            }, (event) => {
                const eventSessionId = event.metadata?.session_id;
                let handledEvent = false;

                if (backgroundSessionId && eventSessionId === backgroundSessionId) {
                    handleGlobalEventRef.current(event);
                    return;
                }

                // Debug: Log key events
                if (event.type === 'start' || event.type === 'done' || event.type === 'error') {
                    // console.log(`[handleSend] Event: ${event.type}, eventSession=${eventSessionId}, currentRef=${currentSessionIdRef.current}`)
                }

                // Handle new session creation (when we started with no session_id)
                if (!originalSessionId) {
                    if (!assistantMessageId) {
                        if (!eventSessionId) {
                            if (CONTENT_EVENT_TYPES.has(event.type as string)) {
                                pendingEvents.push(event as ProcessableEvent);
                            }
                            return;
                        }

                        // Adopt new session once session_id arrives
                        if (isDraftSessionRef.current) {
                            currentSessionIdRef.current = eventSessionId;
                            isDraftSessionRef.current = false;
                            setCurrentSessionId(eventSessionId);
                            setAwaitingFirstTokenSessionId(eventSessionId);
                            setSessionStatus(eventSessionId, {
                                status: 'running',
                                hasUnread: false,
                            });
                            if (currentWorkspace) {
                                switchWorkspaceSession(eventSessionId);
                            }
                        } else {
                            backgroundSessionId = eventSessionId;
                            setSessionStatus(eventSessionId, {
                                status: 'running',
                                hasUnread: true,
                            });
                            isDraftSessionRef.current = false;
                            loadSessions();
                            refreshWorkspaceSessions();
                            handleGlobalEventRef.current(event);
                            return;
                        }

                        assistantMessageId = `current-turn-${eventSessionId}`;
                        let state = createInitialState();
                        for (const pending of pendingEvents) {
                            if (CONTENT_EVENT_TYPES.has(pending.type)) {
                                state = processEvent(state, pending, assistantMessageId);
                            }
                        }
                        if (CONTENT_EVENT_TYPES.has(event.type as string)) {
                            state = processEvent(state, event as ProcessableEvent, assistantMessageId);
                            handledEvent = true;
                        }

                        const hasContentEvents = pendingEvents.length > 0 || CONTENT_EVENT_TYPES.has(event.type as string);
                        if (hasContentEvents) {
                            setIsAwaitingFirstToken(false);
                            setAwaitingFirstTokenSessionId(null);
                        }

                        if (state.blocks.length || state.textContent) {
                            const assistantMessage = buildMessageFromState(state, assistantMessageId, true);
                            setMessages(prev => [...prev, assistantMessage]);
                        }

                        resumeSessionStateRef.current = {
                            sessionId: eventSessionId,
                            assistantMessageId: assistantMessageId,
                            pendingReplaySkip: 0,
                        };
                        processorStateRef.current.set(eventSessionId, state);
                        pendingEvents.length = 0;

                        // Refresh session list to show new item
                        loadSessions();
                        refreshWorkspaceSessions();
                    }
                }

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

                // Log steps for debugging
                const step: AgentStep = {
                    id: crypto.randomUUID(),
                    type: event.type as any,
                    content: event.content,
                    metadata: event.metadata,
                    timestamp: Date.now(),
                };
                setSteps((prev) => [...prev, step]);

                // All events go through the unified global handler
                if (!handledEvent) {
                    handleGlobalEventRef.current(event);
                }
            });
        } catch (error: any) {
            console.error('Failed to send message:', error);
            setIsProcessing(false);
            isProcessingRef.current = false;
            setIsAwaitingFirstToken(false);
            setAwaitingFirstTokenSessionId(null);
            setMessages((prev) => prev.filter(msg => msg.id !== userMessage.id && msg.id !== assistantMessageId));
            inputAreaRef.current?.setValue?.(sentContent);
            // Clear resume state on error
            if (resumeSessionStateRef.current?.sessionId === currentSessionIdRef.current) {
                resumeSessionStateRef.current = null;
            }
            subscribedSessionsRef.current.delete(currentSessionIdRef.current || '');
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
        handleInterrupt,
        handlePermissionResponse,
        handleAskUserSubmit,
        handleAskUserSkip,
        setSecurityMode,
        loadSessions,
    };
}
