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
