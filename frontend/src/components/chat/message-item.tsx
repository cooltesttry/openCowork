import { cn } from "@/lib/utils";
import { Message } from "@/lib/types";
import { User, FilePlus, FileEdit, FileText, Image as ImageIcon } from "lucide-react";
import { BlockList } from "@/components/blocks/block-renderer";
import { TextBlock } from "@/components/blocks/text-block";
import { useMemo } from "react";
import type { OpenImageOptions } from "@/components/image-editor/types";
import type { FilePanelOpenEntry } from "@/components/panels/file-panel";
import { useWorkspace } from "@/lib/workspace-store";
import { useChat } from "@/lib/store";
import { collectFileOperations, normalizePath } from "@/lib/file-links";

interface AttachedFile {
    path: string;
    name: string;
    isImage: boolean;
    isPreviewable: boolean;
}

interface MessageItemProps {
    message: Message;
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
    onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onAskUserSkip?: (requestId: string) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
    onOpenImage?: (path: string, options?: OpenImageOptions) => void;
    onOpenTerminal?: (content: string) => void;
    onPreviewHTML?: (htmlContent: string) => void;
}

// File type detection
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp', '.ico'];
const PREVIEWABLE_EXTENSIONS = [
    '.txt', '.md', '.json', '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
    '.yaml', '.yml', '.xml', '.sh', '.go', '.rs', '.cpp', '.c', '.h', '.java',
    '.sql', '.env', '.toml', '.ini', '.cfg', '.log', '.csv'
];

function getFileExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return '';
    return path.slice(lastDot).toLowerCase();
}

function isImageFile(path: string): boolean {
    return IMAGE_EXTENSIONS.includes(getFileExtension(path));
}

function isPreviewableFile(path: string): boolean {
    const ext = getFileExtension(path);
    return IMAGE_EXTENSIONS.includes(ext) || PREVIEWABLE_EXTENSIONS.includes(ext);
}

const DOCUMENT_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.csv', '.rtf', '.pdf', '.html', '.htm'
]);

function isDocumentFile(path: string): boolean {
    return DOCUMENT_EXTENSIONS.has(getFileExtension(path));
}

function isCodeFile(path: string): boolean {
    const ext = getFileExtension(path);
    return PREVIEWABLE_EXTENSIONS.includes(ext) && !DOCUMENT_EXTENSIONS.has(ext);
}


export function MessageItem({ message, onPermissionResponse, onAskUserSubmit, onAskUserSkip, onSelectFile, onOpenInPanel, onOpenImage, onOpenTerminal, onPreviewHTML }: MessageItemProps) {
    const isUser = message.role === "user";
    const hasBlocks = message.blocks && message.blocks.length > 0;
    const { currentWorkspace } = useWorkspace();
    const { openFilePanelCallback } = useChat();

    // Check if there are text blocks in the message
    const hasTextBlocks = message.blocks?.some(b => b.type === 'text') || false;

    // Parse "Attached files:" section from user messages
    const { cleanContent, attachedFiles } = useMemo(() => {
        if (!isUser || !message.content) {
            return { cleanContent: message.content || '', attachedFiles: [] as AttachedFile[] };
        }

        const content = message.content;
        const attachedMatch = content.match(/\n*Attached files:\s*\n([\s\S]*?)$/i);

        if (!attachedMatch) {
            return { cleanContent: content, attachedFiles: [] as AttachedFile[] };
        }

        // Extract files from the "Attached files:" section
        const filesSection = attachedMatch[1];
        const lines = filesSection.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        const files: AttachedFile[] = lines.map(path => {
            const parts = path.split('/');
            const name = parts[parts.length - 1] || path;
            return {
                path,
                name,
                isImage: isImageFile(path),
                isPreviewable: isPreviewableFile(path),
            };
        });

        // Remove the "Attached files:" section from display content
        const clean = content.slice(0, attachedMatch.index).trim();

        return { cleanContent: clean, attachedFiles: files };
    }, [isUser, message.content]);

    // Separate images from other files
    const imageFiles = attachedFiles.filter(f => f.isImage);
    const otherFiles = attachedFiles.filter(f => !f.isImage);

    // Only show legacy content if:
    // 1. There's actual text content
    // 2. Either there are no blocks OR there are no text blocks (to avoid duplication)
    const hasTextContent = cleanContent && cleanContent.trim().length > 0;
    const showLegacyContent = hasTextContent && !hasTextBlocks;

    const fileOperations = useMemo(() => (
        collectFileOperations({
            blocks: message.blocks,
            workspaceRoot: currentWorkspace?.path || null,
        })
    ), [message.blocks, currentWorkspace?.path]);

    // Extract filename from path
    const getFileName = (path: string) => {
        const parts = path.split('/');
        return parts[parts.length - 1];
    };

    // Handle file click - open in Preview panel
    const handleFileClick = (path: string, isPreviewable: boolean) => {
        if (!isPreviewable) return;
        const name = getFileName(path);
        const openPanel = onOpenInPanel || openFilePanelCallback;
        if (openPanel) {
            if (isImageFile(path)) {
                openPanel(
                    { path, name, is_directory: false },
                    { initialMode: 'image', openInAITool: true }
                );
            } else if (isDocumentFile(path)) {
                openPanel(
                    { path, name, is_directory: false },
                    { initialMode: 'preview' }
                );
            } else if (isCodeFile(path)) {
                openPanel(
                    { path, name, is_directory: false },
                    { initialMode: 'editor' }
                );
            } else {
                openPanel({ path, name, is_directory: false });
            }
            return;
        }
        onSelectFile?.({ path, name, is_directory: false });
    };

    return (
        <div
            className={cn(
                "w-full py-8 border-b border-border",
                isUser ? "bg-muted/20" : "bg-background"
            )}
        >
            <div className="mx-auto flex gap-4 px-4 w-full">
                {/* User avatar - only for user messages */}
                {isUser && (
                    <div className="shrink-0">
                        <div className="h-7 w-7 rounded-full flex items-center justify-center bg-muted/40 text-muted-foreground">
                            <User className="h-4 w-4" />
                        </div>
                    </div>
                )}

                <div className="flex-1 min-w-0 max-w-full overflow-hidden">
                    {/* Status indicators - only for assistant messages */}
                    {!isUser && message.isStreaming && (
                        <div className="flex items-center gap-2 mb-1">
                            {message.isStreaming && (
                                <span className="inline-flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-foreground/40 animate-pulse" />
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
                            onOpenImage={onOpenImage}
                            onOpenInPanel={onOpenInPanel}
                            onOpenTerminal={onOpenTerminal}
                            onPreviewHTML={onPreviewHTML}
                        />
                    )}

                    {/* Only render legacy text content if no text blocks exist (to avoid duplication) */}
                    {showLegacyContent && (
                        <TextBlock
                            block={{
                                id: `legacy-text-${message.id}`,
                                type: 'text',
                                content: cleanContent,
                                status: 'success',
                            }}
                            onPreviewHTML={onPreviewHTML}
                            onOpenInPanel={onOpenInPanel}
                            onOpenTerminal={onOpenTerminal}
                        />
                    )}

                    {/* User attachments display */}
                    {isUser && attachedFiles.length > 0 && (
                        <div className="mt-3 space-y-3">
                            {/* Image thumbnails - displayed on top */}
                            {imageFiles.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {imageFiles.map((file, index) => (
                                        <button
                                            key={`img-${file.path}-${index}`}
                                            onClick={() => handleFileClick(file.path, file.isPreviewable)}
                                            className="relative group rounded-md overflow-hidden border border-border hover:border-foreground/20 transition-colors"
                                            title={file.path}
                                        >
                                            <img
                                                src={`http://localhost:8000/api/files/raw?path=${encodeURIComponent(file.path)}`}
                                                alt={file.name}
                                                className="max-h-[150px] max-w-[200px] object-contain bg-muted/30"
                                                onError={(e) => {
                                                    // Replace with placeholder on error
                                                    const target = e.target as HTMLImageElement;
                                                    target.style.display = 'none';
                                                    target.parentElement?.classList.add('flex', 'items-center', 'justify-center', 'w-24', 'h-24', 'bg-muted/30');
                                                    const icon = document.createElement('div');
                                                    icon.innerHTML = '<svg class="h-8 w-8 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
                                                    target.parentElement?.appendChild(icon);
                                                }}
                                            />
                                            <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-2 py-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                                {file.name}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Other files - displayed below */}
                            {otherFiles.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {otherFiles.map((file, index) => (
                                        <button
                                            key={`file-${file.path}-${index}`}
                                            onClick={() => handleFileClick(file.path, file.isPreviewable)}
                                            className={cn(
                                                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border",
                                                file.isPreviewable
                                                    ? "bg-muted/40 text-foreground border-border hover:bg-muted/60 cursor-pointer"
                                                    : "bg-muted/30 text-muted-foreground border-border cursor-default opacity-60"
                                            )}
                                            title={file.isPreviewable ? `Click to preview: ${file.path}` : `Not previewable: ${file.path}`}
                                            disabled={!file.isPreviewable}
                                        >
                                            <FileText className="h-3.5 w-3.5" />
                                            <span className={file.isPreviewable ? "underline underline-offset-2" : ""}>{file.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {!isUser && message.usage && (
                        <div className="mt-2 text-right text-xs text-muted-foreground/60">
                            {message.usage.total_tokens.toLocaleString()} tokens
                        </div>
                    )}

                    {/* File operations summary - extracted from blocks */}
                    {!isUser && fileOperations.length > 0 && (() => {
                        // Deduplicate by path, keeping only the first occurrence
                        const seenPaths = new Set<string>();
                        const uniqueOperations = fileOperations.filter(op => {
                            const normalizedPath = normalizePath(op.path);
                            if (seenPaths.has(normalizedPath)) {
                                return false;
                            }
                            seenPaths.add(normalizedPath);
                            return true;
                        });

                        return (
                            <div className="mt-4 pt-3 border-t border-border">
                                <div className="flex flex-wrap gap-2">
                                    {uniqueOperations.map((op, index) => (
                                        <button
                                            key={`file-${op.path}-${index}`}
                                            onClick={() => handleFileClick(op.path, true)}
                                            className={cn(
                                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border border-border bg-muted/40 text-foreground hover:bg-muted/60"
                                            )}
                                            title={`Click to preview: ${op.path}`}
                                        >
                                            {op.type === 'Write' ? (
                                                <FilePlus className="h-3 w-3 text-muted-foreground" />
                                            ) : op.type === 'ImageGen' ? (
                                                <ImageIcon className="h-3 w-3 text-muted-foreground" />
                                            ) : op.type === 'Edit' ? (
                                                <FileEdit className="h-3 w-3 text-muted-foreground" />
                                            ) : (
                                                <FileText className="h-3 w-3 text-muted-foreground" />
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
