"use client";

import { useEffect, useState } from "react";
import { fetchConfig, updateConfig, fetchModels } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { List, Check, Plus, Trash2 } from "lucide-react";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ModelEndpoint {
    name: string;
    provider: string;
    api_key?: string;
    endpoint?: string;
}

interface ModelConfig {
    endpoints: ModelEndpoint[];
    selected_endpoint: string;
    provider: string;
    api_key?: string;
    endpoint?: string;
    model_name: string;
    max_tokens: number;
    max_thinking_tokens: number;
}

const PROVIDERS = [
    { value: "claude", label: "Claude" },
    { value: "openai", label: "OpenAI" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "bedrock", label: "Bedrock" },
    { value: "vertex", label: "Vertex" },
    { value: "local", label: "Local" },
];

export function ModelConfig() {
    const [config, setConfig] = useState<ModelConfig | null>(null);
    const [loading, setLoading] = useState(true);

    // New endpoint form state
    const [newEndpoint, setNewEndpoint] = useState<ModelEndpoint>({
        name: "",
        provider: "claude",
        api_key: "",
        endpoint: "",
    });

    // Model Selection State
    const [modelSelectOpen, setModelSelectOpen] = useState(false);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const data = await fetchConfig("/model") as ModelConfig;
            // Initialize endpoints array if not present
            if (!data.endpoints) {
                data.endpoints = [];
            }
            if (!data.selected_endpoint) {
                data.selected_endpoint = "";
            }
            setConfig(data);
        } catch (err) {
            toast.error("Error", { description: "Failed to load model config" });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!config) return;
        try {
            await updateConfig("/model", config);
            toast.success("Success", { description: "Model configuration saved" });
        } catch (err) {
            toast.error("Error", { description: "Failed to save config" });
        }
    };

    // Generate unique name based on provider
    const generateUniqueName = (baseName: string): string => {
        if (!config) return baseName;

        const existingNames = config.endpoints.map(ep => ep.name.toLowerCase());
        if (!existingNames.includes(baseName.toLowerCase())) {
            return baseName;
        }

        // Find next available number
        let counter = 2;
        while (existingNames.includes(`${baseName.toLowerCase()} ${counter}`)) {
            counter++;
        }
        return `${baseName} ${counter}`;
    };

    // Handle provider change - auto-fill name
    const handleProviderChange = (provider: string) => {
        const providerLabel = PROVIDERS.find(p => p.value === provider)?.label || provider;
        const uniqueName = generateUniqueName(providerLabel);
        setNewEndpoint({
            ...newEndpoint,
            provider,
            name: uniqueName,
            endpoint: provider === "local" ? newEndpoint.endpoint : ""
        });
    };

    const handleAddEndpoint = () => {
        if (!config) return;

        // Validate
        if (!newEndpoint.name.trim()) {
            toast.error("Error", { description: "Endpoint name is required" });
            return;
        }

        // Check for duplicates
        const isDuplicate = config.endpoints.some(
            ep => ep.name.toLowerCase() === newEndpoint.name.toLowerCase()
        );
        if (isDuplicate) {
            toast.error("Error", { description: "An endpoint with this name already exists" });
            return;
        }

        // Add endpoint
        const updatedEndpoints = [...config.endpoints, { ...newEndpoint }];
        setConfig({ ...config, endpoints: updatedEndpoints });

        // Reset form
        setNewEndpoint({
            name: "",
            provider: "claude",
            api_key: "",
            endpoint: "",
        });

        toast.success("Endpoint added", { description: newEndpoint.name });
    };

    const handleDeleteEndpoint = (name: string) => {
        if (!config) return;

        const updatedEndpoints = config.endpoints.filter(ep => ep.name !== name);
        const updates: Partial<ModelConfig> = { endpoints: updatedEndpoints };

        // If deleted endpoint was selected, clear selection
        if (config.selected_endpoint === name) {
            updates.selected_endpoint = "";
        }

        setConfig({ ...config, ...updates });
        toast.info("Endpoint removed", { description: name });
    };

    const handleFetchModels = async () => {
        if (!config) return;

        setFetchingModels(true);
        try {
            // Build config for fetch based on selected endpoint or legacy
            let fetchConfig = { ...config };
            if (config.selected_endpoint) {
                const selectedEp = config.endpoints.find(ep => ep.name === config.selected_endpoint);
                if (selectedEp) {
                    fetchConfig = {
                        ...config,
                        provider: selectedEp.provider,
                        api_key: selectedEp.api_key || "",
                        endpoint: selectedEp.endpoint || "",
                    };
                }
            }

            const models = await fetchModels(fetchConfig);
            setAvailableModels(models);
            if (models.length > 0) {
                setModelSelectOpen(true);
                toast.success(`Found ${models.length} models`);
            } else {
                toast.info("No models found via API");
            }
        } catch (err: any) {
            toast.error("Failed to fetch models", { description: err.message });
        } finally {
            setFetchingModels(false);
        }
    };

    const getProviderLabel = (provider: string) => {
        return PROVIDERS.find(p => p.value === provider)?.label || provider;
    };

    if (loading || !config) return <div>Loading...</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Model Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Add New Endpoint Section */}
                <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                    <h3 className="font-medium text-sm">Add New Endpoint</h3>

                    {/* Provider and Endpoint URL on same line */}
                    <div className="grid grid-cols-4 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Provider</Label>
                            <Select
                                value={newEndpoint.provider}
                                onValueChange={handleProviderChange}
                            >
                                <SelectTrigger className="h-9 w-full">
                                    <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                    {PROVIDERS.map(p => (
                                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {newEndpoint.provider === "local" && (
                            <div className="space-y-1 col-span-3">
                                <Label className="text-xs">Endpoint URL</Label>
                                <Input
                                    className="h-9"
                                    value={newEndpoint.endpoint || ""}
                                    onChange={(e) => setNewEndpoint({ ...newEndpoint, endpoint: e.target.value })}
                                    placeholder="http://localhost:1234/v1"
                                />
                            </div>
                        )}
                    </div>

                    {/* Name and API Key */}
                    <div className="grid grid-cols-4 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Name</Label>
                            <Input
                                className="h-9 w-full"
                                value={newEndpoint.name}
                                onChange={(e) => setNewEndpoint({ ...newEndpoint, name: e.target.value })}
                                placeholder="My Endpoint"
                            />
                        </div>
                        <div className="space-y-1 col-span-3">
                            <Label className="text-xs">API Key</Label>
                            <Input
                                className="h-9"
                                type="password"
                                value={newEndpoint.api_key || ""}
                                onChange={(e) => setNewEndpoint({ ...newEndpoint, api_key: e.target.value })}
                                placeholder="sk-..."
                            />
                        </div>
                    </div>

                    <Button size="sm" onClick={handleAddEndpoint} className="w-full">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Endpoint
                    </Button>
                </div>

                {/* Configured Endpoints List */}
                {config.endpoints.length > 0 && (
                    <div className="space-y-2">
                        <Label>Configured Endpoints</Label>
                        <div className="border rounded-lg divide-y">
                            {config.endpoints.map((ep) => (
                                <div
                                    key={ep.name}
                                    className={cn(
                                        "flex items-center justify-between px-3 py-2",
                                        config.selected_endpoint === ep.name && "bg-primary/5"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg">
                                            {ep.provider === "local" ? "🏠" :
                                                ep.provider === "openrouter" ? "🌐" :
                                                    ep.provider === "claude" ? "☁️" : "📦"}
                                        </span>
                                        <div>
                                            <div className="font-medium text-sm">{ep.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {getProviderLabel(ep.provider)}
                                                {ep.endpoint && ` • ${ep.endpoint}`}
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => handleDeleteEndpoint(ep.name)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Active Model Selection */}
                <div className="border rounded-lg p-4 space-y-4">
                    <h3 className="font-medium text-sm">Active Model Selection</h3>

                    <div className="grid grid-cols-4 gap-3">
                        {/* Endpoint Selector */}
                        <div className="space-y-1">
                            <Label className="text-xs">Endpoint</Label>
                            <Select
                                value={config.selected_endpoint || "_none"}
                                onValueChange={(val) => setConfig({
                                    ...config,
                                    selected_endpoint: val === "_none" ? "" : val
                                })}
                            >
                                <SelectTrigger className="h-9 w-full">
                                    <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                    {config.endpoints.length === 0 && (
                                        <SelectItem value="_none" disabled>
                                            (No endpoints)
                                        </SelectItem>
                                    )}
                                    {config.endpoints.map(ep => (
                                        <SelectItem key={ep.name} value={ep.name}>
                                            {ep.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Model Name */}
                        <div className="space-y-1 col-span-3">
                            <Label className="text-xs">Model Name</Label>
                            <div className="flex gap-2">
                                <Input
                                    className="flex-1 h-9"
                                    value={config.model_name}
                                    onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                                    placeholder="claude-3-5-sonnet-20241022"
                                />
                                <Popover open={modelSelectOpen} onOpenChange={setModelSelectOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-9 w-9"
                                            onClick={handleFetchModels}
                                            disabled={fetchingModels || !config.selected_endpoint}
                                            title="Fetch Available Models"
                                        >
                                            <List className={cn("h-4 w-4", fetchingModels && "animate-pulse")} />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="p-0" align="end">
                                        <Command>
                                            <CommandInput placeholder="Search model..." />
                                            <CommandList>
                                                <CommandEmpty>No models found.</CommandEmpty>
                                                <CommandGroup>
                                                    {availableModels.map((model) => (
                                                        <CommandItem
                                                            key={model}
                                                            value={model}
                                                            onSelect={(currentValue) => {
                                                                setConfig({ ...config, model_name: currentValue });
                                                                setModelSelectOpen(false);
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    config.model_name === model ? "opacity-100" : "opacity-0"
                                                                )}
                                                            />
                                                            {model}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    </div>
                </div>


                {/* Token Limits */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <Label className="text-xs">Max Tokens</Label>
                        <Input
                            type="number"
                            value={config.max_tokens || 0}
                            onChange={(e) => setConfig({ ...config, max_tokens: parseInt(e.target.value) || 0 })}
                        />
                        <p className="text-xs text-muted-foreground">0 = default</p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Max Thinking Tokens</Label>
                        <Input
                            type="number"
                            value={config.max_thinking_tokens || 0}
                            onChange={(e) => setConfig({ ...config, max_thinking_tokens: parseInt(e.target.value) || 0 })}
                        />
                        <p className="text-xs text-muted-foreground">0 = default</p>
                    </div>
                </div>

                <Button onClick={handleSave} className="w-full">Save Changes</Button>
            </CardContent>
            <Toaster />
        </Card>
    );
}
