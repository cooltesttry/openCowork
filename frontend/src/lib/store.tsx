"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo, useRef, useCallback } from 'react';
import { Message, AgentStep, Session } from './types';

// Session execution status for task management
export interface SessionStatus {
    status: 'idle' | 'running' | 'completed' | 'error';
    hasUnread: boolean;
    error?: string;
}

interface ChatContextType {
    // Messages for current session
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    steps: AgentStep[];
    setSteps: React.Dispatch<React.SetStateAction<AgentStep[]>>;
    isProcessing: boolean;
    setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;

    // MCP Sidebar (right side)
    isSidebarOpen: boolean;
    setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    sidebarWidth: number;
    setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;

    // Session management (left sidebar)
    sessions: Session[];
    setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
    currentSessionId: string | null;
    setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
    isSessionSidebarOpen: boolean;
    setIsSessionSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isSessionsLoading: boolean;
    setIsSessionsLoading: React.Dispatch<React.SetStateAction<boolean>>;

    // Active model for current session
    activeEndpoint: string;
    setActiveEndpoint: React.Dispatch<React.SetStateAction<string>>;
    activeModel: string;
    setActiveModel: React.Dispatch<React.SetStateAction<string>>;

    // Preview HTML callback (set by dockview, used by code blocks)
    previewHTMLCallback: ((htmlContent: string) => void) | null;
    setPreviewHTMLCallback: React.Dispatch<React.SetStateAction<((htmlContent: string) => void) | null>>;

    // Session status tracking for background tasks
    sessionStatuses: Map<string, SessionStatus>;
    setSessionStatus: (sessionId: string, status: SessionStatus) => void;
    getSessionStatus: (sessionId: string) => SessionStatus;
}

interface ChatSessionsContextType {
    sessions: Session[];
    setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
    currentSessionId: string | null;
    setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
    isSessionsLoading: boolean;
    setIsSessionsLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);
const ChatSessionsContext = createContext<ChatSessionsContextType | undefined>(undefined);

const SIDEBAR_OPEN_KEY = "sidebar-open";
const SIDEBAR_WIDTH_KEY = "sidebar-width";
const SESSION_SIDEBAR_OPEN_KEY = "session-sidebar-open";
const CURRENT_SESSION_KEY = "current-session-id";
const DEFAULT_SIDEBAR_WIDTH = 30;

export function ChatProvider({ children }: { children: ReactNode }) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [steps, setSteps] = useState<AgentStep[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);

    // Session state
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [isSessionSidebarOpen, setIsSessionSidebarOpen] = useState(true);  // Open by default
    const [isSessionsLoading, setIsSessionsLoading] = useState(true);

    // Active model for current session (will be loaded from session or settings)
    const [activeEndpoint, setActiveEndpoint] = useState<string>("");
    const [activeModel, setActiveModel] = useState<string>("");

    // Preview HTML callback (registered by dockview-main)
    const [previewHTMLCallback, setPreviewHTMLCallback] = useState<((htmlContent: string) => void) | null>(null);

    // Session status tracking for background tasks
    const [sessionStatuses, setSessionStatuses] = useState<Map<string, SessionStatus>>(new Map());
    // Ref for stable access in callbacks without triggering re-renders
    const sessionStatusesRef = useRef(sessionStatuses);
    useEffect(() => {
        sessionStatusesRef.current = sessionStatuses;
    }, [sessionStatuses]);

    const setSessionStatus = useCallback((sessionId: string, status: SessionStatus) => {
        setSessionStatuses(prev => {
            const next = new Map(prev);
            next.set(sessionId, status);
            return next;
        });
    }, []);

    // Use state directly - this allows components to react to status changes
    // Keep ref for callbacks that need stable reference without causing re-renders
    const getSessionStatus = useCallback((sessionId: string): SessionStatus => {
        return sessionStatuses.get(sessionId) || { status: 'idle', hasUnread: false };
    }, [sessionStatuses]);

    // Track if we've loaded from localStorage to prevent race condition
    const isHydrated = useRef(false);

    // Load sidebar state from localStorage on mount
    useEffect(() => {
        try {
            const savedOpen = localStorage.getItem(SIDEBAR_OPEN_KEY);
            if (savedOpen !== null) {
                setIsSidebarOpen(JSON.parse(savedOpen));
            }

            const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
            if (savedWidth !== null) {
                const width = parseFloat(savedWidth);
                if (!isNaN(width) && width >= 20 && width <= 80) {
                    setSidebarWidth(width);
                }
            }

            // Load session sidebar state
            const savedSessionSidebarOpen = localStorage.getItem(SESSION_SIDEBAR_OPEN_KEY);
            if (savedSessionSidebarOpen !== null) {
                setIsSessionSidebarOpen(JSON.parse(savedSessionSidebarOpen));
            }

            // Load current session ID
            const savedSessionId = localStorage.getItem(CURRENT_SESSION_KEY);
            if (savedSessionId) {
                setCurrentSessionId(savedSessionId);
            }
        } catch (e) {
            console.warn("Failed to load state from localStorage", e);
        }
        isHydrated.current = true;
    }, []);

    // Save isSidebarOpen to localStorage (only after hydration)
    useEffect(() => {
        if (!isHydrated.current) return;
        localStorage.setItem(SIDEBAR_OPEN_KEY, JSON.stringify(isSidebarOpen));
    }, [isSidebarOpen]);

    // Save sidebarWidth to localStorage (only after hydration)
    useEffect(() => {
        if (!isHydrated.current) return;
        localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
    }, [sidebarWidth]);

    // Save session sidebar state to localStorage (only after hydration)
    useEffect(() => {
        if (!isHydrated.current) return;
        localStorage.setItem(SESSION_SIDEBAR_OPEN_KEY, JSON.stringify(isSessionSidebarOpen));
    }, [isSessionSidebarOpen]);

    // Save current session ID to localStorage (only after hydration)
    useEffect(() => {
        if (!isHydrated.current) return;
        if (currentSessionId) {
            localStorage.setItem(CURRENT_SESSION_KEY, currentSessionId);
        } else {
            localStorage.removeItem(CURRENT_SESSION_KEY);
        }
    }, [currentSessionId]);

    const sessionsContextValue = useMemo(() => ({
        sessions, setSessions,
        currentSessionId, setCurrentSessionId,
        isSessionsLoading, setIsSessionsLoading,
    }), [sessions, currentSessionId, isSessionsLoading]);

    return (
        <ChatContext.Provider value={{
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
            previewHTMLCallback, setPreviewHTMLCallback,
            sessionStatuses, setSessionStatus, getSessionStatus,
        }}>
            <ChatSessionsContext.Provider value={sessionsContextValue}>
                {children}
            </ChatSessionsContext.Provider>
        </ChatContext.Provider>
    );
}

export function useChat() {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
}

export function useChatSessions() {
    const context = useContext(ChatSessionsContext);
    if (context === undefined) {
        throw new Error('useChatSessions must be used within a ChatProvider');
    }
    return context;
}
