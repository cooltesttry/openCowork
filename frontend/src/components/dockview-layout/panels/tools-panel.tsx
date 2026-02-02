'use client';

import { PanelRightClose, PanelRightOpen } from 'lucide-react';

import { McpSidebarPanel } from '@/components/chat/mcp-sidebar-panel';
import { useChat } from '@/lib/store';
import { ThemeToggle } from '@/components/theme-toggle';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { Button } from '@/components/ui/button';

interface ToolsPanelContentProps {
    params?: {
        onMentionFile?: (path: string) => void;
        onOpenFile?: (path: string) => void;
        onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
        onOpenImage?: (path: string) => void;
        isPreviewPanelActive?: () => boolean;
        onToggle?: () => void;
        isOpen?: boolean;
        externalViewFilter?: "all" | "images" | "documents" | "video" | "audio" | "code";
    };
}

export function ToolsPanelContent({ params }: ToolsPanelContentProps) {
    const { isProcessing } = useChat();
    const isOpen = params?.isOpen ?? true;

    if (!isOpen) {
        return (
            <div className="h-full flex flex-col items-center pt-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={params?.onToggle}
                    className="h-8 w-8"
                    title="显示 MCP Servers"
                >
                    <PanelRightOpen className="h-4 w-4" />
                </Button>
                <div className="mt-2 flex h-8 w-8 items-center justify-center" title={isProcessing ? "Active" : "Idle"}>
                    <div
                        className={`h-2 w-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
                    />
                </div>
                <ThemeToggle />
                <SettingsDialog />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="h-10 px-3 border-b flex items-center justify-between bg-card/60 backdrop-blur shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={params?.onToggle}
                    title="隐藏 MCP Servers"
                >
                    <PanelRightClose className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center" title={isProcessing ? "Active" : "Idle"}>
                        <div
                            className={`h-2 w-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
                        />
                    </div>
                    <ThemeToggle />
                    <SettingsDialog />
                </div>
            </div>
            <div className="flex-1 min-h-0">
                {/* Directly reuse existing component with built-in Tabs! */}
                <McpSidebarPanel
                    onMentionFile={params?.onMentionFile}
                    onOpenFile={params?.onOpenFile}
                    onSelectFile={params?.onSelectFile}
                    onOpenImage={params?.onOpenImage}
                    isPreviewPanelActive={params?.isPreviewPanelActive}
                    externalViewFilter={params?.externalViewFilter}
                />
            </div>
        </div>
    );
}
