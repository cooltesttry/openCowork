import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { FileEntry } from "./types";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { CustomVideoRenderer, CustomImageRenderer, CustomMarkdownRenderer, CustomRTFRenderer } from "./preview-renderers";

interface FilePreviewPopupProps {
    entry: FileEntry;
    position: { x: number; y: number };
    anchor?: 'left' | 'right';
    onClose: () => void;
}

export function FilePreviewPopup({ entry, position, anchor = 'right', onClose }: FilePreviewPopupProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const [content, setContent] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Determine file categories
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(entry.name);
    const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(entry.name);
    const isHtml = /\.(html|htm)$/i.test(entry.name);
    // Files that MUST use DocViewer - exclude html/htm as they cause atob() errors
    const isPdf = /\.pdf$/i.test(entry.name);
    const isDocViewerType = /\.(pdf|docx|pptx|xlsx|csv|rtf|md|markdown)$/i.test(entry.name);

    // For text files that are NOT in the above categories, we try to fetch content
    // HTML files are rendered in an iframe, so they don't need content fetching
    const shouldFetchContent = !isImage && !isVideo && !isDocViewerType && !isHtml;

    // Fetch content for text files
    useEffect(() => {
        if (!shouldFetchContent) return;

        const fetchContent = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Use encoded path to handle special characters
                const encodedPath = encodeURIComponent(entry.path);
                const res = await fetch(`http://localhost:8000/api/files/content?path=${encodedPath}`);
                if (!res.ok) {
                    const data = await res.json();

                    // Handle "Binary files not supported" specifically
                    if (res.status === 400 && data.detail && data.detail.includes("Binary files")) {
                        throw new Error("PREVIEW_NOT_AVAILABLE");
                    }

                    throw new Error(data.detail || "Failed to load content");
                }
                const data = await res.json();
                setContent(data.content);
            } catch (err: any) {
                setError(err.message === "PREVIEW_NOT_AVAILABLE" ? "Preview not available for this file type" : err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchContent();
    }, [entry.path, shouldFetchContent]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onClose]);

    // Calculate style adjustments
    const [adjustedStyle, setAdjustedStyle] = useState<React.CSSProperties>({
        top: position.y,
        left: position.x,
        visibility: 'hidden'
    });

    useLayoutEffect(() => {
        if (!popupRef.current) return;

        const rect = popupRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let top = position.y;
        let left = position.x;

        if (anchor === 'left') {
            // Anchor point is the RIGHT edge of the popup
            left = position.x - rect.width;
        }

        // Ensure popup stays within viewport
        if (left + rect.width > viewportWidth) left = viewportWidth - rect.width - 20;
        if (top + rect.height > viewportHeight) top = viewportHeight - rect.height - 20;

        // Ensure non-negative positions
        if (left < 20) left = 20;
        if (top < 20) top = 20;

        setAdjustedStyle({ top, left, visibility: 'visible' });
    }, [position, content, isLoading, isPdf, anchor]);

    const rawUrl = `http://localhost:8000/api/files/raw?path=${encodeURIComponent(entry.path)}`;

    return createPortal(
        <div
            ref={popupRef}
            className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl rounded-lg flex flex-col overflow-hidden"
            style={{
                ...adjustedStyle,
                // Default sizes
                minWidth: isPdf ? '400px' : (isImage || isVideo) ? '350px' : '300px',
                minHeight: isPdf ? '500px' : '200px',
                // Maximum constraints
                maxWidth: isPdf ? '80vw' : '500px',
                maxHeight: isPdf ? '85vh' : '500px',
                // Preferred size - use fixed widths for consistent anchor calculation
                width: isPdf ? '550px' : (isImage || isVideo) ? '450px' : '400px',
                height: isPdf ? '680px' : 'auto',
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 truncate max-w-[200px]">
                    {entry.name}
                </span>
                <button
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                    className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-500"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Content Switcher */}
            <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-900 relative">
                {isImage ? (
                    <div className="flex items-center justify-center p-4 min-h-[150px]">
                        <img
                            src={rawUrl}
                            alt={entry.name}
                            className="max-w-full max-h-full object-contain"
                            onLoad={() => setAdjustedStyle(prev => ({ ...prev }))}
                        />
                    </div>
                ) : isVideo ? (
                    <div className="flex items-center justify-center bg-black min-h-[150px]">
                        <video
                            src={rawUrl}
                            controls
                            className="max-w-full max-h-full object-contain"
                            onLoadedMetadata={() => setAdjustedStyle(prev => ({ ...prev }))}
                        />
                    </div>
                ) : isHtml ? (() => {
                    // Use webserver endpoint for proper relative resource loading
                    const encodedPath = entry.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
                    const webserverUri = `http://localhost:8000/api/files/webserver/${encodedPath}`;

                    console.log('[FilePreviewPopup] HTML Preview Debug:', {
                        path: entry.path,
                        encodedPath: encodedPath,
                        webserverUri: webserverUri
                    });

                    return (
                        <div className="h-full min-h-[300px]">
                            <iframe
                                src={webserverUri}
                                title={entry.name}
                                className="w-full h-full border-0 bg-white"
                                style={{ minHeight: '300px' }}
                                sandbox="allow-scripts allow-same-origin"
                            />
                        </div>
                    );
                })() : isDocViewerType ? (
                    <div className="h-full overflow-hidden">
                        <DocViewer
                            documents={[{
                                uri: rawUrl,
                                fileName: entry.name,
                                fileType: entry.name.split('.').pop()
                            }]}
                            pluginRenderers={[CustomVideoRenderer, CustomImageRenderer, CustomMarkdownRenderer, CustomRTFRenderer, ...DocViewerRenderers]}
                            theme={{
                                primary: "#5296d8",
                                secondary: "#ffffff",
                                tertiary: "#5296d899",
                                textPrimary: "#ffffff",
                                textSecondary: "#d9d9d9",
                                textTertiary: "#00000099",
                                disableThemeScrollbar: false,
                            }}
                            style={{ height: '100%' }}
                            config={{
                                header: { disableHeader: true, disableFileName: true, retainURLParams: false },
                                pdfZoom: { defaultZoom: 0.8, zoomJump: 0.2 },
                            }}
                        />
                    </div>
                ) : (
                    <div className="p-4 min-h-[150px]">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full text-zinc-400">
                                Loading...
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm text-center">
                                {/* Error State */}
                                {error === "PREVIEW_NOT_AVAILABLE" ? (
                                    <>
                                        <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-full mb-3">
                                            {/* File Icon Fallback if imported, else just text */}
                                            <span className="text-2xl">📄</span>
                                        </div>
                                        <p>Preview not available</p>
                                        <p className="text-xs text-zinc-400 mt-1">Binary or unsupported file</p>
                                    </>
                                ) : (
                                    <span className="text-red-500">{error}</span>
                                )}
                            </div>
                        ) : (
                            <pre className="text-xs font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
                                {content}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
