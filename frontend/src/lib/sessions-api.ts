/**
 * Sessions API client for session management.
 * Supports both legacy global sessions and workspace-based sessions.
 */

import { Session, SessionDetail } from './types';

const API_BASE = 'http://localhost:8000/api';
const WORKSPACE_API_BASE = 'http://localhost:8000/api/workspace';

// ==================== Workspace Mode ====================
// When set, all session operations use the workspace API

let currentWorkspaceId: string | null = null;

/**
 * Set workspace mode. When workspaceId is set, all session operations
 * will use the workspace-based API. Set to null to use legacy global API.
 */
export function setWorkspaceMode(workspaceId: string | null) {
    currentWorkspaceId = workspaceId;
}

/**
 * Get the current workspace ID (for checking if in workspace mode).
 */
export function getWorkspaceMode(): string | null {
    return currentWorkspaceId;
}

// ==================== Sessions API ====================

export const sessionsApi = {
    /**
     * List all sessions (metadata only, without messages).
     * Uses workspace API if in workspace mode.
     */
    async list(): Promise<Session[]> {
        if (currentWorkspaceId) {
            const response = await fetch(`${WORKSPACE_API_BASE}/${currentWorkspaceId}/sessions`);
            if (!response.ok) {
                throw new Error(`Failed to list sessions: ${response.statusText}`);
            }
            const data = await response.json();
            return data.sessions || [];
        }

        const response = await fetch(`${API_BASE}/sessions`);
        if (!response.ok) {
            throw new Error(`Failed to list sessions: ${response.statusText}`);
        }
        const data = await response.json();
        return data.sessions;
    },

    /**
     * Get a session by ID with full message history.
     * Uses workspace API if in workspace mode, with fallback to global API.
     */
    async get(id: string): Promise<SessionDetail> {
        if (currentWorkspaceId) {
            const response = await fetch(`${WORKSPACE_API_BASE}/${currentWorkspaceId}/sessions/${id}`);
            if (response.ok) {
                return response.json();
            }
            // If workspace API returns 404, fallback to global API
            // This handles sessions created before workspace mode was enabled
            if (response.status === 404) {
                const globalResponse = await fetch(`${API_BASE}/sessions/${id}`);
                if (!globalResponse.ok) {
                    if (globalResponse.status === 404) {
                        throw new Error('Session not found');
                    }
                    throw new Error(`Failed to get session: ${globalResponse.statusText}`);
                }
                return globalResponse.json();
            }
            throw new Error(`Failed to get session: ${response.statusText}`);
        }

        const response = await fetch(`${API_BASE}/sessions/${id}`);
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Session not found');
            }
            throw new Error(`Failed to get session: ${response.statusText}`);
        }
        return response.json();
    },

    /**
     * Get a session from a specific workspace with full message history.
     * Explicit workspace ID override (ignores workspace mode).
     */
    async getFromWorkspace(workspaceId: string, sessionId: string): Promise<SessionDetail> {
        const response = await fetch(`${WORKSPACE_API_BASE}/${workspaceId}/sessions/${sessionId}`);
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Session not found');
            }
            throw new Error(`Failed to get session: ${response.statusText}`);
        }
        return response.json();
    },

    /**
     * Create a new session.
     * Uses workspace API if in workspace mode.
     */
    async create(title?: string): Promise<Session> {
        if (currentWorkspaceId) {
            const response = await fetch(
                `${WORKSPACE_API_BASE}/${currentWorkspaceId}/sessions?title=${encodeURIComponent(title || 'New Chat')}`,
                { method: 'POST' }
            );
            if (!response.ok) {
                throw new Error(`Failed to create session: ${response.statusText}`);
            }
            return response.json();
        }

        const response = await fetch(`${API_BASE}/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: title || 'New Chat' }),
        });
        if (!response.ok) {
            throw new Error(`Failed to create session: ${response.statusText}`);
        }
        return response.json();
    },

    /**
     * Update a session's title.
     */
    async update(id: string, title: string): Promise<Session> {
        // TODO: Add workspace API support when backend implements it
        const response = await fetch(`${API_BASE}/sessions/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title }),
        });
        if (!response.ok) {
            throw new Error(`Failed to update session: ${response.statusText}`);
        }
        return response.json();
    },

    /**
     * Delete a session by ID.
     * Uses workspace API if in workspace mode.
     */
    async delete(id: string): Promise<void> {
        if (currentWorkspaceId) {
            const response = await fetch(
                `${WORKSPACE_API_BASE}/${currentWorkspaceId}/sessions/${id}`,
                { method: 'DELETE' }
            );
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Session not found');
                }
                throw new Error(`Failed to delete session: ${response.statusText}`);
            }
            return;
        }

        const response = await fetch(`${API_BASE}/sessions/${id}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Session not found');
            }
            throw new Error(`Failed to delete session: ${response.statusText}`);
        }
    },

    /**
     * Get the execution status of a session.
     */
    async getStatus(id: string): Promise<{
        status: 'idle' | 'running' | 'completed' | 'error';
        has_unread: boolean;
        task_id: string | null;
        error: string | null;
    }> {
        const response = await fetch(`${API_BASE}/sessions/${id}/status`);
        if (!response.ok) {
            throw new Error(`Failed to get session status: ${response.statusText}`);
        }
        return response.json();
    },

    /**
     * Mark a session as read (clear unread badge).
     */
    async markRead(id: string): Promise<void> {
        const response = await fetch(`${API_BASE}/sessions/${id}/mark-read`, {
            method: 'POST',
        });
        if (!response.ok) {
            throw new Error(`Failed to mark session as read: ${response.statusText}`);
        }
    },

    /**
     * Get status of all sessions with active or recent tasks.
     */
    async getActiveStatus(): Promise<Record<string, {
        status: 'idle' | 'running' | 'completed' | 'error';
        has_unread: boolean;
        task_id: string;
        error: string | null;
    }>> {
        const response = await fetch(`${API_BASE}/sessions/active/status`);
        if (!response.ok) {
            throw new Error(`Failed to get active sessions status: ${response.statusText}`);
        }
        const data = await response.json();
        return data.sessions;
    },

    /**
     * Get cached events for a session (for replay on reconnect).
     */
    async getEvents(id: string): Promise<{
        events: any[];
        status: string;
        error: string | null;
    }> {
        const response = await fetch(`${API_BASE}/sessions/${id}/events`);
        if (!response.ok) {
            throw new Error(`Failed to get session events: ${response.statusText}`);
        }
        return response.json();
    },

    /**
     * Interrupt a running session.
     * Cancels the current task and updates status.
     */
    async interrupt(id: string): Promise<{ success: boolean; message: string }> {
        const response = await fetch(`${API_BASE}/sessions/${id}/interrupt`, {
            method: 'POST',
        });
        if (!response.ok) {
            throw new Error(`Failed to interrupt session: ${response.statusText}`);
        }
        return response.json();
    },
};
