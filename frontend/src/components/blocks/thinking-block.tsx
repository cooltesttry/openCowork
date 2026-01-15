"use client";

import { useState, useEffect, useRef } from "react";
import { BrainCircuit, ChevronDown, ChevronRight, CheckCircle } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { MessageBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
    block: MessageBlock;
    autoCollapseDelay?: number; // ms delay before auto-collapsing on success
}

export function ThinkingBlock({ block, autoCollapseDelay = 500 }: ThinkingBlockProps) {
    const [isOpen, setIsOpen] = useState(true);
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
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="my-2">
            <CollapsibleTrigger
                className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium",
                    "transition-colors duration-200",
                    "hover:bg-purple-100/50 dark:hover:bg-purple-900/30",
                    isStreaming
                        ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300"
                        : "bg-purple-50/50 dark:bg-purple-900/10 text-purple-600 dark:text-purple-400"
                )}
            >
                {isOpen ? (
                    <ChevronDown className="h-4 w-4 flex-shrink-0" />
                ) : (
                    <ChevronRight className="h-4 w-4 flex-shrink-0" />
                )}
                <BrainCircuit className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isStreaming && "animate-pulse"
                )} />
                <span className="flex-1 text-left">
                    {isStreaming ? "Thinking..." : "Thinking"}
                </span>
                {isComplete && (
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                )}
                {isStreaming && (
                    <span className="h-2 w-2 rounded-full bg-purple-500 animate-pulse flex-shrink-0" />
                )}
            </CollapsibleTrigger>

            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                <div className={cn(
                    "mt-1 ml-6 pl-4 py-2 border-l-2 border-purple-200 dark:border-purple-800",
                    "text-sm text-muted-foreground whitespace-pre-wrap"
                )}>
                    {typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

