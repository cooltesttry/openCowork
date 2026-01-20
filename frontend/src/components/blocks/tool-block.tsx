"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Terminal, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { MessageBlock } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
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
        if (isComplete) return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
        if (isError) return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
        if (isExecuting) return <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;
        if (isPending) return <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse shrink-0" />;
        return null;
    }, [isComplete, isError, isExecuting, isPending]);

    // Get status background color
    const getBgClass = () => {
        if (isError) return "bg-red-50 dark:bg-red-900/20";
        if (isComplete) return "bg-green-50/50 dark:bg-green-900/10";
        if (isExecuting) return "bg-blue-50 dark:bg-blue-900/20";
        if (isPending) return "bg-yellow-50 dark:bg-yellow-900/20";
        return "bg-muted/30";
    };

    // Format input/output for display
    const formatContent = (data: any) => {
        if (typeof data === 'string') return data;
        return JSON.stringify(data, null, 2);
    };

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="my-2 w-full min-w-0">
            <CollapsibleTrigger
                className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium",
                    "transition-colors duration-200",
                    "hover:bg-muted/50",
                    getBgClass()
                )}
            >
                {isOpen ? (
                    <ChevronDown className="h-4 w-4 flex-shrink-0" />
                ) : (
                    <ChevronRight className="h-4 w-4 flex-shrink-0" />
                )}
                <Terminal className="h-4 w-4 flex-shrink-0" />
                <Badge variant="outline" className="font-mono text-xs">
                    {toolName}
                </Badge>
                <span className="flex-1 text-left text-xs text-muted-foreground truncate">
                    {isPending && "Waiting..."}
                    {isExecuting && "Executing..."}
                    {isComplete && "Completed"}
                    {isError && "Failed"}
                </span>
                {statusIcon}
            </CollapsibleTrigger>

            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                <div className="mt-1 ml-6 pl-4 py-2 border-l-2 border-border text-xs font-mono space-y-2 min-w-0 overflow-hidden">
                    {/* Streaming Input Buffer - show during streaming */}
                    {status === 'streaming' && content?.inputBuffer && (
                        <div className="min-w-0">
                            <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px] flex items-center gap-2">
                                <span>Generating</span>
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                            </div>
                            <pre className="bg-blue-50/50 dark:bg-blue-900/10 p-2 rounded max-h-[200px] overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all w-full text-blue-600 dark:text-blue-400">
                                {content.inputBuffer}
                            </pre>
                        </div>
                    )}

                    {/* Input - show when not streaming or after streaming completes */}
                    {content?.input && !content?.inputBuffer && (
                        <div className="min-w-0">
                            <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">Input</div>
                            <pre className="bg-muted/50 p-2 rounded max-h-[100px] overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all w-full">
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
                                "p-2 rounded max-h-[100px] overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all w-full",
                                isError
                                    ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                                    : "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
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

