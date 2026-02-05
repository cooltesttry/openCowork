"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
    fetchWorkspaceSkills,
    addWorkspaceSkill,
    removeWorkspaceSkill,
    fetchSkillsCatalog,
    SkillsCatalogEntry,
    WorkspaceSkillInfo,
    fetchWorkspaceMcpServers,
    addWorkspaceMcpServer,
    disableWorkspaceMcpServer,
    WorkspaceMcpServer,
    fetchGlobalMcpServers,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Server, RefreshCw, Sparkles, Plus, Trash2, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { FileExplorer } from "../file-explorer/file-explorer";
import { useWorkspace } from "@/lib/workspace-store";
import { useChat } from "@/lib/store";
import type { OpenImageOptions } from "@/components/image-editor/types";
import type { FilePanelOpenEntry } from "@/components/panels/file-panel";

interface McpSidebarPanelProps {
    onMentionFile?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    onOpenImage?: (path: string, options?: OpenImageOptions) => void;
    isPreviewPanelActive?: () => boolean;
    externalViewFilter?: "all" | "images" | "documents" | "video" | "audio" | "code";
    externalViewFilterToken?: number;
}

export function McpSidebarPanel({ onMentionFile, onOpenFile, onOpenInPanel, onSelectFile, onOpenImage, isPreviewPanelActive, externalViewFilter, externalViewFilterToken }: McpSidebarPanelProps) {
    const { currentWorkspace } = useWorkspace();
    const { rightPanelView } = useChat();
    const [toolsMode, setToolsMode] = useState<"active" | "add">("active");
    const [addTab, setAddTab] = useState<"mcp" | "skills">("skills");

    const [mcpServers, setMcpServers] = useState<WorkspaceMcpServer[]>([]);
    const [mcpLoading, setMcpLoading] = useState(true);
    const [globalMcpServers, setGlobalMcpServers] = useState<WorkspaceMcpServer[]>([]);
    const [globalMcpLoading, setGlobalMcpLoading] = useState(false);
    const [addingMcpId, setAddingMcpId] = useState<string | null>(null);
    const [removingMcpId, setRemovingMcpId] = useState<string | null>(null);
    const [mcpQuery, setMcpQuery] = useState("");

    // Skills state
    const [skills, setSkills] = useState<WorkspaceSkillInfo[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [libraryQuery, setLibraryQuery] = useState("");
    const [libraryEntries, setLibraryEntries] = useState<SkillsCatalogEntry[]>([]);
    const [addingSkillId, setAddingSkillId] = useState<string | null>(null);
    const [removingSkillId, setRemovingSkillId] = useState<string | null>(null);

    const loadWorkspaceMcp = useCallback(async () => {
        if (!currentWorkspace?.id) {
            setMcpServers([]);
            setMcpLoading(false);
            return;
        }
        try {
            setMcpLoading(true);
            const res = await fetchWorkspaceMcpServers(currentWorkspace.id);
            setMcpServers(res.servers || []);
        } catch (err) {
            console.error("Failed to load workspace MCP:", err);
        } finally {
            setMcpLoading(false);
        }
    }, [currentWorkspace?.id]);

    const loadWorkspaceSkills = useCallback(async () => {
        if (!currentWorkspace?.id) {
            setSkills([]);
            setSkillsLoading(false);
            return;
        }
        try {
            setSkillsLoading(true);
            const res = await fetchWorkspaceSkills(currentWorkspace.id);
            setSkills(res.skills || []);
        } catch (err) {
            console.error("Failed to load workspace skills:", err);
        } finally {
            setSkillsLoading(false);
        }
    }, [currentWorkspace?.id]);

    const loadLibrary = useCallback(async () => {
        try {
            setLibraryLoading(true);
            const res = await fetchSkillsCatalog();
            const entries = Object.values(res.catalog?.skills || {}).filter(
                (entry) => entry.status?.state !== "removed"
            );
            setLibraryEntries(entries);
        } catch (err) {
            console.error("Failed to load skills library:", err);
        } finally {
            setLibraryLoading(false);
        }
    }, []);

    const loadGlobalMcp = useCallback(async () => {
        try {
            setGlobalMcpLoading(true);
            const res = await fetchGlobalMcpServers();
            setGlobalMcpServers(res || []);
        } catch (err) {
            console.error("Failed to load global MCP servers:", err);
        } finally {
            setGlobalMcpLoading(false);
        }
    }, []);

    useEffect(() => {
        loadWorkspaceMcp();
        loadWorkspaceSkills();
    }, [loadWorkspaceMcp, loadWorkspaceSkills]);

    useEffect(() => {
        if (toolsMode === "add") {
            loadLibrary();
            loadGlobalMcp();
        }
    }, [toolsMode, loadLibrary, loadGlobalMcp]);

    const refreshTools = async () => {
        await Promise.all([loadWorkspaceMcp(), loadWorkspaceSkills()]);
    };

    const handleAddMcpFromGlobal = async (server: WorkspaceMcpServer) => {
        if (!currentWorkspace?.id) {
            toast.error("未选择 Workspace");
            return;
        }
        const payload = server.id ? { id: server.id } : { name: server.name };
        setAddingMcpId(server.id || server.name);
        try {
            const res = await addWorkspaceMcpServer(currentWorkspace.id, payload);
            setMcpServers(res.servers || []);
            toast.success("MCP 已添加", { description: server.name });
        } catch (err) {
            toast.error("添加失败", { description: String(err) });
        } finally {
            setAddingMcpId(null);
        }
    };

    const handleDisableMcp = async (idOrName: string, nameHint?: string) => {
        if (!currentWorkspace?.id) {
            toast.error("未选择 Workspace");
            return;
        }
        const payload = nameHint ? { name: nameHint } : { id: idOrName };
        setRemovingMcpId(idOrName);
        try {
            const res = await disableWorkspaceMcpServer(currentWorkspace.id, payload);
            setMcpServers(res.servers || []);
            toast.success("MCP 已停用");
        } catch (err) {
            toast.error("停用失败", { description: String(err) });
        } finally {
            setRemovingMcpId(null);
        }
    };

    const handleAddSkill = async (entry: SkillsCatalogEntry) => {
        if (!currentWorkspace?.id) {
            toast.error("未选择 Workspace");
            return;
        }
        setAddingSkillId(entry.skill_id);
        try {
            const res = await addWorkspaceSkill(currentWorkspace.id, entry.skill_id);
            setSkills(res.skills || []);
            toast.success("Skill 已添加", { description: entry.name });
        } catch (err) {
            toast.error("添加失败", { description: String(err) });
        } finally {
            setAddingSkillId(null);
        }
    };

    const handleRemoveSkill = async (skillId: string) => {
        if (!currentWorkspace?.id) {
            toast.error("未选择 Workspace");
            return;
        }
        setRemovingSkillId(skillId);
        try {
            const res = await removeWorkspaceSkill(currentWorkspace.id, skillId);
            setSkills(res.skills || []);
            toast.success("Skill 已移除");
        } catch (err) {
            toast.error("移除失败", { description: String(err) });
        } finally {
            setRemovingSkillId(null);
        }
    };

    const activeMcpServers = useMemo(() => mcpServers, [mcpServers]);

    const activeMcpIds = useMemo(() => {
        return new Set(activeMcpServers.map((server) => server.id));
    }, [activeMcpServers]);

    const sortedSkills = useMemo(() => {
        return [...skills].sort((a, b) => a.name.localeCompare(b.name));
    }, [skills]);

    const installedSkillIds = useMemo(() => {
        return new Set(skills.map((skill) => skill.id));
    }, [skills]);

    const resolveLibraryEntryId = (entry: SkillsCatalogEntry) => {
        const sourcePath = entry.source?.path || "";
        const parts = sourcePath.split("/").filter(Boolean);
        return parts[parts.length - 1] || entry.name || entry.skill_id;
    };

    const filteredLibraryEntries = useMemo(() => {
        if (!libraryQuery.trim()) return libraryEntries;
        const q = libraryQuery.trim().toLowerCase();
        return libraryEntries.filter((entry) => {
            const name = (entry.name || "").toLowerCase();
            const desc = (entry.description || "").toLowerCase();
            const skillId = (entry.skill_id || "").toLowerCase();
            return name.includes(q) || desc.includes(q) || skillId.includes(q);
        });
    }, [libraryEntries, libraryQuery]);

    const filteredGlobalMcpServers = useMemo(() => {
        if (!mcpQuery.trim()) return globalMcpServers;
        const q = mcpQuery.trim().toLowerCase();
        return globalMcpServers.filter((server) => {
            const name = (server.name || "").toLowerCase();
            const type = (server.type || "").toLowerCase();
            const command = (server.command || "").toLowerCase();
            const url = (server.url || "").toLowerCase();
            return name.includes(q) || type.includes(q) || command.includes(q) || url.includes(q);
        });
    }, [globalMcpServers, mcpQuery]);

    return (
        <div className="h-full flex flex-col bg-card/50">
            {rightPanelView === "files" ? (
                <FileExplorer
                    className="h-full border-0 bg-transparent"
                    onMentionFile={onMentionFile}
                    onOpenFile={onOpenFile}
                    onOpenInPanel={onOpenInPanel}
                    onSelectFile={onSelectFile}
                    onOpenImage={onOpenImage}
                    isPreviewPanelActive={isPreviewPanelActive}
                    workspaceId={currentWorkspace?.id}
                    externalViewFilter={externalViewFilter}
                    externalViewFilterToken={externalViewFilterToken}
                />
            ) : (
                <div className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                                {toolsMode === "active" ? "Active Tools" : "Add Tools"}
                            </span>
                            {toolsMode === "active" && (
                                <Badge variant="secondary" className="text-xs">
                                    {activeMcpServers.length + skills.length}
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    setToolsMode((prev) => {
                                        const next = prev === "active" ? "add" : "active";
                                        if (next === "add") {
                                            setAddTab("skills");
                                        }
                                        return next;
                                    });
                                }}
                                disabled={!currentWorkspace?.id}
                            >
                                {toolsMode === "active" ? (
                                    <>
                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                        Add
                                    </>
                                ) : (
                                    "Back"
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={refreshTools}
                                disabled={mcpLoading || skillsLoading}
                                title="Refresh Tools"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${(mcpLoading || skillsLoading) ? "animate-spin" : ""}`} />
                            </Button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-hidden px-2 py-2">
                        {!currentWorkspace?.id ? (
                            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                请选择 Workspace
                            </div>
                        ) : toolsMode === "add" ? (
                            <div className="h-full flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant={addTab === "mcp" ? "secondary" : "ghost"}
                                        size="sm"
                                        onClick={() => setAddTab("mcp")}
                                    >
                                        MCP
                                    </Button>
                                    <Button
                                        variant={addTab === "skills" ? "secondary" : "ghost"}
                                        size="sm"
                                        onClick={() => setAddTab("skills")}
                                    >
                                        Skills
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="ml-auto h-7 w-7"
                                        onClick={() => setToolsMode("active")}
                                        title="Close"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                {addTab === "mcp" ? (
                                    <div className="flex-1 p-3 space-y-3 flex flex-col">
                                        <Input
                                            value={mcpQuery}
                                            onChange={(e) => setMcpQuery(e.target.value)}
                                            placeholder="搜索 MCP"
                                        />
                                        <div className="flex-1 overflow-y-auto space-y-0.5">
                                            {globalMcpLoading ? (
                                                <div className="text-sm text-muted-foreground">加载中...</div>
                                            ) : filteredGlobalMcpServers.length === 0 ? (
                                                <div className="text-sm text-muted-foreground">暂无可用 MCP 配置。</div>
                                            ) : (
                                                filteredGlobalMcpServers.map((server) => {
                                                    const serverKey = server.id || server.name;
                                                    const installed = server.id ? activeMcpIds.has(server.id) : false;
                                                    const isAdding = addingMcpId === serverKey;
                                                    const isRemoving = removingMcpId === serverKey;
                                                    return (
                                                        <div
                                                            key={serverKey}
                                                            className="flex items-center justify-between gap-2 rounded-md px-3 py-1 hover:bg-muted/30 transition-colors"
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-medium truncate">{server.name}</div>
                                                            </div>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-7 w-7 relative group"
                                                                disabled={isAdding || isRemoving}
                                                                onClick={() => {
                                                                    if (installed) {
                                                                        handleDisableMcp(serverKey, server.id ? undefined : server.name);
                                                                    } else {
                                                                        handleAddMcpFromGlobal(server);
                                                                    }
                                                                }}
                                                            >
                                                                {isAdding || isRemoving ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : installed ? (
                                                                    <span className="relative block h-4 w-4">
                                                                        <Check className="h-4 w-4 transition-opacity group-hover:opacity-0" />
                                                                        <Trash2 className="h-4 w-4 absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
                                                                    </span>
                                                                ) : (
                                                                    <Plus className="h-4 w-4" />
                                                                )}
                                                            </Button>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 p-3 space-y-3 flex flex-col">
                                        <Input
                                            value={libraryQuery}
                                            onChange={(e) => setLibraryQuery(e.target.value)}
                                            placeholder="搜索库里的 Skills"
                                        />
                                        <div className="flex-1 overflow-y-auto space-y-0.5">
                                            {libraryLoading ? (
                                                <div className="text-sm text-muted-foreground">加载中...</div>
                                            ) : filteredLibraryEntries.length === 0 ? (
                                                <div className="text-sm text-muted-foreground">库里暂无可用 Skills。</div>
                                            ) : (
                                                filteredLibraryEntries.map((entry) => {
                                                    const entryId = resolveLibraryEntryId(entry);
                                                    const installed = installedSkillIds.has(entryId);
                                                    const isAdding = addingSkillId === entry.skill_id;
                                                    const isRemoving = removingSkillId === entryId;
                                                    return (
                                                        <div
                                                            key={entry.skill_id}
                                                            className="flex items-center justify-between gap-2 rounded-md px-3 py-1 hover:bg-muted/30 transition-colors"
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-medium truncate">{entry.name}</div>
                                                                <div className="text-xs text-muted-foreground line-clamp-3 leading-snug">
                                                                    {entry.description || "—"}
                                                                </div>
                                                            </div>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-7 w-7 relative group"
                                                                disabled={isAdding || isRemoving}
                                                                onClick={() => {
                                                                    if (installed) {
                                                                        handleRemoveSkill(entryId);
                                                                    } else {
                                                                        handleAddSkill(entry);
                                                                    }
                                                                }}
                                                            >
                                                                {isAdding || isRemoving ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : installed ? (
                                                                    <span className="relative block h-4 w-4">
                                                                        <Check className="h-4 w-4 transition-opacity group-hover:opacity-0" />
                                                                        <Trash2 className="h-4 w-4 absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
                                                                    </span>
                                                                ) : (
                                                                    <Plus className="h-4 w-4" />
                                                                )}
                                                            </Button>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="h-full overflow-y-auto space-y-3">
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs text-muted-foreground uppercase">MCP Servers</span>
                                        <Badge variant="secondary" className="text-xs">
                                            {activeMcpServers.length}
                                        </Badge>
                                    </div>
                                    {mcpLoading ? (
                                        <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                                            加载中...
                                        </div>
                                    ) : activeMcpServers.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-24 text-sm text-muted-foreground gap-2">
                                            <Server className="h-8 w-8 opacity-30" />
                                            <span>暂无 MCP</span>
                                            <span className="text-xs">点击 Add 添加</span>
                                        </div>
                                    ) : (
                                        <div className="space-y-0.5">
                                            {activeMcpServers.map((server) => (
                                                <div
                                                    key={server.id || server.name}
                                                    className="group flex items-center justify-between px-3 py-0 rounded-lg transition-colors bg-muted/30 hover:bg-muted/50"
                                                >
                                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm truncate">{server.name}</span>
                                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                                {server.type}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => handleDisableMcp(server.id || server.name, server.id ? undefined : server.name)}
                                                        disabled={removingMcpId === (server.id || server.name)}
                                                        title="Disable MCP"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-1">
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs text-muted-foreground uppercase">Skills</span>
                                        <Badge variant="secondary" className="text-xs">
                                            {skills.length}
                                        </Badge>
                                    </div>
                                    {skillsLoading ? (
                                        <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                                            加载中...
                                        </div>
                                    ) : skills.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-24 text-sm text-muted-foreground gap-2">
                                            <Sparkles className="h-8 w-8 opacity-30" />
                                            <span>暂无 Skills</span>
                                            <span className="text-xs">点击 Add 添加</span>
                                        </div>
                                    ) : (
                                        <div className="space-y-0.5">
                                            <TooltipProvider delayDuration={60}>
                                                {sortedSkills.map((skill) => {
                                                    const rowClass = "group flex items-center justify-between px-3 py-0 rounded-lg transition-colors bg-muted/30 hover:bg-muted/50";
                                                    const removeButton = (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => handleRemoveSkill(skill.id)}
                                                            disabled={removingSkillId === skill.id}
                                                            title="Remove Skill"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                                        </Button>
                                                    );
                                                    if (!skill.description) {
                                                        return (
                                                            <div key={skill.id} className={rowClass}>
                                                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                                    <span className="font-medium text-sm truncate">{skill.name}</span>
                                                                </div>
                                                                {removeButton}
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <Tooltip key={skill.id}>
                                                            <TooltipTrigger asChild>
                                                                <div className={rowClass}>
                                                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                                        <span className="font-medium text-sm truncate">{skill.name}</span>
                                                                    </div>
                                                                    {removeButton}
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="max-w-[240px] whitespace-normal break-words bg-popover text-popover-foreground border border-border shadow-sm text-sm leading-snug">
                                                                {skill.description}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    );
                                                })}
                                            </TooltipProvider>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
