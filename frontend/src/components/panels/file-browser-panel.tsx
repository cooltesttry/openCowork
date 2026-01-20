'use client';

import { FileExplorer } from '@/components/file-explorer/file-explorer';

interface FileBrowserPanelProps {
    params?: {
        onMentionFile?: (path: string) => void;
    };
}

export function FileBrowserPanel({ params }: FileBrowserPanelProps) {
    return (
        <div className="h-full w-full">
            <FileExplorer
                onMentionFile={params?.onMentionFile}
                className="h-full border-0"
            />
        </div>
    );
}
