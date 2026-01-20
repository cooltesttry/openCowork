// Event types including new incremental streaming events
export type EventType =
    | "start"           // Stream started
    | "done"            // Stream completed
    | "error"           // Error occurred
    | "thinking"        // Complete thinking block (legacy)
    | "thinking_start"  // Thinking block started (streaming)
    | "thinking_delta"  // Incremental thinking content (streaming)
    | "thinking_end"    // Thinking block finished (streaming)
    | "text"            // Complete text block (legacy)
    | "text_start"      // Text block started
    | "text_delta"      // Incremental text content
    | "text_end"        // Text block finished
    | "tool_use"        // Tool invocation
    | "tool_result"     // Tool result
    | "tool_input_start"   // Tool input streaming started
    | "tool_input_delta"   // Tool input streaming delta
    | "tool_input_end"     // Tool input streaming ended
    | "todos"              // Todo list from SystemMessage
    | "ask_user"           // Claude is asking the user a question
    | "permission_request";  // Tool permission request for user approval

// AskUserQuestion types
export interface AskUserOption {
    label: string;
    description?: string;
}

export interface AskUserQuestionItem {
    question: string;
    header?: string;
    options: AskUserOption[];
    multiSelect: boolean;
}

export interface AskUserContent {
    request_id: string;
    questions: AskUserQuestionItem[];
    timeout: number;
}

export interface StreamEvent {
    type: EventType;
    content: any;
    metadata: Record<string, any>;
    id?: string;         // Block ID for streaming events
    usage?: {            // Token usage (on "done" event)
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
    };
}

export interface ChatMessage {
    content: string;
    cwd?: string;
    session_id?: string;  // Session ID for multi-turn context
    endpoint_name?: string;  // Override endpoint for this query
    model_name?: string;  // Override model for this query
    security_mode?: 'default' | 'acceptEdits' | 'bypassPermissions';  // Permission mode
}

export class AgentClient {
    private ws: WebSocket | null = null;
    private url: string;
    private messageQueue: ChatMessage[] = [];
    private isConnected = false;

    constructor(url: string = "ws://localhost:8000/api/ws/chat") {
        this.url = url;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Already connected
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            // Already connecting
            if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                // Wait for existing connection attempt
                const checkConnection = setInterval(() => {
                    if (this.ws?.readyState === WebSocket.OPEN) {
                        clearInterval(checkConnection);
                        resolve();
                    } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                        clearInterval(checkConnection);
                        this.ws = null;
                        this.doConnect(resolve, reject);
                    }
                }, 100);
                return;
            }

            this.doConnect(resolve, reject);
        });
    }

    private doConnect(resolve: () => void, reject: (err: any) => void) {
        this.ws = new WebSocket(this.url);

        const timeout = setTimeout(() => {
            if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                this.ws.close();
                reject(new Error("Connection timeout"));
            }
        }, 5000);

        this.ws.onopen = () => {
            clearTimeout(timeout);
            console.log("WebSocket connected");
            this.isConnected = true;
            this.processQueue();
            resolve();
        };

        this.ws.onclose = () => {
            clearTimeout(timeout);
            console.log("WebSocket disconnected");
            this.isConnected = false;
            this.ws = null;
        };

        this.ws.onerror = (error) => {
            clearTimeout(timeout);
            console.error("WebSocket error:", error);
            reject(error);
        };
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }
    }

    async sendMessage(message: ChatMessage, onEvent: (event: StreamEvent) => void): Promise<void> {
        if (!this.isConnected || !this.ws) {
            await this.connect();
        }

        if (this.ws) {
            // Set up temporary listener for this message stream
            const listener = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data) as StreamEvent;
                    onEvent(data);

                    if (data.type === "done" || data.type === "error") {
                        this.ws?.removeEventListener("message", listener);
                    }
                } catch (e) {
                    console.error("Failed to parse event:", e);
                }
            };

            this.ws.addEventListener("message", listener);
            this.ws.send(JSON.stringify(message));
        } else {
            throw new Error("Failed to connect to WebSocket");
        }
    }

    private processQueue() {
        // Implement queue processing if needed for offline support
        // For now, we rely on direct sendMessage calls
    }
}

export const agentClient = new AgentClient();

/**
 * MultiplexedClient for concurrent multi-session conversations with persistence.
 * Uses /ws/multiplexed endpoint with TaskRunner on backend.
 * 
 * Features:
 * - Multiple sessions can execute concurrently
 * - Events are persisted to disk
 * - Supports reconnect/replay via subscribe
 * - Session status tracking (running, completed, unread)
 * 
 * Protocol:
 * - query: Start a new task for a session
 * - subscribe: Subscribe to events from a session (includes replay)
 * - unsubscribe: Unsubscribe from a session
 * - user_response: Respond to AskUserQuestion
 * - permission_response: Respond to permission request
 */
export class MultiplexedClient {
    private ws: WebSocket | null = null;
    private url: string;
    private isConnected = false;
    private eventHandlers: Map<string, (event: StreamEvent) => void> = new Map();
    private globalHandler: ((event: StreamEvent) => void) | null = null;
    private onReconnectCallback: (() => void) | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;

    constructor(url: string = "ws://localhost:8000/api/ws/multiplexed") {
        this.url = url;
    }

    /**
     * Set callback to be called when WebSocket reconnects.
     * Useful for re-subscribing to running sessions.
     */
    setOnReconnect(callback: (() => void) | null) {
        this.onReconnectCallback = callback;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                const checkConnection = setInterval(() => {
                    if (this.ws?.readyState === WebSocket.OPEN) {
                        clearInterval(checkConnection);
                        resolve();
                    } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                        clearInterval(checkConnection);
                        this.ws = null;
                        this.doConnect(resolve, reject);
                    }
                }, 100);
                return;
            }

            this.doConnect(resolve, reject);
        });
    }

    private doConnect(resolve: () => void, reject: (err: any) => void) {
        const isReconnect = this.reconnectAttempts > 0;
        this.ws = new WebSocket(this.url);

        const timeout = setTimeout(() => {
            if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                this.ws.close();
                reject(new Error("Connection timeout"));
            }
        }, 10000);

        this.ws.onopen = () => {
            clearTimeout(timeout);
            console.log("[MultiplexedClient] Connected");
            this.isConnected = true;

            // Clear old subscriptions on reconnect (they're stale)
            if (isReconnect) {
                this.eventHandlers.clear();
                console.log("[MultiplexedClient] Cleared stale subscriptions");

                // Call reconnect callback to re-subscribe
                if (this.onReconnectCallback) {
                    console.log("[MultiplexedClient] Triggering reconnect callback");
                    this.onReconnectCallback();
                }
            }

            this.reconnectAttempts = 0;
            resolve();
        };

        this.ws.onclose = () => {
            clearTimeout(timeout);
            console.log("[MultiplexedClient] Disconnected");
            this.isConnected = false;
            this.ws = null;

            // Auto-reconnect
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = this.reconnectDelay * this.reconnectAttempts;
                console.log(`[MultiplexedClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
                setTimeout(() => {
                    this.connect().catch(console.error);
                }, delay);
            }
        };

        this.ws.onerror = (error) => {
            clearTimeout(timeout);
            console.error("[MultiplexedClient] Error:", error);
            reject(error);
        };

        this.ws.onmessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data) as StreamEvent;
                const sessionId = data.metadata?.session_id;

                // Debug: Log tool_input events
                if (data.type?.startsWith('tool_input')) {
                    console.log('[WebSocket] Tool input event:', data.type, data.id);
                }

                // Route to session-specific handler
                if (sessionId && this.eventHandlers.has(sessionId)) {
                    this.eventHandlers.get(sessionId)!(data);
                }

                // Also call global handler
                if (this.globalHandler) {
                    this.globalHandler(data);
                }
            } catch (e) {
                console.error("[MultiplexedClient] Failed to parse event:", e);
            }
        };
    }

    disconnect() {
        if (this.ws) {
            this.maxReconnectAttempts = 0; // Prevent auto-reconnect
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }
    }

    /**
     * Set a global event handler that receives ALL events.
     */
    setGlobalHandler(handler: (event: StreamEvent) => void) {
        this.globalHandler = handler;
    }

    /**
     * Subscribe to events from a session.
     * This will replay any cached events first, then stream live events.
     */
    async subscribe(sessionId: string, onEvent: (event: StreamEvent) => void): Promise<void> {
        if (!this.isConnected || !this.ws) {
            await this.connect();
        }

        this.eventHandlers.set(sessionId, onEvent);

        if (this.ws) {
            this.ws.send(JSON.stringify({
                type: "subscribe",
                session_id: sessionId,
            }));
            console.log("[MultiplexedClient] Subscribed to:", sessionId);
        }
    }

    /**
     * Unsubscribe from a session's events.
     */
    unsubscribe(sessionId: string): void {
        this.eventHandlers.delete(sessionId);

        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify({
                type: "unsubscribe",
                session_id: sessionId,
            }));
            console.log("[MultiplexedClient] Unsubscribed from:", sessionId);
        }
    }

    /**
     * Send a query to start a new task for a session.
     * The session must be subscribed first to receive events.
     */
    async sendQuery(message: ChatMessage, onEvent: (event: StreamEvent) => void): Promise<void> {
        if (!this.isConnected || !this.ws) {
            await this.connect();
        }

        const sessionId = message.session_id;
        if (sessionId) {
            // Register handler for this session
            this.eventHandlers.set(sessionId, onEvent);
        }

        if (this.ws) {
            this.ws.send(JSON.stringify({
                type: "query",
                ...message,
            }));
            console.log("[MultiplexedClient] Sent query for:", sessionId);

            // Also subscribe to get events
            if (sessionId && !this.eventHandlers.has(sessionId)) {
                await this.subscribe(sessionId, onEvent);
            }
        } else {
            throw new Error("Failed to connect to Multiplexed WebSocket");
        }
    }

    /**
     * Send a message (legacy compatibility - wraps sendQuery).
     */
    async sendMessage(message: ChatMessage, onEvent: (event: StreamEvent) => void): Promise<void> {
        return this.sendQuery(message, onEvent);
    }

    isActive(): boolean {
        return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Send user's response to an AskUserQuestion request.
     */
    sendUserResponse(requestId: string, answers: Record<string, string>): void {
        if (!this.ws || !this.isConnected) {
            console.error("Cannot send user response: WebSocket not connected");
            return;
        }

        this.ws.send(JSON.stringify({
            type: "user_response",
            request_id: requestId,
            answers: answers,
        }));
        console.log("[MultiplexedClient] Sent user_response for:", requestId);
    }

    /**
     * Send user's permission response (approve/deny) for a tool request.
     */
    sendPermissionResponse(requestId: string, approved: boolean): void {
        if (!this.ws || !this.isConnected) {
            console.error("Cannot send permission response: WebSocket not connected");
            return;
        }

        this.ws.send(JSON.stringify({
            type: "permission_response",
            request_id: requestId,
            approved: approved,
        }));
        console.log("[MultiplexedClient] Sent permission_response for:", requestId, "approved:", approved);
    }
}

// Legacy SessionClient - kept for backward compatibility but uses MultiplexedClient internally
export class SessionClient extends MultiplexedClient {
    constructor(url: string = "ws://localhost:8000/api/ws/multiplexed") {
        super(url);
    }
}

export const sessionClient = new SessionClient();
export const multiplexedClient = new MultiplexedClient();

