"use client";

import { MessageBlock } from "@/lib/types";
import { ThinkingBlock } from "./thinking-block";
import { ToolBlock } from "./tool-block";
import { PlanBlock } from "./plan-block";
import { PermissionCard } from "./permission-card";
import { TextBlock } from "./text-block";
import { AlertCircle } from "lucide-react";

interface BlockRendererProps {
    block: MessageBlock;
    onPermissionResponse?: (blockId: string, approved: boolean) => void;
}

export function BlockRenderer({ block, onPermissionResponse }: BlockRendererProps) {
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
            return <ToolBlock block={block} />;

        case 'plan':
            return <PlanBlock block={block} />;

        case 'text':
            return <TextBlock block={block} />;

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
}

export function BlockList({ blocks, onPermissionResponse }: BlockListProps) {
    return (
        <div className="space-y-1">
            {blocks.map((block) => (
                <BlockRenderer
                    key={block.id}
                    block={block}
                    onPermissionResponse={onPermissionResponse}
                />
            ))}
        </div>
    );
}

