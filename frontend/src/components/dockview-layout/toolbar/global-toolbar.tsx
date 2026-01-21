'use client';

import { useChat } from '@/lib/store';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { PanelRightClose, PanelRightOpen, Settings } from 'lucide-react';
import { SessionSidebarToggle } from '@/components/chat/session-sidebar-new';
import Link from 'next/link';

export function GlobalToolbar() {
    const { isProcessing, isSidebarOpen, setIsSidebarOpen, isSessionSidebarOpen, setIsSessionSidebarOpen } = useChat();

    return (
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
                    <div className={`h-2 w-2 rounded-full ${isProcessing ? 'bg-green-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'
                        }`} />
                    <span className="text-xs text-muted-foreground">
                        {isProcessing ? 'Active' : 'Idle'}
                    </span>
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
    );
}
