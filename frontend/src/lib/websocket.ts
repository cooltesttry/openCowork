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
 * SessionClient for multi-turn conversations.
 * Uses /ws/session endpoint with ClaudeSDKClient on backend.
 * Maintains conversation context across multiple messages within the same connection.
 */
export class SessionClient {
    private ws: WebSocket | null = null;
    private url: string;
    private isConnected = false;

    constructor(url: string = "ws://localhost:8000/api/ws/session") {
        this.url = url;
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
        this.ws = new WebSocket(this.url);

        const timeout = setTimeout(() => {
            if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                this.ws.close();
                reject(new Error("Connection timeout"));
            }
        }, 10000);  // Longer timeout for session init

        this.ws.onopen = () => {
            clearTimeout(timeout);
            console.log("Session WebSocket connected (multi-turn mode)");
            this.isConnected = true;
            resolve();
        };

        this.ws.onclose = () => {
            clearTimeout(timeout);
            console.log("Session WebSocket disconnected");
            this.isConnected = false;
            this.ws = null;
        };

        this.ws.onerror = (error) => {
            clearTimeout(timeout);
            console.error("Session WebSocket error:", error);
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
            throw new Error("Failed to connect to Session WebSocket");
        }
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
        console.log("Sent user_response for:", requestId);
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
        console.log("Sent permission_response for:", requestId, "approved:", approved);
    }
}

export const sessionClient = new SessionClient();
