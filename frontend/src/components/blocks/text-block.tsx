"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { MessageBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

// Import KaTeX CSS for math rendering
import "katex/dist/katex.min.css";
// Import highlight.js CSS for code syntax highlighting
import "highlight.js/styles/github-dark.css";

interface TextBlockProps {
    block: MessageBlock;
}

export function TextBlock({ block }: TextBlockProps) {
    const content = typeof block.content === 'string' ? block.content : '';
    const isStreaming = block.status === 'streaming';

    if (!content) return null;

    return (
        <div className={cn(
            "prose dark:prose-invert max-w-none break-words",
            "prose-p:leading-7 prose-pre:my-2",
            "prose-pre:rounded-lg prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none",
            "prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
            // Table styling
            "prose-table:border-collapse prose-table:w-full prose-table:my-4",
            "prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted/50",
            "prose-td:border prose-td:border-border prose-td:p-2",
            // Link styling
            "prose-a:text-primary hover:prose-a:underline",
            // List spacing
            "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5"
        )}>
            <div className="markdown-content">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeHighlight]}
                    components={{
                        // Use div instead of p to prevent hydration errors when code blocks are inside paragraphs
                        p({ children }: any) {
                            return <div className="mb-4 last:mb-0">{children}</div>;
                        },
                        pre({ children, className, ...props }: any) {
                            return (
                                <div className="relative group my-4">
                                    <pre
                                        className={cn(
                                            "bg-slate-100 dark:bg-slate-900 p-4 rounded-lg overflow-x-auto",
                                            "border border-slate-300 dark:border-slate-700",
                                            "text-sm font-mono leading-relaxed",
                                            className
                                        )}
                                        {...props}
                                    >
                                        {children}
                                    </pre>
                                </div>
                            );
                        },
                        code({ node, className, children, ...props }: any) {
                            // Check if this is inline code (no language, single-line, short)
                            const hasLanguage = /language-(\w+)/.test(className || '');
                            const codeContent = String(children).replace(/\n$/, '');
                            const isInline = !hasLanguage && !codeContent.includes('\n') && codeContent.length < 100;

                            if (isInline) {
                                return (
                                    <code
                                        className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-sm font-mono border border-primary/20"
                                        {...props}
                                    >
                                        {children}
                                    </code>
                                );
                            }

                            // Block code - just return code element, pre is handled above
                            return (
                                <code className={cn("text-slate-800 dark:text-slate-200", className)} {...props}>
                                    {children}
                                </code>
                            );
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
                    {content}
                </ReactMarkdown>
            </div>
            {isStreaming && (
                <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
            )}
        </div>
    );
}
