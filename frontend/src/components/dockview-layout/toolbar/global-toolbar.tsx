'use client';

import { useChat } from '@/lib/store';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { SessionSidebarToggle } from '@/components/chat/session-sidebar-new';
import { SettingsDialog } from '@/components/settings/settings-dialog';

export function GlobalToolbar() {
    const { isProcessing, isSidebarOpen, setIsSidebarOpen, isSessionSidebarOpen, setIsSessionSidebarOpen } = useChat();

    return (
        <header className="h-10 px-4 border-b flex items-center justify-between bg-card/50 backdrop-blur z-10 flex-none">
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
                    title={isSidebarOpen ? "隐藏侧边栏" : "显示侧边栏"}
                >
                    {isSidebarOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
                </Button>
                <ThemeToggle />
                <SettingsDialog />
            </div>
        </header>
    );
}
