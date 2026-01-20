import { useRef, useEffect } from "react";
import { Message } from "@/lib/types";
import { MessageItem } from "./message-item";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MessageListProps {
    messages: Message[];
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
    onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onAskUserSkip?: (requestId: string) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    onPreviewHTML?: (htmlContent: string) => void;
}

export function MessageList({ messages, onPermissionResponse, onAskUserSubmit, onAskUserSkip, onSelectFile, onPreviewHTML }: MessageListProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }
    }, [messages]);

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
                        onPreviewHTML={onPreviewHTML}
                    />
                ))}
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-[50vh] text-muted-foreground opacity-50">
                        <p className="text-lg font-medium">Start a conversation</p>
                        <p className="text-sm">Type your request below to begin</p>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}
