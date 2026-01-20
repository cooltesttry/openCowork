'use client';

import { SessionSidebar } from '@/components/chat/session-sidebar-new';
import { useChatSessions } from '@/lib/store';

interface SessionPanelContentProps {
    params?: {
        onNewSession?: () => void;
        onSelectSession?: (id: string) => void;
        onDeleteSession?: (id: string) => void;
        onToggle?: () => void;
    };
}

export function SessionPanelContent({ params }: SessionPanelContentProps) {
    const {
        sessions,
        currentSessionId,
        isSessionsLoading,
    } = useChatSessions();

    return (
        <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            isOpen={true} // Always open in panel, but can trigger close
            isLoading={isSessionsLoading}
            onToggle={params?.onToggle || (() => { })} // Use passed toggle handler
            onNewSession={params?.onNewSession || (() => { })}
            onSelectSession={params?.onSelectSession || (() => { })}
            onDeleteSession={params?.onDeleteSession || (() => { })}
        />
    );
}
