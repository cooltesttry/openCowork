"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { SettingsShell } from "@/components/settings/settings-shell";

interface SettingsDialogProps {
    trigger?: ReactNode;
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
            <DialogContent className="h-screen !w-screen !max-w-none max-h-none sm:!max-w-none rounded-none m-0 !p-0 !gap-0">
                <DialogHeader className="sr-only">
                    <DialogTitle>Settings</DialogTitle>
                </DialogHeader>
                <div className="h-full w-full overflow-hidden bg-background">
                    <SettingsShell />
                </div>
            </DialogContent>
        </Dialog>
    );
}
