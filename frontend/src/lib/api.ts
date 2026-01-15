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
