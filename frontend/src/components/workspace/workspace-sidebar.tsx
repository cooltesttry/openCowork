"use client";

import { useState } from "react";
import { Session } from "@/lib/types";
import { SessionStatus } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Plus,
    MessageSquare,
    Trash2,
    PanelLeftClose,
    X,
    Loader2,
    CircleDot,
    AlertCircle,
    FolderOpen,
    FolderIcon,
    ChevronDown,
} from "lucide-react";

// ==================== Types ====================

export interface Workspace {
    id: string;
    name: string;
    path: string;
    last_accessed_at: number;
}

export interface WorkspaceSession {
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    message_count: number;
}

interface WorkspaceSidebarProps {
    // Workspaces
    workspaces: Workspace[];
    currentWorkspace: Workspace | null;
    isWorkspacesLoading?: boolean;
    onSwitchWorkspace: (id: string) => void;
    onRemoveWorkspace: (id: string) => void;
    onOpenFolder: () => void;

    // Sessions
    sessions: WorkspaceSession[];
    currentSessionId: string | null;
    isSessionsLoading?: boolean;
    onNewSession: () => void;
    onSelectSession: (id: string) => void;
    onDeleteSession: (id: string) => void;

    // Sidebar control
    isOpen: boolean;
    onToggle: () => void;

    // Session status (for running/unread indicators)
    getSessionStatus?: (sessionId: string) => SessionStatus;
}

const SIDEBAR_WIDTH = 238;

// ==================== Main Component ====================

export function WorkspaceSidebar({
    workspaces,
    currentWorkspace,
    isWorkspacesLoading,
    onSwitchWorkspace,
    onRemoveWorkspace,
    onOpenFolder,
    sessions,
    currentSessionId,
    isSessionsLoading,
    onNewSession,
    onSelectSession,
    onDeleteSession,
    isOpen,
    onToggle,
    getSessionStatus,
}: WorkspaceSidebarProps) {
    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
    const [fadingOutSessionId, setFadingOutSessionId] = useState<string | null>(null);
    const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);

    // Helper to get status icon for a session
    const getStatusIcon = (sessionId: string) => {
        const status = getSessionStatus?.(sessionId) || { status: 'idle', hasUnread: false };

        if (status.status === 'running') {
            return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />;
        }
        if (status.status === 'error') {
            return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
        }
        if (status.hasUnread) {
            return <CircleDot className="h-3.5 w-3.5 shrink-0 text-blue-500" />;
        }
        return <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-50" />;
    };

    const handleDeleteSessionClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();

        if (deletingSessionId === id) {
            // Confirmed - animate and delete
            setFadingOutSessionId(id);
            setDeletingSessionId(null);
            setTimeout(() => {
                onDeleteSession(id);
                setFadingOutSessionId(null);
            }, 200);
        } else {
            // First click - show confirmation
            setDeletingSessionId(id);
        }
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setDeletingSessionId(null);
    };

    return (
        <aside
            className="h-full bg-card border-r flex flex-col shrink-0"
            style={{
                width: isOpen ? SIDEBAR_WIDTH : 0,
                minWidth: isOpen ? SIDEBAR_WIDTH : 0,
                maxWidth: isOpen ? SIDEBAR_WIDTH : 0,
                transition: "width 200ms ease-out, min-width 200ms ease-out, max-width 200ms ease-out",
                overflow: "hidden",
            }}
        >
            {isOpen && (
                <div
                    className="flex flex-col h-full"
                    style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH, maxWidth: SIDEBAR_WIDTH }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                        <h2 className="font-semibold text-sm">Workspaces</h2>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onToggle}
                            className="h-8 w-8"
                            title="Collapse sidebar"
                        >
                            <PanelLeftClose className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Workspace Selector */}
                    <div className="px-3 py-2 border-b shrink-0">
                        {isWorkspacesLoading ? (
                            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading...
                            </div>
                        ) : currentWorkspace ? (
                            <div className="relative">
                                <button
                                    onClick={() => setWorkspaceSelectorOpen(!workspaceSelectorOpen)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-accent/50 hover:bg-accent transition-colors text-left"
                                >
                                    <FolderIcon className="h-4 w-4 shrink-0 text-blue-500" />
                                    <span className="flex-1 text-sm font-medium truncate">
                                        {currentWorkspace.name}
                                    </span>
                                    <ChevronDown className={cn(
                                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                        workspaceSelectorOpen && "rotate-180"
                                    )} />
                                </button>

                                {/* Workspace Dropdown */}
                                {workspaceSelectorOpen && workspaces.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-popover border rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                                        {workspaces.map((ws) => (
                                            <button
                                                key={ws.id}
                                                onClick={() => {
                                                    if (ws.id !== currentWorkspace.id) {
                                                        onSwitchWorkspace(ws.id);
                                                    }
                                                    setWorkspaceSelectorOpen(false);
                                                }}
                                                className={cn(
                                                    "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left",
                                                    ws.id === currentWorkspace.id && "bg-accent/50"
                                                )}
                                            >
                                                <FolderIcon className={cn(
                                                    "h-4 w-4 shrink-0",
                                                    ws.id === currentWorkspace.id ? "text-blue-500" : "text-muted-foreground"
                                                )} />
                                                <span className="flex-1 truncate">{ws.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                                <FolderIcon className="h-4 w-4" />
                                No workspace selected
                            </div>
                        )}
                    </div>

                    {/* Session List */}
                    <div
                        className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1"
                        style={{ maxWidth: SIDEBAR_WIDTH }}
                    >
                        <div className="space-y-0">
                            {!currentWorkspace ? (
                                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    Select or open a workspace
                                </div>
                            ) : isSessionsLoading ? (
                                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    Loading...
                                </div>
                            ) : (
                                <>
                                    <div
                                        onClick={onNewSession}
                                        className={cn(
                                            "group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer",
                                            currentSessionId === null
                                                ? "bg-primary/10 text-primary"
                                                : "hover:bg-muted"
                                        )}
                                    >
                                        <Plus className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                        <div className="flex-1 min-w-0 overflow-hidden transition-all duration-150 group-hover:pr-7">
                                            <div className="text-sm truncate">New Chat</div>
                                        </div>
                                    </div>
                                    {sessions.length === 0 ? (
                                        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                            No conversations yet
                                        </div>
                                    ) : (
                                        sessions.map((session) => (
                                            <div
                                                key={session.id}
                                                onClick={() => deletingSessionId !== session.id && onSelectSession(session.id)}
                                                className={cn(
                                                    "group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer",
                                                    fadingOutSessionId === session.id && "opacity-0 scale-95 transition-all duration-200",
                                                    currentSessionId === session.id
                                                        ? "bg-primary/10 text-primary"
                                                        : "hover:bg-muted"
                                                )}
                                            >
                                                {getStatusIcon(session.id)}
                                                <div className="flex-1 min-w-0 overflow-hidden transition-all duration-150 group-hover:pr-7">
                                                    <div className="text-sm truncate">
                                                        {session.title || "New Chat"}
                                                    </div>
                                                </div>

                                                {deletingSessionId === session.id ? (
                                                    <div
                                                        className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-card/95 backdrop-blur-sm rounded-md"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                            onClick={(e) => handleDeleteSessionClick(e, session.id)}
                                                            title="Confirm delete"
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 hover:bg-muted"
                                                            onClick={handleCancelDelete}
                                                            title="Cancel"
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive hover:bg-destructive/10 bg-card/80"
                                                        onClick={(e) => handleDeleteSessionClick(e, session.id)}
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Open Folder Button */}
                    <div className="p-3 border-t shrink-0">
                        <Button
                            variant="outline"
                            className="w-full justify-start gap-2"
                            onClick={onOpenFolder}
                        >
                            <FolderOpen className="h-4 w-4" />
                            Open Folder...
                        </Button>
                    </div>
                </div>
            )}
        </aside>
    );
}
