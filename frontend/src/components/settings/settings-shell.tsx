"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModelConfig } from "@/components/settings/model-config";
import { McpConfig } from "@/components/settings/mcp-config";
import { SearchConfig } from "@/components/settings/search-config";
import { AgentConfig } from "@/components/settings/agent-config";
import { SkillsConfig } from "@/components/settings/skills-config";
import { Bot, Cpu, Library, Plug, Search, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsShellProps {
    header?: ReactNode;
    className?: string;
}

const SECTIONS = [
    {
        value: "model",
        title: "Model API",
        description: "Providers, endpoints, and tokens",
        icon: Cpu,
    },
    {
        value: "agent",
        title: "Agent",
        description: "Behavior and runtime controls",
        icon: Bot,
    },
    {
        value: "mcp",
        title: "MCP Servers",
        description: "Tools and server connections",
        icon: Plug,
    },
    {
        value: "search",
        title: "Search",
        description: "Retrieval and indexing",
        icon: Search,
    },
    {
        value: "skills",
        title: "Skills",
        description: "Library, manage, import",
        icon: Library,
    },
] as const;

export function SettingsShell({ header, className }: SettingsShellProps) {
    return (
        <Tabs
            defaultValue="model"
            className={cn("flex h-full w-full flex-col gap-0 lg:flex-row", className)}
        >
            <aside className="flex w-full flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground lg:w-72 lg:border-b-0 lg:border-r">
                <div className="px-6 py-6">
                    {header ?? (
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 inline-flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-primary">
                                <Settings className="size-4" />
                            </span>
                            <div>
                                <p className="text-lg font-semibold">Settings</p>
                                <p className="text-sm text-muted-foreground">
                                    Manage your agent configuration
                                </p>
                            </div>
                        </div>
                    )}
                </div>
                <div className="px-3 pb-4">
                    <TabsList className="!h-auto !w-full !bg-transparent !p-0 flex-col gap-1">
                        {SECTIONS.map((section) => {
                            const Icon = section.icon;
                            return (
                                <TabsTrigger
                                    key={section.value}
                                    value={section.value}
                                    className="group !h-auto w-full !justify-start gap-3 rounded-lg px-3 py-2.5 text-left"
                                >
                                    <span className="flex size-9 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition group-data-[state=active]:border-border group-data-[state=active]:text-foreground">
                                        <Icon className="size-4" />
                                    </span>
                                    <span className="flex flex-col">
                                        <span className="text-sm font-medium">
                                            {section.title}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {section.description}
                                        </span>
                                    </span>
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                </div>
            </aside>

            <main className="min-w-0 flex-1 overflow-auto bg-background">
                <div className="mx-auto w-full max-w-5xl px-6 py-8">
                    <TabsContent value="model" className="mt-0 space-y-6">
                        <ModelConfig />
                    </TabsContent>
                    <TabsContent value="agent" className="mt-0 space-y-6">
                        <AgentConfig />
                    </TabsContent>
                    <TabsContent value="mcp" className="mt-0 space-y-6">
                        <McpConfig />
                    </TabsContent>
                    <TabsContent value="search" className="mt-0 space-y-6">
                        <SearchConfig />
                    </TabsContent>
                    <TabsContent value="skills" className="mt-0 space-y-6">
                        <SkillsConfig />
                    </TabsContent>
                </div>
            </main>
        </Tabs>
    );
}
