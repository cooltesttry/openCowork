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
        <Card className="my-3 border-yellow-300 dark:border-yellow-700 bg-yellow-50/50 dark:bg-yellow-900/10">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                        <Shield className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
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
                <div className="flex items-start gap-2 p-2 rounded bg-yellow-100/50 dark:bg-yellow-900/20 text-sm">
                    <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                    <p className="text-yellow-800 dark:text-yellow-200">{description}</p>
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
                    className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white"
                >
                    Approve
                </Button>
            </CardFooter>
        </Card>
    );
}
