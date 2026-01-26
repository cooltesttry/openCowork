"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import { Sparkles, Check, Loader2, ChevronDown } from "lucide-react";
import { fetchConfig, fetchModels, WorkerConfig } from "@/lib/api";
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

interface WorkerModelSelectorProps {
    worker: WorkerConfig;
    onUpdate: (updates: Partial<WorkerConfig>) => void;
    disabled?: boolean;
}

export function WorkerModelSelector({ worker, onUpdate, disabled }: WorkerModelSelectorProps) {
    const [open, setOpen] = useState(false);
    const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([]);

    // Temp state for the popover
    const [tempEndpointName, setTempEndpointName] = useState("");
    const [tempModel, setTempModel] = useState("");

    // Model list state
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelSearchQuery, setModelSearchQuery] = useState("");

    const commandInputRef = useRef<HTMLInputElement>(null);

    // Initial config load
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const config = await fetchConfig("/model") as ModelConfig;
                setEndpoints(config.endpoints || []);

                // Try to find matching endpoint for current worker
                if (worker.provider) {
                    const match = config.endpoints.find(ep =>
                        ep.provider === worker.provider &&
                        (ep.endpoint === worker.endpoint || (!ep.endpoint && !worker.endpoint))
                    );
                    if (match) {
                        setTempEndpointName(match.name);
                    }
                }
            } catch (err) {
                console.error("Failed to load model config:", err);
            }
        };
        loadConfig();
    }, [worker.provider, worker.endpoint]); // Depend on worker to re-match if it changes externally? Maybe just once or when open?

    // Sync temp model with worker model
    useEffect(() => {
        setTempModel(worker.model);
    }, [worker.model]);

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

    // Auto-fetch when popover opens or endpoint changes
    useEffect(() => {
        if (open && tempEndpointName) {
            handleFetchModelsForEndpoint(tempEndpointName);
            setTimeout(() => commandInputRef.current?.focus(), 100);
        }
    }, [open, tempEndpointName, handleFetchModelsForEndpoint]);

    const handleEndpointChange = (newName: string) => {
        setTempEndpointName(newName);
        setTempModel(""); // Clear model when endpoint changes
        handleFetchModelsForEndpoint(newName);
    };

    const handleSelectModel = (model: string) => {
        if (!tempEndpointName) return;

        const endpoint = endpoints.find(ep => ep.name === tempEndpointName);
        if (endpoint) {
            onUpdate({
                model: model,
                provider: endpoint.provider,
                endpoint: endpoint.endpoint,
                api_key: endpoint.api_key // Optional: deciding if we copy the key. Code implies yes.
            });
            setOpen(false);
        }
    };

    const filteredAndSortedModels = useMemo(() => {
        if (!modelSearchQuery.trim()) return availableModels;
        const query = modelSearchQuery.toLowerCase();
        return availableModels
            .filter(m => m.toLowerCase().includes(query))
            .sort((a, b) => {
                const aLower = a.toLowerCase();
                const bLower = b.toLowerCase();
                if (aLower.startsWith(query) && !bLower.startsWith(query)) return -1;
                if (!aLower.startsWith(query) && bLower.startsWith(query)) return 1;
                return aLower.indexOf(query) - bLower.indexOf(query);
            });
    }, [availableModels, modelSearchQuery]);

    const displayText = worker.model || "Select Model";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    disabled={disabled}
                    className="w-full justify-between"
                >
                    <div className="flex items-center gap-2 overflow-hidden">
                        <Sparkles className="h-4 w-4 shrink-0 opacity-50" />
                        <span className="truncate">{displayText}</span>
                    </div>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <div className="flex flex-col">
                    <div className="p-3 border-b">
                        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Endpoint
                        </Label>
                        <Select value={tempEndpointName} onValueChange={handleEndpointChange}>
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
                                            {ep.name} ({ep.provider})
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex-1">
                        <Command filter={() => 1} className="border-0">
                            <CommandInput
                                ref={commandInputRef}
                                placeholder="Search models..."
                                value={modelSearchQuery}
                                onValueChange={setModelSearchQuery}
                                className="h-9"
                            />
                            <CommandList className="max-h-[200px]">
                                {fetchingModels ? (
                                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Loading models...
                                    </div>
                                ) : availableModels.length === 0 ? (
                                    <CommandEmpty>
                                        {tempEndpointName ? "No models available" : "Select an endpoint first"}
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
                                                className="cursor-pointer"
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
                </div>
            </PopoverContent>
        </Popover>
    );
}
