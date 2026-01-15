"use client";

import { useEffect, useState } from "react";
import { fetchConfig, updateConfig } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export function SearchConfig() {
    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const data = await fetchConfig("/search");
            setConfig(data);
        } catch (err) {
            toast.error("Error", { description: "Failed to load search config" });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            await updateConfig("/search", config);
            toast.success("Success", { description: "Search configuration saved" });
        } catch (err) {
            toast.error("Error", { description: "Failed to save config" });
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Search Configuration</CardTitle>
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
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="serper">Serper (Google)</SelectItem>
                            <SelectItem value="tavily">Tavily AI</SelectItem>
                            <SelectItem value="brave">Brave Search</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label>API Key</Label>
                    <Input
                        type="password"
                        value={config.api_key || ""}
                        onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                        placeholder="Search Provider API Key"
                    />
                </div>

                <div className="space-y-2">
                    <Label>Max Results</Label>
                    <Input
                        type="number"
                        value={config.max_results}
                        onChange={(e) => setConfig({ ...config, max_results: parseInt(e.target.value) })}
                    />
                </div>

                <Button onClick={handleSave}>Save Changes</Button>
            </CardContent>
            <Toaster />
        </Card>
    );
}
