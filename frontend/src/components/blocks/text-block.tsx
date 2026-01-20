"use client";

import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { MessageBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Copy, Check, Eye } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/lib/store";

// Import KaTeX CSS for math rendering
import "katex/dist/katex.min.css";
// Import highlight.js CSS for code syntax highlighting
import "highlight.js/styles/github-dark.css";

interface TextBlockProps {
    block: MessageBlock;
    onPreviewHTML?: (htmlContent: string) => void;
}

// Code block wrapper with Copy and Preview buttons
function CodeBlockWrapper({
    children,
    className,
    language,
    codeContent,
    onPreviewHTML
}: {
    children: React.ReactNode;
    className?: string;
    language?: string;
    codeContent: string;
    onPreviewHTML?: (htmlContent: string) => void;
}) {
    const [copied, setCopied] = useState(false);
    const preRef = useRef<HTMLPreElement>(null);
    const isHTML = language === 'html' || language === 'htm';

    const handleCopy = async () => {
        try {
            // Get text content from the pre element directly for accurate copy
            const textToCopy = preRef.current?.textContent || codeContent;
            await navigator.clipboard.writeText(textToCopy);
            setCopied(true);
            toast.success('Copied to clipboard');
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error('Failed to copy');
        }
    };

    const handlePreview = () => {
        // Get text content from the pre element directly (same as handleCopy)
        const htmlToPreview = preRef.current?.textContent || codeContent;
        console.log('[Preview] Button clicked, onPreviewHTML exists:', !!onPreviewHTML, 'htmlToPreview length:', htmlToPreview.length);
        if (onPreviewHTML) {
            onPreviewHTML(htmlToPreview);
        } else {
            toast.error('Preview not available - callback missing');
        }
    };

    return (
        <div
            className="my-4"
            style={{ display: 'table', tableLayout: 'fixed', width: '100%' }}
        >
            <pre
                ref={preRef}
                className={cn(
                    "bg-slate-100 dark:bg-slate-900 p-4 rounded-lg overflow-x-auto",
                    "border border-slate-300 dark:border-slate-700",
                    "text-sm font-mono leading-relaxed",
                    className
                )}
            >
                {children}
            </pre>
            {/* Buttons row - below code block, right-aligned, outside code block */}
            <div className="flex justify-end gap-1 mt-1">
                {isHTML && (
                    <button
                        onClick={handlePreview}
                        className="px-2 py-1 rounded text-xs bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors"
                        title="Preview HTML"
                    >
                        <Eye className="h-3.5 w-3.5 inline mr-1" />
                        Preview
                    </button>
                )}
                <button
                    onClick={handleCopy}
                    className="px-2 py-1 rounded text-xs bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Copy code"
                >
                    {copied ? <Check className="h-3.5 w-3.5 inline mr-1 text-green-500" /> : <Copy className="h-3.5 w-3.5 inline mr-1" />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
        </div>
    );
}

export function TextBlock({ block, onPreviewHTML }: TextBlockProps) {
    const content = typeof block.content === 'string' ? block.content : '';
    const isStreaming = block.status === 'streaming';

    // Get preview callback from store (priority) or from props
    const { previewHTMLCallback } = useChat();
    const previewCallback = previewHTMLCallback || onPreviewHTML;

    console.log('[TextBlock] previewCallback exists:', !!previewCallback);

    if (!content) return null;

    return (
        <div className={cn(
            "prose dark:prose-invert max-w-none break-words min-w-0 overflow-hidden",
            // Softer text color in dark mode (not pure white)
            "text-zinc-800 dark:text-zinc-300",
            "prose-p:leading-7 prose-pre:my-2",
            "prose-pre:rounded-lg prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none",
            // Headings - slightly brighter but not pure white
            "prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
            "prose-headings:text-zinc-900 dark:prose-headings:text-zinc-200",
            // Bold/strong text - match heading color
            "prose-strong:text-zinc-900 dark:prose-strong:text-zinc-200",
            // Table styling
            "prose-table:border-collapse prose-table:w-full prose-table:my-4",
            "prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted/50",
            "prose-td:border prose-td:border-border prose-td:p-2",
            // Link styling
            "prose-a:text-primary hover:prose-a:underline",
            // List spacing
            "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5"
        )}>
            <div className="markdown-content min-w-0 overflow-hidden">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeHighlight]}
                    components={{
                        // Use div instead of p to prevent hydration errors when code blocks are inside paragraphs
                        p({ children }: any) {
                            return <div className="mb-4 last:mb-0">{children}</div>;
                        },
                        pre({ children, className }: any) {
                            // Extract language from child code element
                            // children is a React element, need to access its props correctly
                            let language: string | undefined;
                            let codeContent = '';

                            // Check if children is a valid React element with props
                            if (children && typeof children === 'object' && 'props' in children) {
                                const codeProps = children.props as { className?: string; children?: any };
                                const codeClassName = codeProps?.className || '';
                                const languageMatch = codeClassName.match(/language-(\w+)/);
                                language = languageMatch ? languageMatch[1] : undefined;
                                codeContent = String(codeProps?.children || '').replace(/\n$/, '');
                            }

                            return (
                                <CodeBlockWrapper
                                    className={className}
                                    language={language}
                                    codeContent={codeContent}
                                    onPreviewHTML={previewCallback}
                                >
                                    {children}
                                </CodeBlockWrapper>
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
