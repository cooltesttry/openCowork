'use client';

import { McpSidebarPanel } from '@/components/chat/mcp-sidebar-panel';

interface ToolsPanelContentProps {
    params?: {
        onMentionFile?: (path: string) => void;
        onOpenFile?: (path: string) => void;
        onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
        isPreviewPanelActive?: () => boolean;
    };
}

export function ToolsPanelContent({ params }: ToolsPanelContentProps) {
    return (
        <div className="h-full">
            {/* Directly reuse existing component with built-in Tabs! */}
            <McpSidebarPanel
                onMentionFile={params?.onMentionFile}
                onOpenFile={params?.onOpenFile}
                onSelectFile={params?.onSelectFile}
                isPreviewPanelActive={params?.isPreviewPanelActive}
            />
        </div>
    );
}
