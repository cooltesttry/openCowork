"use client";

import { useEffect, useState } from "react";
import { fetchConfig, updateConfig } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { FolderOpen } from "lucide-react";

interface AgentConfig {
    allowed_tools: string[];
    max_turns: number;
    default_workdir: string | null;
}

export function AgentConfig() {
    const [config, setConfig] = useState<AgentConfig | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const data = await fetchConfig<AgentConfig>("/agent");
            setConfig(data);
        } catch (err) {
            toast.error("Error", { description: "Failed to load agent config" });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!config) return;
        try {
            await updateConfig("/agent", config);
            toast.success("Success", { description: "Agent configuration saved" });
        } catch (err) {
            toast.error("Error", { description: "Failed to save config" });
        }
    };

    if (loading) return <div>Loading...</div>;
    if (!config) return <div>Failed to load configuration</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Agent Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        Default Working Directory
                    </Label>
                    <Input
                        value={config.default_workdir || ""}
                        onChange={(e) => setConfig({ ...config, default_workdir: e.target.value || null })}
                        placeholder="/path/to/your/project"
                    />
                    <p className="text-xs text-muted-foreground">
                        The default working directory for the agent SDK. This is where the agent will execute commands and access files.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label>Max Turns</Label>
                    <Input
                        type="number"
                        value={config.max_turns}
                        onChange={(e) => setConfig({ ...config, max_turns: parseInt(e.target.value) || 50 })}
                    />
                    <p className="text-xs text-muted-foreground">
                        Maximum number of turns the agent can take in a single conversation.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label>Allowed Tools</Label>
                    <Input
                        value={config.allowed_tools.join(", ")}
                        onChange={(e) => setConfig({
                            ...config,
                            allowed_tools: e.target.value.split(",").map(t => t.trim()).filter(Boolean)
                        })}
                        placeholder="Read, Write, Bash, Glob"
                    />
                    <p className="text-xs text-muted-foreground">
                        Comma-separated list of tools the agent is allowed to use.
                    </p>
                </div>

                <Button onClick={handleSave}>Save Changes</Button>
            </CardContent>
            <Toaster />
        </Card>
    );
}
