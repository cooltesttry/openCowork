"use client";

import { useRef, useEffect } from "react";
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
    if (type.includes("stream")) {
        return <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />;
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

export function AgentTab({ agentId, events, plan }: AgentTabProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Filter events based on agentId
    const filteredEvents = events.filter((event) => {
        if (agentId === "lead") {
            return LEAD_EVENT_TYPES.has(event.type);
        }
        // worker-{task_id} pattern
        const taskId = agentId.replace("worker-", "");
        return (event.data.task_id as string) === taskId;
    });

    // Find task info from plan
    const taskId = agentId !== "lead" ? agentId.replace("worker-", "") : null;
    const task = taskId && plan
        ? plan.phases.flatMap((p) => p.tasks).find((t) => t.task_id === taskId)
        : null;

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [filteredEvents.length]);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Task context header */}
            {task && (
                <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <p className="text-xs text-zinc-500">Task</p>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{task.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-[10px]">{task.worker_type_id}</Badge>
                        <span className="text-[10px] text-zinc-400">
                            Submits: {task.submit_count} &middot; Status: {task.status}
                        </span>
                    </div>
                </div>
            )}
            {agentId === "lead" && (
                <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Lead Agent</p>
                    <p className="text-xs text-zinc-500">Plans, reviews, and coordinates tasks</p>
                </div>
            )}

            {/* Events list */}
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
                <div className="p-2 space-y-0.5">
                    {filteredEvents.length === 0 ? (
                        <div className="text-center text-zinc-400 text-sm py-8">
                            No events yet
                        </div>
                    ) : (
                        filteredEvents.map((event, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                <span className="text-[10px] text-zinc-400 whitespace-nowrap mt-0.5">
                                    {formatTime(event.timestamp)}
                                </span>
                                <span className="mt-0.5 shrink-0">{getEventIcon(event.type)}</span>
                                <span className="flex-1 text-zinc-700 dark:text-zinc-300">{getEventLabel(event)}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
