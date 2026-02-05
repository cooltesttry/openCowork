"use client";

import { useState, useRef, type ReactNode, type HTMLAttributes, type ImgHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { MessageBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Copy, Check, Eye, Pencil, Terminal } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/lib/store";
import type { FilePanelOpenEntry } from "@/components/panels/file-panel";

// Import KaTeX CSS for math rendering
import "katex/dist/katex.min.css";

interface TextBlockProps {
    block: MessageBlock;
    onPreviewHTML?: (htmlContent: string) => void;
    onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
    onOpenTerminal?: (content: string) => void;
    containerClassName?: string;
}

// Code block wrapper with Copy and Preview buttons
function CodeBlockWrapper({
    children,
    className,
    language,
    codeContent,
    onPreviewHTML,
    onOpenInPanel,
    onOpenTerminal
}: {
    children: ReactNode;
    className?: string;
    language?: string;
    codeContent: string;
    onPreviewHTML?: (htmlContent: string) => void;
    onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
    onOpenTerminal?: (content: string) => void;
}) {
    const [copied, setCopied] = useState(false);
    const preRef = useRef<HTMLPreElement>(null);
    const normalizedLanguage = language?.toLowerCase();
    const isHTML = normalizedLanguage === 'html' || normalizedLanguage === 'htm';
    const isShell = ['bash', 'sh', 'shell', 'zsh'].includes(normalizedLanguage || '');

    const languageToExtension = (lang?: string) => {
        const normalized = (lang || '').toLowerCase();
        const mapping: Record<string, string> = {
            js: 'js',
            javascript: 'js',
            jsx: 'jsx',
            ts: 'ts',
            typescript: 'ts',
            tsx: 'tsx',
            python: 'py',
            py: 'py',
            json: 'json',
            html: 'html',
            htm: 'html',
            css: 'css',
            scss: 'scss',
            less: 'less',
            md: 'md',
            markdown: 'md',
            yaml: 'yml',
            yml: 'yml',
            toml: 'toml',
            xml: 'xml',
            bash: 'sh',
            sh: 'sh',
            shell: 'sh',
            zsh: 'sh',
            go: 'go',
            rust: 'rs',
            rs: 'rs',
            java: 'java',
            c: 'c',
            cpp: 'cpp',
            cxx: 'cpp',
            h: 'h',
            hpp: 'hpp',
            ruby: 'rb',
            rb: 'rb',
            php: 'php',
            swift: 'swift',
            kt: 'kt',
            kotlin: 'kt',
            scala: 'scala',
            lua: 'lua',
            r: 'r',
            sql: 'sql',
        };

        if (!normalized) return 'txt';
        return mapping[normalized] || 'txt';
    };

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
        if (onOpenInPanel) {
            onOpenInPanel(
                {
                    content: htmlToPreview,
                    name: 'Untitled.html',
                    is_directory: false,
                    language: normalizedLanguage,
                },
                { initialMode: 'preview' }
            );
        } else if (onPreviewHTML) {
            onPreviewHTML(htmlToPreview);
        } else {
            toast.error('Preview not available - callback missing');
        }
    };

    const handleEdit = () => {
        const textToEdit = preRef.current?.textContent || codeContent;
        const ext = languageToExtension(normalizedLanguage);
        const filename = ext === 'Dockerfile' ? 'Dockerfile' : `Untitled.${ext}`;
        if (onOpenInPanel) {
            onOpenInPanel(
                {
                    content: textToEdit,
                    name: filename,
                    is_directory: false,
                    language: normalizedLanguage,
                },
                { initialMode: 'editor' }
            );
        } else {
            toast.error('Edit not available - callback missing');
        }
    };

    const handleSendToTerminal = () => {
        const rawText = preRef.current?.textContent || codeContent;
        const textToSend = rawText.replace(/\r?\n$/, '');
        if (onOpenTerminal) {
            onOpenTerminal(textToSend);
        } else {
            toast.error('Terminal not available - callback missing');
        }
    };

    return (
        <div
            className="my-2"
            style={{ display: 'table', tableLayout: 'fixed', width: '100%' }}
        >
            <pre
                ref={preRef}
                className={cn(
                    "bg-muted/40 dark:bg-muted/30 px-4 py-1.5 rounded-md overflow-x-auto",
                    "border border-border",
                    "text-sm font-mono leading-relaxed text-foreground",
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
                        className="px-2 py-1 rounded text-xs bg-muted/50 hover:bg-muted/70 text-muted-foreground transition-colors"
                        title="Preview HTML"
                    >
                        <Eye className="h-3.5 w-3.5 inline mr-1" />
                        Preview
                    </button>
                )}
                {!isHTML && normalizedLanguage && (
                    <button
                        onClick={handleEdit}
                        className="px-2 py-1 rounded text-xs bg-muted/50 hover:bg-muted/70 text-muted-foreground transition-colors"
                        title="Edit in File Panel"
                    >
                        <Pencil className="h-3.5 w-3.5 inline mr-1" />
                        Edit
                    </button>
                )}
                {isShell && (
                    <button
                        onClick={handleSendToTerminal}
                        className="px-2 py-1 rounded text-xs bg-muted/50 hover:bg-muted/70 text-muted-foreground transition-colors"
                        title="Send to Terminal"
                    >
                        <Terminal className="h-3.5 w-3.5 inline mr-1" />
                        Terminal
                    </button>
                )}
                <button
                    onClick={handleCopy}
                    className="px-2 py-1 rounded text-xs bg-muted/50 hover:bg-muted/70 text-muted-foreground transition-colors"
                    title="Copy code"
                >
                    {copied ? <Check className="h-3.5 w-3.5 inline mr-1 text-foreground" /> : <Copy className="h-3.5 w-3.5 inline mr-1" />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
        </div>
    );
}

// Filter out broken local file path images from markdown before rendering
// Only removes complete patterns to avoid breaking streaming content
function filterLocalImages(markdown: string): string {
    // Pattern 1: Standard markdown image with local absolute path (not http/https)
    // e.g., ![alt text](/Users/xxx/image.jpg) or ![alt](/home/user/file.png)
    let result = markdown.replace(/!\[[^\]]*\]\(\/(?!\/)[^)]+\)/g, '');

    // Pattern 2: Malformed markdown with path embedded in alt text
    // e.g., ![Image: source: /Users/huawang/xxx.jpg]
    result = result.replace(/!\[[^\]]*\/Users\/[^\]]+\]/g, '');

    return result;
}

export function TextBlock({ block, onPreviewHTML, onOpenInPanel, onOpenTerminal, containerClassName }: TextBlockProps) {
    const rawContent = typeof block.content === 'string' ? block.content : '';

    // Filter out broken local file path images before rendering
    const content = filterLocalImages(rawContent);
    const isStreaming = block.status === 'streaming';
    const isStatus = block.metadata?.isStatus === true;

    // Get preview callback from store (priority) or from props
    const { previewHTMLCallback, openFilePanelCallback } = useChat();
    const previewCallback = previewHTMLCallback || onPreviewHTML;
    const openPanel = onOpenInPanel || openFilePanelCallback;

    if (!content) return null;

    if (isStatus) {
        const isIgnored = block.metadata?.statusState === 'ignored_interrupt';
        return (
            <div
                className={cn(
                    "my-1 rounded-md border px-2 py-1 text-xs",
                    isIgnored
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "border-border/60 bg-muted/40 text-muted-foreground"
                )}
            >
                {content}
            </div>
        );
    }

    return (
        <div className={cn(
            "chat-markdown prose dark:prose-invert max-w-none break-words min-w-0 overflow-hidden",
            "text-foreground",
            "prose-p:leading-7 prose-pre:my-2",
            "prose-pre:rounded-md prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none",
            "prose-headings:font-semibold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
            "prose-headings:text-foreground",
            "prose-strong:text-foreground",
            "prose-table:border-collapse prose-table:w-full prose-table:my-4",
            "prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted/30",
            "prose-td:border prose-td:border-border prose-td:p-2",
            "prose-a:text-foreground hover:prose-a:underline",
            "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
            containerClassName
        )}>
            <div className="markdown-content min-w-0 overflow-hidden">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeHighlight]}
                    components={{
                        // Use div instead of p to prevent hydration errors when code blocks are inside paragraphs
                        p({ children }: { children?: ReactNode }) {
                            return <div className="mb-4 last:mb-0">{children}</div>;
                        },
                        pre({ children, className }: { children?: ReactNode; className?: string }) {
                            // Extract language from child code element
                            // children is a React element, need to access its props correctly
                            let language: string | undefined;
                            let codeContent = '';

                            // Check if children is a valid React element with props
                            if (children && typeof children === 'object' && 'props' in children) {
                                const codeProps = children.props as { className?: string; children?: ReactNode };
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
                                    onOpenInPanel={openPanel}
                                    onOpenTerminal={onOpenTerminal}
                                >
                                    {children}
                                </CodeBlockWrapper>
                            );
                        },
                        code({ node, className, children, ...props }: HTMLAttributes<HTMLElement> & { node?: unknown }) {
                            void node;
                            // Check if this is inline code (no language, single-line, short)
                            const hasLanguage = /language-(\w+)/.test(className || '');
                            const codeContent = String(children).replace(/\n$/, '');
                            const isInline = !hasLanguage && !codeContent.includes('\n') && codeContent.length < 100;

                            if (isInline) {
                                return (
                                    <code
                                        className="bg-muted/60 text-foreground px-1.5 py-0.5 rounded text-sm font-mono border border-border break-all"
                                        {...props}
                                    >
                                        {children}
                                    </code>
                                );
                            }

                            // Block code - just return code element, pre is handled above
                            return (
                                <code className={cn("text-foreground", className)} {...props}>
                                    {children}
                                </code>
                            );
                        },
                        table({ children }: { children?: ReactNode }) {
                            return (
                                <div className="overflow-x-auto w-full my-6">
                                    <table className="w-full text-sm">
                                        {children}
                                    </table>
                                </div>
                            );
                        },
                        // Custom img handler to prevent empty src warnings
                        img({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
                            // Don't render if src is empty or undefined
                            if (!src) {
                                return null;
                            }
                            // eslint-disable-next-line @next/next/no-img-element
                            return <img src={src} alt={alt || ''} {...props} />;
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
