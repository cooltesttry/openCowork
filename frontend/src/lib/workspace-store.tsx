"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';

// ==================== Types ====================

export interface Workspace {
    id: string;
    name: string;
    path: string;
    created_at?: number;
    last_accessed_at: number;
    icon?: string;
    color?: string;
}

export interface WorkspaceSession {
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    message_count: number;
    last_model_name?: string;
    last_endpoint_name?: string;
}

// ==================== API ====================

const API_BASE = 'http://localhost:8000/api/workspace';

async function fetchRecentWorkspaces(): Promise<Workspace[]> {
    const res = await fetch(`${API_BASE}/recent`);
    if (!res.ok) throw new Error('Failed to fetch workspaces');
    const data = await res.json();
    return data.workspaces || [];
}

async function fetchCurrentWorkspace(): Promise<Workspace | null> {
    const res = await fetch(`${API_BASE}/current`);
    if (!res.ok) throw new Error('Failed to fetch current workspace');
    const data = await res.json();
    return data.workspace || null;
}

async function openWorkspaceAPI(path: string, name?: string): Promise<Workspace> {
    const res = await fetch(`${API_BASE}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name }),
    });
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to open workspace');
    }
    const data = await res.json();
    return data.workspace;
}

async function switchWorkspaceAPI(workspaceId: string): Promise<Workspace> {
    const res = await fetch(`${API_BASE}/switch/${workspaceId}`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to switch workspace');
    const data = await res.json();
    return data.workspace;
}

async function removeWorkspaceAPI(workspaceId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/${workspaceId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to remove workspace');
}

async function fetchWorkspaceSessions(workspaceId: string): Promise<WorkspaceSession[]> {
    const res = await fetch(`${API_BASE}/${workspaceId}/sessions`);
    if (!res.ok) throw new Error('Failed to fetch sessions');
    const data = await res.json();
    return data.sessions || [];
}

async function createSessionAPI(workspaceId: string, title: string = 'New Chat'): Promise<WorkspaceSession> {
    const res = await fetch(`${API_BASE}/${workspaceId}/sessions?title=${encodeURIComponent(title)}`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to create session');
    return await res.json();
}

async function deleteSessionAPI(workspaceId: string, sessionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/${workspaceId}/sessions/${sessionId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete session');
}

async function fetchSessionDetail(workspaceId: string, sessionId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/${workspaceId}/sessions/${sessionId}`);
    if (!res.ok) throw new Error('Failed to fetch session');
    return await res.json();
}

// ==================== Context ====================

// Session change callback type
type SessionChangeCallback = (sessionId: string, workspaceId: string) => void;

interface WorkspaceContextType {
    // Workspaces
    workspaces: Workspace[];
    currentWorkspace: Workspace | null;
    isLoading: boolean;

    // Sessions for current workspace
    sessions: WorkspaceSession[];
    currentSessionId: string | null;
    isSessionsLoading: boolean;

    // Actions
    openWorkspace: (path: string, name?: string) => Promise<void>;
    switchWorkspace: (workspaceId: string) => Promise<void>;
    removeWorkspace: (workspaceId: string) => Promise<void>;
    refreshWorkspaces: () => Promise<void>;

    // Session actions
    createSession: (title?: string) => Promise<WorkspaceSession | null>;
    switchSession: (sessionId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    refreshSessions: () => Promise<void>;

    // Current session detail (messages, etc.)
    currentSessionDetail: any | null;
    loadSessionDetail: (sessionId: string) => Promise<void>;

    // Callback registration for external components (e.g., chat panel)
    registerSessionChangeCallback: (callback: SessionChangeCallback) => () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

// ==================== Provider ====================

const WORKSPACE_ID_KEY = 'current-workspace-id';
const SESSION_ID_KEY = 'current-session-id';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [isSessionsLoading, setIsSessionsLoading] = useState(false);

    const [currentSessionDetail, setCurrentSessionDetail] = useState<any | null>(null);

    // Session change callbacks for external components (e.g., chat panel)
    const sessionChangeCallbacksRef = useRef<Set<SessionChangeCallback>>(new Set());
    const currentWorkspaceRef = useRef<Workspace | null>(null);
    const currentSessionIdRef = useRef<string | null>(null);
    const isHydrated = useRef(false);

    // Keep refs in sync
    useEffect(() => {
        currentWorkspaceRef.current = currentWorkspace;
    }, [currentWorkspace]);

    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    // Save to localStorage when workspace changes (after hydration)
    useEffect(() => {
        if (!isHydrated.current) return;
        if (currentWorkspace) {
            localStorage.setItem(WORKSPACE_ID_KEY, currentWorkspace.id);
        } else {
            localStorage.removeItem(WORKSPACE_ID_KEY);
        }
    }, [currentWorkspace]);

    // Save to localStorage when session changes (after hydration)
    useEffect(() => {
        if (!isHydrated.current) return;
        if (currentSessionId) {
            localStorage.setItem(SESSION_ID_KEY, currentSessionId);
        } else {
            localStorage.removeItem(SESSION_ID_KEY);
        }
    }, [currentSessionId]);

    // Load workspaces on mount, restore from localStorage
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                // Load saved IDs from localStorage
                const savedWorkspaceId = localStorage.getItem(WORKSPACE_ID_KEY);
                const savedSessionId = localStorage.getItem(SESSION_ID_KEY);

                const [recentList, current] = await Promise.all([
                    fetchRecentWorkspaces(),
                    fetchCurrentWorkspace(),
                ]);
                setWorkspaces(recentList);

                // Use current workspace from backend, or find saved one
                let workspaceToUse = current;
                if (!workspaceToUse && savedWorkspaceId) {
                    workspaceToUse = recentList.find(w => w.id === savedWorkspaceId) || null;
                }
                setCurrentWorkspace(workspaceToUse);

                // Restore session ID from localStorage
                if (savedSessionId && workspaceToUse) {
                    setCurrentSessionId(savedSessionId);
                }
            } catch (error) {
                console.error('Failed to load workspaces:', error);
            } finally {
                setIsLoading(false);
                isHydrated.current = true;
            }
        };
        init();
    }, []);

    // Load sessions when workspace changes
    useEffect(() => {
        if (!currentWorkspace) {
            setSessions([]);
            currentSessionIdRef.current = null;
            setCurrentSessionId(null);
            return;
        }

        const loadSessions = async () => {
            setIsSessionsLoading(true);
            try {
                const sessionList = await fetchWorkspaceSessions(currentWorkspace.id);
                setSessions(sessionList);

                // Use ref to get the most current session ID (not stale closure value)
                const currentId = currentSessionIdRef.current;
                const currentExists = currentId && sessionList.some(s => s.id === currentId);

                if (currentExists) {
                    // Session exists in this workspace, notify listeners
                    sessionChangeCallbacksRef.current.forEach(callback => {
                        try {
                            callback(currentId!, currentWorkspace.id);
                        } catch (e) {
                            console.error('Session change callback error:', e);
                        }
                    });
                } else if (sessionList.length > 0) {
                    // Session doesn't exist in this workspace or none selected, auto-select first
                    const firstSessionId = sessionList[0].id;
                    // Update ref BEFORE triggering callbacks
                    currentSessionIdRef.current = firstSessionId;
                    setCurrentSessionId(firstSessionId);
                    // Notify listeners about the auto-selection
                    sessionChangeCallbacksRef.current.forEach(callback => {
                        try {
                            callback(firstSessionId, currentWorkspace.id);
                        } catch (e) {
                            console.error('Session change callback error:', e);
                        }
                    });
                } else {
                    // No sessions in this workspace, clear selection
                    currentSessionIdRef.current = null;
                    setCurrentSessionId(null);
                }
            } catch (error) {
                console.error('Failed to load sessions:', error);
            } finally {
                setIsSessionsLoading(false);
            }
        };
        loadSessions();
    }, [currentWorkspace?.id]);

    // Load session detail when current session changes
    // Only load if session exists in the current sessions list (avoids race condition)
    useEffect(() => {
        if (!currentWorkspace || !currentSessionId) {
            setCurrentSessionDetail(null);
            return;
        }

        // Check if the session exists in current sessions list before fetching
        const sessionExists = sessions.some(s => s.id === currentSessionId);
        if (!sessionExists) {
            setCurrentSessionDetail(null);
            return;
        }

        const loadDetail = async () => {
            try {
                const detail = await fetchSessionDetail(currentWorkspace.id, currentSessionId);
                setCurrentSessionDetail(detail);
            } catch (error) {
                console.error('Failed to load session detail:', error);
                setCurrentSessionDetail(null);
            }
        };
        loadDetail();
    }, [currentWorkspace?.id, currentSessionId, sessions]);

    const refreshWorkspaces = useCallback(async () => {
        try {
            const recentList = await fetchRecentWorkspaces();
            setWorkspaces(recentList);
        } catch (error) {
            console.error('Failed to refresh workspaces:', error);
        }
    }, []);

    const openWorkspace = useCallback(async (path: string, name?: string) => {
        const workspace = await openWorkspaceAPI(path, name);
        setCurrentWorkspace(workspace);
        currentSessionIdRef.current = null; // Reset session selection for new workspace
        setCurrentSessionId(null);
        setSessions([]); // Clear old sessions immediately
        await refreshWorkspaces();
    }, [refreshWorkspaces]);

    const switchWorkspace = useCallback(async (workspaceId: string) => {
        const workspace = await switchWorkspaceAPI(workspaceId);
        setCurrentWorkspace(workspace);
        currentSessionIdRef.current = null; // Reset session selection
        setCurrentSessionId(null); // Reset session selection
        setSessions([]); // Clear old sessions immediately
        await refreshWorkspaces();
    }, [refreshWorkspaces]);

    const removeWorkspace = useCallback(async (workspaceId: string) => {
        await removeWorkspaceAPI(workspaceId);
        if (currentWorkspace?.id === workspaceId) {
            setCurrentWorkspace(null);
        }
        await refreshWorkspaces();
    }, [currentWorkspace?.id, refreshWorkspaces]);

    const refreshSessions = useCallback(async () => {
        if (!currentWorkspace) return;
        try {
            const sessionList = await fetchWorkspaceSessions(currentWorkspace.id);
            setSessions(sessionList);
        } catch (error) {
            console.error('Failed to refresh sessions:', error);
        }
    }, [currentWorkspace?.id]);

    const createSession = useCallback(async (title?: string): Promise<WorkspaceSession | null> => {
        if (!currentWorkspace) return null;
        try {
            const session = await createSessionAPI(currentWorkspace.id, title);
            await refreshSessions();
            // Update ref BEFORE triggering callbacks
            currentSessionIdRef.current = session.id;
            setCurrentSessionId(session.id);
            // Notify listeners about the new session selection
            sessionChangeCallbacksRef.current.forEach(callback => {
                try {
                    callback(session.id, currentWorkspace.id);
                } catch (e) {
                    console.error('Session change callback error:', e);
                }
            });
            return session;
        } catch (error) {
            console.error('Failed to create session:', error);
            return null;
        }
    }, [currentWorkspace?.id, refreshSessions]);

    const switchSession = useCallback(async (sessionId: string) => {
        // CRITICAL: Update ref IMMEDIATELY before triggering callbacks
        // This ensures registerSessionChangeCallback's immediate trigger uses the correct value
        currentSessionIdRef.current = sessionId;
        setCurrentSessionId(sessionId);
        // Notify external listeners (e.g., chat panel)
        const workspaceId = currentWorkspaceRef.current?.id;
        if (workspaceId) {
            sessionChangeCallbacksRef.current.forEach(callback => {
                try {
                    callback(sessionId, workspaceId);
                } catch (e) {
                    console.error('Session change callback error:', e);
                }
            });
        }
    }, []);

    const registerSessionChangeCallback = useCallback((callback: SessionChangeCallback) => {
        sessionChangeCallbacksRef.current.add(callback);

        // If there's already a current session, trigger the callback immediately
        // This handles the case where the callback is registered after initial session selection
        const sessionId = currentSessionIdRef.current;
        const workspaceId = currentWorkspaceRef.current?.id;
        if (sessionId && workspaceId) {
            try {
                callback(sessionId, workspaceId);
            } catch (e) {
                console.error('Session change callback error (initial):', e);
            }
        }

        return () => {
            sessionChangeCallbacksRef.current.delete(callback);
        };
    }, []);

    const deleteSession = useCallback(async (sessionId: string) => {
        if (!currentWorkspace) return;
        try {
            await deleteSessionAPI(currentWorkspace.id, sessionId);
            if (currentSessionId === sessionId) {
                currentSessionIdRef.current = null;
                setCurrentSessionId(null);
            }
            await refreshSessions();
        } catch (error) {
            console.error('Failed to delete session:', error);
        }
    }, [currentWorkspace?.id, currentSessionId, refreshSessions]);

    const loadSessionDetail = useCallback(async (sessionId: string) => {
        if (!currentWorkspace) return;
        try {
            const detail = await fetchSessionDetail(currentWorkspace.id, sessionId);
            setCurrentSessionDetail(detail);
        } catch (error) {
            console.error('Failed to load session detail:', error);
        }
    }, [currentWorkspace?.id]);

    return (
        <WorkspaceContext.Provider value={{
            workspaces,
            currentWorkspace,
            isLoading,
            sessions,
            currentSessionId,
            isSessionsLoading,
            openWorkspace,
            switchWorkspace,
            removeWorkspace,
            refreshWorkspaces,
            createSession,
            switchSession,
            deleteSession,
            refreshSessions,
            currentSessionDetail,
            loadSessionDetail,
            registerSessionChangeCallback,
        }}>
            {children}
        </WorkspaceContext.Provider>
    );
}

// ==================== Hook ====================

export function useWorkspace() {
    const context = useContext(WorkspaceContext);
    if (context === undefined) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider');
    }
    return context;
}
