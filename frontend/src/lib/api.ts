export const API_BASE = "http://localhost:8000/api/config";

export async function fetchConfig<T>(endpoint: string): Promise<T> {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new Error(`Failed to fetch ${endpoint}`);
    return res.json();
}

export async function updateConfig<T>(endpoint: string, data: any): Promise<T> {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update ${endpoint}`);
    return res.json();
}

export async function addMcpServer(data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to add MCP server");
    return res.json();
}

export async function deleteMcpServer(name: string): Promise<any> {
    const res = await fetch(`${API_BASE}/mcp/${encodeURIComponent(name)}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete MCP server ${name}`);
    return res.json();
}

export async function toggleMcpServer(name: string): Promise<{ status: string; enabled: boolean; name: string }> {
    const res = await fetch(`${API_BASE}/mcp/${encodeURIComponent(name)}/toggle`, {
        method: "PATCH",
    });
    if (!res.ok) throw new Error(`Failed to toggle MCP server ${name}`);
    return res.json();
}

export async function toggleSearch(): Promise<{ status: string; enabled: boolean }> {
    const res = await fetch(`${API_BASE}/search/toggle`, {
        method: "PATCH",
    });
    if (!res.ok) throw new Error("Failed to toggle search");
    return res.json();
}

export async function fetchModels(config: any): Promise<string[]> {
    const res = await fetch(`${API_BASE}/model/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    });
    if (!res.ok) {
        try {
            const err = await res.json();
            throw new Error(err.detail || "Failed to fetch models");
        } catch (e) {
            throw new Error("Failed to fetch models");
        }
    }
    const data = await res.json();
    return data.models || [];
}

// ============== Agent Config ==============

export interface AgentConfig {
    allowed_tools: string[];
    max_turns: number;
    default_workdir: string | null;
}

export async function fetchAgentConfig(): Promise<AgentConfig> {
    const res = await fetch(`${API_BASE}/agent`);
    if (!res.ok) throw new Error("Failed to fetch agent config");
    return res.json();
}

// ============== File Listing ==============

export interface FileListItem {
    name: string;
    path: string;
    is_directory: boolean;
}

export interface FileListResponse {
    status: string;
    files: FileListItem[];
    workdir?: string;
    detail?: string;
}

export async function fetchWorkingDirectoryFiles(subdir: string = ""): Promise<FileListResponse> {
    const url = subdir
        ? `${API_BASE}/files?subdir=${encodeURIComponent(subdir)}`
        : `${API_BASE}/files`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch files");
    return res.json();
}


const API_ROOT = "http://localhost:8000/api";

export async function saveFile(path: string, content: string): Promise<any> {
    const res = await fetch(`${API_ROOT}/files/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
    });
    if (!res.ok) throw new Error("Failed to save file");
    return res.json();
}


// ============== Skills & Agents ==============

export interface SkillInfo {
    name: string;
    path: string;
    source: 'user' | 'project';
    isLoaded?: boolean;  // Whether currently loaded by SDK
}

export interface SubagentInfo {
    name: string;
    path?: string;
    source: 'user' | 'project' | 'builtin';
    is_builtin: boolean;
    isLoaded?: boolean;  // Whether currently loaded by SDK
}

export interface SkillsAgentsResponse {
    skills: SkillInfo[];
    agents: SubagentInfo[];
    workdir?: string;
}

export interface WarmupResponse {
    status: string;
    session_id: string;
    skills: string[];
    agents: string[];
    tools: string[];
    slash_commands: string[];
    detail?: string;
}

export async function fetchSkillsAgents(): Promise<SkillsAgentsResponse> {
    const res = await fetch(`${API_BASE}/skills-agents`);
    if (!res.ok) throw new Error("Failed to fetch skills and agents");
    return res.json();
}

export async function warmupSession(options: {
    session_id?: string;
    endpoint_name?: string;
    model_name?: string;
    cwd?: string;
}): Promise<WarmupResponse> {
    const res = await fetch(`${API_ROOT}/session/warmup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error("Failed to warmup session");
    return res.json();
}


// ============== Worker Templates ==============

export interface WorkerConfig {
    id: string;
    name: string;
    model: string;
    provider?: string;
    api_key?: string;
    endpoint?: string;
    mcp_inherit_system?: boolean;
    mcp_selected?: string[];
    mcp_servers?: object;
    prompt?: {
        system?: string;
        user?: string;
    };
    tools_allow?: string[];
    tools_block?: string[];
    env?: Record<string, string>;
    cwd?: string;
    max_turns?: number;
    max_tokens?: number;
    max_thinking_tokens?: number;
    setting_sources?: string[];
    permission_mode?: string;
    include_partial_messages?: boolean;
    output_format?: object;
    preserve_context?: boolean;
}

export interface WorkersListResponse {
    status: string;
    workers: WorkerConfig[];
}

export interface WorkerResponse {
    status: string;
    worker: WorkerConfig;
}

export interface WorkerValidationResponse {
    valid: boolean;
    errors?: string[];
}

export async function listWorkers(): Promise<WorkersListResponse> {
    const res = await fetch(`${API_ROOT}/agents/`);
    if (!res.ok) throw new Error("Failed to list workers");
    return res.json();
}

export async function getWorker(id: string): Promise<WorkerResponse> {
    const res = await fetch(`${API_ROOT}/agents/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Failed to get worker ${id}`);
    return res.json();
}

export async function createWorker(config: WorkerConfig): Promise<{ status: string; id: string }> {
    const res = await fetch(`${API_ROOT}/agents/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create worker");
    }
    return res.json();
}

export async function updateWorker(id: string, config: WorkerConfig): Promise<{ status: string; id: string }> {
    const res = await fetch(`${API_ROOT}/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update worker");
    }
    return res.json();
}

export async function deleteWorker(id: string): Promise<{ status: string; id: string }> {
    const res = await fetch(`${API_ROOT}/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to delete worker");
    }
    return res.json();
}

export async function validateWorker(config: Partial<WorkerConfig>): Promise<WorkerValidationResponse> {
    const res = await fetch(`${API_ROOT}/agents/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error("Failed to validate worker");
    return res.json();
}


// ============== Super Agent ==============

export interface SuperAgentRunRequest {
    task_objective: string;
    worker_id: string;
    max_cycles?: number;
    initial_input?: Record<string, unknown>;
}

export interface SuperAgentRunResponse {
    session_id: string;
}

export interface SuperAgentCycleResult {
    status: string;
    summary: string;
    output: Record<string, unknown>;
    artifacts: string[];
    error: string | null;
}

export interface SuperAgentCycle {
    cycle_index: number;
    started_at: string;
    ended_at: string;
    result: SuperAgentCycleResult;
    passed: boolean;
    checker_reason: string | null;
}

export interface SuperAgentSession {
    session_id: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    cycle_count: number;
    max_cycles: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    history: SuperAgentCycle[];
}

export interface SuperAgentSessionSummary {
    session_id: string;
    status: string;
    cycle_count: number;
    created_at: string;
}

export async function startSuperAgentRun(request: SuperAgentRunRequest): Promise<SuperAgentRunResponse> {
    const res = await fetch(`${API_ROOT}/super-agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to start Super Agent run" }));
        throw new Error(err.detail || "Failed to start Super Agent run");
    }
    return res.json();
}

export async function getSuperAgentSession(sessionId: string): Promise<SuperAgentSession> {
    const res = await fetch(`${API_ROOT}/super-agent/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Session not found" }));
        throw new Error(err.detail || "Session not found");
    }
    return res.json();
}

export async function cancelSuperAgentSession(sessionId: string): Promise<{ session_id: string; status: string }> {
    const res = await fetch(`${API_ROOT}/super-agent/session/${encodeURIComponent(sessionId)}/cancel`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to cancel session" }));
        throw new Error(err.detail || "Failed to cancel session");
    }
    return res.json();
}

export async function listSuperAgentSessions(): Promise<{ sessions: SuperAgentSessionSummary[] }> {
    const res = await fetch(`${API_ROOT}/super-agent/sessions`);
    if (!res.ok) throw new Error("Failed to list Super Agent sessions");
    return res.json();
}

