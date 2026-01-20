// Basic types
export interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    events?: any[]; // Store raw events for detailed view
    isStreaming?: boolean; // Whether message is still receiving content
    usage?: TokenUsage; // Token usage for this message
    blocks?: MessageBlock[]; // Content blocks for structured rendering
}

export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
}

// Block status lifecycle
export type BlockStatus = 'streaming' | 'pending' | 'executing' | 'success' | 'error';

// Block types
export type BlockType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'plan' | 'error' | 'ask_user';

// Message block for structured content rendering
export interface MessageBlock {
    id: string;
    type: BlockType;
    content: any;
    status: BlockStatus;
    metadata?: {
        toolName?: string;
        toolCallId?: string;
        requiresPermission?: boolean;
        todos?: TodoItem[];
        isPlaceholder?: boolean;  // Used for thinking placeholder blocks
        requestId?: string;  // Used for AskUserQuestion blocks
        isStreaming?: boolean;  // Used for tool input streaming
    };
}

// Todo item for plan blocks
export interface TodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}

export interface AgentStep {
    id: string;
    type: "thinking" | "tool_use" | "tool_result" | "text" | "error" | "tool_input_start" | "tool_input_delta";
    content: any;
    metadata?: any;
    timestamp: number;
}

// Session types for multi-turn conversations
export interface Session {
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    message_count: number;
    last_model_name?: string;
    last_endpoint_name?: string;
}

export interface SessionDetail extends Session {
    messages: Message[];
    sdk_session_id?: string;
}
