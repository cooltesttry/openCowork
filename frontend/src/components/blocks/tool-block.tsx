"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, ChevronRight, Check, XCircle, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { MessageBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ToolBlockProps {
    block: MessageBlock;
    autoCollapseDelay?: number;
    defaultCollapsed?: boolean;  // If true, start collapsed (for history items)
    onPermissionResponse?: (approved: boolean) => void;
}

export function ToolBlock({ block, autoCollapseDelay = 300, defaultCollapsed = false }: ToolBlockProps) {
    // Start collapsed if defaultCollapsed is true OR if status is already success
    const [isOpen, setIsOpen] = useState(!defaultCollapsed && block.status !== 'success');


    const hasAutoCollapsed = useRef(false);
    const prevStatus = useRef(block.status);

    const { status, content, metadata } = block;
    const toolName = metadata?.toolName || content?.name || "Tool";

    const isComplete = status === 'success';
    const isError = status === 'error';
    const isExecuting = status === 'executing';
    const isPending = status === 'pending';
    const isStreaming = status === 'streaming';

    // Auto-collapse ONLY when status transitions to 'success' (one-time)
    useEffect(() => {
        const wasNotComplete = prevStatus.current !== 'success';
        const isNowComplete = status === 'success';

        // Only trigger auto-collapse on status transition, not on manual open
        if (wasNotComplete && isNowComplete && !hasAutoCollapsed.current) {
            hasAutoCollapsed.current = true;
            const timer = setTimeout(() => {
                setIsOpen(false);
            }, autoCollapseDelay);
            return () => clearTimeout(timer);
        }

        prevStatus.current = status;
    }, [status, autoCollapseDelay]);

    // Get status icon - use useMemo to avoid recreating component during render
    const statusIcon = useMemo(() => {
        if (isComplete) return <Check className="h-4 w-4 text-muted-foreground shrink-0" />;
        if (isError) return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
        if (isExecuting) return <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />;
        if (isStreaming) return <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />;
        if (isPending) return <span className="h-2 w-2 rounded-full bg-foreground/40 animate-pulse shrink-0" />;
        return null;
    }, [isComplete, isError, isExecuting, isStreaming, isPending]);

    // Get status background color
    // Format input/output for display
    const formatContent = (data: unknown) => {
        if (typeof data === 'string') return data;
        return JSON.stringify(data, null, 2);
    };

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="my-0.5 w-full min-w-0">
            <CollapsibleTrigger
                className={cn(
                    "flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-sm font-medium",
                    "transition-colors duration-200",
                    "hover:bg-transparent"
                )}
            >
                {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="font-mono text-xs text-muted-foreground">
                    {toolName}
                </span>
                <span className="flex-1 text-left text-xs text-muted-foreground truncate">
                    {isPending && "Waiting..."}
                    {isStreaming && "Generating..."}
                    {isExecuting && "Executing..."}
                    {isComplete && "Completed"}
                    {isError && "Failed"}
                </span>
                {statusIcon}
            </CollapsibleTrigger>

            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                <div className="mt-1 ml-5 pl-3 py-1.5 border-l-2 border-border text-xs font-mono space-y-1.5 min-w-0 overflow-hidden">
                    {/* Streaming Input Buffer - show during streaming */}
                    {status === 'streaming' && content?.inputBuffer && (
                        <div className="min-w-0">
                            <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px] flex items-center gap-2">
                                <span>Generating</span>
                                <span className="h-1.5 w-1.5 rounded-full bg-foreground/40 animate-pulse" />
                            </div>
                            <pre className="bg-muted/40 p-1.5 rounded max-h-[200px] overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all w-full text-foreground">
                                {content.inputBuffer}
                            </pre>
                        </div>
                    )}

                    {/* Input - show when not streaming or after streaming completes */}
                    {content?.input && !content?.inputBuffer && (
                        <div className="min-w-0">
                            <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">Input</div>
                            <pre className="bg-muted/40 p-1.5 rounded max-h-[100px] overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all w-full text-foreground">
                                {formatContent(content.input)}
                            </pre>
                        </div>
                    )}

                    {/* Result */}
                    {content?.result && (
                        <div className="min-w-0">
                            <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">
                                {isError ? "Error" : "Result"}
                            </div>
                            <pre className={cn(
                                "p-1.5 rounded max-h-[100px] overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all w-full bg-muted/40",
                                isError ? "text-destructive" : "text-foreground"
                            )}>
                                {formatContent(content.result)}
                            </pre>
                        </div>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
