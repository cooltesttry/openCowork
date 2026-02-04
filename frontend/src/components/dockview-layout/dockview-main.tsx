'use client';

import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { HTMLAttributes, MouseEvent, PointerEvent } from 'react';
import { useChat } from '@/lib/store';
import { WorkspacePanelContent } from './panels/workspace-panel';
import { ChatPanelContent } from './panels/chat-panel';
import { ToolsPanelContent } from './panels/tools-panel';
import { EditorPanel } from '../panels/editor-panel';
import { TerminalPanel } from '../panels/terminal-panel';
import { FilePreviewPanel } from '../panels/file-preview-panel';
import { FilePanel } from '../panels/file-panel';
import { AgentsPanel } from '../panels/agents-panel';
import { SuperAgentPanel } from '../agent/super-agent-panel';
import { ImageEditorPanel } from './panels/image-editor-panel';
import { FloatingAudioPlayer } from '@/components/audio/floating-audio-player';

import { useChatLogic } from './useChatLogic';
import { Toaster, toast } from 'sonner';
import type { SecurityMode } from '@/components/chat/input-area';
import type { OpenImageOptions } from '@/components/image-editor/types';
import type { FilePanelMode, FilePanelOpenEntry } from '../panels/file-panel';
import type { DockviewPanelApi, IDockviewPanelHeaderProps } from 'dockview-core';

const components = {
    workspaces: WorkspacePanelContent,
    chat: ChatPanelContent,
    tools: ToolsPanelContent,
    editor: EditorPanel,
    terminal: TerminalPanel,
    files: FilePreviewPanel,
    filepanel: FilePanel,
    agents: AgentsPanel,
    superagent: SuperAgentPanel,
    'image-editor': ImageEditorPanel,
};

const SESSION_PANEL_WIDTH = 238;
const TOOLS_PANEL_WIDTH = 310;
const COLLAPSED_PANEL_WIDTH = 44;

type DockviewTabProps = IDockviewPanelHeaderProps & HTMLAttributes<HTMLDivElement> & {
    hideClose?: boolean;
    closeActionOverride?: () => void;
};

const useDockviewTitle = (api: DockviewPanelApi) => {
    const [title, setTitle] = useState(api.title);

    useEffect(() => {
        const disposable = api.onDidTitleChange((event) => {
            setTitle(event.title);
        });
        setTitle((current) => (current !== api.title ? api.title : current));
        return () => {
            disposable.dispose();
        };
    }, [api]);

    return title;
};

const splitTitleForTab = (title: string) => {
    const lastDot = title.lastIndexOf('.');
    if (lastDot <= 0 || lastDot >= title.length - 1) {
        return { head: title, tail: '' };
    }

    const ext = title.slice(lastDot + 1);
    if (!/^[A-Za-z0-9]{1,6}$/.test(ext)) {
        return { head: title, tail: '' };
    }

    return {
        head: title.slice(0, lastDot),
        tail: title.slice(lastDot),
    };
};

const MiddleEllipsisTab = ({
    api,
    containerApi: _containerApi,
    params: _params,
    hideClose,
    closeActionOverride,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    tabLocation: _tabLocation,
    className,
    ...rest
}: DockviewTabProps) => {
    const title = useDockviewTitle(api);
    const { head, tail } = splitTitleForTab(title);
    const isMiddleMouseButton = useRef(false);

    const onClose = useCallback((event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (closeActionOverride) {
            closeActionOverride();
        } else {
            api.close();
        }
    }, [api, closeActionOverride]);

    const onBtnPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
    }, []);

    const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
        isMiddleMouseButton.current = event.button === 1;
        onPointerDown?.(event);
    }, [onPointerDown]);

    const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
        if (isMiddleMouseButton.current && event.button === 1 && !hideClose) {
            isMiddleMouseButton.current = false;
            onClose(event);
        }
        onPointerUp?.(event);
    }, [hideClose, onClose, onPointerUp]);

    const handlePointerLeave = useCallback((event: PointerEvent<HTMLDivElement>) => {
        isMiddleMouseButton.current = false;
        onPointerLeave?.(event);
    }, [onPointerLeave]);

    return (
        <div
            data-testid="dockview-dv-default-tab"
            {...rest}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            className={["dv-default-tab", className].filter(Boolean).join(' ')}
        >
            <span className="dv-default-tab-content dv-middle-ellipsis" title={title}>
                <span className="dv-tab-title-head">{head}</span>
                {tail ? <span className="dv-tab-title-tail">{tail}</span> : null}
            </span>
            {!hideClose && (
                <div className="dv-default-tab-action" onPointerDown={onBtnPointerDown} onClick={onClose}>
                    <svg height="11" width="11" viewBox="0 0 28 28" aria-hidden="false" focusable="false" className="dv-svg">
                        <path d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z" />
                    </svg>
                </div>
            )}
        </div>
    );
};

export function DockviewMain() {
    const apiRef = useRef<DockviewApi | null>(null);
    const filePanelModesRef = useRef<Map<string, FilePanelMode>>(new Map());
    const handlePreviewFileRef = useRef<((path: string, name: string, content?: string) => void) | null>(null);
    const handlePreviewHTMLRef = useRef<((htmlContent: string) => void) | null>(null);
    const terminalInputCallbackRef = useRef<((input: string) => void) | null>(null);
    const {
        isSidebarOpen,
        setIsSidebarOpen,
        isSessionSidebarOpen,
        setIsSessionSidebarOpen,
        setPreviewHTMLCallback,
        setOpenFilePanelCallback,
        terminalInputCallback,
        rightPanelView,
        setRightPanelView,
        setCanvasGroupId,
    } = useChat();

    // State for controlling FileExplorer's viewFilter from ImageEditor
    const [fileExplorerViewFilter, setFileExplorerViewFilter] = useState<"all" | "images" | "documents" | "video" | "audio" | "code">("all");
    const [fileExplorerViewFilterToken, setFileExplorerViewFilterToken] = useState(0);

    // Use shared chat logic hook
    const chatLogic = useChatLogic();
    const chatLogicRef = useRef(chatLogic);

    useEffect(() => {
        chatLogicRef.current = chatLogic;
    }, [chatLogic]);

    useEffect(() => {
        terminalInputCallbackRef.current = terminalInputCallback;
    }, [terminalInputCallback]);

    // Ref for Dockview container
    const containerRef = useRef<HTMLDivElement>(null);

    const relayout = useCallback(() => {
        if (!apiRef.current || !containerRef.current) return;
        apiRef.current.layout(
            containerRef.current.clientWidth,
            containerRef.current.clientHeight,
            true,
        );
    }, []);

    const handleNewSession = useCallback(() => {
        chatLogicRef.current?.handleNewSession();
    }, []);

    const canvasGroupIdRef = useRef<string | null>(null);
    const updateCanvasGroupId = useCallback((groupId: string | null) => {
        if (canvasGroupIdRef.current === groupId) return;
        canvasGroupIdRef.current = groupId;
        setCanvasGroupId(groupId);
    }, [setCanvasGroupId]);

    const ensureCanvasAnchor = useCallback(() => {
        if (!apiRef.current) return null;
        let editorPanel = apiRef.current.getPanel('editor-panel');
        if (editorPanel) {
            updateCanvasGroupId(editorPanel.group?.id ?? null);
            return editorPanel;
        }

        const fallbackPanel =
            apiRef.current.panels.find((panel) => panel.api.component === 'filepanel') ||
            apiRef.current.getPanel('files-panel') ||
            apiRef.current.getPanel('image-editor-panel') ||
            apiRef.current.getPanel('terminal-panel') ||
            apiRef.current.getPanel('agents-panel') ||
            apiRef.current.getPanel('super-agent-panel');

        if (fallbackPanel) {
            updateCanvasGroupId(fallbackPanel.group?.id ?? null);
            return fallbackPanel;
        }

        updateCanvasGroupId(null);
        return null;
    }, [updateCanvasGroupId]);

    const getCanvasReference = useCallback(() => {
        if (!apiRef.current) return null;
        const anchor = ensureCanvasAnchor();
        if (anchor) return { referencePanel: anchor, direction: 'within' as const };
        const chatPanel = apiRef.current.getPanel('chat-panel');
        if (!chatPanel) return null;
        return { referencePanel: chatPanel, direction: 'right' as const };
    }, [ensureCanvasAnchor]);

    const sendToTerminal = useCallback((input: string) => {
        if (!input) return;
        const attemptSend = () => {
            const callback = terminalInputCallbackRef.current;
            if (callback) {
                callback(input);
                return true;
            }
            return false;
        };

        if (attemptSend()) return;

        const start = Date.now();
        const retry = () => {
            if (attemptSend()) return;
            if (Date.now() - start < 2000) {
                setTimeout(retry, 50);
            }
        };
        setTimeout(retry, 50);
    }, []);

    const handleOpenTerminalWithInput = useCallback((input: string) => {
        if (!apiRef.current) return;
        let terminalPanel = apiRef.current.getPanel('terminal-panel');
        if (!terminalPanel) {
            const reference = getCanvasReference();
            if (!reference) return;
            terminalPanel = apiRef.current.addPanel({
                id: 'terminal-panel',
                component: 'terminal',
                title: 'Terminal',
                position: reference,
            });
            if (terminalPanel?.group?.id) {
                updateCanvasGroupId(terminalPanel.group.id);
            }
        }
        terminalPanel?.api.setActive();
        sendToTerminal(input);
    }, [getCanvasReference, sendToTerminal, updateCanvasGroupId]);

    const handleSelectSession = useCallback((id: string) => {
        chatLogicRef.current?.handleSelectSession(id);
    }, []);

    const handleDeleteSession = useCallback((id: string) => {
        chatLogicRef.current?.handleDeleteSession(id);
    }, []);

    const handleSend = useCallback((content: string) => {
        chatLogicRef.current?.handleSend(content);
    }, []);

    const handlePermissionResponse = useCallback((blockId: string, approved: boolean) => {
        chatLogicRef.current?.handlePermissionResponse(blockId, approved);
    }, []);

    const handleFilePanelModeChange = useCallback((panelId: string, mode: FilePanelMode) => {
        filePanelModesRef.current.set(panelId, mode);
    }, []);

    const handleAskUserSubmit = useCallback((requestId: string, answers: Record<string, string>) => {
        chatLogicRef.current?.handleAskUserSubmit(requestId, answers);
    }, []);

    const handleAskUserSkip = useCallback((requestId: string) => {
        chatLogicRef.current?.handleAskUserSkip(requestId);
    }, []);

    const handleSecurityModeChange = useCallback((mode: SecurityMode) => {
        chatLogicRef.current?.setSecurityMode(mode);
    }, []);

    const handleInterrupt = useCallback(() => {
        chatLogicRef.current?.handleInterrupt();
    }, []);

    const handleMentionFile = useCallback((path: string) => {
        chatLogicRef.current?.inputAreaRef.current?.addFileReference(path);
    }, []);

    const handleOpenFile = useCallback(async (path: string) => {
        try {
            const res = await fetch(`http://localhost:8000/api/files/content?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error('Failed to read file');
            const data = await res.json();

            // Ensure Editor Panel is visible/added
            let editorPanel = apiRef.current?.getPanel('editor-panel');
            if (!editorPanel) {
                const reference = getCanvasReference();
                if (!reference) {
                    toast.error("Editor panel not found");
                    return;
                }

                editorPanel = apiRef.current?.addPanel({
                    id: 'editor-panel',
                    component: 'editor',
                    title: 'Editor',
                    position: reference,
                    params: {
                        onPreviewFile: (path: string, name: string, content?: string) => {
                            handlePreviewFileRef.current?.(path, name, content);
                        },
                    }
                });
            }

            if (editorPanel) {
                editorPanel.update({
                    params: {
                        content: data.content,
                        filename: path
                    }
                });
                editorPanel.api.setActive();
                updateCanvasGroupId(editorPanel.group?.id ?? null);
            }
        } catch (error) {
            console.error('Error opening file:', error);
            toast.error("Failed to open file in editor");
        }
    }, [getCanvasReference, updateCanvasGroupId]);

    // Handle reference bar toggle in ImageEditor - switch FileExplorer to images mode
    const handleReferenceBarToggle = useCallback((expanded: boolean) => {
        if (expanded) {
            setRightPanelView('files');
            setIsSidebarOpen(true);
            // Switch file list to images mode when reference bar is expanded
            setFileExplorerViewFilter("images");
            setFileExplorerViewFilterToken((prev) => prev + 1);
        }
        // Note: Don't auto-switch back to "all" when collapsed, let user choose manually
    }, [setIsSidebarOpen, setRightPanelView]);

    const handleOpenFilePanel = useCallback((
        entry: FilePanelOpenEntry,
        options?: { initialMode?: FilePanelMode; openInAITool?: boolean }
    ) => {
        if (!apiRef.current) return;
        if (entry.is_directory) return;

        const toDataUrl = (dataUrl?: string, base64?: string, mimeType: string = 'image/png') => {
            if (dataUrl) return dataUrl;
            if (!base64) return undefined;
            if (base64.startsWith('data:')) return base64;
            return `data:${mimeType};base64,${base64}`;
        };

        const inferImageExtension = (dataUrl: string) => {
            const match = /^data:image\/([a-zA-Z0-9+.-]+);/i.exec(dataUrl);
            if (!match) return 'png';
            const mime = match[1].toLowerCase();
            if (mime === 'jpeg' || mime === 'jpg') return 'jpg';
            if (mime === 'png') return 'png';
            if (mime === 'gif') return 'gif';
            if (mime === 'webp') return 'webp';
            if (mime === 'svg+xml') return 'svg';
            if (mime === 'bmp') return 'bmp';
            if (mime === 'tiff') return 'tif';
            if (mime === 'x-icon' || mime === 'vnd.microsoft.icon') return 'ico';
            return 'png';
        };

        const base64MimeType = (() => {
            const ext = entry.name?.split('.').pop()?.toLowerCase();
            if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
            if (ext === 'png') return 'image/png';
            if (ext === 'gif') return 'image/gif';
            if (ext === 'webp') return 'image/webp';
            if (ext === 'svg') return 'image/svg+xml';
            if (ext === 'bmp') return 'image/bmp';
            if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
            return 'image/png';
        })();

        const inlineImageDataUrl = toDataUrl(entry.imageDataUrl, entry.imageBase64, base64MimeType);
        const inlineTextContent = entry.content;
        const entryPath = entry.path;
        const resolvedName = entry.name || (entryPath ? entryPath.split('/').pop() : undefined);
        const hasInlineContent = !entryPath && (inlineImageDataUrl || typeof inlineTextContent === 'string');
        if (!entryPath && !hasInlineContent) return;

        const updateFilePanelParams = (
            panel: DockviewPanelApi,
            updates: Partial<{
                path: string;
                name?: string;
                size?: number;
                modified_at?: number;
                initialMode?: FilePanelMode;
                currentMode?: FilePanelMode;
                addImage?: string;
                content?: string;
                imageDataUrl?: string;
                language?: string;
                openInAITool?: boolean;
                onModeChange?: (panelId: string, mode: FilePanelMode) => void;
                onReferenceBarToggle?: (expanded: boolean) => void;
            }>
        ) => {
            const current = panel.getParameters();
            panel.updateParameters({
                ...current,
                ...updates,
                currentMode: updates.currentMode ?? updates.initialMode ?? current?.currentMode,
                onModeChange: updates.onModeChange ?? current?.onModeChange,
                onReferenceBarToggle: updates.onReferenceBarToggle ?? current?.onReferenceBarToggle,
            });
        };

        if (entryPath && options?.initialMode === 'image') {
            const editorGroup = ensureCanvasAnchor()?.group;
            const activePanel = editorGroup?.activePanel;
            if (activePanel?.api.component === 'filepanel') {
                const activeParams = activePanel.api.getParameters() as { currentMode?: FilePanelMode } | undefined;
                const activeMode = activeParams?.currentMode ?? filePanelModesRef.current.get(activePanel.api.id);
                if (activeMode === 'image') {
                    const updates: Parameters<typeof updateFilePanelParams>[1] = {
                        addImage: entryPath,
                        onModeChange: handleFilePanelModeChange,
                        onReferenceBarToggle: handleReferenceBarToggle,
                    };
                    if (options?.openInAITool !== undefined) {
                        updates.openInAITool = options.openInAITool;
                    }
                    updateFilePanelParams(activePanel.api, updates);
                    activePanel.api.setActive();
                    return;
                }
            }
        }

        const shouldReuseByPath = Boolean(entryPath) && options?.initialMode !== 'image';
        if (shouldReuseByPath) {
            // If a file panel for this path already exists, activate it
            for (const panel of apiRef.current.panels) {
                const panelParams = (panel as { params?: { path?: string } }).params;
                if (panelParams?.path === entryPath) {
                    if (options?.initialMode || options?.openInAITool !== undefined) {
                        const updates: Parameters<typeof updateFilePanelParams>[1] = {
                            initialMode: options?.initialMode,
                            currentMode: options?.initialMode,
                            onModeChange: handleFilePanelModeChange,
                            onReferenceBarToggle: handleReferenceBarToggle,
                        };
                        if (options?.openInAITool !== undefined) {
                            updates.openInAITool = options.openInAITool;
                        }
                        updateFilePanelParams(panel.api, updates);
                    }
                    panel.api.setActive();
                    return;
                }
            }
        }

        const reference = getCanvasReference();
        if (!reference) return;

        if (hasInlineContent && !entryPath) {
            const fallbackName = inlineImageDataUrl
                ? `Untitled.${inferImageExtension(inlineImageDataUrl)}`
                : typeof inlineTextContent === 'string'
                    ? 'Untitled.txt'
                    : 'Untitled';
            const panelId = `file-panel-${Date.now()}`;
            const newPanel = apiRef.current.addPanel({
                id: panelId,
                component: 'filepanel',
                title: entry.name || fallbackName,
                position: reference,
                params: {
                    name: entry.name || fallbackName,
                    initialMode: options?.initialMode,
                    currentMode: options?.initialMode,
                    content: typeof inlineTextContent === 'string' ? inlineTextContent : undefined,
                    imageDataUrl: inlineImageDataUrl,
                    language: entry.language,
                    openInAITool: options?.openInAITool,
                    onModeChange: handleFilePanelModeChange,
                    onReferenceBarToggle: handleReferenceBarToggle,
                },
            });

            newPanel?.api.setActive();
            if (newPanel?.group?.id) {
                updateCanvasGroupId(newPanel.group.id);
            }
            return;
        }

        const panelId = `file-panel-${Date.now()}`;
        const newPanel = apiRef.current.addPanel({
            id: panelId,
            component: 'filepanel',
            title: resolvedName || 'Untitled',
            position: reference,
            params: {
                path: entryPath,
                name: resolvedName || 'Untitled',
                size: entry.size ?? undefined,
                modified_at: entry.modified_at ?? undefined,
                initialMode: options?.initialMode,
                currentMode: options?.initialMode,
                openInAITool: options?.openInAITool,
                onModeChange: handleFilePanelModeChange,
                onReferenceBarToggle: handleReferenceBarToggle,
            },
        });

        newPanel?.api.setActive();
        if (newPanel?.group?.id) {
            updateCanvasGroupId(newPanel.group.id);
        }
    }, [ensureCanvasAnchor, getCanvasReference, handleFilePanelModeChange, handleReferenceBarToggle, updateCanvasGroupId]);

    // Handle opening an image in ImageEditor panel
    const handleOpenInImageEditor = useCallback((imagePath: string, options?: OpenImageOptions) => {
        if (!apiRef.current) return;

        let imageEditorPanel = apiRef.current.getPanel('image-editor-panel');
        const openInAITool = options?.tool === 'ai';

        if (!imageEditorPanel) {
            // Panel doesn't exist, create it
            const reference = getCanvasReference();
            if (!reference) return;
            imageEditorPanel = apiRef.current.addPanel({
                id: 'image-editor-panel',
                component: 'image-editor',
                title: 'Image Editor',
                position: reference,
                params: {
                    addImage: imagePath,
                    openInAITool,
                    onReferenceBarToggle: handleReferenceBarToggle,
                }
            });
            if (imageEditorPanel?.group?.id) {
                updateCanvasGroupId(imageEditorPanel.group.id);
            }
        } else {
            // Panel already exists, update addImage parameter
            imageEditorPanel.update({
                params: {
                    addImage: imagePath,
                    openInAITool,
                    onReferenceBarToggle: handleReferenceBarToggle,
                }
            });
        }

        // Activate the panel
        imageEditorPanel?.api.setActive();
    }, [getCanvasReference, handleReferenceBarToggle, updateCanvasGroupId]);

    // Handle opening a file in editor from Preview panel
    const handleOpenInEditor = useCallback(async (filePath: string, fileName: string) => {
        if (!apiRef.current) return;

        // Search all panels to see if this file is already open in any editor
        const allPanels = apiRef.current.panels;
        for (const panel of allPanels) {
            if (panel.id.startsWith('editor-')) {
                const panelParams = (panel as { params?: { filename?: string } }).params;
                if (panelParams?.filename === filePath) {
                    // File is already open, just activate that panel
                    panel.api.setActive();
                    return;
                }
            }
        }

        // File is not open anywhere - create a new editor panel
        try {
            const res = await fetch(`http://localhost:8000/api/files/content?path=${encodeURIComponent(filePath)}`);
            if (!res.ok) throw new Error('Failed to fetch file content');
            const data = await res.json();

            // Generate unique panel ID
            const editorId = `editor-${Date.now()}`;

            // Find a reference panel to anchor to
            const reference = getCanvasReference();
            if (!reference) return;

            const newEditorPanel = apiRef.current.addPanel({
                id: editorId,
                component: 'editor',
                title: fileName,
                position: reference,
                params: {
                    content: data.content,
                    filename: filePath,
                    onPreviewFile: (path: string, name: string, content?: string) => {
                        // Forward to handlePreviewFile - will use the ref pattern
                        handlePreviewFileRef.current?.(path, name, content);
                    },
                }
            });
            newEditorPanel?.api.setActive();
            if (newEditorPanel?.group?.id) {
                updateCanvasGroupId(newEditorPanel.group.id);
            }
        } catch (error) {
            console.error('Failed to open file in editor:', error);
        }
    }, [getCanvasReference, updateCanvasGroupId]);

    const handleFileSelect = useCallback((entry: { path: string, name: string, is_directory: boolean, size?: number, modified_at?: number }) => {
        // Only preview files
        if (entry.is_directory) return;
        if (!apiRef.current) return;

        let filesPanel = apiRef.current.getPanel('files-panel');

        // If panel doesn't exist, create it
        if (!filesPanel) {
            const reference = getCanvasReference();
            if (!reference) return;
            filesPanel = apiRef.current.addPanel({
                id: 'files-panel',
                component: 'files',
                title: 'Preview',
                position: reference,
                params: {
                    onOpenInEditor: handleOpenInEditor,
                }
            });
            if (filesPanel?.group?.id) {
                updateCanvasGroupId(filesPanel.group.id);
            }
        }

        if (filesPanel) {
            const uri = `http://localhost:8000/api/files/raw?path=${encodeURIComponent(entry.path)}`;
            const ext = entry.name.split('.').pop();
            filesPanel.update({
                params: {
                    docs: [
                        {
                            uri: uri,
                            fileName: entry.name,
                            fileType: ext,
                            size: entry.size,
                            modified_at: entry.modified_at
                        }
                    ],
                    onOpenInEditor: handleOpenInEditor,
                }
            });
            // Activate the Preview tab
            filesPanel.api.setActive();
        }
    }, [getCanvasReference, handleOpenInEditor, updateCanvasGroupId]);

    // Handle previewing a file from Editor panel
    const handlePreviewFile = useCallback((filePath: string, fileName: string, contentOverride?: string) => {
        // Use same logic as handleFileSelect
        if (!apiRef.current) return;

        let filesPanel = apiRef.current.getPanel('files-panel');

        // If panel doesn't exist, create it
        if (!filesPanel) {
            const reference = getCanvasReference();
            if (!reference) return;
            filesPanel = apiRef.current.addPanel({
                id: 'files-panel',
                component: 'files',
                title: 'Preview',
                position: reference,
                params: {
                    onOpenInEditor: handleOpenInEditor,
                }
            });
            if (filesPanel?.group?.id) {
                updateCanvasGroupId(filesPanel.group.id);
            }
        }

        if (filesPanel) {
            const uri = `http://localhost:8000/api/files/raw?path=${encodeURIComponent(filePath)}`;
            const ext = fileName.split('.').pop();
            filesPanel.update({
                params: {
                    docs: [
                        {
                            uri: uri,
                            fileName: fileName,
                            fileType: ext,
                        }
                    ],
                    onOpenInEditor: handleOpenInEditor,
                    contentOverride: contentOverride,
                }
            });
            filesPanel.api.setActive();
        }
    }, [getCanvasReference, handleOpenInEditor, updateCanvasGroupId]);

    // Handle previewing HTML content from code block
    const handlePreviewHTML = useCallback((htmlContent: string) => {
        if (!apiRef.current) return;

        let filesPanel = apiRef.current.getPanel('files-panel');

        // If panel doesn't exist, create it
        if (!filesPanel) {
            const reference = getCanvasReference();
            if (!reference) return;
            filesPanel = apiRef.current.addPanel({
                id: 'files-panel',
                component: 'files',
                title: 'Preview',
                position: reference,
                params: {
                    onOpenInEditor: handleOpenInEditor,
                }
            });
            if (filesPanel?.group?.id) {
                updateCanvasGroupId(filesPanel.group.id);
            }
        }

        if (filesPanel) {
            // Pass HTML content directly for srcdoc rendering
            filesPanel.update({
                params: {
                    docs: [
                        {
                            uri: '',  // Not used when htmlContent is provided
                            fileName: 'preview.html',
                            fileType: 'html',
                            htmlContent: htmlContent,  // Direct HTML content for srcdoc
                        }
                    ],
                    onOpenInEditor: handleOpenInEditor,
                }
            });
            filesPanel.api.setActive();
        }
    }, [getCanvasReference, handleOpenInEditor, updateCanvasGroupId]);

    // Update refs for forward reference
    handlePreviewFileRef.current = handlePreviewFile;
    handlePreviewHTMLRef.current = handlePreviewHTML;

    // Register handlePreviewHTML to store so code blocks can access it via useChat
    useEffect(() => {
        setPreviewHTMLCallback(() => handlePreviewHTML);
        return () => setPreviewHTMLCallback(null);
    }, [handlePreviewHTML, setPreviewHTMLCallback]);

    useEffect(() => {
        setOpenFilePanelCallback(() => handleOpenFilePanel);
        return () => setOpenFilePanelCallback(null);
    }, [handleOpenFilePanel, setOpenFilePanelCallback]);

    // Check if files-panel (Preview) is currently active
    const isPreviewPanelActive = useCallback(() => {
        const filesPanel = apiRef.current?.getPanel('files-panel');
        if (!filesPanel) return false;
        // Check if this panel is the active panel in its group
        const group = filesPanel.group;
        return group?.activePanel?.id === 'files-panel';
    }, []);

    const onReady = (event: DockviewReadyEvent) => {
        const api = event.api;
        apiRef.current = api;

        api.onDidRemovePanel((panel) => {
            filePanelModesRef.current.delete(panel.api.id);
        });

        // Panel 1: Chat (Center Left) - Anchor
        const chatPanel = api.addPanel({
            id: 'chat-panel',
            component: 'chat',
            title: 'Chat',
            params: {
                onSend: handleSend,
                onPermissionResponse: handlePermissionResponse,
                onAskUserSubmit: handleAskUserSubmit,
                onAskUserSkip: handleAskUserSkip,
                onInterrupt: handleInterrupt,
                securityMode: chatLogic.securityMode,
                onSecurityModeChange: handleSecurityModeChange,
                inputAreaRef: chatLogic.inputAreaRef,
                onSelectFile: handleFileSelect,
                onOpenInPanel: handleOpenFilePanel,
                onOpenImage: handleOpenInImageEditor,
                onOpenTerminal: handleOpenTerminalWithInput,
                onPreviewHTML: (htmlContent: string) => {
                    handlePreviewHTMLRef.current?.(htmlContent);
                },
            }
        });
        if (chatPanel?.group?.header) {
            chatPanel.group.header.hidden = true;
        }

        // Panel 2: Canvas (Center Right) - Editor / Terminal / Files / Web
        // Add Editor as the first tab in this group
        const editorPanel = api.addPanel({
            id: 'editor-panel',
            component: 'editor',
            title: 'Editor',
            position: { referencePanel: 'chat-panel', direction: 'right' },
            params: {
                onPreviewFile: handlePreviewFile,
            }
        });

        // Add other tabs to the same group as Editor
        if (editorPanel) {
            api.addPanel({
                id: 'terminal-panel',
                component: 'terminal',
                title: 'Terminal',
                position: { referencePanel: editorPanel, direction: 'within' },
            });
            api.addPanel({
                id: 'files-panel',
                component: 'files',
                title: 'Preview',
                position: { referencePanel: editorPanel, direction: 'within' },
                params: {
                    onOpenInEditor: handleOpenInEditor,
                }
            });
            api.addPanel({
                id: 'agents-panel',
                component: 'agents',
                title: 'Agents',
                position: { referencePanel: editorPanel, direction: 'within' },
            });
            api.addPanel({
                id: 'super-agent-panel',
                component: 'superagent',
                title: 'Super Agent',
                position: { referencePanel: editorPanel, direction: 'within' },
            });
            api.addPanel({
                id: 'image-editor-panel',
                component: 'image-editor',
                title: 'Image Editor',
                position: { referencePanel: editorPanel, direction: 'within' },
                params: {
                    onReferenceBarToggle: handleReferenceBarToggle,
                }
            });

            // Activate the Editor tab by default
            editorPanel.api.setActive();
            updateCanvasGroupId(editorPanel.group?.id ?? null);
        }


        // Panel 3: Workspaces (Left)
        const workspaceWidth = isSessionSidebarOpen ? SESSION_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;
        const workspacesPanel = api.addPanel({
            id: 'workspaces-panel',
            component: 'workspaces',
            title: 'Workspaces',
            position: { referencePanel: 'chat-panel', direction: 'left' },
            initialWidth: workspaceWidth,
            minimumWidth: workspaceWidth,
            maximumWidth: workspaceWidth,
            params: {
                onNewSession: handleNewSession,
                onSelectSession: handleSelectSession,
                onDeleteSession: handleDeleteSession,
                onToggle: () => setIsSessionSidebarOpen(!isSessionSidebarOpen),
                isOpen: isSessionSidebarOpen,
            }
        });
        if (workspacesPanel?.group?.api) {
            workspacesPanel.group.api.setConstraints({
                minimumWidth: workspaceWidth,
                maximumWidth: workspaceWidth,
            });
            workspacesPanel.group.api.setSize({ width: workspaceWidth });
        }
        if (workspacesPanel?.group?.header) {
            workspacesPanel.group.header.hidden = true;
        }

        // Panel 4: Tools (Right) - Always present, collapsible to icon bar
        const toolsWidth = isSidebarOpen ? TOOLS_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;
        const referencePanel = api.getPanel('editor-panel') || 'chat-panel';
        const toolsPanel = api.addPanel({
            id: 'tools-panel',
            component: 'tools',
            title: 'Tools',
            position: { referencePanel: referencePanel, direction: 'right' },
            initialWidth: toolsWidth,
            minimumWidth: toolsWidth,
            maximumWidth: toolsWidth,
            params: {
                onMentionFile: handleMentionFile,
                onOpenFile: handleOpenFile,
                onOpenInPanel: handleOpenFilePanel,
                onSelectFile: handleFileSelect,
                onOpenImage: handleOpenInImageEditor,
                isPreviewPanelActive: isPreviewPanelActive,
                onToggle: () => setIsSidebarOpen(!isSidebarOpen),
                isOpen: isSidebarOpen,
                externalViewFilter: fileExplorerViewFilter,
                externalViewFilterToken: fileExplorerViewFilterToken,
            }
        });
        if (toolsPanel?.group?.api) {
            toolsPanel.group.api.setConstraints({
                minimumWidth: toolsWidth,
                maximumWidth: toolsWidth,
            });
            toolsPanel.group.api.setSize({ width: toolsWidth });
        }
        if (toolsPanel?.group?.header) {
            toolsPanel.group.header.hidden = true;
        }

        // After all panels are added, set Chat and Editor to split 50/50
        // Use setTimeout to ensure layout is complete
        setTimeout(() => {
            const chatPanelRef = api.getPanel('chat-panel');
            const editorPanelRef = api.getPanel('editor-panel');

            if (chatPanelRef && editorPanelRef) {
                // Get actual widths of the center panels
                const chatWidth = chatPanelRef.api.width;
                const editorWidth = editorPanelRef.api.width;
                const totalCenterWidth = chatWidth + editorWidth;
                const halfWidth = Math.floor(totalCenterWidth / 2);

                // Set chat panel to half, editor will take the rest
                chatPanelRef.api.setSize({ width: halfWidth });
            }
        }, 100);
    };

    // Handle toggle of tools panel when sidebar state changes
    useEffect(() => {
        if (!apiRef.current) return;

        const toolsPanel = apiRef.current.getPanel('tools-panel');

        if (!toolsPanel) {
            // Anchor to editor-panel if it exists (Canvas), otherwise chat-panel
            const editorPanel = apiRef.current.getPanel('editor-panel');
            const referencePanel = editorPanel || apiRef.current.getPanel('chat-panel');

            if (referencePanel) {
                const targetWidth = isSidebarOpen ? TOOLS_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;
                const newToolsPanel = apiRef.current.addPanel({
                    id: 'tools-panel',
                    component: 'tools',
                    title: 'Tools',
                    position: { referencePanel: referencePanel, direction: 'right' },
                    initialWidth: targetWidth,
                    minimumWidth: targetWidth,
                    maximumWidth: targetWidth,
                    params: {
                        onMentionFile: handleMentionFile,
                        onOpenFile: handleOpenFile,
                        onOpenInPanel: handleOpenFilePanel,
                        onSelectFile: handleFileSelect,
                        onOpenImage: handleOpenInImageEditor,
                        isPreviewPanelActive: isPreviewPanelActive,
                        onToggle: () => setIsSidebarOpen(!isSidebarOpen),
                        isOpen: isSidebarOpen,
                        externalViewFilter: fileExplorerViewFilter,
                        externalViewFilterToken: fileExplorerViewFilterToken,
                    }
                });
                if (newToolsPanel?.group?.api) {
                    newToolsPanel.group.api.setConstraints({
                        minimumWidth: targetWidth,
                        maximumWidth: targetWidth,
                    });
                    newToolsPanel.group.api.setSize({ width: targetWidth });
                }
                if (newToolsPanel?.group?.header) {
                    newToolsPanel.group.header.hidden = true;
                }
                relayout();
            }
        } else {
            const targetWidth = isSidebarOpen ? TOOLS_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;
            toolsPanel.group.api.setConstraints({
                minimumWidth: targetWidth,
                maximumWidth: targetWidth,
            });
            toolsPanel.group.api.setSize({ width: targetWidth });
            toolsPanel.api.updateParameters({
                onMentionFile: handleMentionFile,
                onOpenFile: handleOpenFile,
                onOpenInPanel: handleOpenFilePanel,
                onSelectFile: handleFileSelect,
                onOpenImage: handleOpenInImageEditor,
                isPreviewPanelActive: isPreviewPanelActive,
                onToggle: () => setIsSidebarOpen(!isSidebarOpen),
                isOpen: isSidebarOpen,
                externalViewFilter: fileExplorerViewFilter,
                externalViewFilterToken: fileExplorerViewFilterToken,
            });
            relayout();
        }
    }, [isSidebarOpen, handleMentionFile, handleOpenFile, handleOpenFilePanel, handleFileSelect, handleOpenInImageEditor, isPreviewPanelActive, setIsSidebarOpen, relayout, fileExplorerViewFilter, fileExplorerViewFilterToken]);

    // Handle toggle of workspaces panel
    useEffect(() => {
        if (!apiRef.current) return;

        const workspacesPanel = apiRef.current.getPanel('workspaces-panel');

        if (!workspacesPanel) {
            const targetWidth = isSessionSidebarOpen ? SESSION_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;
            const newWorkspacesPanel = apiRef.current.addPanel({
                id: 'workspaces-panel',
                component: 'workspaces',
                title: 'Workspaces',
                position: { referencePanel: 'chat-panel', direction: 'left' },
                initialWidth: targetWidth,
                minimumWidth: targetWidth,
                maximumWidth: targetWidth,
                params: {
                    onNewSession: handleNewSession,
                    onSelectSession: handleSelectSession,
                    onDeleteSession: handleDeleteSession,
                    onToggle: () => setIsSessionSidebarOpen(!isSessionSidebarOpen),
                    isOpen: isSessionSidebarOpen,
                }
            });
            if (newWorkspacesPanel?.group?.api) {
                newWorkspacesPanel.group.api.setConstraints({
                    minimumWidth: targetWidth,
                    maximumWidth: targetWidth,
                });
                newWorkspacesPanel.group.api.setSize({ width: targetWidth });
            }
            if (newWorkspacesPanel?.group?.header) {
                newWorkspacesPanel.group.header.hidden = true;
            }
            relayout();
        } else {
            const targetWidth = isSessionSidebarOpen ? SESSION_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;
            workspacesPanel.group.api.setConstraints({
                minimumWidth: targetWidth,
                maximumWidth: targetWidth,
            });
            workspacesPanel.group.api.setSize({ width: targetWidth });
            workspacesPanel.api.updateParameters({
                onNewSession: handleNewSession,
                onSelectSession: handleSelectSession,
                onDeleteSession: handleDeleteSession,
                onToggle: () => setIsSessionSidebarOpen(!isSessionSidebarOpen),
                isOpen: isSessionSidebarOpen,
            });
            relayout();
        }
    }, [isSessionSidebarOpen, handleNewSession, handleSelectSession, handleDeleteSession, setIsSessionSidebarOpen, relayout]);

    useEffect(() => {
        const panel = apiRef.current?.getPanel('chat-panel');
        if (!panel) return;
        panel.api.updateParameters({
            securityMode: chatLogic.securityMode,
        });
    }, [chatLogic.securityMode]);

    return (
        <div className="h-screen flex flex-col bg-background">

            {/* Dockview Layout with theme support */}
            {/* min-h-0 is critical: allows flex item to shrink below content's intrinsic size */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-hidden"
                style={{
                    paddingLeft: 0,
                    paddingRight: 0,
                    transition: "padding 200ms ease-out",
                }}
            >
                <div className="h-full w-full">
                    <style jsx global>{`
            /* Increase specificity to override library defaults without !important */
            .dockview-theme-light.dockview-theme-light,
            .dockview-theme-dark.dockview-theme-dark {
              --dv-group-view-background-color: var(--background);
              --dv-tabs-and-actions-container-background-color: var(--card);
              --dv-activegroup-visiblepanel-tab-background-color: var(--card);
              --dv-activegroup-hiddenpanel-tab-background-color: var(--muted);
              --dv-inactivegroup-visiblepanel-tab-background-color: var(--card);
              --dv-inactivegroup-hiddenpanel-tab-background-color: var(--muted);
              --dv-tab-divider-color: var(--border);
              --dv-separator-border: var(--border);
              --dv-paneview-header-border-color: var(--border);
              --dv-drag-over-background-color: var(--accent);
              
              /* Fix Tab Text Colors */
              --dv-activegroup-visiblepanel-tab-color: var(--foreground);
              --dv-activegroup-hiddenpanel-tab-color: var(--muted-foreground);
              --dv-inactivegroup-visiblepanel-tab-color: var(--muted-foreground);
              --dv-inactivegroup-hiddenpanel-tab-color: var(--muted-foreground);

              /* Slightly smaller and shorter tabs (especially for the right panel area) */
              --dv-tabs-and-actions-container-height: 30px;
              --dv-tabs-and-actions-container-font-size: 12px;
              --dv-tab-font-size: 12px;
            }

            .dockview-theme-light .dv-tabs-and-actions-container .dv-tab,
            .dockview-theme-dark .dv-tabs-and-actions-container .dv-tab {
              padding: 0 0.5rem;
            }

            .dockview-theme-light .dv-tabs-and-actions-container .dv-default-tab-content,
            .dockview-theme-dark .dv-tabs-and-actions-container .dv-default-tab-content {
              max-width: 12ch;
              min-width: 0;
              overflow: hidden;
              display: flex;
              align-items: center;
              gap: 0;
            }

            .dockview-theme-light .dv-tabs-and-actions-container .dv-tab-title-head,
            .dockview-theme-dark .dv-tabs-and-actions-container .dv-tab-title-head {
              min-width: 0;
              flex: 1 1 auto;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .dockview-theme-light .dv-tabs-and-actions-container .dv-tab-title-tail,
            .dockview-theme-dark .dv-tabs-and-actions-container .dv-tab-title-tail {
              flex: 0 0 auto;
              white-space: nowrap;
            }

            /* Smooth programmatic resize for sidebars */
            .dockview-theme-light .dv-split-view-container .dv-view,
            .dockview-theme-dark .dv-split-view-container .dv-view,
            .dockview-theme-light .dv-split-view-container .dv-sash,
            .dockview-theme-dark .dv-split-view-container .dv-sash {
              transition: transform 0.18s ease-out;
            }
          `}</style>
                    <DockviewReact
                        components={components}
                        defaultTabComponent={MiddleEllipsisTab}
                        onReady={onReady}
                        className="h-full w-full dockview-theme-light dark:dockview-theme-dark"
                    />
                </div>
            </div>
            <FloatingAudioPlayer />
            <Toaster />
        </div>
    );
}
