"use client";

import { Circle, Clock, CheckCircle2, ListTodo } from "lucide-react";
import { MessageBlock, TodoItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PlanBlockProps {
    block: MessageBlock;
}

const statusConfig = {
    pending: {
        icon: Circle,
        className: "text-muted-foreground",
        label: "Pending"
    },
    in_progress: {
        icon: Clock,
        className: "text-blue-500",
        label: "In Progress"
    },
    completed: {
        icon: CheckCircle2,
        className: "text-green-500",
        label: "Completed"
    }
};

export function PlanBlock({ block }: PlanBlockProps) {
    const todos: TodoItem[] = block.metadata?.todos || [];

    if (todos.length === 0) {
        return null;
    }

    const completedCount = todos.filter(t => t.status === 'completed').length;
    const progress = Math.round((completedCount / todos.length) * 100);

    return (
        <div className="my-3 rounded-lg border bg-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <ListTodo className="h-4 w-4 text-primary" />
                    <span>Execution Plan</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {completedCount}/{todos.length}
                    </span>
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Todo List */}
            <div className="p-3 space-y-1">
                {todos.map((todo) => {
                    const config = statusConfig[todo.status];
                    const Icon = config.icon;

                    return (
                        <div
                            key={todo.id}
                            className={cn(
                                "flex items-start gap-2 py-1.5 px-2 rounded text-sm",
                                todo.status === 'in_progress' && "bg-blue-50/50 dark:bg-blue-900/10",
                                todo.status === 'completed' && "opacity-60"
                            )}
                        >
                            <Icon className={cn("h-4 w-4 flex-shrink-0 mt-0.5", config.className)} />
                            <span className={cn(
                                todo.status === 'completed' && "line-through"
                            )}>
                                {todo.content}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
