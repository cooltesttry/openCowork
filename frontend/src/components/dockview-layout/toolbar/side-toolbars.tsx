"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

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
    } = useChat();

    return (
        <>
            {/* Left toolbar */}
            <aside
                className={`fixed left-0 top-0 z-40 flex h-full flex-col items-center border-r bg-card/90 backdrop-blur transition-[opacity,transform] duration-200 ease-out ${isSessionSidebarOpen ? "pointer-events-none opacity-0 -translate-x-2" : "opacity-100 translate-x-0"}`}
                style={{ width: DOCKSIDE_TOOLBAR_WIDTH }}
            >
                <div className="flex flex-col items-center gap-2 py-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsSessionSidebarOpen(true)}
                        title="展开会话列表"
                    >
                        <PanelLeftOpen className="h-5 w-5" />
                    </Button>
                </div>
            </aside>

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
                    <div className="flex h-full flex-col items-center gap-2 py-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsSidebarOpen(true)}
                            title="显示 MCP Servers"
                        >
                            <PanelRightOpen className="h-5 w-5" />
                        </Button>

                        <div className="flex h-8 w-8 items-center justify-center" title={isProcessing ? "Active" : "Idle"}>
                            <div
                                className={`h-2 w-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
                            />
                        </div>

                        <ThemeToggle />
                        <SettingsDialog />
                    </div>
                )}
            </aside>
        </>
    );
}
