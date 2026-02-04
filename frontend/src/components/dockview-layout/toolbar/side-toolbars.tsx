"use client";

import { FolderOpen, PanelRightClose, PanelRightOpen, Wrench } from "lucide-react";

import { useChat } from "@/lib/store";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";

export const DOCKSIDE_TOOLBAR_WIDTH = 44;

export function DocksideToolbars({ toolsPanelWidth }: { toolsPanelWidth: number }) {
    const {
        isProcessing,
        isSidebarOpen,
        setIsSidebarOpen,
        isSessionSidebarOpen,
        setIsSessionSidebarOpen,
        rightPanelView,
        setRightPanelView,
    } = useChat();

    return (
        <>
            {/* Right toolbar / header */}
            <aside
                className={`fixed right-0 top-0 z-40 overflow-hidden border-l bg-card/90 backdrop-blur transition-[width,height] duration-200 ease-out ${isSidebarOpen ? "border-b" : ""}`}
                style={{
                    width: isSidebarOpen ? toolsPanelWidth : DOCKSIDE_TOOLBAR_WIDTH,
                    height: isSidebarOpen ? 40 : "100%",
                }}
            >
                {isSidebarOpen ? (
                    <div className="flex h-full items-center justify-between px-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsSidebarOpen(false)}
                            title="隐藏 MCP Servers"
                        >
                            <PanelRightClose className="h-5 w-5" />
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button
                                variant={rightPanelView === "files" ? "secondary" : "ghost"}
                                size="icon"
                                onClick={() => setRightPanelView("files")}
                                title="Files"
                            >
                                <FolderOpen className="h-4 w-4" />
                            </Button>
                            <Button
                                variant={rightPanelView === "tools" ? "secondary" : "ghost"}
                                size="icon"
                                onClick={() => setRightPanelView("tools")}
                                title="Tools"
                            >
                                <Wrench className="h-4 w-4" />
                            </Button>
                            <div className="flex h-8 w-8 items-center justify-center" title={isProcessing ? "Active" : "Idle"}>
                                <div
                                    className={`h-2 w-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
                                />
                            </div>
                            <ThemeToggle />
                            <SettingsDialog />
                        </div>
                    </div>
                ) : (
                    <div className="flex h-full flex-col items-stretch gap-5 py-5">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsSidebarOpen(true)}
                            title="显示 MCP Servers"
                            className="w-full !h-11 !rounded-none px-0"
                        >
                            <PanelRightOpen className="h-7 w-7" />
                        </Button>

                        <ThemeToggle buttonClassName="w-full !h-11 !rounded-none px-0" iconClassName="h-7 w-7" />
                        <SettingsDialog buttonClassName="w-full !h-11 !rounded-none px-0" iconClassName="h-7 w-7" />

                        <div
                            className="mt-auto flex h-11 w-full items-center justify-center"
                            title={isProcessing ? "Active" : "Idle"}
                        >
                            <div
                                className={`h-2 w-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
                            />
                        </div>
                    </div>
                )}
            </aside>
        </>
    );
}
