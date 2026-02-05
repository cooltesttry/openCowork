"use client";

import { useEffect, useState } from "react";
import {
    fetchWorkspaceConfig,
    updateWorkspaceConfig,
    fetchWorkspaceClaudeMd,
    updateWorkspaceClaudeMd,
    fetchWorkspacePromptPreview,
    WorkspaceClaudeMd,
    WorkspaceConfig,
    WorkspacePromptPreview,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export function WorkspacePromptConfigPanel() {
    const { currentWorkspace } = useWorkspace();
    const [config, setConfig] = useState<WorkspaceConfig | null>(null);
    const [claudeMd, setClaudeMd] = useState<WorkspaceClaudeMd | null>(null);
    const [preview, setPreview] = useState<WorkspacePromptPreview | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!currentWorkspace?.id) {
            setConfig(null);
            setClaudeMd(null);
            setPreview(null);
            return;
        }
        void loadWorkspaceData(currentWorkspace.id);
    }, [currentWorkspace?.id]);

    const loadWorkspaceData = async (workspaceId: string) => {
        setLoading(true);
        try {
            const [cfg, md] = await Promise.all([
                fetchWorkspaceConfig(workspaceId),
                fetchWorkspaceClaudeMd(workspaceId),
            ]);
            setConfig(cfg);
            setClaudeMd(md);
        } catch {
            toast.error("Error", { description: "Failed to load workspace prompt data" });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProjectPrompt = async () => {
        if (!currentWorkspace?.id || !config) return;
        try {
            const updated = await updateWorkspaceConfig(currentWorkspace.id, {
                project_system_prompt: config.project_system_prompt || "",
                project_system_prompt_enabled: config.project_system_prompt_enabled ?? true,
            });
            setConfig(updated);
            toast.success("Saved", { description: "Project prompt updated" });
        } catch {
            toast.error("Error", { description: "Failed to save project prompt" });
        }
    };

    const handleSaveClaudeMd = async () => {
        if (!currentWorkspace?.id || !claudeMd) return;
        try {
            const result = await updateWorkspaceClaudeMd(currentWorkspace.id, claudeMd.content || "");
            setClaudeMd({ ...claudeMd, exists: true, file_hash: result.file_hash });
            await updateWorkspaceConfig(currentWorkspace.id, {
                claude_md_last_hash: result.file_hash,
            });
            toast.success("Saved", { description: "CLAUDE.md updated" });
        } catch {
            toast.error("Error", { description: "Failed to save CLAUDE.md" });
        }
    };

    const handleMarkTrusted = async () => {
        if (!currentWorkspace?.id || !claudeMd?.file_hash) return;
        try {
            const updated = await updateWorkspaceConfig(currentWorkspace.id, {
                claude_md_last_hash: claudeMd.file_hash,
            });
            setConfig(updated);
            setClaudeMd({ ...claudeMd, tracked_hash: claudeMd.file_hash });
            toast.success("Updated", { description: "Marked CLAUDE.md as trusted" });
        } catch {
            toast.error("Error", { description: "Failed to update trust hash" });
        }
    };

    const handlePreview = async () => {
        if (!currentWorkspace?.id) return;
        try {
            const data = await fetchWorkspacePromptPreview(currentWorkspace.id);
            setPreview(data);
        } catch {
            toast.error("Error", { description: "Failed to fetch prompt preview" });
        }
    };

    if (!currentWorkspace) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Workspace Prompts</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                    No workspace selected.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Project System Prompt</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading && <div>Loading...</div>}
                    {!loading && config && (
                        <>
                            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                                <div className="space-y-1">
                                    <Label>Enable Project Prompt</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Toggle whether project-level prompt is appended.
                                    </p>
                                </div>
                                <Switch
                                    checked={config.project_system_prompt_enabled ?? true}
                                    onCheckedChange={(checked) =>
                                        setConfig({ ...config, project_system_prompt_enabled: checked })
                                    }
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Project Prompt (Append)</Label>
                                <Textarea
                                    value={config.project_system_prompt || ""}
                                    onChange={(e) =>
                                        setConfig({ ...config, project_system_prompt: e.target.value })
                                    }
                                    rows={8}
                                    placeholder="Project-specific system prompt..."
                                />
                            </div>

                            <Button onClick={handleSaveProjectPrompt}>Save Project Prompt</Button>
                        </>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>CLAUDE.md</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {claudeMd && (
                        <>
                            <div className="text-xs text-muted-foreground">
                                Path: {claudeMd.path}
                            </div>
                            {claudeMd.file_hash &&
                                claudeMd.tracked_hash &&
                                claudeMd.file_hash !== claudeMd.tracked_hash && (
                                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                        CLAUDE.md has changed since last trusted hash.
                                        <Button
                                            variant="link"
                                            className="ml-2 h-auto p-0 text-xs"
                                            onClick={handleMarkTrusted}
                                        >
                                            Mark as trusted
                                        </Button>
                                    </div>
                                )}

                            <Textarea
                                value={claudeMd.content || ""}
                                onChange={(e) =>
                                    setClaudeMd({ ...claudeMd, content: e.target.value })
                                }
                                rows={10}
                                placeholder="CLAUDE.md content..."
                            />
                            <Button onClick={handleSaveClaudeMd}>Save CLAUDE.md</Button>
                        </>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Prompt Preview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Button variant="outline" onClick={handlePreview}>
                        Generate Preview
                    </Button>
                    {preview && (
                        <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                                Base preset: {preview.base_preset}
                            </div>
                            <Textarea value={preview.append_text || ""} readOnly rows={8} />
                        </div>
                    )}
                </CardContent>
            </Card>
            <Toaster />
        </div>
    );
}
