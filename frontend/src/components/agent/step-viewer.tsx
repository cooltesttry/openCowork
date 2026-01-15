"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentStep } from "@/lib/types";
import { ToolCall } from "./tool-call";
import { BrainCircuit } from "lucide-react";
import { Card } from "@/components/ui/card";

interface StepViewerProps {
    steps: AgentStep[];
}

export function StepViewer({ steps }: StepViewerProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }
    }, [steps]);

    return (
        <div className="flex flex-col h-full border-l bg-muted/10">
            <div className="p-3 border-b bg-background flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-purple-500" />
                    Agent Execution
                </h3>
                <span className="text-xs text-muted-foreground">
                    {steps.length} steps
                </span>
            </div>

            <ScrollArea ref={scrollRef} className="flex-1 p-3">
                <div className="space-y-3 pb-4">
                    {steps.map((step) => {
                        if (step.type === "thinking") {
                            return (
                                <Card key={step.id} className="p-3 border-none bg-purple-50/50 dark:bg-purple-900/10">
                                    <div className="flex items-center gap-2 mb-1 text-purple-600 dark:text-purple-400">
                                        <BrainCircuit className="h-3 w-3" />
                                        <span className="text-xs font-medium uppercase tracking-wider">Thinking</span>
                                    </div>
                                    <div className="text-sm text-muted-foreground whitespace-pre-wrap italic">
                                        {step.content}
                                    </div>
                                </Card>
                            );
                        }

                        if (step.type === "tool_use") {
                            // Find result for this tool use
                            const resultStep = steps.find(s =>
                                s.type === "tool_result" &&
                                s.content.tool_use_id === step.content.id &&
                                s.timestamp > step.timestamp
                            );

                            return (
                                <ToolCall
                                    key={step.id}
                                    name={step.content.name}
                                    input={step.content.input}
                                    result={resultStep?.content.result}
                                    error={resultStep?.content.is_error ? resultStep.content.result : undefined}
                                />
                            );
                        }
                        return null; // Don't render text/result steps directly as they are handled elsewhere
                    })}
                </div>
            </ScrollArea>
        </div>
    );
}
