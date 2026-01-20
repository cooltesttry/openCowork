import React, { useState, useEffect } from "react";
import { DocRenderer } from "@cyntler/react-doc-viewer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

// --- Custom Renderers ---

export const CustomVideoRenderer: DocRenderer = ({ mainState: { currentDocument } }) => {
    if (!currentDocument) return null;

    // Determine source: if http, use as is; if local, use proxy
    const src = currentDocument.uri.startsWith('http')
        ? currentDocument.uri
        : `http://localhost:8000/api/files/raw?path=${encodeURIComponent(currentDocument.uri)}`;

    return (
        <div className="flex items-center justify-center h-full w-full bg-black">
            <video
                controls
                className="max-h-full max-w-full outline-none"
                src={src}
            />
        </div>
    );
};
CustomVideoRenderer.fileTypes = ["mp4", "mov", "webm", "video/mp4", "video/quicktime", "mkv"];
CustomVideoRenderer.weight = 10;

export const CustomImageRenderer: DocRenderer = ({ mainState: { currentDocument } }) => {
    if (!currentDocument) return null;

    const src = currentDocument.uri.startsWith('http')
        ? currentDocument.uri
        : `http://localhost:8000/api/files/raw?path=${encodeURIComponent(currentDocument.uri)}`;

    return (
        <div className="flex items-center justify-center h-full w-full bg-transparent overflow-auto p-4">
            <img
                src={src}
                alt={currentDocument.fileName}
                className="max-h-full max-w-full object-contain"
            />
        </div>
    );
};
CustomImageRenderer.fileTypes = ["svg", "image/svg+xml"];
CustomImageRenderer.weight = 10;

export const CustomMarkdownRenderer: DocRenderer = ({ mainState: { currentDocument } }) => {
    const [content, setContent] = useState<string | null>(null);

    useEffect(() => {
        if (!currentDocument?.uri) return;

        let url = currentDocument.uri;
        // If it looks like a local path (starts with / or ./ or no protocol), use backend API
        if (!url.startsWith('http')) {
            url = `http://localhost:8000/api/files/content?path=${encodeURIComponent(currentDocument.uri)}`;
        }

        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error("Failed to fetch");
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    return res.json();
                }
                return res.text();
            })
            .then(data => {
                if (typeof data === 'string') {
                    setContent(data);
                } else if (data.content) {
                    setContent(data.content);
                } else {
                    setContent(JSON.stringify(data));
                }
            })
            .catch(err => {
                console.warn("Markdown renderer: Failed to load content", err.message);
                setContent(`*Failed to load content*`);
            });
    }, [currentDocument?.uri]);

    if (!content) return (
        <div className="flex items-center justify-center h-full text-zinc-500">
            Loading...
        </div>
    );

    return (
        <div className="h-full w-full overflow-auto bg-zinc-50 dark:bg-zinc-900 p-8">
            <article className="prose dark:prose-invert max-w-none prose-pre:bg-zinc-200 dark:prose-pre:bg-zinc-800">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                >
                    {content}
                </ReactMarkdown>
            </article>
        </div>
    );
};
CustomMarkdownRenderer.fileTypes = ["md", "markdown", "text/markdown"];
CustomMarkdownRenderer.weight = 10;

export const CustomRTFRenderer: DocRenderer = ({ mainState: { currentDocument } }) => {
    const [content, setContent] = useState<string | null>(null);

    useEffect(() => {
        if (!currentDocument?.uri) return;

        let url = currentDocument.uri;
        if (!url.startsWith('http')) {
            url = `http://localhost:8000/api/files/content?path=${encodeURIComponent(currentDocument.uri)}`;
        }

        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error("Failed to fetch");
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    return res.json();
                }
                return res.text();
            })
            .then(data => {
                if (typeof data === 'string') {
                    setContent(data);
                } else if (data.content) {
                    setContent(data.content);
                } else {
                    setContent(JSON.stringify(data));
                }
            })
            .catch(err => {
                console.error("Failed to load RTF", err);
            });
    }, [currentDocument?.uri]);

    if (!content) return (
        <div className="flex items-center justify-center h-full text-zinc-500">
            Loading RTF...
        </div>
    );

    return (
        <div className="h-full w-full overflow-auto bg-white p-8">
            <div
                className="prose prose-sm max-w-none text-zinc-800"
                dangerouslySetInnerHTML={{ __html: content }}
            />
        </div>
    );
};
CustomRTFRenderer.fileTypes = ["rtf", "text/rtf", "application/rtf"];
CustomRTFRenderer.weight = 10;
