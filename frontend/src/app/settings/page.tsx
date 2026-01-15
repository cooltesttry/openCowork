"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModelConfig } from "@/components/settings/model-config";
import { McpConfig } from "@/components/settings/mcp-config";
import { SearchConfig } from "@/components/settings/search-config";
import { AgentConfig } from "@/components/settings/agent-config";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
    return (
        <div className="container mx-auto py-10 max-w-4xl">
            <div className="flex items-center gap-4 mb-8">
                <Link href="/">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
                    <p className="text-muted-foreground">Manage your agent configuration</p>
                </div>
            </div>

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
    );
}

