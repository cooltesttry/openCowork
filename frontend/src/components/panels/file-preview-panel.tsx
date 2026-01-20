'use client';

import React, { useState, useEffect } from 'react';
import dynamic from "next/dynamic";
import { DocViewerRenderers } from "@cyntler/react-doc-viewer";

const DocViewer = dynamic(() => import("@cyntler/react-doc-viewer"), { ssr: false });
// React PDF styles
import 'react-pdf/dist/esm/Page/TextLayer.css';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import { format } from 'date-fns';

import styled from "styled-components";
import { IDockviewPanelProps } from "dockview";

import { CustomVideoRenderer, CustomImageRenderer, CustomMarkdownRenderer, CustomRTFRenderer } from "../file-explorer/preview-renderers";

import { Pencil } from 'lucide-react';

interface FilePreviewPanelProps extends IDockviewPanelProps {
    params: {
        docs?: { uri: string; fileType?: string; fileName?: string; size?: number; modified_at?: number; htmlContent?: string }[];
        onOpenInEditor?: (filePath: string, fileName: string) => void;
    };
}

// Helper to format bytes
const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const Container = styled.div`
    height: 100%;
    width: 100%;
    
    .react-doc-viewer {
        height: 100% !important;
    }
    
    /* Override some default styles to match dark mode better if needed */
    #header-bar {
        background-color: transparent !important;
        box-shadow: none !important;
        border-bottom: 1px solid #3f3f46;
    }
`;

export function FilePreviewPanel({ params }: FilePreviewPanelProps) {
    const [content, setContent] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Default demo docs if none provided
    const docs = params?.docs || [
        {
            uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            fileType: "mp4",
            fileName: "Sample Video.mp4"
        }
    ];

    const currentDoc = docs[0];
    const fileName = currentDoc?.fileName || '';

    // Determine file categories (same logic as popup)
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(fileName);
    const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(fileName);
    const isHtml = /\.(html|htm)$/i.test(fileName);
    // Exclude html/htm from DocViewer - they cause atob() decode errors
    const isDocViewerType = /\.(pdf|docx|pptx|xlsx|csv|rtf|md|markdown)$/i.test(fileName);

    // For text files that are NOT in the above categories, try to fetch content
    // HTML files are rendered in an iframe, so they don't need content fetching
    const shouldFetchContent = !isImage && !isVideo && !isDocViewerType && !isHtml;

    // Check if file is editable (text-based files that can be edited in Monaco)
    const isEditable = /\.(txt|js|jsx|ts|tsx|py|json|html|htm|css|scss|less|md|markdown|xml|yaml|yml|toml|ini|cfg|conf|sh|bash|zsh|sql|go|rs|java|c|cpp|h|hpp|rb|php|swift|kt|scala|lua|r|vue|svelte|astro)$/i.test(fileName);

    // Extract file path from URI for opening in editor
    const getFilePath = () => {
        const urlParams = new URLSearchParams(currentDoc?.uri?.split('?')[1] || '');
        return urlParams.get('path') || '';
    };

    // Fetch content for text files
    useEffect(() => {
        if (!shouldFetchContent || !currentDoc) return;

        const fetchTextContent = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Extract path from URI
                const urlParams = new URLSearchParams(currentDoc.uri.split('?')[1]);
                const path = urlParams.get('path');
                if (!path) {
                    throw new Error("No path in URI");
                }

                const res = await fetch(`http://localhost:8000/api/files/content?path=${encodeURIComponent(path)}`);
                if (!res.ok) {
                    const data = await res.json();
                    if (res.status === 400 && data.detail?.includes("Binary files")) {
                        throw new Error("PREVIEW_NOT_AVAILABLE");
                    }
                    throw new Error(data.detail || "Failed to load content");
                }
                const data = await res.json();
                setContent(data.content);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                setError(errorMessage === "PREVIEW_NOT_AVAILABLE" ? "Preview not available for this file type" : errorMessage);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTextContent();
    }, [currentDoc?.uri, shouldFetchContent, currentDoc]);

    // No document
    if (!currentDoc) {
        return (
            <Container className="flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 text-zinc-500">
                <p>No file selected</p>
            </Container>
        );
    }

    const ext = currentDoc.fileType?.toLowerCase();

    // Render based on file type (same logic as popup)
    return (
        <Container className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 truncate">
                        {fileName}
                    </span>
                    {isEditable && params.onOpenInEditor && (
                        <button
                            onClick={() => {
                                const filePath = getFilePath();
                                if (filePath) {
                                    params.onOpenInEditor!(filePath, fileName);
                                }
                            }}
                            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shrink-0"
                            title="Open in Editor"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                {currentDoc.size !== undefined && (
                    <span className="text-xs text-zinc-400 shrink-0">
                        {formatBytes(currentDoc.size)}
                    </span>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-900 relative">
                {isImage ? (
                    <div className="flex items-center justify-center p-4 h-full">
                        <img
                            src={currentDoc.uri}
                            alt={fileName}
                            className="max-w-full max-h-full object-contain"
                        />
                    </div>
                ) : isVideo ? (
                    <div className="flex items-center justify-center bg-black h-full">
                        <video
                            src={currentDoc.uri}
                            controls
                            className="max-w-full max-h-full object-contain"
                        />
                    </div>
                ) : isHtml ? (() => {
                    // If inline htmlContent is provided, use srcdoc for direct rendering
                    if (currentDoc.htmlContent) {
                        console.log('[FilePreviewPanel] Rendering inline HTML with srcdoc, length:', currentDoc.htmlContent.length);
                        return (
                            <div className="h-full">
                                <iframe
                                    srcDoc={currentDoc.htmlContent}
                                    title={fileName}
                                    className="w-full h-full border-0 bg-white"
                                    sandbox="allow-scripts"
                                />
                            </div>
                        );
                    }

                    // Otherwise, extract path from the raw file URI and use webserver endpoint
                    // Original URI: http://localhost:8000/api/files/raw?path=xxx
                    // New URI: http://localhost:8000/api/files/webserver/xxx
                    const urlParams = new URLSearchParams(currentDoc.uri.split('?')[1] || '');
                    const filePath = urlParams.get('path') || '';
                    // Encode each path segment to handle special characters and Chinese filenames
                    const encodedPath = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
                    const webserverUri = `http://localhost:8000/api/files/webserver/${encodedPath}`;

                    // Debug logging
                    console.log('[FilePreviewPanel] HTML Preview Debug:', {
                        originalUri: currentDoc.uri,
                        extractedPath: filePath,
                        encodedPath: encodedPath,
                        webserverUri: webserverUri
                    });

                    return (
                        <div className="h-full">
                            <iframe
                                src={webserverUri}
                                title={fileName}
                                className="w-full h-full border-0 bg-white"
                                sandbox="allow-scripts allow-same-origin"
                            />
                        </div>
                    );
                })() : isDocViewerType ? (
                    <div className="h-full overflow-hidden">
                        <DocViewer
                            documents={docs}
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
                            style={{ height: '100%', background: 'transparent' }}
                            config={{
                                header: { disableHeader: true, disableFileName: true, retainURLParams: false },
                                csvDelimiter: ",",
                                pdfZoom: { defaultZoom: 1.1, zoomJump: 0.2 },
                                pdfVerticalScrollByDefault: true,
                            }}
                        />
                    </div>
                ) : (
                    // Text content or unsupported
                    <div className="p-4 h-full">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full text-zinc-400">
                                Loading...
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm text-center">
                                <div className="p-6 rounded-2xl bg-zinc-200 dark:bg-zinc-800 shadow-sm mb-4">
                                    <span className="text-4xl font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                                        {ext || 'FILE'}
                                    </span>
                                </div>
                                <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1 break-all">
                                    {fileName}
                                </h3>
                                <p className="text-sm text-zinc-400 mt-2">Preview not available</p>

                                <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 w-full max-w-md px-4">
                                    <div className="flex flex-col items-start gap-1">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                            Size
                                        </span>
                                        <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
                                            {currentDoc.size !== undefined ? formatBytes(currentDoc.size) : 'Unknown'}
                                        </span>
                                    </div>
                                    <div className="flex flex-col items-start gap-1">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                            Last Modified
                                        </span>
                                        <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
                                            {currentDoc.modified_at
                                                ? format(new Date(currentDoc.modified_at * 1000), 'MMM d, yyyy HH:mm')
                                                : 'Unknown'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <pre className="text-xs font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
                                {content}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </Container>
    );
}
