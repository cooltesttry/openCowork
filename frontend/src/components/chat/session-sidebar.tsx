"use client";

import { Session } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Plus, MessageSquare, Trash2, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

interface SessionSidebarProps {
    sessions: Session[];
    currentSessionId: string | null;
    isOpen: boolean;
    isLoading?: boolean;
    onToggle: () => void;
    onNewSession: () => void;
    onSelectSession: (id: string) => void;
    onDeleteSession: (id: string) => void;
}

export function SessionSidebar({
    sessions,
    currentSessionId,
    isOpen,
    isLoading,
    onToggle,
    onNewSession,
    onSelectSession,
    onDeleteSession,
}: SessionSidebarProps) {
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [fadingOutId, setFadingOutId] = useState<string | null>(null);

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();

        if (deletingId === id) {
            // Confirmed - animate and delete
            setFadingOutId(id);
            setDeletingId(null);
            // Wait for animation then delete
            setTimeout(() => {
                onDeleteSession(id);
                setFadingOutId(null);
            }, 200);
        } else {
            // First click - show confirmation
            setDeletingId(id);
        }
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setDeletingId(null);
    };

    return (
        <div
            className={cn(
                "h-full bg-card border-r flex flex-col transition-all duration-300 ease-in-out overflow-hidden shrink-0",
                isOpen ? "w-[280px] min-w-[280px] max-w-[280px]" : "w-0 min-w-0"
            )}
        >
            {isOpen && (
                <>
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                        <h2 className="font-semibold text-sm">Conversations</h2>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onToggle}
                            className="h-8 w-8"
                            title="收起会话列表"
                        >
                            <PanelLeftClose className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* New Session Button */}
                    <div className="px-3 py-2">
                        <Button
                            variant="outline"
                            className="w-full justify-start gap-2"
                            onClick={onNewSession}
                        >
                            <Plus className="h-4 w-4" />
                            New Chat
                        </Button>
                    </div>

                    {/* Session List */}
                    <ScrollArea className="flex-1 w-full">
                        <div className="px-2 py-1 space-y-1">
                            {isLoading ? (
                                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    Loading...
                                </div>
                            ) : sessions.length === 0 ? (
                                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    No conversations yet
                                </div>
                            ) : (
                                sessions.map((session) => (
                                    <div
                                        key={session.id}
                                        onClick={() => deletingId !== session.id && onSelectSession(session.id)}
                                        className={cn(
                                            "group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200",
                                            fadingOutId === session.id && "opacity-0 scale-95",
                                            currentSessionId === session.id
                                                ? "bg-primary/10 text-primary"
                                                : "hover:bg-muted"
                                        )}
                                    >
                                        <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                                        <div className="flex-1 min-w-0 overflow-hidden">
                                            <div className="text-sm font-medium truncate">
                                                {session.title || "New Chat"}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {formatDistanceToNow(session.updated_at * 1000, { addSuffix: true })}
                                            </div>
                                        </div>

                                        {deletingId === session.id ? (
                                            // Confirmation state
                                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={(e) => handleDeleteClick(e, session.id)}
                                                    title="Confirm delete"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 hover:bg-muted"
                                                    onClick={handleCancelDelete}
                                                    title="Cancel"
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            // Normal state - show on hover
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive hover:bg-destructive/10"
                                                onClick={(e) => handleDeleteClick(e, session.id)}
                                                title="Delete"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </>
            )}
        </div>
    );
}


/**
 * Toggle button for collapsed sidebar state.
 * Shown in the header when sidebar is closed.
 */
export function SessionSidebarToggle({
    isOpen,
    onToggle,
}: {
    isOpen: boolean;
    onToggle: () => void;
}) {
    if (isOpen) return null;

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            title="展开会话列表"
        >
            <PanelLeftOpen className="h-5 w-5" />
        </Button>
    );
}
