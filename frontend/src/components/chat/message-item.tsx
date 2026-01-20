import { cn } from "@/lib/utils";
import { Message } from "@/lib/types";
import { User, FilePlus, FileEdit } from "lucide-react";
import { BlockList } from "@/components/blocks/block-renderer";
import { TextBlock } from "@/components/blocks/text-block";

interface FileOperation {
    type: 'Write' | 'Edit';
    path: string;
}

interface MessageItemProps {
    message: Message;
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
    onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onAskUserSkip?: (requestId: string) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    onPreviewHTML?: (htmlContent: string) => void;
}

export function MessageItem({ message, onPermissionResponse, onAskUserSubmit, onAskUserSkip, onSelectFile, onPreviewHTML }: MessageItemProps) {
    const isUser = message.role === "user";
    const hasBlocks = message.blocks && message.blocks.length > 0;

    // Check if there are text blocks in the message
    const hasTextBlocks = message.blocks?.some(b => b.type === 'text') || false;

    // Only show legacy content if:
    // 1. There's actual text content
    // 2. Either there are no blocks OR there are no text blocks (to avoid duplication)
    const hasTextContent = message.content && message.content.trim().length > 0;
    const showLegacyContent = hasTextContent && !hasTextBlocks;

    // Extract file operations from blocks (simple approach)
    const fileOperations: FileOperation[] = message.blocks
        ?.filter(b =>
            b.type === 'tool_use' &&
            (b.content?.name === 'Write' || b.content?.name === 'Edit') &&
            b.status === 'success' &&
            b.content?.input?.file_path
        )
        .map(b => ({
            type: b.content.name as 'Write' | 'Edit',
            path: b.content.input.file_path as string
        })) || [];

    // Extract filename from path
    const getFileName = (path: string) => {
        const parts = path.split('/');
        return parts[parts.length - 1];
    };

    // Handle file click - open in Preview panel
    const handleFileClick = (path: string) => {
        if (onSelectFile) {
            const name = getFileName(path);
            onSelectFile({ path, name, is_directory: false });
        }
    };

    return (
        <div
            className={cn(
                "w-full py-8 border-b border-black/5 dark:border-white/5",
                isUser ? "bg-zinc-100/50 dark:bg-zinc-800/30" : "bg-zinc-50 dark:bg-zinc-900"
            )}
        >
            <div className="mx-auto flex gap-4 px-4 w-full">
                {/* User avatar - only for user messages */}
                {isUser && (
                    <div className="shrink-0">
                        <div className="h-7 w-7 rounded-full flex items-center justify-center bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                            <User className="h-4 w-4" />
                        </div>
                    </div>
                )}

                <div className="flex-1 min-w-0 max-w-full overflow-hidden">
                    {/* Status indicators - only for assistant messages */}
                    {!isUser && (message.isStreaming || message.usage) && (
                        <div className="flex items-center gap-2 mb-1">
                            {message.isStreaming && (
                                <span className="inline-flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                                </span>
                            )}
                            {message.usage && (
                                <span className="text-xs text-muted-foreground/60">
                                    {message.usage.total_tokens.toLocaleString()} tokens
                                </span>
                            )}
                        </div>
                    )}

                    {/* Render blocks first (includes thinking, tool calls, etc.) */}
                    {hasBlocks && (
                        <BlockList
                            blocks={message.blocks!}
                            onPermissionResponse={onPermissionResponse}
                            onAskUserSubmit={onAskUserSubmit}
                            onAskUserSkip={onAskUserSkip}
                            onPreviewHTML={onPreviewHTML}
                        />
                    )}

                    {/* Only render legacy text content if no text blocks exist (to avoid duplication) */}
                    {showLegacyContent && (
                        <TextBlock
                            block={{
                                id: `legacy-text-${message.id}`,
                                type: 'text',
                                content: message.content,
                                status: 'success',
                            }}
                        />
                    )}

                    {/* File operations summary - extracted from blocks */}
                    {!isUser && fileOperations.length > 0 && (() => {
                        // Deduplicate by path, keeping only the first occurrence
                        const seenPaths = new Set<string>();
                        const uniqueOperations = fileOperations.filter(op => {
                            if (seenPaths.has(op.path)) {
                                return false;
                            }
                            seenPaths.add(op.path);
                            return true;
                        });

                        return (
                            <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                                <div className="flex flex-wrap gap-2">
                                    {uniqueOperations.map((op, index) => (
                                        <button
                                            key={`file-${op.path}-${index}`}
                                            onClick={() => handleFileClick(op.path)}
                                            className={cn(
                                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
                                                op.type === 'Write'
                                                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
                                                    : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                                            )}
                                            title={`Click to preview: ${op.path}`}
                                        >
                                            {op.type === 'Write' ? (
                                                <FilePlus className="h-3 w-3" />
                                            ) : (
                                                <FileEdit className="h-3 w-3" />
                                            )}
                                            <span className="underline underline-offset-2">{getFileName(op.path)}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
