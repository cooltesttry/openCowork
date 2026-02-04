'use client';

import { useChat } from '@/lib/store';
import { MessageList } from '@/components/chat/message-list';
import { InputArea, InputAreaRef, SecurityMode } from '@/components/chat/input-area';
import { useRef } from 'react';
import type { OpenImageOptions } from '@/components/image-editor/types';
import type { FilePanelOpenEntry } from '@/components/panels/file-panel';

interface ChatPanelContentProps {
    params?: {
        onSend?: (content: string) => void;
        onPermissionResponse?: (blockId: string, approved: boolean) => void;
        onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
        onAskUserSkip?: (requestId: string) => void;
        onInterrupt?: () => void;
        securityMode?: SecurityMode;
        onSecurityModeChange?: (mode: SecurityMode) => void;
        inputAreaRef?: React.RefObject<InputAreaRef>;
        onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
        onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
        onOpenImage?: (path: string, options?: OpenImageOptions) => void;
        onPreviewHTML?: (htmlContent: string) => void;
    };
}

export function ChatPanelContent({ params }: ChatPanelContentProps) {
    const {
        messages,
        currentSessionId,
        getSessionStatus,
        isAwaitingFirstToken,
        awaitingFirstTokenSessionId,
    } = useChat();
    const localInputRef = useRef<InputAreaRef>(null);
    const inputRef = params?.inputAreaRef || localInputRef;

    // Per-session processing check - only disable input if CURRENT session is running
    const isCurrentSessionProcessing = currentSessionId
        ? getSessionStatus(currentSessionId).status === 'running'
        : false;

    const showProcessingPlaceholder = isAwaitingFirstToken && (
        awaitingFirstTokenSessionId === currentSessionId ||
        (currentSessionId === null && awaitingFirstTokenSessionId === null)
    );

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 min-h-0">
                <div className="h-full w-full max-w-4xl mx-auto">
                    <MessageList
                        messages={messages}
                        showProcessingPlaceholder={showProcessingPlaceholder}
                        onPermissionResponse={params?.onPermissionResponse || (() => { })}
                        onAskUserSubmit={params?.onAskUserSubmit || (() => { })}
                        onAskUserSkip={params?.onAskUserSkip || (() => { })}
                        onSelectFile={params?.onSelectFile}
                        onOpenInPanel={params?.onOpenInPanel}
                        onOpenImage={params?.onOpenImage}
                        onPreviewHTML={params?.onPreviewHTML}
                    />
                </div>
            </div>

            <div className="flex-none z-10">
                <div className="w-full max-w-4xl mx-auto">
                    <InputArea
                        ref={inputRef}
                        onSend={params?.onSend || (() => { })}
                        isRunning={isCurrentSessionProcessing}
                        onInterrupt={params?.onInterrupt}
                        securityMode={params?.securityMode || 'bypassPermissions'}
                        onSecurityModeChange={params?.onSecurityModeChange || (() => { })}
                    />
                </div>
            </div>
        </div>
    );
}
