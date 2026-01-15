import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Message } from "@/lib/types";
import { Bot, User } from "lucide-react";
import { BlockList } from "@/components/blocks/block-renderer";

interface MessageItemProps {
    message: Message;
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
}

export function MessageItem({ message, onPermissionResponse }: MessageItemProps) {
    const isUser = message.role === "user";
    const hasBlocks = message.blocks && message.blocks.length > 0;

    // For user messages or legacy messages without blocks, show content directly
    const showLegacyContent = !hasBlocks && message.content && message.content.trim().length > 0;

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

                    {/* Render blocks in order (includes text, thinking, tool calls, etc.) */}
                    {hasBlocks && (
                        <BlockList
                            blocks={message.blocks!}
                            onPermissionResponse={onPermissionResponse}
                        />
                    )}

                    {/* Legacy content rendering for user messages or messages without blocks */}
                    {showLegacyContent && (
                        <div className={cn(
                            "prose dark:prose-invert max-w-none break-words",
                            "prose-p:leading-7 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border",
                            "prose-pre:rounded-lg prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none",
                            "prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
                            "prose-table:border-collapse prose-table:w-full prose-table:my-4",
                            "prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted/50",
                            "prose-td:border prose-td:border-border prose-td:p-2",
                            "prose-a:text-primary hover:prose-a:underline",
                            "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5"
                        )}>
                            <div className="markdown-content">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        code({ node, inline, className, children, ...props }: any) {
                                            return !inline ? (
                                                <div className="relative group">
                                                    <pre className="!bg-muted/50 !p-4 rounded-lg overflow-x-auto border border-border/50 my-4 text-sm">
                                                        <code className={className} {...props}>
                                                            {children}
                                                        </code>
                                                    </pre>
                                                </div>
                                            ) : (
                                                <code className="bg-muted/50 px-1.5 py-0.5 rounded text-sm font-mono text-foreground border border-border/50" {...props}>
                                                    {children}
                                                </code>
                                            )
                                        },
                                        table({ children }: any) {
                                            return (
                                                <div className="overflow-x-auto w-full my-6 border rounded-lg bg-card/50">
                                                    <table className="w-full text-sm">
                                                        {children}
                                                    </table>
                                                </div>
                                            );
                                        }
                                    }}
                                >
                                    {message.content}
                                </ReactMarkdown>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

