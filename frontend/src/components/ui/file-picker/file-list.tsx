"use client";

import * as React from "react";
import { Folder, File, FileText, FileImage, FileVideo, FileAudio, FileCode, FileArchive } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilePickerItem, FileFilter } from "./types";

interface FileListProps {
  files: FilePickerItem[];
  selectedItem: FilePickerItem | null;
  onSelect: (item: FilePickerItem) => void;
  onDoubleClick: (item: FilePickerItem) => void;
  type: "file" | "directory" | "both";
  fileFilter?: FileFilter[];
  loading?: boolean;
  error?: string | null;
}

function getFileIcon(item: FilePickerItem) {
  if (item.is_directory) {
    return Folder;
  }

  const ext = item.name.split(".").pop()?.toLowerCase() || "";

  // Image files
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "ico", "bmp"].includes(ext)) {
    return FileImage;
  }

  // Video files
  if (["mp4", "mov", "avi", "mkv", "webm", "flv"].includes(ext)) {
    return FileVideo;
  }

  // Audio files
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) {
    return FileAudio;
  }

  // Code files
  if (["js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "css", "scss", "html", "vue", "svelte"].includes(ext)) {
    return FileCode;
  }

  // Archive files
  if (["zip", "tar", "gz", "rar", "7z", "bz2"].includes(ext)) {
    return FileArchive;
  }

  // Text/document files
  if (["txt", "md", "json", "yaml", "yml", "xml", "csv", "pdf", "doc", "docx"].includes(ext)) {
    return FileText;
  }

  return File;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "--";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function matchesFilter(item: FilePickerItem, fileFilter?: FileFilter[]): boolean {
  if (!fileFilter || fileFilter.length === 0) return true;
  if (item.is_directory) return true;

  const ext = item.name.split(".").pop()?.toLowerCase() || "";
  return fileFilter.some((filter) =>
    filter.extensions.some((filterExt) => filterExt.toLowerCase() === ext)
  );
}

export function FileList({
  files,
  selectedItem,
  onSelect,
  onDoubleClick,
  type,
  fileFilter,
  loading,
  error,
}: FileListProps) {
  // Filter files based on type and fileFilter
  const filteredFiles = files.filter((item) => {
    // Type filter
    if (type === "directory" && !item.is_directory) return false;
    if (type === "file" && item.is_directory) return true; // Always show directories for navigation

    // Extension filter
    return matchesFilter(item, fileFilter);
  });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-destructive">
        {error}
      </div>
    );
  }

  if (filteredFiles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No files found
      </div>
    );
  }

  return (
    <div className="flex-1 relative min-h-0">
      <div className="absolute inset-0 overflow-auto">
        <div className="divide-y divide-border">
        {filteredFiles.map((item) => {
          const Icon = getFileIcon(item);
          const isSelected = selectedItem?.path === item.path;
          const isDisabled = type === "file" && item.is_directory === false && !matchesFilter(item, fileFilter);

          return (
            <div
              key={item.path}
              onClick={() => !isDisabled && onSelect(item)}
              onDoubleClick={() => !isDisabled && onDoubleClick(item)}
              className={cn(
                "flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors text-[13px]",
                "hover:bg-blue-500/10",
                isSelected && "bg-blue-500/20 text-blue-600 dark:text-blue-400",
                isDisabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon
                className={cn(
                  "size-3.5 shrink-0",
                  item.is_directory ? "text-blue-500" : "text-muted-foreground"
                )}
              />
              <span className="flex-1 truncate">{item.name}</span>
              <span className="text-[11px] text-muted-foreground shrink-0 w-14 text-right">
                {formatSize(item.size)}
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0 w-20 text-right">
                {formatDate(item.modified_at)}
              </span>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
