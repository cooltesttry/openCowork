"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { ModelConfig } from "@/components/settings/model-config";
import { McpConfig } from "@/components/settings/mcp-config";
import { SearchConfig } from "@/components/settings/search-config";
import { AgentConfig } from "@/components/settings/agent-config";

interface SettingsDialogProps {
    trigger?: React.ReactNode;
}

export function SettingsDialog({ trigger }: SettingsDialogProps) {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {trigger ? (
                <div onClick={() => setOpen(true)}>{trigger}</div>
            ) : (
                <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
                    <Settings className="h-5 w-5" />
                </Button>
            )}
            <DialogContent className="w-screen h-screen max-w-none max-h-none rounded-none m-0 p-6 flex flex-col">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Manage your agent configuration
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto">
                    <Tabs defaultValue="model" className="space-y-4">
                        <TabsList>
                            <TabsTrigger value="model">Model API</TabsTrigger>
                            <TabsTrigger value="agent">Agent</TabsTrigger>
                            <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
                            <TabsTrigger value="search">Search</TabsTrigger>
                        </TabsList>

                        <TabsContent value="model">
                            <ModelConfig />
                        </TabsContent>

                        <TabsContent value="agent">
                            <AgentConfig />
                        </TabsContent>

                        <TabsContent value="mcp">
                            <McpConfig />
                        </TabsContent>

                        <TabsContent value="search">
                            <SearchConfig />
                        </TabsContent>
                    </Tabs>
                </div>
            </DialogContent>
        </Dialog>
    );
}
