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
import { List, Check } from "lucide-react";
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

export function ModelConfig() {
    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Model Selection State
    const [modelSelectOpen, setModelSelectOpen] = useState(false);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const data = await fetchConfig("/model");
            setConfig(data);
        } catch (err) {
            toast.error("Error", { description: "Failed to load model config" });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            await updateConfig("/model", config);
            toast.success("Success", { description: "Model configuration saved" });
        } catch (err) {
            toast.error("Error", { description: "Failed to save config" });
        }
    };

    const handleFetchModels = async () => {
        setFetchingModels(true);
        try {
            // Use current config state to fetch models
            const models = await fetchModels(config);
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

    if (loading) return <div>Loading...</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Model Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select
                        value={config.provider}
                        onValueChange={(val) => setConfig({ ...config, provider: val })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                            <SelectItem value="openai">OpenAI</SelectItem>
                            <SelectItem value="openrouter">OpenRouter</SelectItem>
                            <SelectItem value="bedrock">AWS Bedrock</SelectItem>
                            <SelectItem value="vertex">Google Vertex AI</SelectItem>
                            <SelectItem value="local">Local (LM Studio/Ollama)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label>Endpoint API URL (Optional)</Label>
                    <Input
                        value={config.endpoint || ""}
                        onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
                        placeholder={config.provider === "openai" ? "https://api.openai.com/v1" : "http://localhost:1234/v1"}
                    />
                    <p className="text-xs text-muted-foreground">
                        Leave empty for default. Required for Local providers (e.g. http://localhost:1234/v1).
                    </p>
                </div>

                <div className="space-y-2">
                    <Label>Model Name</Label>
                    <div className="flex gap-2">
                        <Input
                            className="flex-1"
                            value={config.model_name}
                            onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                        />
                        <Popover open={modelSelectOpen} onOpenChange={setModelSelectOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={handleFetchModels}
                                    disabled={fetchingModels}
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
                    <p className="text-xs text-muted-foreground">e.g. claude-3-5-sonnet-20241022</p>
                </div>

                <div className="space-y-2">
                    <Label>API Key</Label>
                    <Input
                        type="password"
                        value={config.api_key || ""}
                        onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                        placeholder="sk-..."
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Max Tokens</Label>
                        <Input
                            type="number"
                            value={config.max_tokens || 0}
                            onChange={(e) => setConfig({ ...config, max_tokens: parseInt(e.target.value) || 0 })}
                        />
                        <p className="text-xs text-muted-foreground">0 = default</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Max Thinking Tokens</Label>
                        <Input
                            type="number"
                            value={config.max_thinking_tokens || 0}
                            onChange={(e) => setConfig({ ...config, max_thinking_tokens: parseInt(e.target.value) || 0 })}
                        />
                        <p className="text-xs text-muted-foreground">0 = default</p>
                    </div>
                </div>

                <Button onClick={handleSave}>Save Changes</Button>
            </CardContent>
            <Toaster />
        </Card>
    );
}
