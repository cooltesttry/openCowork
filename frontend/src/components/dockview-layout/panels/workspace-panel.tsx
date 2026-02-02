'use client';

import { useEffect, useState } from 'react';
import { WorkspaceSidebar } from '@/components/workspace/workspace-sidebar';
import { useWorkspace } from '@/lib/workspace-store';
import { useChat } from '@/lib/store';
import { setWorkspaceMode } from '@/lib/sessions-api';
import { FilePickerDialog } from '@/components/ui/file-picker';

interface WorkspacePanelContentProps {
    params?: {
        onNewSession?: () => void;
        onSelectSession?: (id: string) => void;
        onDeleteSession?: (id: string) => void;
        onToggle?: () => void;
        isOpen?: boolean;
    };
}

export function WorkspacePanelContent({ params }: WorkspacePanelContentProps) {
    const [folderPickerOpen, setFolderPickerOpen] = useState(false);
    const {
        workspaces,
        currentWorkspace,
        isLoading: isWorkspacesLoading,
        sessions,
        currentSessionId,
        isSessionsLoading,
        switchWorkspace,
        removeWorkspace,
        openWorkspace,
        startNewSessionDraft,
        switchSession,
        deleteSession,
    } = useWorkspace();

    const { getSessionStatus } = useChat();

    // Sync workspace mode to sessions API
    // When workspace changes, update the API layer to use workspace-based endpoints
    useEffect(() => {
        setWorkspaceMode(currentWorkspace?.id || null);
    }, [currentWorkspace?.id]);

    const handleOpenFolder = () => {
        setFolderPickerOpen(true);
    };

    const handleFolderSelected = async (path: string) => {
        try {
            await openWorkspace(path);
        } catch (error) {
            console.error("Failed to open workspace:", error);
            alert("Failed to open workspace: " + (error as Error).message);
        }
    };

    const handleNewSession = async () => {
        // In workspace mode, start a draft session (no server create yet)
        if (currentWorkspace) {
            startNewSessionDraft();
            return;
        }
        // Fallback to legacy behavior
        if (params?.onNewSession) {
            params.onNewSession();
        }
    };

    const handleSelectSession = (id: string) => {
        // Only use workspace's switchSession - the callback in useChatLogic will handle loading
        // Do NOT call params.onSelectSession here to avoid double loading
        switchSession(id);
    };

    const handleDeleteSession = async (id: string) => {
        // Use workspace's deleteSession if available, otherwise fallback to params
        if (currentWorkspace) {
            await deleteSession(id);
        } else if (params?.onDeleteSession) {
            params.onDeleteSession(id);
        }
    };

    // Convert WorkspaceSession to Session-compatible format for status lookup
    const sessionsWithStatus = sessions.map(s => ({
        id: s.id,
        title: s.title,
        created_at: s.created_at,
        updated_at: s.updated_at,
        message_count: s.message_count,
    }));

    return (
        <>
            <WorkspaceSidebar
                workspaces={workspaces}
                currentWorkspace={currentWorkspace}
                isWorkspacesLoading={isWorkspacesLoading}
                onSwitchWorkspace={switchWorkspace}
                onRemoveWorkspace={removeWorkspace}
                onOpenFolder={handleOpenFolder}
                sessions={sessionsWithStatus}
                currentSessionId={currentSessionId}
                isSessionsLoading={isSessionsLoading}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                isOpen={params?.isOpen ?? true}
                onToggle={params?.onToggle || (() => {})}
                getSessionStatus={getSessionStatus}
            />
            <FilePickerDialog
                open={folderPickerOpen}
                onOpenChange={setFolderPickerOpen}
                mode="select"
                type="directory"
                title="Open Folder"
                onSelect={handleFolderSelected}
            />
        </>
    );
}
