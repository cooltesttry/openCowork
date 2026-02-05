"use client";

import { useEffect, useState } from "react";
import { fetchPromptConfig, updatePromptConfig, PromptConfig } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export function PromptConfigPanel() {
    const [config, setConfig] = useState<PromptConfig | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const data = await fetchPromptConfig();
            setConfig(data);
        } catch {
            toast.error("Error", { description: "Failed to load prompt config" });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!config) return;
        try {
            await updatePromptConfig(config);
            toast.success("Success", { description: "Prompt template saved" });
        } catch {
            toast.error("Error", { description: "Failed to save prompt template" });
        }
    };

    if (loading) return <div>Loading...</div>;
    if (!config) return <div>Failed to load configuration</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Prompt Templates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label>Base Preset</Label>
                    <Input
                        value={config.prompt_base_preset}
                        onChange={(e) =>
                            setConfig({ ...config, prompt_base_preset: e.target.value })
                        }
                        placeholder="claude_code"
                    />
                    <p className="text-xs text-muted-foreground">
                        The system prompt base preset used by Claude Code.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label>Global Template (Append)</Label>
                    <Textarea
                        value={config.prompt_global_template}
                        onChange={(e) =>
                            setConfig({ ...config, prompt_global_template: e.target.value })
                        }
                        rows={8}
                        placeholder="Global system prompt template..."
                    />
                    <p className="text-xs text-muted-foreground">
                        Appended after the base preset. Supports placeholders like
                        {` {{TIME_UTC}}`} , {`{{TIME_LOCAL}}`} , {`{{CWD}}`} ,
                        {`{{PROJECT_ROOT}}`} , {`{{PROJECT_NAME}}`}.
                    </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="space-y-1">
                        <Label>Apply to Chat</Label>
                        <p className="text-xs text-muted-foreground">
                            Apply global+project template to normal chat sessions.
                        </p>
                    </div>
                    <Switch
                        checked={config.prompt_apply_to_chat}
                        onCheckedChange={(checked) =>
                            setConfig({ ...config, prompt_apply_to_chat: checked })
                        }
                    />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="space-y-1">
                        <Label>Apply to Super Agent</Label>
                        <p className="text-xs text-muted-foreground">
                            Apply global+project template to Super Agent worker runs.
                        </p>
                    </div>
                    <Switch
                        checked={config.prompt_apply_to_super_agent}
                        onCheckedChange={(checked) =>
                            setConfig({ ...config, prompt_apply_to_super_agent: checked })
                        }
                    />
                </div>

                <Button onClick={handleSave}>Save Changes</Button>
            </CardContent>
            <Toaster />
        </Card>
    );
}
