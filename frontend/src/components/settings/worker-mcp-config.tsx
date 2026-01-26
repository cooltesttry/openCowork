"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Server, Settings } from "lucide-react";

interface MCPServer {
    name: string;
    command: string;
    args?: string[];
}

interface WorkerMcpConfigProps {
    inheritSystem: boolean;
    selectedServers: string[];
    onInheritChange: (inherit: boolean) => void;
    onSelectedChange: (selected: string[]) => void;
}

export function WorkerMcpConfig({
    inheritSystem,
    selectedServers,
    onInheritChange,
    onSelectedChange,
}: WorkerMcpConfigProps) {
    const [systemServers, setSystemServers] = useState<MCPServer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSystemServers();
    }, []);

    const loadSystemServers = async () => {
        try {
            const response = await fetch("/api/config/mcp-servers");
            if (response.ok) {
                const data = await response.json();
                setSystemServers(data || []);
            }
        } catch (err) {
            console.error("Failed to load system MCP servers:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleServerToggle = (serverName: string, checked: boolean) => {
        if (checked) {
            onSelectedChange([...selectedServers, serverName]);
        } else {
            onSelectedChange(selectedServers.filter(s => s !== serverName));
        }
    };

    if (loading) {
        return <div className="p-4 text-muted-foreground">Loading MCP servers...</div>;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    MCP Servers
                </CardTitle>
                <CardDescription>
                    Configure which MCP (Model Context Protocol) servers this worker can access.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Inherit System Toggle */}
                <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                        <Settings className="h-5 w-5 text-muted-foreground" />
                        <div>
                            <Label htmlFor="inherit-system" className="text-base font-medium">
                                Inherit System Settings
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Use all MCP servers configured in system settings
                            </p>
                        </div>
                    </div>
                    <Switch
                        id="inherit-system"
                        checked={inheritSystem}
                        onCheckedChange={onInheritChange}
                    />
                </div>

                {/* Server Selection - only show if not inheriting */}
                {!inheritSystem && (
                    <div className="space-y-3">
                        <Label className="text-sm font-medium">Select MCP Servers</Label>
                        {systemServers.length === 0 ? (
                            <p className="text-sm text-muted-foreground p-4 border rounded-lg">
                                No MCP servers configured in system settings.
                                Go to Settings → MCP to add servers.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {systemServers.map((server) => (
                                    <div
                                        key={server.name}
                                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <Checkbox
                                                id={`server-${server.name}`}
                                                checked={selectedServers.includes(server.name)}
                                                onCheckedChange={(checked) =>
                                                    handleServerToggle(server.name, checked as boolean)
                                                }
                                            />
                                            <div>
                                                <Label
                                                    htmlFor={`server-${server.name}`}
                                                    className="font-medium cursor-pointer"
                                                >
                                                    {server.name}
                                                </Label>
                                                <p className="text-xs text-muted-foreground font-mono">
                                                    {server.command}
                                                </p>
                                            </div>
                                        </div>
                                        {selectedServers.includes(server.name) && (
                                            <Badge variant="secondary">Selected</Badge>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Info about blocked tools */}
                <div className="p-3 border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        <strong>Note:</strong> WebSearch and WebFetch tools are automatically disabled
                        for all Super Agent sessions to ensure controlled behavior.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
