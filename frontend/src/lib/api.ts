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


export const API_ROOT = "http://localhost:8000/api";
export const WORKSPACE_API_BASE = "http://localhost:8000/api/workspace";

export async function saveFile(path: string, content: string): Promise<any> {
    const res = await fetch(`${API_ROOT}/files/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
    });
    if (!res.ok) throw new Error("Failed to save file");
    return res.json();
}

// ============== File Attachment Upload ==============

export interface UploadAttachmentResponse {
    status: string;
    absolute_path: string;
    relative_path: string;
    original_name: string;
    size: number;
}

export async function uploadAttachment(file: File): Promise<UploadAttachmentResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_ROOT}/files/upload-attachment`, {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(err.detail || 'Failed to upload attachment');
    }
    return res.json();
}

// ============== Path Resolution ==============

export interface ResolvePathResponse {
    status: string;
    absolute_path: string;
    relative_path: string;
    is_directory: boolean;
}

export async function resolvePath(relativePath: string): Promise<ResolvePathResponse> {
    const res = await fetch(`${API_ROOT}/files/resolve-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relativePath }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Path resolution failed' }));
        throw new Error(err.detail || 'Failed to resolve path');
    }
    return res.json();
}


// ============== Skills & Agents ==============
export interface SkillsCatalogEntry {
    skill_id: string;
    name: string;
    description?: string;
    source?: {
        type?: string;
        id?: string;
        repo_url?: string | null;
        path?: string | null;
        ref?: string | null;
        fetched_at?: string | null;
    };
    content?: {
        hash?: string;
        file_count?: number;
        size_bytes?: number;
    };
    risk?: {
        level?: string;
        signals?: string[];
    };
    dependency_hints?: {
        summary?: string;
        signals?: Array<{
            kind?: string;
            value?: string;
            confidence?: string;
        }>;
    };
    status?: {
        state?: string;
        reason?: string;
    };
    timestamps?: {
        imported_at?: string;
        updated_at?: string;
    };
    local?: Record<string, any>;
}

export interface SkillsCatalog {
    schema_version: number;
    generated_at: string;
    skills: Record<string, SkillsCatalogEntry>;
    sources?: Record<string, number>;
}

export interface SkillsCatalogResponse {
    status: string;
    catalog: SkillsCatalog;
    path: string;
    skills_dir: string;
}

export async function fetchSkillsCatalog(): Promise<SkillsCatalogResponse> {
    const res = await fetch(`${API_ROOT}/skills/catalog`);
    if (!res.ok) throw new Error("Failed to fetch skills catalog");
    return res.json();
}

export async function rebuildSkillsCatalog(): Promise<SkillsCatalogResponse> {
    const res = await fetch(`${API_ROOT}/skills/catalog/rebuild`, {
        method: "POST",
    });
    if (!res.ok) throw new Error("Failed to rebuild skills catalog");
    return res.json();
}

export interface SkillSourceSearchResult {
    name: string;
    slug: string;
    source?: string;
    package: string;
    installs?: number | string;
    detail_url?: string;
}

export interface SkillSourceSearchResponse {
    status: string;
    source: string;
    results: SkillSourceSearchResult[];
}

export async function searchSkillSources(options: {
    source: string;
    query?: string;
    page?: number;
    limit?: number;
}): Promise<SkillSourceSearchResponse> {
    const params = new URLSearchParams();
    params.set("source", options.source);
    if (options.query) params.set("query", options.query);
    if (options.page) params.set("page", options.page.toString());
    if (options.limit) params.set("limit", options.limit.toString());
    const res = await fetch(`${API_ROOT}/skills/sources/search?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to search skill sources");
    return res.json();
}

export async function installSkillFromSource(payload: {
    package: string;
    skill?: string | null;
    full_depth?: boolean;
}): Promise<{ status: string; installed: string[]; catalog: SkillsCatalog }> {
    const res = await fetch(`${API_ROOT}/skills/sources/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to install skill");
    return res.json();
}

export async function removeSkillFromLibrary(payload: { skill_id: string }): Promise<{ status: string; catalog: SkillsCatalog }> {
    const res = await fetch(`${API_ROOT}/skills/library/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to remove skill");
    return res.json();
}

export interface SkillInfo {
    name: string;
    path: string;
    source: 'user' | 'project';
    isLoaded?: boolean;  // Whether currently loaded by SDK
}

export interface WorkspaceSkillInfo {
    id: string;
    name: string;
    description?: string;
    path: string;
}

export interface WorkspaceSkillsResponse {
    skills: WorkspaceSkillInfo[];
    workdir?: string;
    status?: string;
    mode?: string;
}

export interface WorkspaceMcpServer {
    id: string;
    name: string;
    type: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    enabled?: boolean;
}

export interface WorkspaceMcpResponse {
    servers: WorkspaceMcpServer[];
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

export async function fetchWorkspaceSkills(workspaceId: string): Promise<WorkspaceSkillsResponse> {
    const res = await fetch(`${WORKSPACE_API_BASE}/${workspaceId}/skills`);
    if (!res.ok) throw new Error("Failed to fetch workspace skills");
    return res.json();
}

export async function addWorkspaceSkill(workspaceId: string, skillId: string): Promise<WorkspaceSkillsResponse> {
    const res = await fetch(`${WORKSPACE_API_BASE}/${workspaceId}/skills/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_id: skillId }),
    });
    if (!res.ok) throw new Error("Failed to add workspace skill");
    return res.json();
}

export async function removeWorkspaceSkill(workspaceId: string, skillId: string): Promise<WorkspaceSkillsResponse> {
    const res = await fetch(`${WORKSPACE_API_BASE}/${workspaceId}/skills/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_id: skillId }),
    });
    if (!res.ok) throw new Error("Failed to remove workspace skill");
    return res.json();
}

export async function fetchWorkspaceMcpServers(workspaceId: string): Promise<WorkspaceMcpResponse> {
    const res = await fetch(`${WORKSPACE_API_BASE}/${workspaceId}/mcp-servers`);
    if (!res.ok) throw new Error("Failed to fetch workspace MCP servers");
    return res.json();
}

export async function addWorkspaceMcpServer(
    workspaceId: string,
    mcpId: string
): Promise<WorkspaceMcpResponse> {
    const res = await fetch(`${WORKSPACE_API_BASE}/${workspaceId}/mcp-servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: mcpId }),
    });
    if (!res.ok) throw new Error("Failed to add workspace MCP server");
    return res.json();
}

export async function disableWorkspaceMcpServer(workspaceId: string, mcpId: string): Promise<WorkspaceMcpResponse> {
    const res = await fetch(`${WORKSPACE_API_BASE}/${workspaceId}/mcp-servers/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: mcpId }),
    });
    if (!res.ok) throw new Error("Failed to disable workspace MCP server");
    return res.json();
}

export async function fetchGlobalMcpServers(): Promise<WorkspaceMcpServer[]> {
    const res = await fetch(`${API_BASE}/mcp`);
    if (!res.ok) throw new Error("Failed to fetch global MCP servers");
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
    checker_id: string;
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


// ============== File Picker ==============

export interface CommonDirectory {
    name: string;
    path: string;
    icon: string;
}

export interface FilePickerItem {
    name: string;
    path: string;
    is_directory: boolean;
    size: number | null;
    modified_at: number;
}

export interface ListFilesAbsoluteResponse {
    files: FilePickerItem[];
    current_path: string;
    parent_path: string | null;
}

export async function fetchCommonDirectories(): Promise<{ directories: CommonDirectory[] }> {
    const res = await fetch(`${API_ROOT}/files/common-directories`);
    if (!res.ok) throw new Error("Failed to fetch common directories");
    return res.json();
}

export async function listFilesAbsolute(path: string = "", showHidden: boolean = false): Promise<ListFilesAbsoluteResponse> {
    const params = new URLSearchParams();
    if (path) params.append("path", path);
    if (showHidden) params.append("show_hidden", "true");

    const res = await fetch(`${API_ROOT}/files/list-absolute?${params.toString()}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to list files" }));
        throw new Error(err.detail || "Failed to list files");
    }
    return res.json();
}

export async function createDirectoryAbsolute(path: string): Promise<{ status: string; path: string }> {
    const res = await fetch(`${API_ROOT}/files/create-directory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, is_directory: true }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to create directory" }));
        throw new Error(err.detail || "Failed to create directory");
    }
    return res.json();
}


// ============== Base64 File Operations ==============

export async function writeBase64File(path: string, base64Data: string): Promise<{ status: string; path: string }> {
    const res = await fetch(`${API_ROOT}/files/write-base64`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, base64_data: base64Data }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to write file" }));
        throw new Error(err.detail || "Failed to write file");
    }
    return res.json();
}


// ============== Image Generation ==============

export interface GenerateImageRequest {
    prompt: string;
    filename?: string;
    reference_images?: string[];  // List of data URLs
}

export interface GenerateImageResponse {
    status: string;
    file_path: string;
    mime_type: string;
    width: number;
    height: number;
    note?: string;
}

export async function generateImage(request: GenerateImageRequest): Promise<GenerateImageResponse> {
    const res = await fetch(`${API_ROOT}/imagegen/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to generate image" }));
        throw new Error(err.detail || "Failed to generate image");
    }
    return res.json();
}
