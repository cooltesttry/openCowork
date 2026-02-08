"use client";

import { useRef, useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
    Play,
    CheckCircle,
    XCircle,
    Loader2,
    Wrench,
    Search,
    MessageSquare,
    Send,
    ChevronRight,
    Brain,
    FileText,
    Cpu,
} from "lucide-react";
import type { Plan } from "@/lib/api";

interface SessionEvent {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
}

interface AgentTabProps {
    agentId: string;
    events: SessionEvent[];
    plan: Plan | null;
}

interface StreamBlock {
    id: string;
    type: "text" | "thinking" | "tool_input";
    content: string;
    status: "streaming" | "complete";
    toolName?: string;
}

interface StepInfo {
    systemPrompt?: string;
    userPrompt?: string;
    model?: string;
    maxTurns?: number;
    permissionMode?: string;
    cwd?: string;
}

const LEAD_EVENT_TYPES = new Set([
    "team_planning_start",
    "team_planning_complete",
    "team_review_start",
    "team_review_complete",
    "team_phase_review_start",
    "team_phase_review_complete",
    "team_plan_updated",
    "team_session_start",
    "team_session_complete",
    "team_session_error",
    "team_phase_start",
    "team_phase_complete",
    "worker_start",
    "worker_stream",
    "worker_tool_call",
    "worker_tool_result",
]);

function getEventIcon(type: string) {
    if (type.includes("start") || type.includes("planning_start") || type.includes("phase_start")) {
        return <Play className="h-3 w-3 text-blue-500" />;
    }
    if (type.includes("complete") || type.includes("approved")) {
        return <CheckCircle className="h-3 w-3 text-green-500" />;
    }
    if (type.includes("error") || type.includes("failed")) {
        return <XCircle className="h-3 w-3 text-red-500" />;
    }
    if (type.includes("feedback")) {
        return <MessageSquare className="h-3 w-3 text-orange-500" />;
    }
    if (type.includes("submit") || type.includes("resubmit")) {
        return <Send className="h-3 w-3 text-yellow-500" />;
    }
    if (type.includes("tool_call")) {
        return <Wrench className="h-3 w-3 text-purple-500" />;
    }
    if (type.includes("tool_result")) {
        return <CheckCircle className="h-3 w-3 text-purple-400" />;
    }
    return <Search className="h-3 w-3 text-zinc-400" />;
}

function getEventLabel(event: SessionEvent): string {
    const { type, data } = event;
    switch (type) {
        case "team_session_start": return "Session started";
        case "team_session_complete": return "Session completed";
        case "team_session_error": return `Error: ${(data.error as string)?.slice(0, 50) || "Unknown"}`;
        case "team_planning_start": return "Planning started";
        case "team_planning_complete": return "Plan created";
        case "team_phase_start": return `Phase ${(data.phase_index as number) + 1}: ${(data.description as string)?.slice(0, 40) || ""}`;
        case "team_phase_complete": return "Phase completed";
        case "team_phase_review_start": return "Reviewing phase";
        case "team_phase_review_complete": return `Review: ${data.decision}`;
        case "team_task_start": return `Task: ${(data.description as string)?.slice(0, 40) || data.task_id}`;
        case "team_task_submitted": return "Result submitted";
        case "team_task_complete": return "Task approved";
        case "team_task_failed": return `Failed: ${(data.error as string)?.slice(0, 40) || ""}`;
        case "team_task_feedback": return `Feedback: ${(data.feedback as string)?.slice(0, 40) || ""}`;
        case "team_task_resubmit": return `Resubmit (#${data.submit_count})`;
        case "team_review_start": return "Reviewing submission";
        case "team_review_complete": return "Review done";
        case "team_plan_updated": return `Plan updated: ${(data.change_note as string)?.slice(0, 40) || ""}`;
        default: return type.replace("team_", "").replace(/_/g, " ");
    }
}

function formatTime(timestamp: string): string {
    try {
        return new Date(timestamp).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return "";
    }
}

/** Process events incrementally to build stream blocks and step info */
function processEvents(
    events: SessionEvent[],
    startIndex: number,
    blocks: Map<string, StreamBlock>,
    stepInfo: StepInfo,
    modelInfo: { model?: string },
    toolResults: Map<string, { content: unknown; isError: boolean }>,
) {
    for (let i = startIndex; i < events.length; i++) {
        const event = events[i];
        if (event.type === "worker_start") {
            const d = event.data;
            if (d.system_prompt) stepInfo.systemPrompt = d.system_prompt as string;
            if (d.user_prompt) stepInfo.userPrompt = d.user_prompt as string;
            if (d.model) stepInfo.model = d.model as string;
            if (d.max_turns) stepInfo.maxTurns = d.max_turns as number;
            if (d.permission_mode) stepInfo.permissionMode = d.permission_mode as string;
            if (d.cwd) stepInfo.cwd = d.cwd as string;
        } else if (event.type === "worker_stream") {
            const d = event.data;
            const streamType = d.stream_type as string;
            const blockId = d.block_id as string;
            const content = (d.content as string) || "";

            if (streamType === "model_info") {
                modelInfo.model = d.model as string;
            } else if (streamType === "text_start") {
                blocks.set(blockId, { id: blockId, type: "text", content: "", status: "streaming" });
            } else if (streamType === "thinking_start") {
                blocks.set(blockId, { id: blockId, type: "thinking", content: "", status: "streaming" });
            } else if (streamType === "tool_input_start") {
                blocks.set(blockId, {
                    id: blockId,
                    type: "tool_input",
                    content: "",
                    status: "streaming",
                    toolName: d.tool_name as string,
                });
            } else if (streamType === "text_delta" || streamType === "thinking_delta" || streamType === "tool_input_delta") {
                const block = blocks.get(blockId);
                if (block) block.content += content;
            } else if (streamType === "text_end" || streamType === "thinking_end" || streamType === "tool_input_end") {
                const block = blocks.get(blockId);
                if (block) block.status = "complete";
            }
        } else if (event.type === "worker_tool_result") {
            const d = event.data;
            toolResults.set(d.tool_id as string, {
                content: d.content,
                isError: d.is_error as boolean,
            });
        }
    }
}

function PromptSection({ label, content }: { label: string; content: string }) {
    return (
        <details className="group">
            <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1 py-0.5">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                <FileText className="h-3 w-3" />
                {label}
                <span className="text-zinc-400 ml-1">({content.length.toLocaleString()} chars)</span>
            </summary>
            <pre className="mt-1 p-2 bg-zinc-100 dark:bg-zinc-800 rounded text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto font-mono">
                {content}
            </pre>
        </details>
    );
}

function StreamBlockView({ block, toolResult }: { block: StreamBlock; toolResult?: { content: unknown; isError: boolean } }) {
    if (block.type === "thinking") {
        return (
            <details className="group mb-1" open={block.status === "streaming"}>
                <summary className="cursor-pointer text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 py-0.5">
                    <Brain className="h-3 w-3" />
                    Thinking
                    {block.status === "streaming" && (
                        <Loader2 className="h-3 w-3 animate-spin ml-1" />
                    )}
                </summary>
                <pre className="mt-0.5 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded text-[11px] text-amber-800 dark:text-amber-300 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto font-mono">
                    {block.content || "..."}
                </pre>
            </details>
        );
    }

    if (block.type === "tool_input") {
        return (
            <div className="mb-1 border border-purple-200 dark:border-purple-800/40 rounded overflow-hidden">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-50 dark:bg-purple-900/20 text-[11px]">
                    <Wrench className="h-3 w-3 text-purple-500" />
                    <span className="font-medium text-purple-700 dark:text-purple-300">
                        {block.toolName || "Tool"}
                    </span>
                    {block.status === "streaming" && (
                        <Loader2 className="h-3 w-3 animate-spin text-purple-400 ml-auto" />
                    )}
                </div>
                <pre className="p-2 text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto font-mono bg-white dark:bg-zinc-900">
                    {block.content || "{}"}
                </pre>
                {toolResult && (
                    <div className={`border-t px-2 py-1 text-[11px] ${toolResult.isError
                        ? "border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                        : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400"
                    }`}>
                        <pre className="whitespace-pre-wrap break-words max-h-[100px] overflow-y-auto font-mono">
                            {typeof toolResult.content === "string"
                                ? toolResult.content
                                : JSON.stringify(toolResult.content, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        );
    }

    // text block
    return (
        <div className="mb-1 text-[12px] text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words leading-relaxed">
            {block.content}
            {block.status === "streaming" && (
                <span className="inline-block w-1.5 h-3.5 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />
            )}
        </div>
    );
}

export function AgentTab({ agentId, events, plan }: AgentTabProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const lastProcessedRef = useRef(0);
    const blocksRef = useRef<Map<string, StreamBlock>>(new Map());
    const stepInfoRef = useRef<StepInfo>({});
    const modelInfoRef = useRef<{ model?: string }>({});
    const toolResultsRef = useRef<Map<string, { content: unknown; isError: boolean }>>(new Map());
    const wasAtBottomRef = useRef(true);

    // Filter events based on agentId
    const filteredEvents = useMemo(() => {
        return events.filter((event) => {
            if (agentId === "lead") {
                if (event.type === "worker_start" || event.type === "worker_stream" || event.type === "worker_tool_result") {
                    return (event.data.agent as string) === "lead";
                }
                return LEAD_EVENT_TYPES.has(event.type);
            }
            // worker-{task_id} pattern
            const taskId = agentId.replace("worker-", "");
            return (event.data.task_id as string) === taskId;
        });
    }, [agentId, events]);

    // Process new events incrementally
    const { blocks, stepInfo, modelInfo, timelineEvents, toolResults } = useMemo(() => {
        // Reset if events got shorter (new session)
        if (filteredEvents.length < lastProcessedRef.current) {
            blocksRef.current = new Map();
            stepInfoRef.current = {};
            modelInfoRef.current = {};
            toolResultsRef.current = new Map();
            lastProcessedRef.current = 0;
        }

        processEvents(
            filteredEvents,
            lastProcessedRef.current,
            blocksRef.current,
            stepInfoRef.current,
            modelInfoRef.current,
            toolResultsRef.current,
        );
        lastProcessedRef.current = filteredEvents.length;

        // Separate timeline events from stream events
        const timeline = filteredEvents.filter(
            (e) => e.type !== "worker_stream" && e.type !== "worker_start" && e.type !== "worker_tool_result"
        );

        return {
            blocks: blocksRef.current,
            stepInfo: stepInfoRef.current,
            modelInfo: modelInfoRef.current,
            timelineEvents: timeline,
            toolResults: toolResultsRef.current,
        };
    }, [filteredEvents]);

    // Track scroll position - only auto-scroll if user is near bottom
    const handleScroll = useCallback(() => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            wasAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 60;
        }
    }, []);

    useEffect(() => {
        if (scrollRef.current && wasAtBottomRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [filteredEvents.length]);

    // Find task info from plan
    const taskId = agentId !== "lead" ? agentId.replace("worker-", "") : null;
    const task = taskId && plan
        ? plan.phases.flatMap((p) => p.tasks).find((t) => t.task_id === taskId)
        : null;

    const displayModel = modelInfo.model || stepInfo.model;
    const blockArray = Array.from(blocks.values());
    const hasStreamContent = blockArray.length > 0;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header with task/lead info */}
            {task && (
                <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <p className="text-xs text-zinc-500">Task</p>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{task.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-[10px]">{task.worker_type_id}</Badge>
                        {displayModel && (
                            <Badge variant="outline" className="text-[10px]">
                                <Cpu className="h-2.5 w-2.5 mr-0.5" />
                                {displayModel}
                            </Badge>
                        )}
                        <span className="text-[10px] text-zinc-400">
                            Submits: {task.submit_count} &middot; Status: {task.status}
                        </span>
                    </div>
                </div>
            )}
            {agentId === "lead" && (
                <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Lead Agent</p>
                        {displayModel && (
                            <Badge variant="outline" className="text-[10px]">
                                <Cpu className="h-2.5 w-2.5 mr-0.5" />
                                {displayModel}
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-zinc-500">Plans, reviews, and coordinates tasks</p>
                </div>
            )}

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={handleScroll}>
                <div className="p-3 space-y-2">
                    {/* Step Info - collapsible prompts */}
                    {(stepInfo.systemPrompt || stepInfo.userPrompt) && (
                        <div className="space-y-1 pb-2 border-b border-zinc-200 dark:border-zinc-700">
                            {stepInfo.systemPrompt && (
                                <PromptSection label="System Prompt" content={stepInfo.systemPrompt} />
                            )}
                            {stepInfo.userPrompt && (
                                <PromptSection label="User Prompt" content={stepInfo.userPrompt} />
                            )}
                            {(stepInfo.maxTurns || stepInfo.permissionMode || stepInfo.cwd) && (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {stepInfo.maxTurns && (
                                        <Badge variant="outline" className="text-[10px]">max_turns: {stepInfo.maxTurns}</Badge>
                                    )}
                                    {stepInfo.permissionMode && (
                                        <Badge variant="outline" className="text-[10px]">{stepInfo.permissionMode}</Badge>
                                    )}
                                    {stepInfo.cwd && (
                                        <Badge variant="outline" className="text-[10px] max-w-[200px] truncate" title={stepInfo.cwd}>
                                            {stepInfo.cwd}
                                        </Badge>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Streaming content blocks */}
                    {hasStreamContent && (
                        <div className="space-y-1">
                            {blockArray.map((block) => (
                                <StreamBlockView
                                    key={block.id}
                                    block={block}
                                    toolResult={block.type === "tool_input" ? toolResults.get(block.id) : undefined}
                                />
                            ))}
                        </div>
                    )}

                    {/* Timeline events (non-stream) */}
                    {timelineEvents.length > 0 && (
                        <div className="space-y-0.5">
                            {timelineEvents.map((event, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs py-1 px-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                    <span className="text-[10px] text-zinc-400 whitespace-nowrap mt-0.5">
                                        {formatTime(event.timestamp)}
                                    </span>
                                    <span className="mt-0.5 shrink-0">{getEventIcon(event.type)}</span>
                                    <span className="flex-1 text-zinc-700 dark:text-zinc-300">{getEventLabel(event)}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {!hasStreamContent && timelineEvents.length === 0 && (
                        <div className="text-center text-zinc-400 text-sm py-8">
                            No events yet
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
