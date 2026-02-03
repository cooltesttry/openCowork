"use client";

import { MessageBlock } from "@/lib/types";
import { Image as ImageIcon, Loader2, AlertCircle, Download, ExternalLink } from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";

interface ImageGenBlockProps {
    block: MessageBlock;
}

interface ImageGenResult {
    file_path: string;
    mime_type?: string;
    width?: number;
    height?: number;
    note?: string;
}

/**
 * Parse image generation result from tool block.
 * MCP result structure: array of {type: "text", text: "..."} or direct string
 */
function parseImageGenResult(block: MessageBlock): ImageGenResult | null {
    try {
        const resultData = block.content?.result;
        if (!resultData) return null;

        let jsonStr: string | null = null;

        if (typeof resultData === 'string') {
            jsonStr = resultData;
        } else if (Array.isArray(resultData) && resultData.length > 0) {
            const firstBlock = resultData[0];
            if (firstBlock?.type === 'text' && typeof firstBlock.text === 'string') {
                jsonStr = firstBlock.text;
            }
        }

        if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            if (parsed?.file_path) {
                return parsed as ImageGenResult;
            }
        }
    } catch {
        // Ignore parse errors
    }
    return null;
}

export function ImageGenBlock({ block }: ImageGenBlockProps) {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    const isRunning = block.status === 'executing' || block.status === 'pending' || block.status === 'streaming';
    const isError = block.status === 'error' || block.content?.is_error;
    const isSuccess = block.status === 'success' && !isError;

    // Parse result - always try to parse for preloading
    // Use block.content and block.status as dependencies to detect in-place mutations
    const result = useMemo(() => parseImageGenResult(block), [block.content, block.status]);
    const prompt = block.content?.input?.prompt || '';

    // Get image URL from backend
    const imageUrl = useMemo(() => {
        return result?.file_path
            ? `http://localhost:8000/api/files/raw?path=${encodeURIComponent(result.file_path)}`
            : null;
    }, [result?.file_path]);

    // Preload image when URL becomes available (even before success status)
    // Also reset states when URL changes
    const prevImageUrlRef = useRef<string | null>(null);
    useEffect(() => {
        // Reset if URL changed
        if (imageUrl !== prevImageUrlRef.current) {
            prevImageUrlRef.current = imageUrl;
            if (!imageUrl) {
                setImageLoaded(false);
                setImageError(false);
                return;
            }
            // Start preloading
            setImageLoaded(false);
            setImageError(false);
            const img = new Image();
            img.onload = () => setImageLoaded(true);
            img.onerror = () => setImageError(true);
            img.src = imageUrl;
        }
    }, [imageUrl]);

    // Handle download
    const handleDownload = () => {
        if (imageUrl && result?.file_path) {
            const link = document.createElement('a');
            link.href = imageUrl;
            link.download = result.file_path.split('/').pop() || 'generated-image';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    // Handle open with system default application
    const handleOpenExternal = async () => {
        if (result?.file_path) {
            try {
                const res = await fetch('http://localhost:8000/api/files/open', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: result.file_path }),
                });

                if (!res.ok) {
                    console.error('Failed to open file:', await res.text());
                }
            } catch (err) {
                console.error('Open file error:', err);
            }
        }
    };

    // Running state - show loading with preload
    if (isRunning) {
        return (
            <div className="my-2 w-full min-w-0 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/20 overflow-hidden transition-all duration-300">
                <div className="px-4 py-3 flex items-center gap-3 min-w-0">
                    <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/50">
                        <Loader2 className="h-4 w-4 text-violet-600 dark:text-violet-400 animate-spin" />
                    </div>
                    <div className="flex-1 w-0 min-w-0 overflow-hidden">
                        <div className="text-sm font-medium text-violet-700 dark:text-violet-300">
                            Generating image...
                        </div>
                        {prompt && (
                            <div className="text-xs text-violet-600/70 dark:text-violet-400/70 truncate mt-0.5">
                                {prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Error state
    if (isError) {
        const errorMessage = typeof block.content?.result === 'string'
            ? block.content.result
            : 'Image generation failed';
        return (
            <div className="my-2 w-full min-w-0 rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20 overflow-hidden transition-all duration-300">
                <div className="px-4 py-3 flex items-center gap-3 min-w-0">
                    <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/50">
                        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </div>
                    <div className="flex-1 w-0 min-w-0 overflow-hidden">
                        <div className="text-sm font-medium text-red-700 dark:text-red-300">
                            Image generation failed
                        </div>
                        <div className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5 truncate">
                            {errorMessage}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Success state - show the image
    if (isSuccess && result) {
        return (
            <div className="my-2 w-full min-w-0 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-900/10 overflow-hidden transition-all duration-300">
                {/* Header */}
                <div className="px-4 py-2 flex items-center justify-between border-b border-violet-200/50 dark:border-violet-800/50">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
                            Generated Image
                        </span>
                        {result.width && result.height && (
                            <span className="text-xs text-violet-600/60 dark:text-violet-400/60">
                                {result.width} × {result.height}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleDownload}
                            className="p-1.5 rounded-md hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors"
                            title="Download image"
                        >
                            <Download className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        </button>
                        <button
                            onClick={handleOpenExternal}
                            className="p-1.5 rounded-md hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors"
                            title="Open with default app"
                        >
                            <ExternalLink className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        </button>
                    </div>
                </div>

                {/* Image with smooth fade-in */}
                <div className="relative min-h-[100px]">
                    {/* Loading overlay - fades out when image loads */}
                    <div
                        className={`absolute inset-0 flex items-center justify-center bg-violet-50 dark:bg-violet-900/20 transition-opacity duration-300 ${imageLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
                            }`}
                    >
                        <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
                    </div>

                    {imageError ? (
                        <div className="p-8 flex flex-col items-center justify-center text-violet-600/60 dark:text-violet-400/60">
                            <AlertCircle className="h-8 w-8 mb-2" />
                            <span className="text-sm">Failed to load image</span>
                            <span className="text-xs mt-1 opacity-60">{result.file_path}</span>
                        </div>
                    ) : (
                        <img
                            src={imageUrl!}
                            alt={prompt || "Generated image"}
                            className={`w-full max-h-[500px] object-contain bg-zinc-100 dark:bg-zinc-800 transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'
                                }`}
                            onLoad={() => setImageLoaded(true)}
                            onError={() => setImageError(true)}
                        />
                    )}
                </div>

                {/* Prompt (collapsible) */}
                {prompt && (
                    <div className="px-4 py-2 border-t border-violet-200/50 dark:border-violet-800/50">
                        <details className="group">
                            <summary className="text-xs text-violet-600/70 dark:text-violet-400/70 cursor-pointer hover:text-violet-700 dark:hover:text-violet-300 transition-colors">
                                View prompt
                            </summary>
                            <p className="mt-2 text-xs text-violet-700/80 dark:text-violet-300/80 leading-relaxed whitespace-pre-wrap">
                                {prompt}
                            </p>
                        </details>
                    </div>
                )}
            </div>
        );
    }

    // Fallback - shouldn't happen
    return null;
}
