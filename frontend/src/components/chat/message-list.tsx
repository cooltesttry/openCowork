import { useRef, useEffect } from "react";
import { Message } from "@/lib/types";
import type { OpenImageOptions } from "@/components/image-editor/types";
import type { FilePanelOpenEntry } from "@/components/panels/file-panel";
import { MessageItem } from "./message-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

interface MessageListProps {
    messages: Message[];
    showProcessingPlaceholder?: boolean;
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
    onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onAskUserSkip?: (requestId: string) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
    onOpenImage?: (path: string, options?: OpenImageOptions) => void;
    onOpenTerminal?: (content: string) => void;
    onPreviewHTML?: (htmlContent: string) => void;
}

export function MessageList({ messages, showProcessingPlaceholder, onPermissionResponse, onAskUserSubmit, onAskUserSkip, onSelectFile, onOpenInPanel, onOpenImage, onOpenTerminal, onPreviewHTML }: MessageListProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom only when there's a streaming message
    // This prevents unnecessary scrolling when switching sessions or loading history
    useEffect(() => {
        // Only auto-scroll if there's an actively streaming message
        const hasStreamingMessage = messages.some(msg => msg.isStreaming) || !!showProcessingPlaceholder;
        if (!hasStreamingMessage) return;

        if (scrollRef.current) {
            const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }
    }, [messages, showProcessingPlaceholder]);

    return (
        <ScrollArea ref={scrollRef} className="flex-1 h-full">
            <div className="flex flex-col min-h-full">
                {messages.map((msg) => (
                    <MessageItem
                        key={msg.id}
                        message={msg}
                        onPermissionResponse={onPermissionResponse}
                        onAskUserSubmit={onAskUserSubmit}
                        onAskUserSkip={onAskUserSkip}
                        onSelectFile={onSelectFile}
                        onOpenInPanel={onOpenInPanel}
                        onOpenImage={onOpenImage}
                        onOpenTerminal={onOpenTerminal}
                        onPreviewHTML={onPreviewHTML}
                    />
                ))}
                {showProcessingPlaceholder && (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                        <div className="h-6 w-6 rounded-full bg-muted/40 flex items-center justify-center">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </div>
                        <span>Processing...</span>
                    </div>
                )}
                {messages.length === 0 && !showProcessingPlaceholder && (
                    <div className="flex flex-col items-center justify-center h-[50vh] text-muted-foreground opacity-50">
                        <p className="text-lg font-medium">Start a conversation</p>
                        <p className="text-sm">Type your request below to begin</p>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}
