'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { IDockviewPanelProps } from "dockview";
import { saveFile } from '../../lib/api';
import { toast } from 'sonner';
import { Eye } from 'lucide-react';

interface EditorPanelProps extends IDockviewPanelProps {
    params: {
        content?: string;
        language?: string;
        filename?: string;
        onPreviewFile?: (filePath: string, fileName: string) => void;
    };
}

const MonacoEditor = dynamic(
    () => import('@monaco-editor/react'),
    { ssr: false, loading: () => <div>Loading Editor...</div> }
);

export function EditorPanel({ params }: EditorPanelProps) {
    const [value, setValue] = useState('// Type your code here\nconsole.log("Hello World");');
    const [language, setLanguage] = useState('typescript');
    const { resolvedTheme } = useTheme();

    // Check if file is previewable (HTML or Markdown)
    const isPreviewable = params?.filename && /\.(html|htm|md|markdown)$/i.test(params.filename);
    const fileName = params?.filename?.split('/').pop() || 'Untitled';

    useEffect(() => {
        if (params?.content !== undefined) {
            setValue(params.content);
        }
        if (params?.language) {
            setLanguage(params.language);
        } else if (params?.filename) {
            // Simple extension detection
            const ext = params.filename.split('.').pop()?.toLowerCase();
            switch (ext) {
                case 'ts': case 'tsx': setLanguage('typescript'); break;
                case 'js': case 'jsx': setLanguage('javascript'); break;
                case 'py': setLanguage('python'); break;
                case 'json': setLanguage('json'); break;
                case 'html': setLanguage('html'); break;
                case 'css': setLanguage('css'); break;
                case 'md': setLanguage('markdown'); break;
                case 'sql': setLanguage('sql'); break;
                case 'sh': setLanguage('shell'); break;
                case 'yml': case 'yaml': setLanguage('yaml'); break;
                default: setLanguage('plaintext');
            }
        }
    }, [params]);

    const handleSave = useCallback(async () => {
        if (!params.filename) {
            toast.error('No filename associated with this editor');
            return;
        }
        try {
            await saveFile(params.filename, value);
            toast.success('File saved');
        } catch (error) {
            console.error('Failed to save:', error);
            toast.error('Failed to save file');
        }
    }, [params.filename, value]);

    const handlePreview = useCallback(() => {
        if (params?.filename && params?.onPreviewFile) {
            params.onPreviewFile(params.filename, fileName);
        }
    }, [params, fileName]);

    // Keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [value, params.filename, handleSave]); // Re-bind when value/filename changes to ensure latest state is saved

    // Listen to dimension changes to layout monaco
    // Monaco React handles resizing automatically if width/height are 100%, 
    // but sometimes needs a trigger if container resizes.

    return (
        <div className="h-full w-full flex flex-col relative">
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 truncate">
                        {params?.filename || 'Untitled'}
                    </span>
                    {isPreviewable && params?.onPreviewFile && (
                        <button
                            onClick={handlePreview}
                            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shrink-0"
                            title="Preview"
                        >
                            <Eye className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <button
                    onClick={handleSave}
                    className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    title="Save (Cmd+S)"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                </button>
            </div>
            <div className="flex-1 min-h-0">
                <MonacoEditor
                    height="100%"
                    width="100%"
                    language={language}
                    theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
                    value={value}
                    onChange={(val) => setValue(val || '')}
                    options={{
                        fontSize: 14,
                        fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
                        minimap: { enabled: false },
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                    }}
                />
            </div>
        </div>
    );
}
