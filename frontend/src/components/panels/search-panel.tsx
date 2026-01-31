'use client';

import React, { useState, useCallback } from 'react';
import { IDockviewPanelProps } from 'dockview';
import { Search, FileText, Loader2, AlertCircle } from 'lucide-react';
import { API_ROOT } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-store';

interface SearchPanelProps extends IDockviewPanelProps {
    params: {
        onSelectFile?: (path: string, fileName: string) => void;
    };
}

type FileResult = {
    path: string;
    snippet: string;
    start_line?: number | null;
    end_line?: number | null;
    score: number;
    bm25?: number | null;
    distance?: number | null;
    size?: number | null;
    modified_at?: number | null;
};

// Search configuration: alpha=0.5 means 50% keyword + 50% semantic
const CONTENT_ALPHA = 0.5;

// Format file size
const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Format date
const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
};

export function SearchPanel({ params }: SearchPanelProps) {
    const { currentWorkspace } = useWorkspace();
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<FileResult[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);

    const handleSearch = useCallback(async () => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            setError('Please enter a search query');
            return;
        }

        if (!currentWorkspace?.path) {
            setError('No workspace selected');
            return;
        }

        setError(null);
        setLoading(true);
        setResults([]);
        setHasSearched(true);

        try {
            // Single hybrid search: content (alpha=0.5) + filename matching bonus
            const res = await fetch(`${API_ROOT}/search/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workdir: currentWorkspace.path,
                    query: trimmedQuery,
                    filename_query: trimmedQuery,
                    limit: 20,
                    vector_k: 30,
                    use_vector: true,
                    use_fts: true,
                    mode: 'files',
                    rerank: 'alpha',
                    alpha: CONTENT_ALPHA,
                    exclude_paths: ['.opencowork'],
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Search failed');
            }

            const data = await res.json();
            setResults(data.results || []);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Search failed';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [query, currentWorkspace?.path]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    }, [handleSearch]);

    const handleResultClick = useCallback((result: FileResult) => {
        if (params.onSelectFile) {
            const fileName = result.path.split('/').pop() || result.path;
            params.onSelectFile(result.path, fileName);
        }
    }, [params]);

    const getFileName = (path: string) => {
        const parts = path.split('/');
        return parts[parts.length - 1];
    };

    return (
        <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
            {/* Header */}
            <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 shrink-0">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {currentWorkspace ? (
                        <>Searching in: <span className="font-medium text-zinc-700 dark:text-zinc-300">{currentWorkspace.name}</span></>
                    ) : (
                        <span className="text-amber-600 dark:text-amber-400">No workspace selected</span>
                    )}
                </div>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search files..."
                        disabled={!currentWorkspace}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    {loading && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 animate-spin" />
                    )}
                </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-auto">
                {error && (
                    <div className="p-3 m-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {!currentWorkspace && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-sm p-4 text-center">
                        <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
                        <p>Please select a workspace first</p>
                    </div>
                )}

                {currentWorkspace && !hasSearched && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-sm">
                        <Search className="h-8 w-8 mb-2 opacity-50" />
                        <p>Enter a query to search files</p>
                    </div>
                )}

                {currentWorkspace && hasSearched && !loading && results.length === 0 && !error && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-sm">
                        <p>No results found</p>
                    </div>
                )}

                {results.length > 0 && (
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                        {results.map((result, index) => {
                            const fileName = getFileName(result.path);

                            return (
                                <div
                                    key={`${result.path}-${index}`}
                                    className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                                    onClick={() => handleResultClick(result)}
                                >
                                    <div className="flex items-start gap-2.5">
                                        {/* File icon */}
                                        <div className="shrink-0 mt-0.5">
                                            <FileText className="h-4 w-4 text-zinc-400" />
                                        </div>

                                        {/* Content */}
                                        <div className="min-w-0 flex-1 space-y-1">
                                            {/* Row 1: Filename */}
                                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                {fileName}
                                            </div>

                                            {/* Row 2: File info (size, date) */}
                                            <div className="flex items-center gap-2 text-xs text-zinc-400">
                                                {result.size != null && (
                                                    <span>{formatSize(result.size)}</span>
                                                )}
                                                {result.modified_at != null && (
                                                    <span>{formatDate(result.modified_at)}</span>
                                                )}
                                                {result.start_line != null && (
                                                    <span>Line {result.start_line}</span>
                                                )}
                                            </div>

                                            {/* Row 3: Snippet preview */}
                                            {result.snippet && (
                                                <p className="text-xs text-zinc-600 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                                                    {result.snippet.slice(0, 200)}
                                                </p>
                                            )}

                                            {/* Row 4: Full path */}
                                            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate font-mono">
                                                {result.path}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
