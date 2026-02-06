'use client';

import { FolderOpen, PanelRightClose, PanelRightOpen, Wrench } from 'lucide-react';

import { McpSidebarPanel } from '@/components/chat/mcp-sidebar-panel';
import { useChat } from '@/lib/store';
import { ThemeToggle } from '@/components/theme-toggle';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { Button } from '@/components/ui/button';
import type { OpenImageOptions } from '@/components/image-editor/types';
import type { FilePanelOpenEntry } from '@/components/panels/file-panel';

interface ToolsPanelContentProps {
    params?: {
        onMentionFile?: (path: string) => void;
        onOpenFile?: (path: string) => void;
        onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
        onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
        onOpenImage?: (path: string, options?: OpenImageOptions) => void;
        isPreviewPanelActive?: () => boolean;
        onToggle?: () => void;
        isOpen?: boolean;
        externalViewFilter?: "all" | "images" | "documents" | "video" | "audio" | "code";
        externalViewFilterToken?: number;
    };
}

export function ToolsPanelContent({ params }: ToolsPanelContentProps) {
    const { isProcessing, rightPanelView, setRightPanelView } = useChat();
    const isOpen = params?.isOpen ?? true;
    const panelBackgroundClass = rightPanelView === "files" ? "bg-zinc-50 dark:bg-zinc-900" : "bg-card";

    if (!isOpen) {
        return (
            <div className={`h-full flex flex-col items-stretch gap-2 py-4 ${panelBackgroundClass}`}>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={params?.onToggle}
                    className="w-full !h-12 !rounded-none px-0"
                    title="显示 MCP Servers"
                >
                    <PanelRightOpen className="h-6 w-6" />
                </Button>
                <Button
                    variant={rightPanelView === "files" ? "secondary" : "ghost"}
                    size="icon"
                    onClick={() => {
                        setRightPanelView("files");
                        params?.onToggle?.();
                    }}
                    className="w-full !h-12 !rounded-none px-0"
                    title="Files"
                >
                    <FolderOpen className="h-6 w-6" />
                </Button>
                <Button
                    variant={rightPanelView === "tools" ? "secondary" : "ghost"}
                    size="icon"
                    onClick={() => {
                        setRightPanelView("tools");
                        params?.onToggle?.();
                    }}
                    className="w-full !h-12 !rounded-none px-0"
                    title="Tools"
                >
                    <Wrench className="h-6 w-6" />
                </Button>
                <ThemeToggle buttonClassName="w-full !h-12 !rounded-none px-0" iconClassName="h-6 w-6" />
                <SettingsDialog buttonClassName="w-full !h-12 !rounded-none px-0" iconClassName="h-6 w-6" />

                <div className="mt-auto flex h-12 w-full items-center justify-center" title={isProcessing ? "Active" : "Idle"}>
                    <div
                        className={`h-2 w-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className={`h-full flex flex-col ${panelBackgroundClass}`}>
            <div className={`h-10 px-3 border-b flex items-center justify-between shrink-0 ${panelBackgroundClass}`}>
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
                    <Button
                        variant={rightPanelView === "files" ? "secondary" : "ghost"}
                        size="icon"
                        onClick={() => setRightPanelView("files")}
                        title="Files"
                    >
                        <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button
                        variant={rightPanelView === "tools" ? "secondary" : "ghost"}
                        size="icon"
                        onClick={() => setRightPanelView("tools")}
                        title="Tools"
                    >
                        <Wrench className="h-4 w-4" />
                    </Button>
                    <ThemeToggle />
                    <SettingsDialog />
                </div>
            </div>
            <div className="flex-1 min-h-0">
                {/* Directly reuse existing component with built-in Tabs! */}
                <McpSidebarPanel
                    onMentionFile={params?.onMentionFile}
                    onOpenFile={params?.onOpenFile}
                    onOpenInPanel={params?.onOpenInPanel}
                    onSelectFile={params?.onSelectFile}
                    onOpenImage={params?.onOpenImage}
                    isPreviewPanelActive={params?.isPreviewPanelActive}
                    externalViewFilter={params?.externalViewFilter}
                    externalViewFilterToken={params?.externalViewFilterToken}
                />
            </div>
        </div>
    );
}
