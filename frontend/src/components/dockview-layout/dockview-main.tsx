'use client';

import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { useRef, useEffect, useCallback } from 'react';
import { useChat } from '@/lib/store';
import { GlobalToolbar } from './toolbar/global-toolbar';
import { SessionPanelContent } from './panels/session-panel';
import { ChatPanelContent } from './panels/chat-panel';
import { ToolsPanelContent } from './panels/tools-panel';
import { EditorPanel } from '../panels/editor-panel';
import { TerminalPanel } from '../panels/terminal-panel';
import { FilePreviewPanel } from '../panels/file-preview-panel';
import { WebContainerPanel } from '../panels/webcontainer-panel';
import { useChatLogic } from './useChatLogic';
import { Toaster, toast } from 'sonner';
import type { SecurityMode } from '@/components/chat/input-area';

const components = {
    sessions: SessionPanelContent,
    chat: ChatPanelContent,
    tools: ToolsPanelContent,
    editor: EditorPanel,
    terminal: TerminalPanel,
    files: FilePreviewPanel,
    web: WebContainerPanel,
};

const SESSION_PANEL_WIDTH = 238;
const TOOLS_PANEL_WIDTH = 310;

export function DockviewMain() {
    const apiRef = useRef<DockviewApi | null>(null);
    const handlePreviewFileRef = useRef<((path: string, name: string) => void) | null>(null);
    const handlePreviewHTMLRef = useRef<((htmlContent: string) => void) | null>(null);
    const { isSidebarOpen, isSessionSidebarOpen, setIsSessionSidebarOpen, setPreviewHTMLCallback } = useChat();

    // Use shared chat logic hook
    const chatLogic = useChatLogic();
    const chatLogicRef = useRef(chatLogic);

    useEffect(() => {
        chatLogicRef.current = chatLogic;
    }, [chatLogic]);

    const handleNewSession = useCallback(() => {
        chatLogicRef.current?.handleNewSession();
    }, []);

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

    const handleAskUserSubmit = useCallback((requestId: string, answers: Record<string, string>) => {
        chatLogicRef.current?.handleAskUserSubmit(requestId, answers);
    }, []);

    const handleAskUserSkip = useCallback((requestId: string) => {
        chatLogicRef.current?.handleAskUserSkip(requestId);
    }, []);

    const handleSecurityModeChange = useCallback((mode: SecurityMode) => {
        chatLogicRef.current?.setSecurityMode(mode);
    }, []);

    const handleMentionFile = useCallback((path: string) => {
        chatLogicRef.current?.inputAreaRef.current?.insertText(path);
    }, []);

    const handleOpenFile = useCallback(async (path: string) => {
        try {
            const res = await fetch(`http://localhost:8000/api/files/content?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error('Failed to read file');
            const data = await res.json();

            // Ensure Editor Panel is visible/added
            const editorPanel = apiRef.current?.getPanel('editor-panel');
            if (!editorPanel && apiRef.current) {
                // If closed, recreate it? Or just focus if hidden?
                // Ideally we should re-add it if missing, but for now let's assume it's just hidden or we can find it.
                // If it was *closed* (destroyed), we need to add it again.
                // For simplicity, let's just warn if missing, or try to find it.
                toast.error("Editor panel not found");
                return;
            }

            if (editorPanel) {
                editorPanel.update({
                    params: {
                        content: data.content,
                        filename: path
                    }
                });
                editorPanel.api.setActive();
            }
        } catch (error) {
            console.error('Error opening file:', error);
            toast.error("Failed to open file in editor");
        }
    }, []);

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
            const editorPanel = apiRef.current.getPanel('editor-panel');
            const chatPanel = apiRef.current.getPanel('chat-panel');
            const referencePanel = editorPanel || chatPanel;

            if (referencePanel) {
                const newEditorPanel = apiRef.current.addPanel({
                    id: editorId,
                    component: 'editor',
                    title: fileName,
                    position: { referencePanel: referencePanel, direction: editorPanel ? 'within' : 'right' },
                    params: {
                        content: data.content,
                        filename: filePath,
                        onPreviewFile: (path: string, name: string) => {
                            // Forward to handlePreviewFile - will use the ref pattern
                            handlePreviewFileRef.current?.(path, name);
                        },
                    }
                });
                newEditorPanel?.api.setActive();
            }
        } catch (error) {
            console.error('Failed to open file in editor:', error);
        }
    }, []);

    const handleFileSelect = useCallback((entry: { path: string, name: string, is_directory: boolean, size?: number, modified_at?: number }) => {
        // Only preview files
        if (entry.is_directory) return;
        if (!apiRef.current) return;

        let filesPanel = apiRef.current.getPanel('files-panel');

        // If panel doesn't exist, create it
        if (!filesPanel) {
            // Find a reference panel to anchor to (prefer editor-panel)
            const editorPanel = apiRef.current.getPanel('editor-panel');
            const chatPanel = apiRef.current.getPanel('chat-panel');
            const referencePanel = editorPanel || chatPanel;

            if (referencePanel) {
                filesPanel = apiRef.current.addPanel({
                    id: 'files-panel',
                    component: 'files',
                    title: 'Preview',
                    position: { referencePanel: referencePanel, direction: editorPanel ? 'within' : 'right' },
                    params: {
                        onOpenInEditor: handleOpenInEditor,
                    }
                });
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
    }, [handleOpenInEditor]);

    // Handle previewing a file from Editor panel
    const handlePreviewFile = useCallback((filePath: string, fileName: string) => {
        // Use same logic as handleFileSelect
        if (!apiRef.current) return;

        let filesPanel = apiRef.current.getPanel('files-panel');

        // If panel doesn't exist, create it
        if (!filesPanel) {
            const editorPanel = apiRef.current.getPanel('editor-panel');
            const chatPanel = apiRef.current.getPanel('chat-panel');
            const referencePanel = editorPanel || chatPanel;

            if (referencePanel) {
                filesPanel = apiRef.current.addPanel({
                    id: 'files-panel',
                    component: 'files',
                    title: 'Preview',
                    position: { referencePanel: referencePanel, direction: editorPanel ? 'within' : 'right' },
                    params: {
                        onOpenInEditor: handleOpenInEditor,
                    }
                });
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
                }
            });
            filesPanel.api.setActive();
        }
    }, [handleOpenInEditor]);

    // Handle previewing HTML content from code block
    const handlePreviewHTML = useCallback((htmlContent: string) => {
        if (!apiRef.current) return;

        let filesPanel = apiRef.current.getPanel('files-panel');

        // If panel doesn't exist, create it
        if (!filesPanel) {
            const editorPanel = apiRef.current.getPanel('editor-panel');
            const chatPanel = apiRef.current.getPanel('chat-panel');
            const referencePanel = editorPanel || chatPanel;

            if (referencePanel) {
                filesPanel = apiRef.current.addPanel({
                    id: 'files-panel',
                    component: 'files',
                    title: 'Preview',
                    position: { referencePanel: referencePanel, direction: editorPanel ? 'within' : 'right' },
                    params: {
                        onOpenInEditor: handleOpenInEditor,
                    }
                });
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
    }, [handleOpenInEditor]);

    // Update refs for forward reference
    handlePreviewFileRef.current = handlePreviewFile;
    handlePreviewHTMLRef.current = handlePreviewHTML;

    // Register handlePreviewHTML to store so code blocks can access it via useChat
    useEffect(() => {
        setPreviewHTMLCallback(() => handlePreviewHTML);
        return () => setPreviewHTMLCallback(null);
    }, [handlePreviewHTML, setPreviewHTMLCallback]);

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
                securityMode: chatLogic.securityMode,
                onSecurityModeChange: handleSecurityModeChange,
                inputAreaRef: chatLogic.inputAreaRef,
                onSelectFile: handleFileSelect,
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
                id: 'web-panel',
                component: 'web',
                title: 'Web Container',
                position: { referencePanel: editorPanel, direction: 'within' },
            });

            // Activate the Editor tab by default
            editorPanel.api.setActive();
        }

        // Panel 3: Sessions (Left)
        if (isSessionSidebarOpen) {
            const sessionsPanel = api.addPanel({
                id: 'sessions-panel',
                component: 'sessions',
                title: 'Sessions',
                position: { referencePanel: 'chat-panel', direction: 'left' },
                initialWidth: SESSION_PANEL_WIDTH,
                minimumWidth: SESSION_PANEL_WIDTH,
                maximumWidth: SESSION_PANEL_WIDTH,
                params: {
                    onNewSession: handleNewSession,
                    onSelectSession: handleSelectSession,
                    onDeleteSession: handleDeleteSession,
                    onToggle: () => setIsSessionSidebarOpen(false),
                }
            });
            if (sessionsPanel?.group?.header) {
                sessionsPanel.group.header.hidden = true;
            }
        }

        // Panel 4: Tools (Right) - Positioned right of the Canvas group
        if (isSidebarOpen) {
            // If editor panel exists, position right of it. key is 'editor-panel'
            const referencePanel = api.getPanel('editor-panel') || 'chat-panel';
            const toolsPanel = api.addPanel({
                id: 'tools-panel',
                component: 'tools',
                title: 'Tools',
                position: { referencePanel: referencePanel, direction: 'right' },
                initialWidth: TOOLS_PANEL_WIDTH,
                minimumWidth: TOOLS_PANEL_WIDTH,
                maximumWidth: TOOLS_PANEL_WIDTH,
                params: {
                    onMentionFile: handleMentionFile,
                    onOpenFile: handleOpenFile,
                    onSelectFile: handleFileSelect,
                    isPreviewPanelActive: isPreviewPanelActive
                }
            });
            if (toolsPanel?.group?.header) {
                toolsPanel.group.header.hidden = true;
            }
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

        if (isSidebarOpen && !toolsPanel) {
            // Anchor to editor-panel if it exists (Canvas), otherwise chat-panel
            const editorPanel = apiRef.current.getPanel('editor-panel');
            const referencePanel = editorPanel || apiRef.current.getPanel('chat-panel');

            if (referencePanel) {
                const newToolsPanel = apiRef.current.addPanel({
                    id: 'tools-panel',
                    component: 'tools',
                    title: 'Tools',
                    position: { referencePanel: referencePanel, direction: 'right' },
                    initialWidth: TOOLS_PANEL_WIDTH,
                    minimumWidth: TOOLS_PANEL_WIDTH,
                    maximumWidth: TOOLS_PANEL_WIDTH,
                    params: {
                        onMentionFile: handleMentionFile,
                        onOpenFile: handleOpenFile,
                        onSelectFile: handleFileSelect,
                        isPreviewPanelActive: isPreviewPanelActive
                    }
                });
                if (newToolsPanel?.group?.header) {
                    newToolsPanel.group.header.hidden = true;
                }
            }
        } else if (!isSidebarOpen && toolsPanel) {
            toolsPanel.api.close();
        }
    }, [isSidebarOpen, handleMentionFile, handleOpenFile, handleFileSelect, isPreviewPanelActive]);

    // Handle toggle of sessions panel
    useEffect(() => {
        if (!apiRef.current) return;

        const sessionsPanel = apiRef.current.getPanel('sessions-panel');

        if (isSessionSidebarOpen && !sessionsPanel) {
            const newSessionsPanel = apiRef.current.addPanel({
                id: 'sessions-panel',
                component: 'sessions',
                title: 'Sessions',
                position: { referencePanel: 'chat-panel', direction: 'left' },
                initialWidth: SESSION_PANEL_WIDTH,
                minimumWidth: SESSION_PANEL_WIDTH,
                maximumWidth: SESSION_PANEL_WIDTH,
                params: {
                    onNewSession: handleNewSession,
                    onSelectSession: handleSelectSession,
                    onDeleteSession: handleDeleteSession,
                    onToggle: () => setIsSessionSidebarOpen(false),
                }
            });
            if (newSessionsPanel?.group?.header) {
                newSessionsPanel.group.header.hidden = true;
            }
        } else if (!isSessionSidebarOpen && sessionsPanel) {
            sessionsPanel.api.close();
        }
    }, [isSessionSidebarOpen, handleNewSession, handleSelectSession, handleDeleteSession, setIsSessionSidebarOpen]);

    useEffect(() => {
        const panel = apiRef.current?.getPanel('chat-panel');
        if (!panel) return;
        panel.api.updateParameters({
            securityMode: chatLogic.securityMode,
        });
    }, [chatLogic.securityMode]);

    return (
        <div className="h-screen flex flex-col bg-background">
            {/* Global Toolbar */}
            <GlobalToolbar />

            {/* Dockview Layout with theme support */}
            <div className="flex-1">
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
            }
          `}</style>
                    <DockviewReact
                        components={components}
                        onReady={onReady}
                        className="h-full w-full dockview-theme-light dark:dockview-theme-dark"
                    />
                </div>
            </div>
            <Toaster />
        </div>
    );
}
