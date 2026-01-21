"use client";

import { useState, useEffect, useMemo } from "react";
import { useChat } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, List, Check } from "lucide-react";
import { fetchConfig, fetchModels } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ModelEndpoint {
    name: string;
    provider: string;
    api_key?: string;
    endpoint?: string;
}

interface ModelConfig {
    endpoints: ModelEndpoint[];
    selected_endpoint: string;
    model_name: string;
}

export function ModelSelector() {
    const { activeEndpoint, setActiveEndpoint, activeModel, setActiveModel } = useChat();
    const [open, setOpen] = useState(false);
    const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([]);
    const [tempEndpoint, setTempEndpoint] = useState("");
    const [tempModel, setTempModel] = useState("");

    // Model list state
    const [modelListOpen, setModelListOpen] = useState(false);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelSearchQuery, setModelSearchQuery] = useState("");

    // Custom filter to prioritize exact matches
    // Returns sorted models: 1) starts with query, 2) contains query exactly, 3) others
    const filteredAndSortedModels = useMemo(() => {
        if (!modelSearchQuery.trim()) {
            return availableModels;
        }
        const query = modelSearchQuery.toLowerCase();

        // Filter models that match
        const matched = availableModels.filter(m =>
            m.toLowerCase().includes(query)
        );

        // Sort: startsWith > contains > others
        return matched.sort((a, b) => {
            const aLower = a.toLowerCase();
            const bLower = b.toLowerCase();
            const aStartsWith = aLower.startsWith(query);
            const bStartsWith = bLower.startsWith(query);

            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;

            // If both or neither starts with query, sort by position of match
            const aIndex = aLower.indexOf(query);
            const bIndex = bLower.indexOf(query);
            return aIndex - bIndex;
        });
    }, [availableModels, modelSearchQuery]);

    // Load endpoints from config on mount
    useEffect(() => {
        loadConfig();
    }, []);

    // Sync temp values when popover opens
    useEffect(() => {
        if (open) {
            setTempEndpoint(activeEndpoint);
            setTempModel(activeModel);
        }
    }, [open, activeEndpoint, activeModel]);

    const loadConfig = async () => {
        try {
            const config = await fetchConfig("/model") as ModelConfig;
            setEndpoints(config.endpoints || []);

            // Initialize active model from settings if not set
            if (!activeEndpoint && config.selected_endpoint) {
                setActiveEndpoint(config.selected_endpoint);
            }
            if (!activeModel && config.model_name) {
                setActiveModel(config.model_name);
            }
        } catch (err) {
            console.error("Failed to load model config:", err);
        }
    };

    const handleFetchModels = async () => {
        if (!tempEndpoint) {
            toast.error("Please select an endpoint first");
            return;
        }

        setFetchingModels(true);
        try {
            // Find the endpoint config
            const endpoint = endpoints.find(ep => ep.name === tempEndpoint);
            if (!endpoint) {
                toast.error("Endpoint not found");
                return;
            }

            // Build config for API call
            const configForFetch = {
                provider: endpoint.provider,
                api_key: endpoint.api_key,
                endpoint: endpoint.endpoint,
            };

            const models = await fetchModels(configForFetch);
            setAvailableModels(models);

            if (models.length > 0) {
                setModelListOpen(true);
                toast.success(`Found ${models.length} models`);
            } else {
                toast.info("No models found");
            }
        } catch (err: any) {
            toast.error("Failed to fetch models", { description: err.message });
        } finally {
            setFetchingModels(false);
        }
    };

    const handleApply = () => {
        setActiveEndpoint(tempEndpoint);
        setActiveModel(tempModel);
        setOpen(false);
    };

    // Get display text for current selection - only show last part after "/"
    const getShortModelName = (modelName: string) => {
        if (!modelName) return '';
        // Extract last part after "/" (handles paths like "anthropic/claude-3-5-sonnet")
        const parts = modelName.split('/');
        return parts[parts.length - 1];
    };

    const displayText = activeModel
        ? getShortModelName(activeModel)
        : "Select Model";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    className="h-6 px-2 text-sm font-normal gap-1 hover:bg-accent text-muted-foreground"
                >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{displayText}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="center">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Endpoint</Label>
                        <Select value={tempEndpoint} onValueChange={setTempEndpoint}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select endpoint" />
                            </SelectTrigger>
                            <SelectContent>
                                {endpoints.length === 0 ? (
                                    <SelectItem value="_none" disabled>
                                        No endpoints configured
                                    </SelectItem>
                                ) : (
                                    endpoints.map((ep) => (
                                        <SelectItem key={ep.name} value={ep.name}>
                                            {ep.name}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Model Name</Label>
                        <div className="flex gap-2">
                            <Input
                                className="flex-1"
                                value={tempModel}
                                onChange={(e) => setTempModel(e.target.value)}
                                placeholder="claude-3-5-sonnet-20241022"
                            />
                            <Popover open={modelListOpen} onOpenChange={setModelListOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={handleFetchModels}
                                        disabled={fetchingModels || !tempEndpoint}
                                        title="Fetch Available Models"
                                    >
                                        <List className={cn("h-4 w-4", fetchingModels && "animate-pulse")} />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="p-0 w-64" align="end">
                                    <Command filter={() => 1}>
                                        <CommandInput
                                            placeholder="Search model..."
                                            value={modelSearchQuery}
                                            onValueChange={setModelSearchQuery}
                                        />
                                        <CommandList>
                                            <CommandEmpty>No models found.</CommandEmpty>
                                            <CommandGroup>
                                                {filteredAndSortedModels.map((model) => (
                                                    <CommandItem
                                                        key={model}
                                                        value={model}
                                                        onSelect={(val) => {
                                                            setTempModel(val);
                                                            setModelListOpen(false);
                                                            setModelSearchQuery("");
                                                        }}
                                                    >
                                                        <Check
                                                            className={cn(
                                                                "mr-2 h-4 w-4",
                                                                tempModel === model ? "opacity-100" : "opacity-0"
                                                            )}
                                                        />
                                                        <span className="truncate">{model}</span>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>

                    <Button onClick={handleApply} className="w-full">
                        Apply
                    </Button>
                </div>
            </PopoverContent>
        </Popover >
    );
}
