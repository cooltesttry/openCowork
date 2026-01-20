"use client";

import { useEffect, useState } from "react";
import { fetchConfig, toggleMcpServer, toggleSearch, fetchSkillsAgents, warmupSession, SkillInfo, SubagentInfo } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Server, RefreshCw, Search, FolderOpen, Sparkles, Bot, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as Tabs from "@radix-ui/react-tabs";
import { FileExplorer } from "../file-explorer/file-explorer";

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

interface McpSidebarPanelProps {
    onMentionFile?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    isPreviewPanelActive?: () => boolean;
}

export function McpSidebarPanel({ onMentionFile, onOpenFile, onSelectFile, isPreviewPanelActive }: McpSidebarPanelProps) {
    const [servers, setServers] = useState<MCPServer[]>([]);
    const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<string | null>(null);

    // Skills & Subagents state
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
    const [loadedSkills, setLoadedSkills] = useState<Set<string>>(new Set());
    const [loadedAgents, setLoadedAgents] = useState<Set<string>>(new Set());
    const [skillsLoading, setSkillsLoading] = useState(true);

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

    const loadSkillsAgents = async () => {
        try {
            setSkillsLoading(true);
            // Load filesystem data
            const fsData = await fetchSkillsAgents();
            setSkills(fsData.skills);
            setSubagents(fsData.agents);

            // Try warmup to get loaded skills/agents
            try {
                const warmupData = await warmupSession({});
                if (warmupData.status === "success") {
                    setLoadedSkills(new Set(warmupData.skills));
                    setLoadedAgents(new Set(warmupData.agents));
                }
            } catch (warmupErr) {
                // Warmup may fail if no active session, that's ok
                console.debug("Warmup skipped:", warmupErr);
            }
        } catch (err) {
            console.error("Failed to load skills/agents:", err);
        } finally {
            setSkillsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        loadSkillsAgents();
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

    // Sort skills: loaded first
    const sortedSkills = [...skills].sort((a, b) => {
        const aLoaded = loadedSkills.has(a.name);
        const bLoaded = loadedSkills.has(b.name);
        if (aLoaded && !bLoaded) return -1;
        if (!aLoaded && bLoaded) return 1;
        return a.name.localeCompare(b.name);
    });

    // Sort subagents: loaded first, then builtin
    const sortedAgents = [...subagents].sort((a, b) => {
        const aLoaded = loadedAgents.has(a.name);
        const bLoaded = loadedAgents.has(b.name);
        if (aLoaded && !bLoaded) return -1;
        if (!aLoaded && bLoaded) return 1;
        if (a.is_builtin && !b.is_builtin) return -1;
        if (!a.is_builtin && b.is_builtin) return 1;
        return a.name.localeCompare(b.name);
    });

    return (
        <div className="h-full flex flex-col bg-card/50">
            <Tabs.Root defaultValue="files" className="flex flex-col h-full">
                {/* Tabs Header */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/80 backdrop-blur shrink-0">
                    <Tabs.List className="flex items-center gap-3">
                        <Tabs.Trigger
                            value="files"
                            className="font-medium text-xs data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground transition-colors cursor-pointer outline-none flex items-center gap-1.5"
                        >
                            <FolderOpen className="h-3.5 w-3.5" />
                            Files
                        </Tabs.Trigger>
                        <Tabs.Trigger
                            value="mcp"
                            className="font-medium text-xs data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground transition-colors cursor-pointer outline-none flex items-center gap-1.5"
                        >
                            <Server className="h-3.5 w-3.5" />
                            MCP
                        </Tabs.Trigger>
                        <Tabs.Trigger
                            value="skills"
                            className="font-medium text-xs data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground transition-colors cursor-pointer outline-none flex items-center gap-1.5"
                        >
                            <Sparkles className="h-3.5 w-3.5" />
                            Skills
                        </Tabs.Trigger>
                        <Tabs.Trigger
                            value="agents"
                            className="font-medium text-xs data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground transition-colors cursor-pointer outline-none flex items-center gap-1.5"
                        >
                            <Bot className="h-3.5 w-3.5" />
                            Agents
                        </Tabs.Trigger>
                    </Tabs.List>
                </div>

                {/* MCP Tab Content */}
                <Tabs.Content value="mcp" className="flex flex-col flex-1 overflow-hidden data-[state=inactive]:hidden mt-0">
                    {/* MCP Header Stats & Refresh (Sub-header) */}
                    <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Enabled:</span>
                            <Badge variant="secondary" className="text-xs">
                                {enabledCount}/{totalItems}
                            </Badge>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={loadData}
                            disabled={loading}
                            title="Refresh MCP Config"
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
                </Tabs.Content>

                {/* Skills Tab Content */}
                <Tabs.Content value="skills" className="flex flex-col flex-1 overflow-hidden data-[state=inactive]:hidden mt-0">
                    <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Available:</span>
                            <Badge variant="secondary" className="text-xs">
                                {skills.length}
                            </Badge>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={loadSkillsAgents}
                            disabled={skillsLoading}
                            title="Refresh Skills"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${skillsLoading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 py-2">
                        {skillsLoading && skills.length === 0 ? (
                            <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                                加载中...
                            </div>
                        ) : skills.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground gap-2">
                                <Sparkles className="h-8 w-8 opacity-30" />
                                <span>暂无 Skills</span>
                                <span className="text-xs">在 .claude/skills/ 添加</span>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {sortedSkills.map((skill) => {
                                    const isLoaded = loadedSkills.has(skill.name);
                                    return (
                                        <div
                                            key={skill.name}
                                            className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${isLoaded
                                                ? "bg-green-500/10 hover:bg-green-500/15 border border-green-500/20"
                                                : "bg-muted/30 hover:bg-muted/50"
                                                }`}
                                        >
                                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    {isLoaded && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                                                    <span className="font-medium text-sm truncate">
                                                        {skill.name}
                                                    </span>
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                        {skill.source}
                                                    </Badge>
                                                </div>
                                                <span className="text-xs text-muted-foreground truncate">
                                                    {skill.path}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <div className="px-4 py-2 border-t text-xs text-muted-foreground text-center">
                        Skills 根据上下文自动激活
                    </div>
                </Tabs.Content>

                {/* Agents Tab Content */}
                <Tabs.Content value="agents" className="flex flex-col flex-1 overflow-hidden data-[state=inactive]:hidden mt-0">
                    <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Available:</span>
                            <Badge variant="secondary" className="text-xs">
                                {subagents.length}
                            </Badge>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={loadSkillsAgents}
                            disabled={skillsLoading}
                            title="Refresh Agents"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${skillsLoading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 py-2">
                        {skillsLoading && subagents.length === 0 ? (
                            <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                                加载中...
                            </div>
                        ) : subagents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground gap-2">
                                <Bot className="h-8 w-8 opacity-30" />
                                <span>暂无 Agents</span>
                                <span className="text-xs">在 .claude/agents/ 添加</span>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {sortedAgents.map((agent) => {
                                    const isLoaded = loadedAgents.has(agent.name);
                                    return (
                                        <div
                                            key={agent.name}
                                            className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${isLoaded
                                                ? "bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/20"
                                                : "bg-muted/30 hover:bg-muted/50"
                                                }`}
                                        >
                                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    {isLoaded && <CheckCircle2 className="h-3.5 w-3.5 text-purple-500" />}
                                                    <span className="font-medium text-sm truncate">
                                                        {agent.name}
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[10px] px-1.5 py-0 ${agent.is_builtin ? "border-purple-500/50 text-purple-600 dark:text-purple-400" : ""
                                                            }`}
                                                    >
                                                        {agent.is_builtin ? "builtin" : agent.source}
                                                    </Badge>
                                                </div>
                                                {agent.path && (
                                                    <span className="text-xs text-muted-foreground truncate">
                                                        {agent.path}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <div className="px-4 py-2 border-t text-xs text-muted-foreground text-center">
                        使用 @agent 或 Task 工具调用
                    </div>
                </Tabs.Content>

                {/* Files Tab Content */}
                <Tabs.Content value="files" className="flex-1 overflow-hidden data-[state=inactive]:hidden mt-0">
                    <FileExplorer
                        className="h-full border-0 bg-transparent"
                        onMentionFile={onMentionFile}
                        onOpenFile={onOpenFile}
                        onSelectFile={onSelectFile}
                        isPreviewPanelActive={isPreviewPanelActive}
                    />
                </Tabs.Content>
            </Tabs.Root>
        </div>
    );
}
