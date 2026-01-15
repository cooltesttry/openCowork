"use client";

import { useEffect, useState } from "react";
import { fetchConfig, toggleMcpServer, toggleSearch } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Server, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MCPServer {
    name: string;
    type: "stdio" | "sse" | "http" | "sdk";
    enabled: boolean;
    command?: string;
    args?: string[];
    url?: string;
}

interface SearchConfig {
    provider: "serper" | "tavily" | "brave" | "none";
    api_key: string | null;
    enabled: boolean;
}

export function McpSidebarPanel() {
    const [servers, setServers] = useState<MCPServer[]>([]);
    const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<string | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const [mcpData, searchData] = await Promise.all([
                fetchConfig<MCPServer[]>("/mcp"),
                fetchConfig<SearchConfig>("/search"),
            ]);
            setServers(mcpData);
            setSearchConfig(searchData);
        } catch (err) {
            console.error("Failed to load data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleToggleMcp = async (name: string) => {
        setToggling(name);
        try {
            const result = await toggleMcpServer(name);
            setServers((prev) =>
                prev.map((s) =>
                    s.name === name ? { ...s, enabled: result.enabled } : s
                )
            );
            toast.success(result.enabled ? "已激活" : "已关闭", {
                description: `MCP Server: ${name}`,
            });
        } catch (err) {
            toast.error("切换失败", { description: String(err) });
        } finally {
            setToggling(null);
        }
    };

    const handleToggleSearch = async () => {
        if (!searchConfig) return;
        setToggling("search");
        try {
            const result = await toggleSearch();
            setSearchConfig((prev) => prev ? { ...prev, enabled: result.enabled } : null);
            toast.success(result.enabled ? "已激活" : "已关闭", {
                description: "搜索工具",
            });
        } catch (err) {
            toast.error("切换失败", { description: String(err) });
        } finally {
            setToggling(null);
        }
    };

    // Check if search is configured (has provider and api_key)
    const isSearchConfigured = searchConfig &&
        searchConfig.provider !== "none" &&
        searchConfig.api_key;

    // Count enabled items
    const searchEnabled = isSearchConfigured && searchConfig.enabled ? 1 : 0;
    const mcpEnabled = servers.filter((s) => s.enabled).length;
    const totalItems = (isSearchConfigured ? 1 : 0) + servers.length;
    const enabledCount = searchEnabled + mcpEnabled;

    return (
        <div className="h-full flex flex-col bg-card/50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-card/80 backdrop-blur">
                <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-semibold text-sm">MCP Servers</h2>
                    <Badge variant="secondary" className="text-xs">
                        {enabledCount}/{totalItems}
                    </Badge>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={loadData}
                    disabled={loading}
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {/* Server List */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
                {loading && servers.length === 0 ? (
                    <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                        加载中...
                    </div>
                ) : !isSearchConfigured && servers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground gap-2">
                        <Server className="h-8 w-8 opacity-30" />
                        <span>暂无 MCP Server</span>
                        <span className="text-xs">请在设置中添加</span>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {/* Search Tool - Always First when configured */}
                        {isSearchConfigured && searchConfig && (
                            <div
                                className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${searchConfig.enabled
                                        ? "bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20"
                                        : "bg-muted/30 hover:bg-muted/50 opacity-60"
                                    }`}
                            >
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
                                    <div className="flex items-center gap-2">
                                        <Search className={`h-3.5 w-3.5 ${searchConfig.enabled ? "text-blue-500" : "text-muted-foreground"
                                            }`} />
                                        <span className={`font-medium text-sm truncate ${searchConfig.enabled ? "text-foreground" : "text-muted-foreground"
                                            }`}>
                                            搜索工具
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] px-1.5 py-0 ${searchConfig.enabled
                                                    ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                                                    : "opacity-50"
                                                }`}
                                        >
                                            {searchConfig.provider}
                                        </Badge>
                                    </div>
                                    <span className="text-xs text-muted-foreground truncate">
                                        search-tools (内置)
                                    </span>
                                </div>
                                <Switch
                                    checked={searchConfig.enabled}
                                    onCheckedChange={handleToggleSearch}
                                    disabled={toggling === "search"}
                                    className="shrink-0"
                                />
                            </div>
                        )}

                        {/* Regular MCP Servers */}
                        {servers.map((server) => (
                            <div
                                key={server.name}
                                className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${server.enabled
                                        ? "bg-primary/5 hover:bg-primary/10"
                                        : "bg-muted/30 hover:bg-muted/50 opacity-60"
                                    }`}
                            >
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-medium text-sm truncate ${server.enabled ? "text-foreground" : "text-muted-foreground"
                                            }`}>
                                            {server.name}
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] px-1.5 py-0 ${server.enabled ? "" : "opacity-50"
                                                }`}
                                        >
                                            {server.type}
                                        </Badge>
                                    </div>
                                    <span className="text-xs text-muted-foreground truncate">
                                        {server.type === "stdio"
                                            ? `${server.command || ""} ${(server.args || []).join(" ")}`.trim() || "—"
                                            : server.url || "—"}
                                    </span>
                                </div>
                                <Switch
                                    checked={server.enabled}
                                    onCheckedChange={() => handleToggleMcp(server.name)}
                                    disabled={toggling === server.name}
                                    className="shrink-0"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t text-xs text-muted-foreground text-center">
                仅激活的服务器会被 Agent 调用
            </div>
        </div>
    );
}
