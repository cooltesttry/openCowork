"use client";

import * as React from "react";
import {
  Home,
  Monitor,
  FileText,
  Download,
  Image,
  Music,
  Video,
  Folder,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CommonDirectory } from "./types";

const iconMap: Record<string, LucideIcon> = {
  home: Home,
  monitor: Monitor,
  "file-text": FileText,
  download: Download,
  image: Image,
  music: Music,
  video: Video,
  folder: Folder,
};

interface SidebarProps {
  directories: CommonDirectory[];
  currentPath: string;
  onNavigate: (path: string) => void;
  customShortcut?: { name: string; path: string; icon: string };
}

export function Sidebar({ directories, currentPath, onNavigate, customShortcut }: SidebarProps) {
  // Combine custom shortcut with common directories
  const allDirs = React.useMemo(() => {
    if (customShortcut) {
      return [customShortcut, ...directories];
    }
    return directories;
  }, [directories, customShortcut]);

  return (
    <div className="w-40 shrink-0 border-r border-border bg-muted/30 p-2 space-y-1">
      <div className="text-xs font-medium text-muted-foreground px-2 py-1 uppercase tracking-wide">
        Favorites
      </div>
      {allDirs.map((dir) => {
        const Icon = iconMap[dir.icon] || FileText;
        const isActive = currentPath === dir.path;

        return (
          <button
            key={dir.path}
            onClick={() => onNavigate(dir.path)}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md transition-colors",
              "hover:bg-accent/50",
              isActive && "bg-accent text-accent-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{dir.name}</span>
          </button>
        );
      })}
    </div>
  );
}
