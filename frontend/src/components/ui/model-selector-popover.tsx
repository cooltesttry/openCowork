"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { Sparkles, Check, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModelEndpoint {
    name: string;
    provider: string;
    api_key?: string;
    endpoint?: string;
}

export interface ModelSelectorPopoverProps {
    /** List of available endpoints */
    endpoints: ModelEndpoint[];
    /** Currently selected endpoint name */
    selectedEndpoint: string;
    /** Currently selected model name */
    selectedModel: string;
    /** Callback when endpoint changes */
    onEndpointChange: (endpoint: string) => void;
    /** Callback when model is selected */
    onModelSelect: (model: string) => void;
    /** Function to fetch models for an endpoint, should return a promise of model names */
    fetchModelsForEndpoint: (endpoint: ModelEndpoint) => Promise<string[]>;
    /** Trigger button variant */
    triggerVariant?: "ghost" | "outline";
    /** Trigger button className */
    triggerClassName?: string;
    /** Icon to show in trigger */
    icon?: "sparkles" | "image";
    /** Popover alignment */
    align?: "start" | "end";
    /** Placeholder text when no model selected */
    placeholder?: string;
    /** Whether popover is controlled externally */
    open?: boolean;
    /** Callback when popover open state changes */
    onOpenChange?: (open: boolean) => void;
}

export function ModelSelectorPopover({
    endpoints,
    selectedEndpoint,
    selectedModel,
    onEndpointChange,
    onModelSelect,
    fetchModelsForEndpoint,
    triggerVariant = "outline",
    triggerClassName,
    icon = "sparkles",
    align = "end",
    placeholder = "Select model...",
    open: controlledOpen,
    onOpenChange,
}: ModelSelectorPopoverProps) {
    // Internal open state (can be controlled or uncontrolled)
    const [internalOpen, setInternalOpen] = useState(false);
    const open = controlledOpen ?? internalOpen;
    const setOpen = onOpenChange ?? setInternalOpen;

    // Model list state
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);

    // Refs for auto-focus and scroll
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Fetch models for endpoint
    const handleFetchModels = useCallback(async (endpointName: string) => {
        const endpoint = endpoints.find(ep => ep.name === endpointName);
        if (!endpoint) return;

        setFetchingModels(true);
        try {
            const models = await fetchModelsForEndpoint(endpoint);
            // Sort models alphabetically for consistent ordering
            setAvailableModels([...models].sort((a, b) => a.localeCompare(b)));
        } catch (err) {
            console.error("Failed to fetch models:", err);
            setAvailableModels([]);
        } finally {
            setFetchingModels(false);
        }
    }, [endpoints, fetchModelsForEndpoint]);

    // Auto-fetch models and focus when popover opens
    useEffect(() => {
        if (open) {
            if (selectedEndpoint) {
                handleFetchModels(selectedEndpoint);
            }
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open, selectedEndpoint, handleFetchModels]);

    // Scroll to selected model when popover opens
    useEffect(() => {
        if (!open) return;

        const scrollToSelected = () => {
            if (!selectedModel || !listRef.current) return false;
            const selected = listRef.current.querySelector(`[data-value="${selectedModel.toLowerCase()}"]`);
            if (selected) {
                selected.scrollIntoView({ block: 'center', behavior: 'instant' });
                return true;
            }
            return false;
        };

        if (!scrollToSelected()) {
            let attempts = 0;
            const interval = setInterval(() => {
                if (scrollToSelected() || ++attempts > 10) {
                    clearInterval(interval);
                }
            }, 50);
            return () => clearInterval(interval);
        }
    }, [open, selectedModel]);

    // Handle endpoint change
    const handleEndpointChange = useCallback((newEndpoint: string) => {
        const endpoint = newEndpoint === "_none" ? "" : newEndpoint;
        onEndpointChange(endpoint);
        if (endpoint) {
            handleFetchModels(endpoint);
        } else {
            setAvailableModels([]);
        }
    }, [onEndpointChange, handleFetchModels]);

    // Handle model selection
    const handleModelSelect = useCallback((model: string) => {
        onModelSelect(model);
        setOpen(false);
    }, [onModelSelect, setOpen]);

    // Get short model name for display
    const getShortModelName = (modelName: string) => {
        if (!modelName) return '';
        const parts = modelName.split('/');
        return parts[parts.length - 1];
    };

    const displayText = selectedModel ? getShortModelName(selectedModel) : placeholder;
    const IconComponent = icon === "image" ? ImageIcon : Sparkles;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant={triggerVariant}
                    className={cn(
                        "gap-2 justify-start",
                        triggerVariant === "ghost"
                            ? "h-6 px-2 text-sm font-normal hover:bg-accent text-muted-foreground"
                            : "h-9 min-w-[200px]",
                        triggerClassName
                    )}
                >
                    <IconComponent className={cn(
                        triggerVariant === "ghost" ? "h-3.5 w-3.5" : "h-4 w-4 text-muted-foreground"
                    )} />
                    <span className="truncate">{displayText}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align={align}>
                <div className="flex flex-col">
                    {/* Endpoint Selector */}
                    <div className="p-3 border-b">
                        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Endpoint
                        </Label>
                        <Select
                            value={selectedEndpoint || "_none"}
                            onValueChange={handleEndpointChange}
                        >
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

                    {/* Model List */}
                    <Command className="border-0">
                        <CommandInput
                            ref={inputRef}
                            placeholder="Search models..."
                            className="h-9"
                        />
                        <CommandList ref={listRef} className="max-h-[240px]">
                            {fetchingModels ? (
                                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Loading models...
                                </div>
                            ) : availableModels.length === 0 ? (
                                <CommandEmpty>
                                    {selectedEndpoint
                                        ? "No models available"
                                        : "Select an endpoint first"}
                                </CommandEmpty>
                            ) : (
                                <CommandGroup>
                                    {availableModels.map((model) => (
                                        <CommandItem
                                            key={model}
                                            value={model}
                                            onSelect={() => handleModelSelect(model)}
                                        >
                                            <Check
                                                className={cn(
                                                    "mr-2 h-4 w-4",
                                                    selectedModel === model ? "opacity-100" : "opacity-0"
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
            </PopoverContent>
        </Popover>
    );
}
