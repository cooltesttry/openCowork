/**
 * Sessions API client for session management.
 */

import { Session, SessionDetail } from './types';

const API_BASE = 'http://localhost:8000/api';

export const sessionsApi = {
    /**
     * List all sessions (metadata only, without messages).
     */
    async list(): Promise<Session[]> {
        const response = await fetch(`${API_BASE}/sessions`);
        if (!response.ok) {
            throw new Error(`Failed to list sessions: ${response.statusText}`);
        }
        const data = await response.json();
        return data.sessions;
    },

    /**
     * Get a session by ID with full message history.
     */
    async get(id: string): Promise<SessionDetail> {
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
     * Create a new session.
     */
    async create(title?: string): Promise<Session> {
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
     */
    async delete(id: string): Promise<void> {
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
};
