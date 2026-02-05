"use client";

import { useState, useEffect, useCallback } from "react";
import { useChat } from "@/lib/store";
import { ModelSelectorPopover, ModelEndpoint } from "@/components/ui/model-selector-popover";
import { fetchConfig, fetchModels } from "@/lib/api";
import { toast } from "sonner";

interface ModelConfig {
    endpoints: ModelEndpoint[];
    selected_endpoint: string;
    model_name: string;
}

export function ModelSelector() {
    const { activeEndpoint, setActiveEndpoint, activeModel, setActiveModel } = useChat();
    const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([]);

    // Load config
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

    // Load endpoints from config on mount
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadConfig();
    }, [loadConfig]);

    // Fetch models for endpoint
    const handleFetchModels = useCallback(async (endpoint: ModelEndpoint) => {
        try {
            const models = await fetchModels({
                provider: endpoint.provider,
                api_key: endpoint.api_key,
                endpoint: endpoint.endpoint,
            });
            return models;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            toast.error("Failed to fetch models", { description: message });
            return [];
        }
    }, []);

    // Handle endpoint change - clear model
    const handleEndpointChange = useCallback((endpoint: string) => {
        setActiveEndpoint(endpoint);
        setActiveModel(""); // Clear model when endpoint changes
    }, [setActiveEndpoint, setActiveModel]);

    return (
        <ModelSelectorPopover
            endpoints={endpoints}
            selectedEndpoint={activeEndpoint}
            selectedModel={activeModel}
            onEndpointChange={handleEndpointChange}
            onModelSelect={setActiveModel}
            fetchModelsForEndpoint={handleFetchModels}
            triggerVariant="ghost"
            align="start"
            placeholder="Select Model"
        />
    );
}
