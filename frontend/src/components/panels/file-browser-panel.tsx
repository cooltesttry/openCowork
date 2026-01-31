'use client';

import { FileExplorer } from '@/components/file-explorer/file-explorer';
import { useWorkspace } from '@/lib/workspace-store';

interface FileBrowserPanelProps {
    params?: {
        onMentionFile?: (path: string) => void;
    };
}

export function FileBrowserPanel({ params }: FileBrowserPanelProps) {
    const { currentWorkspace } = useWorkspace();

    return (
        <div className="h-full w-full">
            <FileExplorer
                onMentionFile={params?.onMentionFile}
                className="h-full border-0"
                workspaceId={currentWorkspace?.id}
            />
        </div>
    );
}
