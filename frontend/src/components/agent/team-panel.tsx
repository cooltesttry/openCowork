"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
    Play,
    Square,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Users,
} from "lucide-react";
import {
    listWorkers,
    startTeamRun,
    getTeamSession,
    cancelTeamSession,
    WorkerConfig,
    Plan,
} from "@/lib/api";
import { PlanView } from "./plan-view";
import { AgentTab } from "./agent-tab";
import { ResultsTab } from "./results-tab";

interface SessionEvent {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
}

type TeamStatus = "idle" | "planning" | "executing" | "phase_review" | "completed" | "failed" | "cancelled";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_STATUSES = new Set(["planning", "executing", "phase_review"]);

export function TeamPanel() {
    // Input state
    const [taskObjective, setTaskObjective] = useState("");
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
    const [maxTaskSubmits, setMaxTaskSubmits] = useState(3);

    // Workers list
    const [workers, setWorkers] = useState<WorkerConfig[]>([]);
    const [isLoadingWorkers, setIsLoadingWorkers] = useState(true);

    // Session state
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [status, setStatus] = useState<TeamStatus>("idle");
    const [plan, setPlan] = useState<Plan | null>(null);
    const [currentPhaseIndex, setCurrentPhaseIndex] = useState(-1);
    const [events, setEvents] = useState<SessionEvent[]>([]);
    const [selectedTab, setSelectedTab] = useState("lead");
    const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
    const [finalOutput, setFinalOutput] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);

    // Load workers on mount
    useEffect(() => {
        async function loadWorkers() {
            try {
                const data = await listWorkers();
                setWorkers(data.workers || []);
                if (data.workers?.length > 0 && !selectedLeadId) {
                    setSelectedLeadId(data.workers[0].id);
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

    // Track status in a ref so the WS effect doesn't re-run on status changes
    const statusRef = useRef(status);
    statusRef.current = status;

    // WebSocket connection — only reconnects when sessionId changes
    useEffect(() => {
        if (!sessionId) return;

        const wsUrl = `ws://localhost:8000/api/team/ws/${sessionId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (msg) => {
            try {
                const event = JSON.parse(msg.data) as SessionEvent;
                if (event.type === "pong") return;

                // Deduplicate by type + timestamp
                setEvents((prev) => {
                    const isDuplicate = prev.some(
                        (e) => e.type === event.type && e.timestamp === event.timestamp
                    );
                    if (isDuplicate) return prev;
                    return [...prev, event];
                });

                // Auto-navigation
                if (event.type === "team_planning_complete") {
                    const eventPlan = event.data.plan as Plan | undefined;
                    if (eventPlan) {
                        setPlan(eventPlan);
                        if (eventPlan.phases.length > 0) {
                            setExpandedPhases(new Set([eventPlan.phases[0].phase_id]));
                        }
                    }
                }
                if (event.type === "team_plan_updated") {
                    const updatedPlan = event.data.plan as Plan | undefined;
                    if (updatedPlan) setPlan(updatedPlan);
                }
                if (event.type === "team_phase_start") {
                    const phaseIndex = event.data.phase_index as number;
                    const phaseId = event.data.phase_id as string;
                    setCurrentPhaseIndex(phaseIndex);
                    setExpandedPhases((prev) => new Set(prev).add(phaseId));
                }
                if (event.type === "team_task_start") {
                    const taskId = event.data.task_id as string;
                    setSelectedTab(`worker-${taskId}`);
                }
                if (event.type === "team_session_complete") {
                    setSelectedTab("results");
                }
            } catch (e) {
                console.error("[TeamPanel] Parse error:", e);
            }
        };

        ws.onerror = (e) => console.error("[TeamPanel] WS error:", e);

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [sessionId]);

    // Close WebSocket when session reaches a terminal state
    useEffect(() => {
        if (sessionId && !ACTIVE_STATUSES.has(status) && status !== "idle") {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        }
    }, [sessionId, status]);

    // Polling for status + plan sync
    useEffect(() => {
        if (!sessionId) return;
        if (status === "idle") return;

        const interval = setInterval(async () => {
            try {
                const session = await getTeamSession(sessionId);

                // Update plan from polling
                if (session.plan) setPlan(session.plan);
                if (session.current_phase_index >= 0) setCurrentPhaseIndex(session.current_phase_index);
                if (session.final_output) setFinalOutput(session.final_output);
                if (session.error) setError(session.error);

                if (TERMINAL_STATUSES.has(session.status) && !TERMINAL_STATUSES.has(status)) {
                    setStatus(session.status as TeamStatus);
                    if (session.status === "completed") {
                        toast.success("Team task completed!");
                    } else if (session.status === "failed") {
                        toast.error(`Team task failed: ${session.error || "Unknown error"}`);
                    }
                } else if (session.status !== status) {
                    setStatus(session.status as TeamStatus);
                }
            } catch (err) {
                console.error("Polling error:", err);
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [sessionId, status]);

    const handleStart = useCallback(async () => {
        if (!taskObjective.trim()) {
            toast.error("Please enter an objective");
            return;
        }
        if (!selectedLeadId) {
            toast.error("Please select a lead worker");
            return;
        }

        setError(null);
        setStatus("planning");
        setEvents([]);
        setPlan(null);
        setCurrentPhaseIndex(-1);
        setFinalOutput(null);
        setSelectedTab("lead");
        setExpandedPhases(new Set());

        try {
            const result = await startTeamRun({
                objective: taskObjective.trim(),
                lead_worker_id: selectedLeadId,
                max_task_submits: maxTaskSubmits,
            });
            setSessionId(result.session_id);
            toast.success(`Team session started`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to start team run";
            setError(message);
            setStatus("failed");
            toast.error(message);
        }
    }, [taskObjective, selectedLeadId, maxTaskSubmits]);

    const handleStop = useCallback(async () => {
        if (!sessionId) return;
        try {
            await cancelTeamSession(sessionId);
            setStatus("cancelled");
            toast.info("Team session cancelled");
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to cancel";
            toast.error(message);
        }
    }, [sessionId]);

    const handleReset = useCallback(() => {
        setSessionId(null);
        setStatus("idle");
        setError(null);
        setTaskObjective("");
        setPlan(null);
        setCurrentPhaseIndex(-1);
        setEvents([]);
        setFinalOutput(null);
        setSelectedTab("lead");
        setExpandedPhases(new Set());
    }, []);

    const handleTogglePhase = useCallback((phaseId: string) => {
        setExpandedPhases((prev) => {
            const next = new Set(prev);
            if (next.has(phaseId)) next.delete(phaseId);
            else next.add(phaseId);
            return next;
        });
    }, []);

    const handleSelectTask = useCallback((taskId: string) => {
        setSelectedTab(`worker-${taskId}`);
    }, []);

    // Compute available agent tabs from plan
    const agentTabs: { id: string; label: string }[] = [{ id: "lead", label: "Lead" }];
    if (plan) {
        for (const phase of plan.phases) {
            for (const task of phase.tasks) {
                if (task.status !== "pending") {
                    agentTabs.push({
                        id: `worker-${task.task_id}`,
                        label: task.description.slice(0, 20) || task.task_id.slice(0, 8),
                    });
                }
            }
        }
    }

    // Compute selectedTaskId for PlanView highlighting
    const selectedTaskId = selectedTab.startsWith("worker-") ? selectedTab.replace("worker-", "") : null;

    const isActive = ACTIVE_STATUSES.has(status);

    return (
        <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold">Team</h2>
                    <StatusBadge status={status} />
                </div>
                <div className="flex items-center gap-1.5">
                    {isActive && (
                        <Button variant="destructive" size="sm" onClick={handleStop} className="h-7 text-xs">
                            <Square className="w-3 h-3 mr-1" />
                            Stop
                        </Button>
                    )}
                    {status !== "idle" && (
                        <Button variant="ghost" size="sm" onClick={handleReset} className="h-7 text-xs">
                            New Task
                        </Button>
                    )}
                </div>
            </div>

            {/* Input form */}
            {status === "idle" && (
                <div className="p-4 space-y-3 border-b border-zinc-200 dark:border-zinc-700">
                    <div className="space-y-1.5">
                        <Label htmlFor="team-objective" className="text-xs">Objective</Label>
                        <Textarea
                            id="team-objective"
                            placeholder="Describe what the team should accomplish..."
                            value={taskObjective}
                            onChange={(e) => setTaskObjective(e.target.value)}
                            className="min-h-[80px] text-sm"
                        />
                    </div>

                    <div className="flex gap-3">
                        <div className="flex-1 space-y-1.5">
                            <Label className="text-xs">Lead Worker</Label>
                            <Select
                                value={selectedLeadId || ""}
                                onValueChange={setSelectedLeadId}
                                disabled={isLoadingWorkers}
                            >
                                <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Select lead..." />
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

                        <div className="w-28 space-y-1.5">
                            <Label className="text-xs">Max Submits</Label>
                            <Select
                                value={String(maxTaskSubmits)}
                                onValueChange={(v) => setMaxTaskSubmits(Number(v))}
                            >
                                <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <SelectItem key={n} value={String(n)}>
                                            {n}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Button onClick={handleStart} className="w-full h-8 text-xs" disabled={!taskObjective.trim()}>
                        <Play className="w-3 h-3 mr-1.5" />
                        Start Team
                    </Button>
                </div>
            )}

            {/* Main area */}
            {status !== "idle" && (
                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* Left sidebar: Plan View */}
                    <div className="w-[280px] border-r border-zinc-200 dark:border-zinc-700 shrink-0 overflow-hidden">
                        <PlanView
                            plan={plan}
                            currentPhaseIndex={currentPhaseIndex}
                            expandedPhases={expandedPhases}
                            onTogglePhase={handleTogglePhase}
                            onSelectTask={handleSelectTask}
                            selectedTaskId={selectedTaskId}
                        />
                    </div>

                    {/* Right area: Agent tabs + Results */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex flex-col h-full gap-0">
                            <TabsList className="w-full justify-start rounded-none border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 h-8 px-1">
                                {agentTabs.map((tab) => (
                                    <TabsTrigger key={tab.id} value={tab.id} className="text-[11px] h-6 px-2 py-0">
                                        {tab.label}
                                    </TabsTrigger>
                                ))}
                                <TabsTrigger value="results" className="text-[11px] h-6 px-2 py-0">
                                    Results
                                </TabsTrigger>
                            </TabsList>

                            {agentTabs.map((tab) => (
                                <TabsContent key={tab.id} value={tab.id} className="flex-1 min-h-0 overflow-hidden mt-0">
                                    <AgentTab agentId={tab.id} events={events} plan={plan} />
                                </TabsContent>
                            ))}
                            <TabsContent value="results" className="flex-1 min-h-0 overflow-hidden mt-0">
                                <ResultsTab plan={plan} finalOutput={finalOutput} status={status} error={error} />
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            )}

            {/* Error display (when idle) */}
            {status === "idle" && error && (
                <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                </div>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: TeamStatus }) {
    switch (status) {
        case "planning":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 animate-pulse">
                    <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin" />
                    Planning
                </Badge>
            );
        case "executing":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300 animate-pulse">
                    <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin" />
                    Executing
                </Badge>
            );
        case "phase_review":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-orange-600 border-orange-300">
                    Reviewing
                </Badge>
            );
        case "completed":
            return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-300">
                    <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                    Completed
                </Badge>
            );
        case "failed":
            return (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                    <AlertCircle className="w-2.5 h-2.5 mr-0.5" />
                    Failed
                </Badge>
            );
        case "cancelled":
            return (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Cancelled
                </Badge>
            );
        default:
            return null;
    }
}
