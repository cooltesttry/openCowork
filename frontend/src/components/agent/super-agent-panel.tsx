"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    Play,
    Square,
    CheckCircle2,
    Loader2,
    AlertCircle,
} from "lucide-react";

import {
    listWorkers,
    startSuperAgentRun,
    getSuperAgentSession,
    cancelSuperAgentSession,
    WorkerConfig,
    SuperAgentSession,
} from "@/lib/api";
import { SessionEventsLog, EventDetails } from "./session-events-log";

interface SessionEvent {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
}

type SessionStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export function SuperAgentPanel() {
    // Input State
    const [taskObjective, setTaskObjective] = useState("");
    const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
    const [maxCycles, setMaxCycles] = useState(3);

    // Workers list
    const [workers, setWorkers] = useState<WorkerConfig[]>([]);
    const [isLoadingWorkers, setIsLoadingWorkers] = useState(true);

    // Session State
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [session, setSession] = useState<SuperAgentSession | null>(null);
    const [status, setStatus] = useState<SessionStatus>("idle");
    const [error, setError] = useState<string | null>(null);

    // Event selection state
    const [selectedEvent, setSelectedEvent] = useState<SessionEvent | null>(null);
    const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);

    // Load workers on mount
    useEffect(() => {
        async function loadWorkers() {
            try {
                const data = await listWorkers();
                setWorkers(data.workers || []);
                if (data.workers?.length > 0 && !selectedWorkerId) {
                    setSelectedWorkerId(data.workers[0].id);
                }
            } catch {
                toast.error("Failed to load workers");
            } finally {
                setIsLoadingWorkers(false);
            }
        }
        loadWorkers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Polling effect
    useEffect(() => {
        if (!sessionId || status !== "running") return;

        const interval = setInterval(async () => {
            try {
                const sessionData = await getSuperAgentSession(sessionId);
                setSession(sessionData);

                if (["completed", "failed", "cancelled"].includes(sessionData.status)) {
                    setStatus(sessionData.status as SessionStatus);
                    if (sessionData.status === "completed") {
                        toast.success("Task completed successfully!");
                    } else if (sessionData.status === "failed") {
                        toast.error(`Task failed: ${sessionData.last_error || "Unknown error"}`);
                    }
                }
            } catch (err) {
                console.error("Polling error:", err);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [sessionId, status]);

    const handleStart = useCallback(async () => {
        if (!taskObjective.trim()) {
            toast.error("Please enter a task objective");
            return;
        }
        if (!selectedWorkerId) {
            toast.error("Please select a worker");
            return;
        }

        setError(null);
        setStatus("running");
        setSession(null);

        try {
            const result = await startSuperAgentRun({
                task_objective: taskObjective.trim(),
                worker_id: selectedWorkerId,
                max_cycles: maxCycles,
            });
            setSessionId(result.session_id);
            toast.success(`Started session: ${result.session_id}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to start task";
            setError(message);
            setStatus("failed");
            toast.error(message);
        }
    }, [taskObjective, selectedWorkerId, maxCycles]);

    const handleStop = useCallback(async () => {
        if (!sessionId) return;

        try {
            await cancelSuperAgentSession(sessionId);
            setStatus("cancelled");
            toast.info("Task cancelled");
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to cancel task";
            toast.error(message);
        }
    }, [sessionId]);

    const handleReset = useCallback(() => {
        setSessionId(null);
        setSession(null);
        setStatus("idle");
        setError(null);
        setTaskObjective("");
    }, []);

    return (
        <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">Super Agent</h2>
                    {status === "running" && (
                        <Badge variant="outline" className="animate-pulse">
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Running
                        </Badge>
                    )}
                    {status === "completed" && (
                        <Badge variant="default" className="bg-green-600">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Completed
                        </Badge>
                    )}
                    {status === "failed" && (
                        <Badge variant="destructive">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Failed
                        </Badge>
                    )}
                </div>
                {status !== "idle" && (
                    <Button variant="ghost" size="sm" onClick={handleReset}>
                        New Task
                    </Button>
                )}
            </div>

            {/* Input Section */}
            {status === "idle" && (
                <div className="p-4 space-y-4 border-b border-zinc-200 dark:border-zinc-700">
                    <div className="space-y-2">
                        <Label htmlFor="task-objective">Task Objective</Label>
                        <Textarea
                            id="task-objective"
                            placeholder="Describe what the agent should do..."
                            value={taskObjective}
                            onChange={(e) => setTaskObjective(e.target.value)}
                            className="min-h-[100px]"
                        />
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-1 space-y-2">
                            <Label>Worker</Label>
                            <Select
                                value={selectedWorkerId || ""}
                                onValueChange={setSelectedWorkerId}
                                disabled={isLoadingWorkers}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a worker..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {workers.map((w) => (
                                        <SelectItem key={w.id} value={w.id}>
                                            {w.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="w-24 space-y-2">
                            <Label>Max Cycles</Label>
                            <Select
                                value={String(maxCycles)}
                                onValueChange={(v) => setMaxCycles(Number(v))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                        <SelectItem key={n} value={String(n)}>
                                            {n}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Button onClick={handleStart} className="w-full" disabled={!taskObjective.trim()}>
                        <Play className="w-4 h-4 mr-2" />
                        Start Task
                    </Button>
                </div>
            )}

            {/* Running Controls */}
            {status === "running" && (
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
                    <Button variant="destructive" onClick={handleStop}>
                        <Square className="w-4 h-4 mr-2" />
                        Stop
                    </Button>
                </div>
            )}

            {/* Error Display */}
            {error && (
                <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            {/* Main Content: Split view with events log */}
            <div className="flex-1 flex min-h-0">
                {/* Live Events Panel - shown when running or just completed */}
                {(status === "running" || sessionId) && (
                    <div className="w-56 border-r border-zinc-200 dark:border-zinc-700 shrink-0">
                        <SessionEventsLog
                            sessionId={sessionId}
                            isActive={status === "running"}
                            onEventSelect={(event, index) => {
                                setSelectedEvent(event);
                                setSelectedEventIndex(index);
                            }}
                            selectedEventIndex={selectedEventIndex}
                        />
                    </div>
                )}

                {/* Event Details Panel - fills remaining space */}
                <div className="flex-1 min-w-0">
                    {selectedEvent ? (
                        <EventDetails event={selectedEvent} />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                            {status === "idle" ? (
                                <p>Enter a task and click Start to begin</p>
                            ) : status === "running" ? (
                                <>
                                    <Loader2 className="w-8 h-8 animate-spin mb-2" />
                                    <p>Click an event to view details</p>
                                </>
                            ) : (
                                <p>Click an event to view details</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
