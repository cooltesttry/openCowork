'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Eye, Pencil, Image as ImageIcon, Save, Paintbrush2 } from 'lucide-react';
import { toast } from 'sonner';

import { saveFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EditorPanel } from './editor-panel';
import { FilePreviewPanel } from './file-preview-panel';
import { ImageEditorPanel } from '../dockview-layout/panels/image-editor-panel';

export type FilePanelMode = 'editor' | 'preview' | 'image';

interface FilePanelParams {
    path: string;
    name?: string;
    size?: number | null;
    modified_at?: number | null;
    initialMode?: FilePanelMode;
    currentMode?: FilePanelMode;
    addImage?: string;
    openInAITool?: boolean;
    onModeChange?: (panelId: string, mode: FilePanelMode) => void;
    onReferenceBarToggle?: (expanded: boolean) => void;
}

interface FilePanelProps extends IDockviewPanelProps {
    params: FilePanelParams;
}

const isImageFile = (filename: string) => /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tif|tiff|heic|heif)$/i.test(filename);
const isEditableFile = (filename: string) => /\.(txt|js|jsx|ts|tsx|py|json|html|htm|css|scss|less|md|markdown|xml|yaml|yml|toml|ini|cfg|conf|sh|bash|zsh|sql|go|rs|java|c|cpp|h|hpp|rb|php|swift|kt|scala|lua|r|vue|svelte|astro)$/i.test(filename);

export function FilePanel({ params, api }: FilePanelProps) {
    const filePath = params?.path;
    const fileName = params?.name || filePath?.split('/').pop() || 'Untitled';
    const fileExt = fileName.includes('.') ? fileName.split('.').pop() : undefined;

    const isImage = isImageFile(fileName);
    const isEditable = isEditableFile(fileName);

    const allowedModes = useMemo<FilePanelMode[]>(() => {
        if (isImage) return ['preview', 'image'];
        if (isEditable) return ['editor', 'preview'];
        return ['preview'];
    }, [isImage, isEditable]);

    const defaultMode = useMemo<FilePanelMode>(() => {
        if (params?.initialMode && allowedModes.includes(params.initialMode)) {
            return params.initialMode;
        }
        if (isImage) return 'preview';
        if (isEditable) return 'editor';
        return 'preview';
    }, [params?.initialMode, allowedModes, isImage, isEditable]);

    const [mode, setMode] = useState<FilePanelMode>(defaultMode);
    const [editorContent, setEditorContent] = useState('');
    const [draftContent, setDraftContent] = useState('');
    const [lastSavedContent, setLastSavedContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [imagePreviewDataUrl, setImagePreviewDataUrl] = useState<string | null>(null);
    const [imageHasContent, setImageHasContent] = useState(false);
    const imageExporterRef = useRef<null | (() => string | null)>(null);
    const [imageAutoFitToken, setImageAutoFitToken] = useState(0);

    useEffect(() => {
        if (params?.currentMode === mode) return;
        api.updateParameters({ ...params, currentMode: mode });
    }, [api, mode, params]);

    useEffect(() => {
        if (!params?.onModeChange) return;
        params.onModeChange(api.id, mode);
    }, [api.id, mode, params?.onModeChange]);

    useEffect(() => {
        setMode(defaultMode);
    }, [defaultMode, filePath]);

    useEffect(() => {
        setImagePreviewDataUrl(null);
        setImageHasContent(false);
        setImageAutoFitToken(0);
    }, [filePath]);

    useEffect(() => {
        if (mode === 'image') {
            setImageAutoFitToken((prev) => prev + 1);
        }
    }, [mode, filePath]);

    useEffect(() => {
        if (!filePath || !isEditable) return;

        let isActive = true;
        setIsLoading(true);
        fetch(`http://localhost:8000/api/files/content?path=${encodeURIComponent(filePath)}`)
            .then(async (res) => {
                if (!res.ok) throw new Error('Failed to load file');
                return res.json();
            })
            .then((data) => {
                if (!isActive) return;
                const content = data.content ?? '';
                setEditorContent(content);
                setDraftContent(content);
                setLastSavedContent(content);
            })
            .catch((error) => {
                if (!isActive) return;
                console.error('Failed to load file:', error);
                toast.error('Failed to load file');
            })
            .finally(() => {
                if (!isActive) return;
                setIsLoading(false);
            });

        return () => {
            isActive = false;
        };
    }, [filePath, isEditable]);

    const isDirty = isEditable && draftContent !== lastSavedContent;

    const handleSave = useCallback(async () => {
        if (!filePath) {
            toast.error('No filename associated with this file');
            return;
        }
        try {
            await saveFile(filePath, draftContent);
            setLastSavedContent(draftContent);
            toast.success('File saved');
        } catch (error) {
            console.error('Failed to save:', error);
            toast.error('Failed to save file');
        }
    }, [filePath, draftContent]);

    const previewContentOverride = useMemo(() => {
        if (mode !== 'preview') return undefined;
        if (!isEditable) return undefined;
        return draftContent;
    }, [mode, isEditable, draftContent]);

    useEffect(() => {
        if (!isImage) return;
        if (mode !== 'preview') return;

        const exporter = imageExporterRef.current;
        if (!exporter) return;

        const dataUrl = exporter();
        if (dataUrl) {
            setImagePreviewDataUrl(dataUrl);
        }
    }, [mode, isImage, imageHasContent, filePath]);

    const rawUri = filePath
        ? `http://localhost:8000/api/files/raw?path=${encodeURIComponent(filePath)}`
        : '';
    const previewUri = isImage && imagePreviewDataUrl ? imagePreviewDataUrl : rawUri;

    const imageModeToggle = (
        <div className="flex items-center rounded-md bg-zinc-100 dark:bg-zinc-700/60 p-1">
            <button
                onClick={() => setMode('preview')}
                className={cn(
                    'flex items-center justify-center rounded px-2 py-1 transition-colors',
                    mode === 'preview'
                        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                )}
                title="Preview"
            >
                <Eye className="h-4 w-4" />
            </button>
            <button
                onClick={() => setMode('image')}
                className={cn(
                    'flex items-center justify-center rounded px-2 py-1 transition-colors',
                    mode === 'image'
                        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                )}
                title="Image Editor"
            >
                <Paintbrush2 className="h-4 w-4" />
            </button>
        </div>
    );

    return (
        <div className="h-full w-full flex flex-col">
            {!(isImage && mode === 'image') && (
                <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 truncate">
                            {fileName}
                        </span>
                        {isDirty && (
                            <span className="text-[10px] text-amber-500 font-semibold" title="Unsaved changes">
                                ●
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {isEditable && (
                            <button
                                onClick={handleSave}
                                disabled={isLoading}
                                className={cn(
                                    'p-1 rounded transition-colors',
                                    'text-zinc-500 dark:text-zinc-400',
                                    'hover:bg-zinc-200 dark:hover:bg-zinc-700',
                                    'hover:text-zinc-700 dark:hover:text-zinc-200',
                                    isLoading && 'opacity-60 cursor-not-allowed'
                                )}
                                title="Save (Cmd+S)"
                            >
                                <Save className="h-3.5 w-3.5" />
                            </button>
                        )}
                        {isImage ? imageModeToggle : allowedModes.length > 1 && (
                            <div className="flex items-center rounded-md bg-zinc-100 dark:bg-zinc-700/60 p-1 text-xs">
                                {allowedModes.map((option) => {
                                    const isActive = mode === option;
                                    const label = option === 'editor' ? 'Editor' : option === 'image' ? 'Image Editor' : 'Preview';
                                    const Icon = option === 'editor' ? Pencil : option === 'image' ? ImageIcon : Eye;
                                    return (
                                        <button
                                            key={option}
                                            onClick={() => setMode(option)}
                                            className={cn(
                                                'flex items-center gap-1 rounded px-2 py-1 transition-colors',
                                                isActive
                                                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                                            )}
                                            title={label}
                                        >
                                            <Icon className="h-3 w-3" />
                                            <span>{label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="flex-1 min-h-0">
                {isEditable && (
                    <div className={mode === 'editor' ? 'h-full' : 'hidden'}>
                        <EditorPanel
                            params={{
                                content: editorContent,
                                filename: filePath,
                                hideHeader: true,
                                onContentChange: setDraftContent,
                                onSave: (content) => setLastSavedContent(content),
                            }}
                        />
                    </div>
                )}

                {isImage && (
                    <div className={mode === 'image' ? 'h-full' : 'hidden'}>
                        <ImageEditorPanel
                            params={{
                                initialImage: filePath,
                                addImage: params?.addImage,
                                openInAITool: params?.openInAITool,
                                onHasContentChange: setImageHasContent,
                                onExportRequest: (exporter) => {
                                    imageExporterRef.current = exporter;
                                    if (mode === 'preview') {
                                        const dataUrl = exporter();
                                        if (dataUrl) {
                                            setImagePreviewDataUrl(dataUrl);
                                        }
                                    }
                                },
                                autoFitToken: imageAutoFitToken,
                                modeToggle: imageModeToggle,
                                onReferenceBarToggle: params?.onReferenceBarToggle,
                            }}
                        />
                    </div>
                )}

                {mode === 'preview' && (
                    <FilePreviewPanel
                        params={{
                            docs: [
                                {
                                    uri: previewUri,
                                    fileName,
                                    fileType: fileExt,
                                    size: params?.size ?? undefined,
                                    modified_at: params?.modified_at ?? undefined,
                                },
                            ],
                            hideHeader: true,
                            contentOverride: previewContentOverride,
                        }}
                    />
                )}
            </div>
        </div>
    );
}
