"use client";

import * as React from "react";
import { ChevronRight, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumb({ path, onNavigate }: BreadcrumbProps) {
  const parts = path.split("/").filter(Boolean);

  const handleClick = (index: number) => {
    const newPath = "/" + parts.slice(0, index + 1).join("/");
    onNavigate(newPath);
  };

  return (
    <div className="flex items-center gap-1 text-sm overflow-x-auto scrollbar-none">
      <button
        onClick={() => onNavigate("/")}
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-accent/50 transition-colors shrink-0",
          parts.length === 0 && "bg-accent"
        )}
      >
        <HardDrive className="size-3.5" />
      </button>

      {parts.map((part, index) => (
        <React.Fragment key={index}>
          <ChevronRight className="size-3 text-muted-foreground shrink-0" />
          <button
            onClick={() => handleClick(index)}
            className={cn(
              "px-1.5 py-0.5 rounded hover:bg-accent/50 transition-colors truncate max-w-32",
              index === parts.length - 1 && "font-medium"
            )}
            title={part}
          >
            {part}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
