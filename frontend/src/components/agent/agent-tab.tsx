"use client";

import { useRef, useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
    Play,
    CheckCircle,
    XCircle,
    Search,
    MessageSquare,
    Send,
    ChevronRight,
    FileText,
    Cpu,
    Wrench,
} from "lucide-react";
import type { Plan } from "@/lib/api";
import {
    processEvent,
    createInitialState,
    type EventProcessorState,
    type ProcessableEvent,
} from "@/lib/event-processor";
import { BlockList } from "@/components/blocks/block-renderer";

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

interface StepInfo {
    systemPrompt?: string;
    userPrompt?: string;
    model?: string;
    maxTurns?: number;
    permissionMode?: string;
    cwd?: string;
}

/** A "run" groups a worker_start's step info, its stream blocks, and trailing timeline events */
interface Run {
    stepInfo: StepInfo;
    modelInfo?: string;
    epState: EventProcessorState;
    timelineEvents: SessionEvent[];
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

/** Translate a worker_stream event into a ProcessableEvent for the event-processor pipeline */
function translateWorkerStreamEvent(event: SessionEvent): ProcessableEvent | null {
    const d = event.data;
    const streamType = d.stream_type as string;
    const blockId = d.block_id as string;

    switch (streamType) {
        case "text_start":
            return { type: "text_start", id: blockId };
        case "text_delta":
            return { type: "text_delta", id: blockId, content: d.content as string };
        case "text_end":
            return { type: "text_end", id: blockId };
        case "thinking_start":
            return { type: "thinking_start", id: blockId };
        case "thinking_delta":
            return { type: "thinking_delta", id: blockId, content: d.content as string };
        case "thinking_end":
            return { type: "thinking_end", id: blockId };
        case "tool_input_start":
            return { type: "tool_input_start", id: blockId, content: { name: d.tool_name as string } };
        case "tool_input_delta":
            return { type: "tool_input_delta", id: blockId, content: d.content as string };
        case "tool_input_end":
            return { type: "tool_input_end", id: blockId };
        default:
            return null; // model_info and others handled separately
    }
}

/** Translate a worker_tool_call event into a ProcessableEvent */
function translateWorkerToolCall(event: SessionEvent): ProcessableEvent {
    const d = event.data;
    return {
        type: "tool_use",
        content: {
            name: d.tool_name as string,
            id: d.tool_id as string,
            input: d.input,
        },
    };
}

/** Translate a worker_tool_result event into a ProcessableEvent */
function translateWorkerToolResult(event: SessionEvent): ProcessableEvent {
    const d = event.data;
    return {
        type: "tool_result",
        content: {
            tool_use_id: d.tool_id as string,
            result: d.content,
            is_error: d.is_error as boolean,
        },
    };
}

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
        case "team_phase_review_complete": {
            const decision = String(data.decision ?? "");
            const base = `Review: ${decision}`;
            const raw = data.context_usage;
            if (!raw || typeof raw !== "object") return base;
            const ctx = raw as Record<string, unknown>;
            if (ctx.status === "ok") {
                const used = typeof ctx.used_tokens === "number" ? ctx.used_tokens : NaN;
                const window = typeof ctx.window_tokens === "number" ? ctx.window_tokens : NaN;
                const percent = typeof ctx.percent === "number" ? ctx.percent : NaN;
                if (Number.isFinite(used) && Number.isFinite(window) && Number.isFinite(percent)) {
                    return `${base} · Ctx ${used}/${window} (${percent}%)`;
                }
            }
            if (ctx.status === "failed") {
                const code = typeof ctx.error_code === "string" ? ctx.error_code : "UNKNOWN";
                return `${base} · Ctx failed (${code})`;
            }
            return base;
        }
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

/** Group filtered events into runs, where each run starts at a worker_start event */
function buildRuns(events: SessionEvent[]): Run[] {
    const runs: Run[] = [];
    let currentRun: Run | null = null;

    // Collect timeline events that arrive before the first worker_start
    const leadingTimeline: SessionEvent[] = [];

    for (const event of events) {
        if (event.type === "worker_start") {
            // Start a new run
            const d = event.data;
            const stepInfo: StepInfo = {};
            if (d.system_prompt) stepInfo.systemPrompt = d.system_prompt as string;
            if (d.user_prompt) stepInfo.userPrompt = d.user_prompt as string;
            if (d.model) stepInfo.model = d.model as string;
            if (d.max_turns) stepInfo.maxTurns = d.max_turns as number;
            if (d.permission_mode) stepInfo.permissionMode = d.permission_mode as string;
            if (d.cwd) stepInfo.cwd = d.cwd as string;

            currentRun = {
                stepInfo,
                epState: createInitialState(),
                timelineEvents: [],
            };
            runs.push(currentRun);
        } else if (event.type === "worker_stream") {
            if (!currentRun) {
                currentRun = { stepInfo: {}, epState: createInitialState(), timelineEvents: [] };
                runs.push(currentRun);
            }
            // Handle model_info separately
            const streamType = event.data.stream_type as string;
            if (streamType === "model_info") {
                currentRun.modelInfo = event.data.model as string;
            } else {
                const pe = translateWorkerStreamEvent(event);
                if (pe) {
                    currentRun.epState = processEvent(currentRun.epState, pe, "agent");
                }
            }
        } else if (event.type === "worker_tool_call") {
            if (!currentRun) {
                currentRun = { stepInfo: {}, epState: createInitialState(), timelineEvents: [] };
                runs.push(currentRun);
            }
            const pe = translateWorkerToolCall(event);
            currentRun.epState = processEvent(currentRun.epState, pe, "agent");
        } else if (event.type === "worker_tool_result") {
            if (!currentRun) {
                currentRun = { stepInfo: {}, epState: createInitialState(), timelineEvents: [] };
                runs.push(currentRun);
            }
            const pe = translateWorkerToolResult(event);
            currentRun.epState = processEvent(currentRun.epState, pe, "agent");
        } else {
            // Timeline event
            if (currentRun) {
                currentRun.timelineEvents.push(event);
            } else {
                leadingTimeline.push(event);
            }
        }
    }

    // If there were leading timeline events but no runs, create a virtual run to hold them
    if (leadingTimeline.length > 0) {
        if (runs.length > 0) {
            // Prepend to first run's timeline
            runs[0].timelineEvents = [...leadingTimeline, ...runs[0].timelineEvents];
        } else {
            runs.push({
                stepInfo: {},
                epState: createInitialState(),
                timelineEvents: leadingTimeline,
            });
        }
    }

    return runs;
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

function TimelineEventRow({ event }: { event: SessionEvent }) {
    return (
        <div className="flex items-start gap-2 text-xs py-1 px-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <span className="text-[10px] text-zinc-400 whitespace-nowrap mt-0.5">
                {formatTime(event.timestamp)}
            </span>
            <span className="mt-0.5 shrink-0">{getEventIcon(event.type)}</span>
            <span className="flex-1 text-zinc-700 dark:text-zinc-300">{getEventLabel(event)}</span>
        </div>
    );
}

function RunView({ run, runIndex, showDivider }: { run: Run; runIndex: number; showDivider: boolean }) {
    const { stepInfo, modelInfo, epState, timelineEvents } = run;
    const hasStepInfo = stepInfo.systemPrompt || stepInfo.userPrompt;
    const hasBlocks = epState.blocks.length > 0;
    const displayModel = modelInfo || stepInfo.model;

    return (
        <div>
            {/* Run divider for multi-run display */}
            {showDivider && (
                <div className="flex items-center gap-2 py-1.5 px-2 my-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded text-[11px] text-blue-600 dark:text-blue-400">
                    <Play className="h-3 w-3" />
                    <span className="font-medium">Run {runIndex + 1}</span>
                    {displayModel && (
                        <Badge variant="outline" className="text-[10px] ml-auto">
                            <Cpu className="h-2.5 w-2.5 mr-0.5" />
                            {displayModel}
                        </Badge>
                    )}
                </div>
            )}

            {/* Step Info - collapsible prompts */}
            {hasStepInfo && (
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

            {/* Stream content via BlockList */}
            {hasBlocks && (
                <BlockList blocks={epState.blocks} />
            )}

            {/* Timeline events inline after stream blocks */}
            {timelineEvents.length > 0 && (
                <div className="space-y-0.5">
                    {timelineEvents.map((event, i) => (
                        <TimelineEventRow key={`${runIndex}-tl-${i}`} event={event} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function AgentTab({ agentId, events, plan }: AgentTabProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const wasAtBottomRef = useRef(true);

    // Filter events based on agentId
    const filteredEvents = useMemo(() => {
        return events.filter((event) => {
            if (agentId === "lead") {
                if (event.type === "worker_start" || event.type === "worker_stream" || event.type === "worker_tool_call" || event.type === "worker_tool_result") {
                    return (event.data.agent as string) === "lead";
                }
                return LEAD_EVENT_TYPES.has(event.type);
            }
            // worker-{task_id} pattern
            const taskId = agentId.replace("worker-", "");
            return (event.data.task_id as string) === taskId;
        });
    }, [agentId, events]);

    // Build runs from filtered events - groups stream blocks with interleaved timeline events
    const runs = useMemo(() => buildRuns(filteredEvents), [filteredEvents]);

    // Derive display model from runs for header
    const displayModel = useMemo(() => {
        for (const run of runs) {
            if (run.modelInfo) return run.modelInfo;
            if (run.stepInfo.model) return run.stepInfo.model;
        }
        return undefined;
    }, [runs]);

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

    const hasContent = runs.some(r => r.epState.blocks.length > 0 || r.timelineEvents.length > 0);

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
                    {runs.map((run, i) => (
                        <RunView
                            key={i}
                            run={run}
                            runIndex={i}
                            showDivider={runs.length > 1}
                        />
                    ))}

                    {!hasContent && (
                        <div className="text-center text-zinc-400 text-sm py-8">
                            No events yet
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
