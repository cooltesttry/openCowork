"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsShell } from "@/components/settings/settings-shell";

export default function SettingsPage() {
    const header = (
        <div className="flex items-start gap-3">
            <Link href="/" className="mt-0.5">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full bg-background/70 hover:bg-background"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
            </Link>
            <div>
                <h1 className="text-lg font-semibold">Settings</h1>
                <p className="text-sm text-muted-foreground">
                    Manage your agent configuration
                </p>
            </div>
        </div>
    );

    return (
        <div className="h-[100dvh] w-full overflow-hidden bg-background">
            <SettingsShell header={header} />
        </div>
    );
}
