"use client";

import { Badge } from "@/components/ui/badge";
import {
    ChevronRight,
    ChevronDown,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Clock,
    Send,
} from "lucide-react";
import type { Plan } from "@/lib/api";

interface PlanViewProps {
    plan: Plan | null;
    currentPhaseIndex: number;
    expandedPhases: Set<string>;
    onTogglePhase: (phaseId: string) => void;
    onSelectTask: (taskId: string) => void;
    selectedTaskId: string | null;
}

function statusBadge(status: string) {
    switch (status) {
        case "running":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-blue-600 border-blue-300">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Running
                </Badge>
            );
        case "completed":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-green-600 border-green-300">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Done
                </Badge>
            );
        case "failed":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-red-600 border-red-300">
                    <AlertCircle className="h-2.5 w-2.5" />
                    Failed
                </Badge>
            );
        case "submitted":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-yellow-600 border-yellow-300">
                    <Send className="h-2.5 w-2.5" />
                    Submitted
                </Badge>
            );
        case "approved":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-green-600 border-green-300">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Approved
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-zinc-500 border-zinc-300">
                    <Clock className="h-2.5 w-2.5" />
                    Pending
                </Badge>
            );
    }
}

export function PlanView({
    plan,
    currentPhaseIndex,
    expandedPhases,
    onTogglePhase,
    onSelectTask,
    selectedTaskId,
}: PlanViewProps) {
    if (!plan) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm px-4 text-center">
                <Loader2 className="h-6 w-6 animate-spin mb-2" />
                Waiting for plan...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Objective header */}
            <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wide">Objective</p>
                <p className="text-sm mt-0.5 text-blue-900 dark:text-blue-100 line-clamp-3">{plan.objective}</p>
            </div>

            {/* Phase list */}
            <div className="flex-1 overflow-y-auto">
                {plan.phases.map((phase) => {
                    const isExpanded = expandedPhases.has(phase.phase_id);
                    const isCurrent = phase.phase_index === currentPhaseIndex;

                    return (
                        <div key={phase.phase_id}>
                            {/* Phase header */}
                            <button
                                onClick={() => onTogglePhase(phase.phase_id)}
                                className={`w-full flex items-start gap-1.5 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800 ${
                                    isCurrent ? "border-l-2 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20" : ""
                                }`}
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-zinc-400" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-zinc-400" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-medium text-zinc-400">P{phase.phase_index + 1}</span>
                                        {statusBadge(phase.status)}
                                    </div>
                                    <p className="text-xs mt-0.5 text-zinc-700 dark:text-zinc-300 line-clamp-2">{phase.description}</p>
                                </div>
                            </button>

                            {/* Tasks list */}
                            {isExpanded && (
                                <div className="bg-zinc-50 dark:bg-zinc-900/50">
                                    {phase.tasks.map((task) => (
                                        <button
                                            key={task.task_id}
                                            onClick={() => onSelectTask(task.task_id)}
                                            className={`w-full flex items-start gap-2 px-4 pl-7 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                                                selectedTaskId === task.task_id
                                                    ? "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-400"
                                                    : ""
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    {statusBadge(task.status)}
                                                    <Badge variant="secondary" className="text-[9px] px-1 py-0">
                                                        {task.worker_type_id}
                                                    </Badge>
                                                </div>
                                                <p className="text-[11px] mt-0.5 text-zinc-600 dark:text-zinc-400 line-clamp-2">
                                                    {task.description}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Plan version footer */}
            <div className="px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-400">
                Plan v{plan.version} &middot; {plan.phases.length} phases &middot;{" "}
                {plan.phases.reduce((sum, p) => sum + p.tasks.length, 0)} tasks
            </div>
        </div>
    );
}
