// Event types including new incremental streaming events
export type EventType =
    | "start"           // Stream started
    | "done"            // Stream completed
    | "error"           // Error occurred
    | "thinking"        // Thinking/reasoning content
    | "text"            // Complete text block (legacy)
    | "text_start"      // Text block started
    | "text_delta"      // Incremental text content
    | "text_end"        // Text block finished
    | "tool_use"        // Tool invocation
    | "tool_result"     // Tool result
    | "tool_input_start"   // Tool input streaming started
    | "tool_input_delta"   // Tool input streaming delta
    | "tool_input_end"     // Tool input streaming ended
    | "todos";             // Todo list from SystemMessage

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
