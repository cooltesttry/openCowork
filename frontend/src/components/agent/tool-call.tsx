import { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, CheckCircle, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ToolCallProps {
    name: string;
    input: any;
    result?: any;
    error?: string;
    isExpanded?: boolean;
}

export function ToolCall({ name, input, result, error, isExpanded: defaultExpanded = false }: ToolCallProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const status = error ? "error" : result ? "success" : "running";

    return (
        <Card className="mb-2 border overflow-hidden">
            <div
                className="flex items-center justify-between p-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Badge variant="outline" className="font-mono text-xs">
                        <Terminal className="h-3 w-3 mr-1 inline" />
                        {name}
                    </Badge>
                    {status === "running" && <span className="text-xs text-muted-foreground animate-pulse">Running...</span>}
                    {status === "success" && <CheckCircle className="h-4 w-4 text-green-500" />}
                    {status === "error" && <XCircle className="h-4 w-4 text-red-500" />}
                </div>
            </div>

            {isExpanded && (
                <div className="p-3 bg-card border-t text-xs font-mono overflow-x-auto">
                    <div className="mb-2">
                        <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">Input</div>
                        <pre className="bg-muted/50 p-2 rounded max-h-[150px] overflow-y-auto">
                            {JSON.stringify(input, null, 2)}
                        </pre>
                    </div>

                    {(result || error) && (
                        <div>
                            <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">
                                {error ? "Error" : "Result"}
                            </div>
                            <pre className={cn(
                                "p-2 rounded max-h-[150px] overflow-y-auto",
                                error ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" : "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                            )}>
                                {typeof result === 'string' ? result : JSON.stringify(result || error, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
