"use client";

import { MessageBlock } from "@/lib/types";
import { ThinkingBlock } from "./thinking-block";
import { ToolBlock } from "./tool-block";
import { PlanBlock } from "./plan-block";
import { PermissionCard } from "./permission-card";
import { TextBlock } from "./text-block";
import { AskUserBlock } from "./ask-user-block";
import { AlertCircle } from "lucide-react";

interface BlockRendererProps {
    block: MessageBlock;
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
    onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onAskUserSkip?: (requestId: string) => void;
    onPreviewHTML?: (htmlContent: string) => void;
}

export function BlockRenderer({ block, onPermissionResponse, onAskUserSubmit, onAskUserSkip, onPreviewHTML }: BlockRendererProps) {
    // Check if this is a permission request
    if (block.metadata?.requiresPermission && block.status === 'pending') {
        return (
            <PermissionCard
                block={block}
                onApprove={() => onPermissionResponse?.(block.id, true)}
                onDeny={() => onPermissionResponse?.(block.id, false)}
            />
        );
    }

    switch (block.type) {
        case 'thinking':
            return <ThinkingBlock block={block} />;

        case 'tool_use':
        case 'tool_result':
            // Render AskUserQuestion tool_use blocks as ask_user blocks for better history display
            if (block.metadata?.toolName === 'AskUserQuestion' || block.content?.name === 'AskUserQuestion') {
                // Determine correct status for history display
                // If there's a result, it means the question was answered or skipped
                const hasResult = block.content?.result !== undefined;
                const isError = block.content?.is_error === true ||
                    (typeof block.content?.result === 'string' && block.content?.result.includes('did not provide'));

                // For history: always show as completed (success/error), never pending
                const resolvedStatus = hasResult
                    ? (isError ? 'error' : 'success')
                    : block.status;

                // Convert tool_use block to ask_user format for rendering
                const askUserBlock = {
                    ...block,
                    type: 'ask_user' as const,
                    status: resolvedStatus,
                    content: {
                        input: {
                            questions: block.content?.input?.questions || [],
                            timeout: block.content?.input?.timeout || 60,
                        },
                        result: block.content?.result,
                        is_error: isError,
                    },
                    metadata: {
                        ...block.metadata,
                        requestId: block.metadata?.toolCallId || block.id,
                    },
                };
                return <AskUserBlock block={askUserBlock} />;
            }
            return <ToolBlock block={block} />;

        case 'plan':
            return <PlanBlock block={block} />;

        case 'text':
            return <TextBlock block={block} onPreviewHTML={onPreviewHTML} />;

        case 'ask_user':
            return (
                <AskUserBlock
                    block={block}
                    onSubmit={onAskUserSubmit}
                    onSkip={onAskUserSkip}
                />
            );

        case 'error':
            return (
                <div className="my-2 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{typeof block.content === 'string' ? block.content : JSON.stringify(block.content)}</span>
                </div>
            );

        default:
            return null;
    }
}

interface BlockListProps {
    blocks: MessageBlock[];
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
    onAskUserSubmit?: (requestId: string, answers: Record<string, string>) => void;
    onAskUserSkip?: (requestId: string) => void;
    onPreviewHTML?: (htmlContent: string) => void;
}

export function BlockList({ blocks, onPermissionResponse, onAskUserSubmit, onAskUserSkip, onPreviewHTML }: BlockListProps) {
    return (
        <div className="space-y-1 min-w-0 max-w-full overflow-hidden">
            {blocks.map((block, index) => (
                <BlockRenderer
                    key={block.id || `block-${index}`}
                    block={block}
                    onPermissionResponse={onPermissionResponse}
                    onAskUserSubmit={onAskUserSubmit}
                    onAskUserSkip={onAskUserSkip}
                    onPreviewHTML={onPreviewHTML}
                />
            ))}
        </div>
    );
}

