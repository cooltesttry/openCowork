"use client";

import { useEffect, useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
    Play,
    CheckCircle,
    XCircle,
    Loader2,
    Wrench,
    Search,
    AlertCircle,
    ChevronRight,
} from "lucide-react";

interface SessionEvent {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
}

interface SessionEventsLogProps {
    sessionId: string | null;
    isActive: boolean;
    onEventSelect?: (event: SessionEvent | null, index: number | null) => void;
    selectedEventIndex?: number | null;
}

export function SessionEventsLog({
    sessionId,
    isActive,
    onEventSelect,
    selectedEventIndex
}: SessionEventsLogProps) {
    const [events, setEvents] = useState<SessionEvent[]>([]);
    const [connected, setConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!sessionId || !isActive) {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            setConnected(false);
            return;
        }

        const wsUrl = `ws://localhost:8000/api/super-agent/ws/${sessionId}`;
        console.log("[SessionEvents] Connecting to:", wsUrl);

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("[SessionEvents] Connected");
            setConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data) as SessionEvent;
                console.log("[SessionEvents] Received:", data);
                setEvents((prev) => [...prev, data]);
            } catch (e) {
                console.error("[SessionEvents] Parse error:", e);
            }
        };

        ws.onerror = (error) => {
            console.error("[SessionEvents] WebSocket error:", error);
        };

        ws.onclose = () => {
            console.log("[SessionEvents] Disconnected");
            setConnected(false);
        };

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [sessionId, isActive]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [events]);

    // Store onEventSelect in a ref to avoid stale closures
    const onEventSelectRef = useRef(onEventSelect);
    useEffect(() => {
        onEventSelectRef.current = onEventSelect;
    }, [onEventSelect]);

    // Reset events only when sessionId changes (not onEventSelect)
    const prevSessionIdRef = useRef(sessionId);
    useEffect(() => {
        if (prevSessionIdRef.current !== sessionId) {
            setEvents([]);
            onEventSelectRef.current?.(null, null);
            prevSessionIdRef.current = sessionId;
        }
    }, [sessionId]);

    const getEventIcon = (type: string) => {
        switch (type) {
            case "session_start":
            case "cycle_start":
            case "worker_start":
            case "checker_start":
                return <Play className="h-3 w-3 text-blue-500" />;
            case "session_complete":
            case "cycle_end":
            case "worker_complete":
            case "checker_complete":
                return <CheckCircle className="h-3 w-3 text-green-500" />;
            case "worker_tool_call":
                return <Wrench className="h-3 w-3 text-purple-500" />;
            case "worker_tool_result":
                return <CheckCircle className="h-3 w-3 text-purple-400" />;
            case "checker_stream":
                return <Loader2 className="h-3 w-3 text-orange-500 animate-spin" />;
            case "session_error":
            case "worker_error":
            case "checker_error":
                return <XCircle className="h-3 w-3 text-red-500" />;
            default:
                return <Search className="h-3 w-3 text-gray-500" />;
        }
    };

    const getEventLabel = (event: SessionEvent) => {
        const { type, data } = event;
        switch (type) {
            case "session_start":
                return `Session: ${data.model || "Unknown"}`;
            case "session_complete":
                return data.summary ? `✅ ${(data.summary as string).slice(0, 40)}...` : "Session completed";
            case "session_error":
                return `Error: ${(data.error as string)?.slice(0, 30) || "Unknown"}`;
            case "cycle_start":
                return `Cycle #${data.cycle_index}/${data.max_cycles}`;
            case "cycle_end":
                return `Cycle #${data.cycle_index} ${data.passed ? "✓" : "✗"}`;
            case "worker_start":
                return "Worker started";
            case "worker_complete":
                return `Worker: ${(data.summary as string)?.slice(0, 30)}...`;
            case "worker_tool_call":
                return `Tool: ${data.tool_name}`;
            case "worker_tool_result":
                return `Result: ${data.is_error ? "❌ Error" : "✓ OK"}`;
            case "checker_start":
                return "Checker started";
            case "checker_stream":
                return `Checking... (${data.total_length} chars)`;
            case "checker_complete":
                return `Checker: ${data.passed ? "PASS" : "FAIL"}`;
            default:
                return type;
        }
    };

    const formatTime = (timestamp: string) => {
        try {
            const date = new Date(timestamp);
            return date.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        } catch {
            return "";
        }
    };

    const handleEventClick = (event: SessionEvent, index: number) => {
        if (selectedEventIndex === index) {
            onEventSelect?.(null, null);
        } else {
            onEventSelect?.(event, index);
        }
    };

    if (!sessionId) {
        return (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                Start a run to see live events
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-sm font-medium">Live Events</span>
                <Badge variant={connected ? "default" : "secondary"} className="text-xs">
                    {connected ? (
                        <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Live
                        </>
                    ) : (
                        <>
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Offline
                        </>
                    )}
                </Badge>
            </div>

            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
                <div className="p-2 space-y-0.5">
                    {events.length === 0 ? (
                        <div className="text-center text-muted-foreground text-sm py-4">
                            {connected ? "Waiting for events..." : "Connecting..."}
                        </div>
                    ) : (
                        events.map((event, index) => (
                            <div
                                key={index}
                                onClick={() => handleEventClick(event, index)}
                                className={`flex items-center gap-2 text-xs py-1.5 px-2 rounded cursor-pointer transition-colors
                                    ${selectedEventIndex === index
                                        ? "bg-blue-100 dark:bg-blue-900/40 border-l-2 border-blue-500"
                                        : "hover:bg-muted/50"
                                    }`}
                            >
                                <span className="text-muted-foreground whitespace-nowrap text-[10px]">
                                    {formatTime(event.timestamp)}
                                </span>
                                {getEventIcon(event.type)}
                                <span className="flex-1 truncate">
                                    {getEventLabel(event)}
                                </span>
                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// Event Details Component
interface EventDetailsProps {
    event: SessionEvent | null;
}

export function EventDetails({ event }: EventDetailsProps) {
    if (!event) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Click an event to view details
            </div>
        );
    }

    // Special rendering for session_complete with output data
    if (event.type === "session_complete" && (event.data.text_content || event.data.files)) {
        const files = event.data.files as string[] || [];
        return (
            <div className="flex flex-col h-full overflow-hidden">
                <div className="px-4 py-3 border-b bg-green-50 dark:bg-green-900/20">
                    <h3 className="font-semibold text-green-700 dark:text-green-300">
                        ✅ 任务完成
                    </h3>
                    {event.data.summary && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                            {String(event.data.summary)}
                        </p>
                    )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Text Output */}
                    {event.data.text_content && (
                        <div>
                            <h4 className="text-sm font-medium mb-2">📝 输出结果</h4>
                            <pre className="whitespace-pre-wrap text-sm bg-muted p-3 rounded">
                                {String(event.data.text_content)}
                            </pre>
                        </div>
                    )}

                    {/* File List */}
                    {files.length > 0 && (
                        <div>
                            <h4 className="text-sm font-medium mb-2">📁 生成的文件 ({files.length})</h4>
                            <ul className="space-y-1 bg-muted p-3 rounded">
                                {files.map((file, i) => (
                                    <li key={i} className="text-sm text-blue-600 dark:text-blue-400 font-mono">
                                        📄 {typeof file === 'string' ? file.split('/').pop() : file}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* User Instructions */}
                    {event.data.instruction_to_user && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800">
                            <h4 className="text-sm font-medium text-blue-700 dark:text-blue-300">
                                💡 下一步
                            </h4>
                            <p className="text-sm mt-1">{String(event.data.instruction_to_user)}</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const renderValue = (value: unknown, depth = 0): React.ReactNode => {
        if (value === null || value === undefined) {
            return <span className="text-muted-foreground">null</span>;
        }
        if (typeof value === "boolean") {
            return <span className={value ? "text-green-600" : "text-red-600"}>{String(value)}</span>;
        }
        if (typeof value === "number") {
            return <span className="text-blue-600">{value}</span>;
        }
        if (typeof value === "string") {
            if (value.length > 200) {
                return <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded mt-1">{value}</pre>;
            }
            return <span className="text-emerald-600">&quot;{value}&quot;</span>;
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return <span className="text-muted-foreground">[]</span>;
            return (
                <div className="ml-4">
                    {value.map((item, i) => (
                        <div key={i} className="flex items-start gap-1">
                            <span className="text-muted-foreground">{i}:</span>
                            {renderValue(item, depth + 1)}
                        </div>
                    ))}
                </div>
            );
        }
        if (typeof value === "object") {
            const entries = Object.entries(value as Record<string, unknown>);
            if (entries.length === 0) return <span className="text-muted-foreground">{"{}"}</span>;
            return (
                <div className={depth > 0 ? "ml-4" : ""}>
                    {entries.map(([k, v]) => (
                        <div key={k} className="flex items-start gap-1 py-0.5">
                            <span className="text-purple-600 font-medium">{k}:</span>
                            {renderValue(v, depth + 1)}
                        </div>
                    ))}
                </div>
            );
        }
        return String(value);
    };

    const getEventTitle = (type: string) => {
        switch (type) {
            case "session_start": return "Session Started";
            case "session_complete": return "Session Completed";
            case "session_error": return "Session Error";
            case "cycle_start": return "Cycle Started";
            case "cycle_end": return "Cycle Ended";
            case "worker_start": return "Worker Started";
            case "worker_complete": return "Worker Completed";
            case "worker_tool_call": return "Tool Call";
            case "checker_start": return "Checker Started";
            case "checker_complete": return "Checker Result";
            default: return type;
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-4 py-3 border-b">
                <h3 className="font-semibold">{getEventTitle(event.type)}</h3>
                <p className="text-xs text-muted-foreground">
                    {new Date(event.timestamp).toLocaleString()}
                </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
                <div className="text-sm">{renderValue(event.data)}</div>
            </div>
        </div>
    );
}
