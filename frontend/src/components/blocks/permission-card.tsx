"use client";

import { Shield, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { MessageBlock } from "@/lib/types";

interface PermissionCardProps {
    block: MessageBlock;
    onApprove?: () => void;
    onDeny?: () => void;
}

export function PermissionCard({ block, onApprove, onDeny }: PermissionCardProps) {
    const toolName = block.metadata?.toolName || "Unknown Tool";
    const description = typeof block.content === 'string'
        ? block.content
        : block.content?.description || "This tool requires your permission to execute.";

    return (
        <Card className="my-3 border-border bg-card w-full min-w-0 overflow-hidden">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-full bg-muted/40">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                        <h4 className="font-medium text-sm">Permission Request</h4>
                        <p className="text-xs text-muted-foreground">
                            Tool: <span className="font-mono">{toolName}</span>
                        </p>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="py-2">
                <div className="flex items-start gap-2 p-2 rounded bg-muted/30 text-sm">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <p className="text-foreground">{description}</p>
                </div>
            </CardContent>

            <CardFooter className="pt-2 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onDeny}
                    className="flex-1"
                >
                    Deny
                </Button>
                <Button
                    size="sm"
                    onClick={onApprove}
                    className="flex-1"
                >
                    Approve
                </Button>
            </CardFooter>
        </Card>
    );
}
