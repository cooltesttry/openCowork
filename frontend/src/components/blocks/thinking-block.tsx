"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Check } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { MessageBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
    block: MessageBlock;
    autoCollapseDelay?: number; // ms delay before auto-collapsing on success
}

export function ThinkingBlock({ block, autoCollapseDelay = 500 }: ThinkingBlockProps) {
    // Start collapsed if status is already success (for history items)
    const [isOpen, setIsOpen] = useState(block.status !== 'success');
    const hasAutoCollapsed = useRef(false);
    const prevStatus = useRef(block.status);

    const isComplete = block.status === 'success';
    const isStreaming = block.status === 'streaming' || block.status === 'executing';

    // Auto-collapse ONLY when status transitions to 'success' (one-time)
    useEffect(() => {
        const wasNotComplete = prevStatus.current !== 'success';
        const isNowComplete = block.status === 'success';

        // Only trigger auto-collapse on status transition, not on manual open
        if (wasNotComplete && isNowComplete && !hasAutoCollapsed.current) {
            hasAutoCollapsed.current = true;
            const timer = setTimeout(() => {
                setIsOpen(false);
            }, autoCollapseDelay);
            return () => clearTimeout(timer);
        }

        prevStatus.current = block.status;
    }, [block.status, autoCollapseDelay]);

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="my-1 min-w-0">
            <CollapsibleTrigger
                className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs font-medium text-muted-foreground",
                    "transition-colors duration-200",
                    "hover:bg-muted/40",
                    isStreaming
                        ? "bg-muted/40"
                        : "bg-muted/30"
                )}
            >
                {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 text-left text-muted-foreground">
                    {isStreaming ? "Thinking..." : "Thinking"}
                </span>
                {isComplete && (
                    <Check className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                {isStreaming && (
                    <span className="h-2 w-2 rounded-full bg-foreground/40 animate-pulse flex-shrink-0" />
                )}
            </CollapsibleTrigger>

            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                <div className={cn(
                    "mt-1 ml-6 pl-4 py-2 border-l-2 border-border",
                    "text-sm text-muted-foreground whitespace-pre-wrap break-words min-w-0 overflow-hidden"
                )}>
                    {typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
