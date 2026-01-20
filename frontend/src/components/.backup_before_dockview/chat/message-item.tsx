import { cn } from "@/lib/utils";
import { Message, MessageBlock } from "@/lib/types";
import { Bot, User } from "lucide-react";
import { BlockList } from "@/components/blocks/block-renderer";
import { TextBlock } from "@/components/blocks/text-block";

interface MessageItemProps {
    message: Message;
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
    onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onAskUserSkip?: (requestId: string) => void;
}

export function MessageItem({ message, onPermissionResponse, onAskUserSubmit, onAskUserSkip }: MessageItemProps) {
    const isUser = message.role === "user";
    const hasBlocks = message.blocks && message.blocks.length > 0;

    // Check if there are text blocks in the message
    const hasTextBlocks = message.blocks?.some(b => b.type === 'text') || false;

    // Only show legacy content if:
    // 1. There's actual text content
    // 2. Either there are no blocks OR there are no text blocks (to avoid duplication)
    const hasTextContent = message.content && message.content.trim().length > 0;
    const showLegacyContent = hasTextContent && !hasTextBlocks;


    return (
        <div
            className={cn(
                "w-full py-8 border-b border-black/5 dark:border-white/5",
                isUser ? "bg-muted/30 dark:bg-muted/10" : "bg-background"
            )}
        >
            <div className="max-w-4xl mx-auto flex gap-6 px-4">
                <div className="flex-shrink-0 flex flex-col items-center">
                    <div className={cn(
                        "h-8 w-8 rounded-sm flex items-center justify-center border shadow-sm",
                        isUser
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-purple-100 text-purple-600 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800"
                    )}>
                        {isUser ? <User className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
                    </div>
                </div>

                <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">
                            {isUser ? "You" : "Claude"}
                        </span>
                        {message.isStreaming && (
                            <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                            </span>
                        )}
                        {message.usage && (
                            <span className="text-xs text-muted-foreground/60 ml-2">
                                {message.usage.total_tokens.toLocaleString()} tokens
                            </span>
                        )}
                    </div>

                    {/* Render blocks first (includes thinking, tool calls, etc.) */}
                    {hasBlocks && (
                        <BlockList
                            blocks={message.blocks!}
                            onPermissionResponse={onPermissionResponse}
                            onAskUserSubmit={onAskUserSubmit}
                            onAskUserSkip={onAskUserSkip}
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
                </div>
            </div>
        </div>
    );
}

