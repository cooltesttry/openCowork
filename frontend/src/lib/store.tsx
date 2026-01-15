"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { Message, AgentStep } from './types';

interface ChatContextType {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    steps: AgentStep[];
    setSteps: React.Dispatch<React.SetStateAction<AgentStep[]>>;
    isProcessing: boolean;
    setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
    isSidebarOpen: boolean;
    setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    sidebarWidth: number;
    setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const SIDEBAR_OPEN_KEY = "sidebar-open";
const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 30;

export function ChatProvider({ children }: { children: ReactNode }) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [steps, setSteps] = useState<AgentStep[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);

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
        } catch (e) {
            console.warn("Failed to load sidebar state from localStorage", e);
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

    return (
        <ChatContext.Provider value={{
            messages, setMessages,
            steps, setSteps,
            isProcessing, setIsProcessing,
            isSidebarOpen, setIsSidebarOpen,
            sidebarWidth, setSidebarWidth
        }}>
            {children}
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
