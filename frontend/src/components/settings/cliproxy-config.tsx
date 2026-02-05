"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    cliproxyAction,
    cliproxyManagement,
    fetchCliproxyStatus,
    type CliproxyStatus,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ExternalLink, RefreshCcw, Play, Square, ArrowUp, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuthFileEntry {
    id?: string;
    name?: string;
    label?: string;
    provider?: string;
    status?: string;
    status_message?: string;
    disabled?: boolean;
    email?: string;
    created_at?: string;
    updated_at?: string;
}

const OAUTH_PROVIDERS = [
    { id: "anthropic", label: "Claude", path: "anthropic-auth-url" },
    { id: "codex", label: "Codex", path: "codex-auth-url" },
    { id: "gemini", label: "Gemini CLI", path: "gemini-cli-auth-url" },
    { id: "antigravity", label: "Antigravity", path: "antigravity-auth-url" },
    { id: "qwen", label: "Qwen", path: "qwen-auth-url" },
    { id: "iflow", label: "iFlow", path: "iflow-auth-url" },
] as const;

export function CliproxyConfig() {
    const [status, setStatus] = useState<CliproxyStatus | null>(null);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [apiKeys, setApiKeys] = useState<string[]>([]);
    const [newApiKey, setNewApiKey] = useState("");
    const [openaiCompatJson, setOpenaiCompatJson] = useState("[]");
    const [claudeKeysJson, setClaudeKeysJson] = useState("[]");
    const [codexKeysJson, setCodexKeysJson] = useState("[]");
    const [geminiKeysJson, setGeminiKeysJson] = useState("[]");
    const [vertexKeysJson, setVertexKeysJson] = useState("[]");
    const [oauthExcludedJson, setOauthExcludedJson] = useState("{}");
    const [oauthAliasJson, setOauthAliasJson] = useState("{}");
    const [authFiles, setAuthFiles] = useState<AuthFileEntry[]>([]);
    const [oauthProgress, setOauthProgress] = useState<Record<string, { state: string; status: string }>>({});

    const refreshStatus = useCallback(async () => {
        setLoadingStatus(true);
        try {
            const data = await fetchCliproxyStatus();
            setStatus(data);
        } catch (err) {
            console.error(err);
            toast.error("Failed to load CLIProxyAPI status");
        } finally {
            setLoadingStatus(false);
        }
    }, []);

    const loadManagementData = useCallback(async (force = false) => {
        if (!force && !status?.running) return;
        try {
            const apiKeyData = await cliproxyManagement<{ "api-keys": string[] }>("api-keys");
            setApiKeys(apiKeyData["api-keys"] || []);
        } catch (err) {
            console.error(err);
            toast.error("Failed to load API keys");
        }

        try {
            const openaiCompat = await cliproxyManagement<{ "openai-compatibility": unknown }>("openai-compatibility");
            setOpenaiCompatJson(JSON.stringify(openaiCompat["openai-compatibility"] ?? [], null, 2));
        } catch (err) {
            console.error(err);
        }

        try {
            const claudeKeys = await cliproxyManagement<{ "claude-api-key": unknown }>("claude-api-key");
            setClaudeKeysJson(JSON.stringify(claudeKeys["claude-api-key"] ?? [], null, 2));
        } catch (err) {
            console.error(err);
        }

        try {
            const codexKeys = await cliproxyManagement<{ "codex-api-key": unknown }>("codex-api-key");
            setCodexKeysJson(JSON.stringify(codexKeys["codex-api-key"] ?? [], null, 2));
        } catch (err) {
            console.error(err);
        }

        try {
            const geminiKeys = await cliproxyManagement<{ "gemini-api-key": unknown }>("gemini-api-key");
            setGeminiKeysJson(JSON.stringify(geminiKeys["gemini-api-key"] ?? [], null, 2));
        } catch (err) {
            console.error(err);
        }

        try {
            const vertexKeys = await cliproxyManagement<{ "vertex-api-key": unknown }>("vertex-api-key");
            setVertexKeysJson(JSON.stringify(vertexKeys["vertex-api-key"] ?? [], null, 2));
        } catch (err) {
            console.error(err);
        }

        try {
            const authList = await cliproxyManagement<{ auth_files?: AuthFileEntry[]; "auth-files"?: AuthFileEntry[] }>(
                "auth-files"
            );
            setAuthFiles(authList["auth-files"] ?? authList.auth_files ?? []);
        } catch (err) {
            console.error(err);
        }

        try {
            const oauthExcluded = await cliproxyManagement<{ "oauth-excluded-models": unknown }>("oauth-excluded-models");
            setOauthExcludedJson(JSON.stringify(oauthExcluded["oauth-excluded-models"] ?? {}, null, 2));
        } catch (err) {
            console.error(err);
        }

        try {
            const oauthAlias = await cliproxyManagement<{ "oauth-model-alias": unknown }>("oauth-model-alias");
            setOauthAliasJson(JSON.stringify(oauthAlias["oauth-model-alias"] ?? {}, null, 2));
        } catch (err) {
            console.error(err);
        }
    }, [status?.running]);

    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    useEffect(() => {
        if (status?.running) {
            loadManagementData();
        }
    }, [status?.running, loadManagementData]);

    const handleStart = async () => {
        try {
            await cliproxyAction("start");
            await refreshStatus();
            await loadManagementData(true);
        } catch (err) {
            console.error(err);
            toast.error("Failed to start CLIProxyAPI");
        }
    };

    const handleStop = async () => {
        try {
            await cliproxyAction("stop");
            await refreshStatus();
        } catch (err) {
            console.error(err);
            toast.error("Failed to stop CLIProxyAPI");
        }
    };

    const handleRestart = async () => {
        try {
            await cliproxyAction("restart");
            await refreshStatus();
            await loadManagementData(true);
        } catch (err) {
            console.error(err);
            toast.error("Failed to restart CLIProxyAPI");
        }
    };

    const handleUpgrade = async () => {
        try {
            await cliproxyAction("upgrade");
            await refreshStatus();
            toast.success("CLIProxyAPI upgraded");
        } catch (err) {
            console.error(err);
            toast.error("Failed to upgrade CLIProxyAPI");
        }
    };

    const saveApiKeys = async () => {
        try {
            await cliproxyManagement("api-keys", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(apiKeys),
            });
            toast.success("API keys saved");
        } catch (err) {
            console.error(err);
            toast.error("Failed to save API keys");
        }
    };

    const parseJson = (value: string) => {
        try {
            return JSON.parse(value);
        } catch {
            throw new Error("Invalid JSON");
        }
    };

    const saveJsonConfig = async (path: string, value: string, label: string) => {
        try {
            const parsed = parseJson(value);
            await cliproxyManagement(path, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parsed),
            });
            toast.success(`${label} saved`);
        } catch (err) {
            console.error(err);
            toast.error(`Failed to save ${label}`);
        }
    };

    const toggleAuthFile = async (entry: AuthFileEntry, disabled: boolean) => {
        const name = entry.id || entry.name || "";
        if (!name) return;
        try {
            await cliproxyManagement("auth-files/status", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, disabled }),
            });
            await loadManagementData();
        } catch (err) {
            console.error(err);
            toast.error("Failed to update auth status");
        }
    };

    const deleteAuthFile = async (entry: AuthFileEntry) => {
        const name = entry.name || entry.id;
        if (!name) return;
        try {
            await cliproxyManagement(`auth-files?name=${encodeURIComponent(name)}`, {
                method: "DELETE",
            });
            await loadManagementData();
        } catch (err) {
            console.error(err);
            toast.error("Failed to delete auth file");
        }
    };

    const startOAuth = async (providerId: string, path: string) => {
        try {
            const res = await cliproxyManagement<{ url: string; state: string }>(`${path}?is_webui=true`);
            if (!res.url || !res.state) {
                throw new Error("Missing auth URL");
            }
            window.open(res.url, "_blank", "noopener");
            setOauthProgress((prev) => ({ ...prev, [providerId]: { state: res.state, status: "wait" } }));
            pollAuthStatus(providerId, res.state);
        } catch (err) {
            console.error(err);
            toast.error("Failed to start OAuth");
        }
    };

    const pollAuthStatus = (providerId: string, state: string, attempt = 0) => {
        const maxAttempts = 120;
        if (attempt >= maxAttempts) {
            setOauthProgress((prev) => ({ ...prev, [providerId]: { state, status: "timeout" } }));
            toast.error("OAuth timeout");
            return;
        }
        setTimeout(async () => {
            try {
                const res = await cliproxyManagement<{ status: string; error?: string }>(`get-auth-status?state=${encodeURIComponent(state)}`);
                if (res.status === "wait") {
                    pollAuthStatus(providerId, state, attempt + 1);
                    return;
                }
                if (res.status === "ok") {
                    toast.success("OAuth completed");
                } else {
                    toast.error(res.error || "OAuth failed");
                }
                setOauthProgress((prev) => {
                    const copy = { ...prev };
                    delete copy[providerId];
                    return copy;
                });
                await loadManagementData();
            } catch (err) {
                console.error(err);
                pollAuthStatus(providerId, state, attempt + 1);
            }
        }, 2500);
    };

    const managementUrl = useMemo(() => status?.management_ui ?? "http://127.0.0.1:8317/management.html", [status]);

    return (
        <>
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        CLIProxyAPI Service
                        {status?.running ? (
                            <Badge variant="secondary" className="ml-2">Running</Badge>
                        ) : (
                            <Badge variant="outline" className="ml-2">Stopped</Badge>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            variant="outline"
                            onClick={async () => {
                                await refreshStatus();
                                await loadManagementData();
                            }}
                            disabled={loadingStatus}
                        >
                            <RefreshCcw className="mr-2 size-4" /> Refresh
                        </Button>
                        <Button onClick={handleStart} disabled={status?.running}>
                            <Play className="mr-2 size-4" /> Start
                        </Button>
                        <Button variant="secondary" onClick={handleRestart} disabled={!status?.running}>
                            <RotateCw className="mr-2 size-4" /> Restart
                        </Button>
                        <Button variant="destructive" onClick={handleStop} disabled={!status?.running}>
                            <Square className="mr-2 size-4" /> Stop
                        </Button>
                        <Button
                            variant={status?.upgrade_available ? "default" : "outline"}
                            onClick={handleUpgrade}
                            disabled={loadingStatus}
                        >
                            <ArrowUp className="mr-2 size-4" /> Upgrade
                        </Button>
                        <Button variant="outline" asChild>
                            <a href={managementUrl} target="_blank" rel="noopener noreferrer">
                                Open Management UI <ExternalLink className="ml-2 size-4" />
                            </a>
                        </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-border/60 p-3">
                            <p className="text-sm text-muted-foreground">Base URL</p>
                            <p className="text-sm font-medium">{status?.base_url || "—"}</p>
                        </div>
                        <div className="rounded-lg border border-border/60 p-3">
                            <p className="text-sm text-muted-foreground">Version</p>
                            <p className="text-sm font-medium">{status?.version || "—"}</p>
                            <p className="text-xs text-muted-foreground">
                                Latest: {status?.latest_version || "—"}
                            </p>
                        </div>
                    </div>
                    <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
                        OAuth login needs a local callback server. If you access OpenCowork remotely, use SSH
                        port forwarding or run the OAuth flow on the server. Qwen device flow is remote-friendly.
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>API Keys</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {apiKeys.map((key, idx) => (
                            <div key={`${key}-${idx}`} className="flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs">
                                <span className="font-mono">{key}</span>
                                <button
                                    onClick={() => setApiKeys(apiKeys.filter((_, i) => i !== idx))}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row md:items-end">
                        <div className="flex-1 space-y-1">
                            <Label>New Key</Label>
                            <Input value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} />
                        </div>
                        <Button
                            onClick={() => {
                                if (newApiKey.trim()) {
                                    setApiKeys([...apiKeys, newApiKey.trim()]);
                                    setNewApiKey("");
                                }
                            }}
                        >
                            Add Key
                        </Button>
                        <Button variant="secondary" onClick={saveApiKeys}>
                            Save Keys
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>OpenAI Compatibility (OpenRouter/Ollama)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Textarea
                        value={openaiCompatJson}
                        onChange={(e) => setOpenaiCompatJson(e.target.value)}
                        className="min-h-[200px] font-mono text-xs"
                    />
                    <Button onClick={() => saveJsonConfig("openai-compatibility", openaiCompatJson, "OpenAI compatibility")}>
                        Save OpenAI Compatibility
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Provider API Keys</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {[
                        { label: "Claude", value: claudeKeysJson, setter: setClaudeKeysJson, path: "claude-api-key" },
                        { label: "Codex", value: codexKeysJson, setter: setCodexKeysJson, path: "codex-api-key" },
                        { label: "Gemini", value: geminiKeysJson, setter: setGeminiKeysJson, path: "gemini-api-key" },
                        { label: "Vertex", value: vertexKeysJson, setter: setVertexKeysJson, path: "vertex-api-key" },
                    ].map((item) => (
                        <div key={item.path} className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">{item.label}</Label>
                                <Button size="sm" onClick={() => saveJsonConfig(item.path, item.value, `${item.label} keys`)}>
                                    Save
                                </Button>
                            </div>
                            <Textarea
                                value={item.value}
                                onChange={(e) => item.setter(e.target.value)}
                                className="min-h-[160px] font-mono text-xs"
                            />
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>OAuth Accounts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {OAUTH_PROVIDERS.map((provider) => (
                            <Button
                                key={provider.id}
                                variant="outline"
                                onClick={() => startOAuth(provider.id, provider.path)}
                                disabled={!status?.running}
                            >
                                {provider.label}
                                {oauthProgress[provider.id]?.status === "wait" && (
                                    <span className="ml-2 text-xs text-muted-foreground">pending</span>
                                )}
                            </Button>
                        ))}
                    </div>
                    <div className="space-y-2">
                        {authFiles.length === 0 && (
                            <p className="text-sm text-muted-foreground">No OAuth auth files found.</p>
                        )}
                        {authFiles.map((entry) => (
                            <div
                                key={entry.id || entry.name}
                                className={cn(
                                    "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3",
                                    entry.disabled && "opacity-60"
                                )}
                            >
                                <div className="space-y-1">
                                    <p className="text-sm font-medium">
                                        {entry.label || entry.name || entry.id}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {entry.provider} {entry.email ? `• ${entry.email}` : ""}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {entry.status_message || entry.status || ""}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Switch
                                        checked={!entry.disabled}
                                        onCheckedChange={(checked) => toggleAuthFile(entry, !checked)}
                                    />
                                    <Button variant="ghost" size="sm" onClick={() => deleteAuthFile(entry)}>
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>OAuth Model Alias</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Textarea
                        value={oauthAliasJson}
                        onChange={(e) => setOauthAliasJson(e.target.value)}
                        className="min-h-[160px] font-mono text-xs"
                    />
                    <Button onClick={() => saveJsonConfig("oauth-model-alias", oauthAliasJson, "OAuth model alias")}>
                        Save OAuth Model Alias
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>OAuth Excluded Models</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Textarea
                        value={oauthExcludedJson}
                        onChange={(e) => setOauthExcludedJson(e.target.value)}
                        className="min-h-[160px] font-mono text-xs"
                    />
                    <Button onClick={() => saveJsonConfig("oauth-excluded-models", oauthExcludedJson, "OAuth excluded models")}>
                        Save OAuth Excluded Models
                    </Button>
                </CardContent>
            </Card>
        </div>
        <Toaster />
        </>
    );
}
