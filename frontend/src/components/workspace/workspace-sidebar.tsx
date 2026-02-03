"use client";

import { useEffect, useRef, useState } from "react";
import { SessionStatus } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
    Plus,
    MessageSquare,
    Trash2,
    PanelLeftClose,
    PanelLeftOpen,
    X,
    Loader2,
    CircleDot,
    AlertCircle,
    FolderOpen,
    FolderIcon,
    Search,
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
const COLLAPSED_WIDTH = 44;
const WORKSPACE_ROW_HEIGHT = 30;
const WORKSPACE_LIST_MAX_VISIBLE = 8;

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
    const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
    const [sessionQuery, setSessionQuery] = useState("");
    const [sessionResults, setSessionResults] = useState<Array<{ path: string; snippet: string }>>([]);
    const [sessionSearchLoading, setSessionSearchLoading] = useState(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const sortedWorkspaces = [...workspaces]
        .filter((ws) => ws.id !== currentWorkspace?.id)
        .sort((a, b) => (b.last_accessed_at || 0) - (a.last_accessed_at || 0));
    const workspaceListMaxHeight = WORKSPACE_ROW_HEIGHT * WORKSPACE_LIST_MAX_VISIBLE;

    useEffect(() => {
        if (sessionSearchOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 0);
        } else {
            setSessionQuery("");
            setSessionResults([]);
        }
    }, [sessionSearchOpen]);

    useEffect(() => {
        setSessionSearchOpen(false);
        setSessionQuery("");
        setSessionResults([]);
    }, [currentWorkspace?.id]);

    useEffect(() => {
        if (!sessionSearchOpen) return;
        const query = sessionQuery.trim();
        if (!query) {
            setSessionResults([]);
            return;
        }
        if (!currentWorkspace?.path) {
            setSessionResults([]);
            return;
        }

        let cancelled = false;
        const controller = new AbortController();
        setSessionSearchLoading(true);

        const timer = setTimeout(async () => {
            try {
                const response = await fetch("http://localhost:8000/api/search/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                    body: JSON.stringify({
                        workdir: currentWorkspace.path,
                        query,
                        mode: "files",
                        limit: 50,
                        use_vector: true,
                        use_fts: true,
                        include_paths: [".opencowork/sessions"],
                    }),
                });
                if (!response.ok) {
                    throw new Error(`Search failed: ${response.statusText}`);
                }
                const data = await response.json();
                if (!cancelled) {
                    setSessionResults(data.results || []);
                }
            } catch (err) {
                if (!cancelled) {
                    setSessionResults([]);
                }
            } finally {
                if (!cancelled) {
                    setSessionSearchLoading(false);
                }
            }
        }, 250);

        return () => {
            cancelled = true;
            controller.abort();
            clearTimeout(timer);
        };
    }, [sessionQuery, sessionSearchOpen, currentWorkspace?.path]);

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

    const extractSessionId = (path: string) => {
        const base = path.split("/").pop() || path;
        return base.endsWith(".json") ? base.slice(0, -5) : base;
    };

    return (
        <aside
            className="h-full bg-card border-r flex flex-col shrink-0"
            style={{
                width: isOpen ? SIDEBAR_WIDTH : COLLAPSED_WIDTH,
                minWidth: isOpen ? SIDEBAR_WIDTH : COLLAPSED_WIDTH,
                maxWidth: isOpen ? SIDEBAR_WIDTH : COLLAPSED_WIDTH,
                transition: "width 200ms ease-out, min-width 200ms ease-out, max-width 200ms ease-out",
                overflow: "hidden",
            }}
        >
            {isOpen ? (
                <div className="flex flex-col h-full" style={{ width: SIDEBAR_WIDTH }}>
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                        <h2 className="font-semibold text-sm">Workspace</h2>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSessionSearchOpen((prev) => !prev)}
                                className="h-8 w-8"
                                title="Search sessions"
                            >
                                <Search className="h-4 w-4" />
                            </Button>
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
                    </div>

                    {/* Workspace Selector */}
                    <div className="px-3 py-2 border-b shrink-0">
                        {isWorkspacesLoading ? (
                            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading...
                            </div>
                        ) : currentWorkspace ? (
                            <div className="flex items-center gap-2 px-2 h-[30px] border-l-2 border-blue-500">
                                <FolderIcon className="h-4 w-4 shrink-0 text-blue-500" />
                                <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {currentWorkspace.name}
                                    </div>
                                </div>
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
                        className="flex-1 overflow-y-auto overflow-x-hidden px-2 bg-card"
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
                                    <div className="sticky top-0 z-10 -mx-2 px-2 pt-1 pb-1 bg-card">
                                        {sessionSearchOpen && (
                                            <div className="mb-2 flex items-center gap-2">
                                                <div className="relative">
                                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                                    <Input
                                                        ref={searchInputRef}
                                                        value={sessionQuery}
                                                        onChange={(e) => setSessionQuery(e.target.value)}
                                                        placeholder="Search sessions..."
                                                        className="h-8 pl-7 pr-2 text-sm"
                                                    />
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setSessionSearchOpen(false)}
                                                    className="h-8 w-8"
                                                    title="Close search"
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
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
                                    </div>
                                    {sessionSearchOpen ? (
                                        sessionSearchLoading ? (
                                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                                Searching...
                                            </div>
                                        ) : sessionResults.length === 0 ? (
                                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                                No matching sessions
                                            </div>
                                        ) : (
                                            sessionResults.map((result) => {
                                                const sessionId = extractSessionId(result.path);
                                                const session = sessions.find((s) => s.id === sessionId);
                                                const title = session?.title || "New Chat";
                                                return (
                                                    <div
                                                        key={result.path}
                                                        onClick={() => onSelectSession(sessionId)}
                                                        className={cn(
                                                            "group relative flex items-start gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer",
                                                            currentSessionId === sessionId
                                                                ? "bg-primary/10 text-primary"
                                                                : "hover:bg-muted"
                                                        )}
                                                    >
                                                        {getStatusIcon(sessionId)}
                                                        <div className="flex-1 min-w-0 overflow-hidden">
                                                            <div className="text-sm truncate">
                                                                {title}
                                                            </div>
                                                            {result.snippet ? (
                                                                <div className="text-xs text-muted-foreground line-clamp-2">
                                                                    {result.snippet}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )
                                    ) : sessions.length === 0 ? (
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

                    {/* Workspace List */}
                    <div className="border-t bg-muted/40 shrink-0">
                        <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                            Workspaces
                        </div>
                        <div className="px-2 pb-2">
                            {isWorkspacesLoading ? (
                                <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading...
                                </div>
                            ) : sortedWorkspaces.length === 0 ? (
                                <div className="px-2.5 py-2 text-sm text-muted-foreground">
                                    No workspaces yet
                                </div>
                            ) : (
                                <div
                                    className="overflow-y-auto"
                                    style={{ maxHeight: workspaceListMaxHeight }}
                                >
                                    {sortedWorkspaces.map((ws) => {
                                        return (
                                            <button
                                                key={ws.id}
                                                onClick={() => onSwitchWorkspace(ws.id)}
                                                className={cn(
                                                    "group flex items-center gap-2 px-2.5 text-sm text-left w-full h-[30px] border-l-2 transition-colors",
                                                    "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60"
                                                )}
                                            >
                                                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                <span className="flex-1 truncate">{ws.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-2 pb-2">
                            <button
                                onClick={onOpenFolder}
                                className="w-full flex items-center gap-2 px-2.5 h-[30px] text-sm text-muted-foreground hover:text-foreground hover:bg-background/60 border-l-2 border-transparent transition-colors text-left"
                            >
                                <FolderOpen className="h-4 w-4 shrink-0" />
                                Add Workspace
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex h-full flex-col items-center justify-start pt-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggle}
                        className="h-8 w-8"
                        title="Expand sidebar"
                    >
                        <PanelLeftOpen className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </aside>
    );
}
