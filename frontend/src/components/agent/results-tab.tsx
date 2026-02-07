"use client";

import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import type { Plan } from "@/lib/api";

interface ResultsTabProps {
    plan: Plan | null;
    finalOutput: string | null;
    status: string;
    error: string | null;
}

export function ResultsTab({ plan, finalOutput, status, error }: ResultsTabProps) {
    return (
        <div className="flex flex-col h-full overflow-y-auto">
            {/* Final output */}
            {status === "completed" && finalOutput && (
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
                    <h3 className="text-sm font-semibold text-green-700 dark:text-green-300 flex items-center gap-1.5 mb-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Final Output
                    </h3>
                    <pre className="whitespace-pre-wrap text-sm bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                        {finalOutput}
                    </pre>
                </div>
            )}

            {/* Error display */}
            {(status === "failed" || error) && (
                <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-1.5 mb-1">
                        <AlertCircle className="h-4 w-4" />
                        Error
                    </h3>
                    <p className="text-sm text-red-600 dark:text-red-400">{error || "Unknown error"}</p>
                </div>
            )}

            {/* Phase summary */}
            {plan && (
                <div className="p-4">
                    <h3 className="text-sm font-semibold mb-3">Phase Summary</h3>
                    <div className="space-y-3">
                        {plan.phases.map((phase) => (
                            <div
                                key={phase.phase_id}
                                className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-zinc-500">
                                        Phase {phase.phase_index + 1}
                                    </span>
                                    <StatusBadge status={phase.status} />
                                </div>
                                <p className="text-sm text-zinc-700 dark:text-zinc-300">{phase.description}</p>
                                <div className="text-xs text-zinc-400 mt-1">
                                    {phase.tasks.length} task{phase.tasks.length !== 1 ? "s" : ""}
                                    {phase.started_at && phase.completed_at && (
                                        <> &middot; {formatDuration(phase.started_at, phase.completed_at)}</>
                                    )}
                                </div>

                                {/* Per-task results */}
                                {phase.tasks.some((t) => t.result) && (
                                    <div className="mt-2 space-y-2">
                                        {phase.tasks.map((task) =>
                                            task.result ? (
                                                <div
                                                    key={task.task_id}
                                                    className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-2"
                                                >
                                                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                                        {task.description}
                                                    </p>
                                                    {task.result.summary && (
                                                        <p className="text-xs text-zinc-500 mt-0.5">
                                                            {task.result.summary}
                                                        </p>
                                                    )}
                                                    {task.result.files.length > 0 && (
                                                        <div className="mt-1">
                                                            <span className="text-[10px] text-zinc-400">Files: </span>
                                                            {task.result.files.map((f, i) => (
                                                                <span
                                                                    key={i}
                                                                    className="text-[10px] text-blue-500 font-mono"
                                                                >
                                                                    {f.split("/").pop()}
                                                                    {i < task.result!.files.length - 1 ? ", " : ""}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : null
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* No results yet */}
            {!plan && !finalOutput && !error && (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm">
                    <Clock className="h-6 w-6 mb-2" />
                    No results yet
                </div>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case "completed":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-300">
                    <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                    Done
                </Badge>
            );
        case "failed":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-600 border-red-300">
                    <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                    Failed
                </Badge>
            );
        case "running":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300">
                    Running
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-zinc-500 border-zinc-300">
                    Pending
                </Badge>
            );
    }
}

function formatDuration(start: string, end: string): string {
    try {
        const ms = new Date(end).getTime() - new Date(start).getTime();
        if (ms < 1000) return `${ms}ms`;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}m ${secs}s`;
    } catch {
        return "";
    }
}
