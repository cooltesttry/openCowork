/**
 * File Watcher Client - WebSocket client for receiving file change notifications.
 * Connects to /api/files/ws/watch endpoint.
 */

export interface FileChangeEvent {
    type: "file_change";
    action: "created" | "deleted" | "modified" | "moved";
    path: string;
    is_directory: boolean;
    timestamp: number;
}

export interface FilesChangedEvent {
    type: "files_changed";
    changes: FileChangeEvent[];
    timestamp: number;
}

export type FileWatchEvent = FileChangeEvent | FilesChangedEvent;

type FileWatchCallback = (event: FileWatchEvent) => void;

export class FileWatcherClient {
    private ws: WebSocket | null = null;
    private url: string;
    private onChangeCallback: FileWatchCallback | null = null;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isConnecting = false;
    private shouldReconnect = true;
    private pingInterval: ReturnType<typeof setInterval> | null = null;

    constructor(url: string = "ws://localhost:8000/api/files/ws/watch") {
        this.url = url;
    }

    /**
     * Connect to the file watcher WebSocket and register a callback for file changes.
     */
    connect(onChange: FileWatchCallback): void {
        this.onChangeCallback = onChange;
        this.shouldReconnect = true;
        this.doConnect();
    }

    private doConnect(): void {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        this.isConnecting = true;

        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log("[FileWatcher] Connected");
                this.isConnecting = false;

                // Start ping interval to keep connection alive
                this.startPingInterval();
            };

            this.ws.onmessage = (event: MessageEvent) => {
                this.handleMessage(event);
            };

            this.ws.onclose = () => {
                console.log("[FileWatcher] Disconnected");
                this.isConnecting = false;
                this.stopPingInterval();

                if (this.shouldReconnect) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = () => {
                // WebSocket errors are often transient during page reload/navigation
                // The onclose handler will trigger reconnection if needed
                console.warn("[FileWatcher] WebSocket connection issue (will reconnect)");
                this.isConnecting = false;
            };
        } catch (error) {
            console.error("[FileWatcher] Failed to create WebSocket:", error);
            this.isConnecting = false;

            if (this.shouldReconnect) {
                this.scheduleReconnect();
            }
        }
    }

    /**
     * Disconnect from the file watcher.
     */
    disconnect(): void {
        this.shouldReconnect = false;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.stopPingInterval();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.onChangeCallback = null;
        console.log("[FileWatcher] Disconnected (manual)");
    }

    private handleMessage(event: MessageEvent): void {
        try {
            const data = JSON.parse(event.data) as FileWatchEvent | { type: "pong" };

            // Ignore pong responses
            if (data.type === "pong") {
                return;
            }

            console.log("[FileWatcher] Received event:", data.type, data);

            if (this.onChangeCallback && (data.type === "file_change" || data.type === "files_changed")) {
                this.onChangeCallback(data as FileWatchEvent);
            }
        } catch (error) {
            console.error("[FileWatcher] Failed to parse message:", error);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout) {
            return;
        }

        console.log("[FileWatcher] Scheduling reconnect in 3s...");
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.doConnect();
        }, 3000);
    }

    private startPingInterval(): void {
        this.stopPingInterval();

        // Send ping every 30 seconds to keep connection alive
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send("ping");
            }
        }, 30000);
    }

    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Check if the client is connected.
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
export const fileWatcherClient = new FileWatcherClient();
