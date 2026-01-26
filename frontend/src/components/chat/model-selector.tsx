"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import { Label } from "@/components/ui/label";
import { Sparkles, Check, Loader2 } from "lucide-react";
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
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelSearchQuery, setModelSearchQuery] = useState("");

    // Ref for auto-focus
    const commandInputRef = useRef<HTMLInputElement>(null);

    // Custom filter to prioritize exact matches
    const filteredAndSortedModels = useMemo(() => {
        if (!modelSearchQuery.trim()) {
            return availableModels;
        }
        const query = modelSearchQuery.toLowerCase();

        const matched = availableModels.filter(m =>
            m.toLowerCase().includes(query)
        );

        return matched.sort((a, b) => {
            const aLower = a.toLowerCase();
            const bLower = b.toLowerCase();
            const aStartsWith = aLower.startsWith(query);
            const bStartsWith = bLower.startsWith(query);

            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;

            const aIndex = aLower.indexOf(query);
            const bIndex = bLower.indexOf(query);
            return aIndex - bIndex;
        });
    }, [availableModels, modelSearchQuery]);

    // Load config - defined early so it can be called in useEffect
    const loadConfig = useCallback(async () => {
        try {
            const config = await fetchConfig("/model") as ModelConfig;
            setEndpoints(config.endpoints || []);

            if (!activeEndpoint && config.selected_endpoint) {
                setActiveEndpoint(config.selected_endpoint);
            }
            if (!activeModel && config.model_name) {
                setActiveModel(config.model_name);
            }
        } catch (err) {
            console.error("Failed to load model config:", err);
        }
    }, [activeEndpoint, activeModel, setActiveEndpoint, setActiveModel]);

    // Fetch models for a specific endpoint
    const handleFetchModelsForEndpoint = useCallback(async (endpointName: string) => {
        const endpoint = endpoints.find(ep => ep.name === endpointName);
        if (!endpoint) return;

        setFetchingModels(true);
        try {
            const configForFetch = {
                provider: endpoint.provider,
                api_key: endpoint.api_key,
                endpoint: endpoint.endpoint,
            };

            const models = await fetchModels(configForFetch);
            setAvailableModels(models);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            toast.error("Failed to fetch models", { description: message });
        } finally {
            setFetchingModels(false);
        }
    }, [endpoints]);

    // Load endpoints from config on mount
    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    // Sync temp values and auto-fetch models when popover opens
    useEffect(() => {
        if (open) {
            setTempEndpoint(activeEndpoint);
            setTempModel(activeModel);
            setModelSearchQuery("");

            // Auto-fetch models when opening if endpoint is set
            if (activeEndpoint) {
                handleFetchModelsForEndpoint(activeEndpoint);
            }

            // Auto-focus the search input after a short delay
            setTimeout(() => {
                commandInputRef.current?.focus();
            }, 100);
        }
    }, [open, activeEndpoint, activeModel, handleFetchModelsForEndpoint]);

    // When endpoint changes, auto-fetch models
    const handleEndpointChange = useCallback((newEndpoint: string) => {
        setTempEndpoint(newEndpoint);
        setTempModel(""); // Clear model when endpoint changes
        if (newEndpoint) {
            handleFetchModelsForEndpoint(newEndpoint);
        } else {
            setAvailableModels([]);
        }
    }, [handleFetchModelsForEndpoint]);

    // Handle model selection - directly apply and close (keyboard Enter or click)
    const handleSelectModel = useCallback((model: string) => {
        if (tempEndpoint && model) {
            setActiveEndpoint(tempEndpoint);
            setActiveModel(model);
            setOpen(false);
        }
    }, [tempEndpoint, setActiveEndpoint, setActiveModel]);

    // Apply and close (for Apply button)
    const handleApply = useCallback(() => {
        if (tempEndpoint && tempModel) {
            setActiveEndpoint(tempEndpoint);
            setActiveModel(tempModel);
            setOpen(false);
        } else {
            toast.warning("Please select an endpoint and model");
        }
    }, [tempEndpoint, tempModel, setActiveEndpoint, setActiveModel]);

    // Get display text for current selection
    const getShortModelName = (modelName: string) => {
        if (!modelName) return '';
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
            <PopoverContent className="w-80 p-0" align="start">
                <div className="flex flex-col">
                    {/* Top: Endpoint Selector */}
                    <div className="p-3 border-b">
                        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Endpoint
                        </Label>
                        <Select value={tempEndpoint} onValueChange={handleEndpointChange}>
                            <SelectTrigger className="h-8">
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

                    {/* Middle: Model List with Search */}
                    <div className="flex-1">
                        <Command filter={() => 1} className="border-0">
                            <CommandInput
                                ref={commandInputRef}
                                placeholder="Search models..."
                                value={modelSearchQuery}
                                onValueChange={setModelSearchQuery}
                                className="h-9"
                            />
                            <CommandList className="max-h-[240px]">
                                {fetchingModels ? (
                                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Loading models...
                                    </div>
                                ) : availableModels.length === 0 ? (
                                    <CommandEmpty>
                                        {tempEndpoint
                                            ? "No models available"
                                            : "Select an endpoint first"}
                                    </CommandEmpty>
                                ) : filteredAndSortedModels.length === 0 ? (
                                    <CommandEmpty>No matching models</CommandEmpty>
                                ) : (
                                    <CommandGroup>
                                        {filteredAndSortedModels.map((model) => (
                                            <CommandItem
                                                key={model}
                                                value={model}
                                                onSelect={() => handleSelectModel(model)}
                                                className={cn(
                                                    "cursor-pointer",
                                                    tempModel === model && "bg-accent"
                                                )}
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
                                )}
                            </CommandList>
                        </Command>
                    </div>

                    {/* Bottom: Apply Button */}
                    <div className="p-3 border-t">
                        <Button
                            onClick={handleApply}
                            className="w-full"
                            disabled={!tempEndpoint || !tempModel}
                        >
                            Apply
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
