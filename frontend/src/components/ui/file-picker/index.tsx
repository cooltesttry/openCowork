"use client";

import * as React from "react";
import { FolderPlus, ChevronUp, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchCommonDirectories,
  listFilesAbsolute,
  createDirectoryAbsolute,
} from "@/lib/api";
import { Sidebar } from "./sidebar";
import { Breadcrumb } from "./breadcrumb";
import { FileList } from "./file-list";
import type {
  FilePickerDialogProps,
  FilePickerItem,
  CommonDirectory,
  FilePickerState,
} from "./types";

export function FilePickerDialog({
  open,
  onOpenChange,
  mode,
  type,
  title,
  defaultPath,
  fileFilter,
  onSelect,
  onCancel,
}: FilePickerDialogProps) {
  const [state, setState] = React.useState<FilePickerState>({
    currentPath: defaultPath || "",
    parentPath: null,
    files: [],
    selectedItem: null,
    loading: true,
    error: null,
    filename: "",
    showHidden: false,
  });

  const [commonDirs, setCommonDirs] = React.useState<CommonDirectory[]>([]);
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const filenameInputRef = React.useRef<HTMLInputElement>(null);

  // Load common directories on mount
  React.useEffect(() => {
    if (open) {
      fetchCommonDirectories()
        .then((data) => setCommonDirs(data.directories))
        .catch(console.error);
    }
  }, [open]);

  // Load files when path changes
  React.useEffect(() => {
    if (!open) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    listFilesAbsolute(state.currentPath, state.showHidden)
      .then((data) => {
        setState((prev) => ({
          ...prev,
          files: data.files,
          currentPath: data.current_path,
          parentPath: data.parent_path,
          loading: false,
          selectedItem: null,
        }));
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err.message,
        }));
      });
  }, [open, state.currentPath, state.showHidden]);

  // Focus filename input in create mode
  React.useEffect(() => {
    if (open && mode === "create" && filenameInputRef.current) {
      setTimeout(() => filenameInputRef.current?.focus(), 100);
    }
  }, [open, mode]);

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setState({
        currentPath: defaultPath || "",
        parentPath: null,
        files: [],
        selectedItem: null,
        loading: true,
        error: null,
        filename: "",
        showHidden: false,
      });
      setCreatingFolder(false);
      setNewFolderName("");
    }
  }, [open, defaultPath]);

  const navigateTo = React.useCallback((path: string) => {
    setState((prev) => ({ ...prev, currentPath: path }));
  }, []);

  const handleSelect = React.useCallback((item: FilePickerItem) => {
    setState((prev) => ({ ...prev, selectedItem: item }));
    if (mode === "create" && !item.is_directory) {
      setState((prev) => ({ ...prev, filename: item.name }));
    }
  }, [mode]);

  const handleDoubleClick = React.useCallback((item: FilePickerItem) => {
    if (item.is_directory) {
      setState((prev) => ({ ...prev, currentPath: item.path }));
    } else if (type !== "directory" && mode === "select") {
      onSelect(item.path);
      onOpenChange(false);
    }
  }, [type, mode, onSelect, onOpenChange]);

  const handleConfirm = React.useCallback(() => {
    setState((prev) => {
      if (mode === "select") {
        if (prev.selectedItem) {
          if (type === "directory" && !prev.selectedItem.is_directory) {
            return prev; // Can't select a file when only directories are allowed
          }
          onSelect(prev.selectedItem.path);
          onOpenChange(false);
        }
      } else {
        // Create mode
        if (prev.filename) {
          const fullPath = prev.currentPath + "/" + prev.filename;
          onSelect(fullPath);
          onOpenChange(false);
        }
      }
      return prev;
    });
  }, [mode, type, onSelect, onOpenChange]);

  const handleCancel = React.useCallback(() => {
    onCancel?.();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  const handleCreateFolder = React.useCallback(async () => {
    if (!newFolderName.trim()) return;

    try {
      setState((prev) => {
        const fullPath = prev.currentPath + "/" + newFolderName.trim();
        createDirectoryAbsolute(fullPath)
          .then(() => listFilesAbsolute(prev.currentPath, prev.showHidden))
          .then((data) => {
            setState((p) => ({
              ...p,
              files: data.files,
            }));
          })
          .catch((err) => console.error("Failed to create folder:", err));
        return prev;
      });
      setCreatingFolder(false);
      setNewFolderName("");
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  }, [newFolderName]);

  const goToParent = React.useCallback(() => {
    setState((prev) => {
      if (prev.parentPath) {
        return { ...prev, currentPath: prev.parentPath };
      }
      return prev;
    });
  }, []);

  const toggleHidden = () => {
    setState((prev) => ({ ...prev, showHidden: !prev.showHidden }));
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (creatingFolder) {
          setCreatingFolder(false);
          setNewFolderName("");
        } else {
          handleCancel();
        }
      } else if (e.key === "Enter") {
        if (creatingFolder) {
          handleCreateFolder();
        } else {
          handleConfirm();
        }
      } else if (e.key === "ArrowUp" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        goToParent();
      } else if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCreatingFolder(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, creatingFolder, goToParent, handleCancel, handleConfirm, handleCreateFolder]);

  const dialogTitle =
    title ||
    (mode === "select"
      ? type === "directory"
        ? "Select Folder"
        : "Select File"
      : "Save As");

  const confirmLabel =
    mode === "select" ? (type === "directory" ? "Select" : "Open") : "Save";

  const canConfirm =
    mode === "select"
      ? state.selectedItem !== null &&
        (type !== "directory" || state.selectedItem.is_directory)
      : state.filename.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-[820px] sm:!max-w-[820px] h-[520px] p-0 flex flex-col gap-0"
        showCloseButton={false}
      >
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <Sidebar
            directories={commonDirs}
            currentPath={state.currentPath}
            onNavigate={navigateTo}
          />

          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={goToParent}
                disabled={!state.parentPath}
                title="Go to parent (Cmd+Up)"
              >
                <ChevronUp className="size-4" />
              </Button>

              <Breadcrumb path={state.currentPath} onNavigate={navigateTo} />

              <div className="flex-1" />

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleHidden}
                title={state.showHidden ? "Hide hidden files" : "Show hidden files"}
              >
                {state.showHidden ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCreatingFolder(true)}
                title="New folder (Cmd+N)"
              >
                <FolderPlus className="size-4" />
              </Button>
            </div>

            {/* New folder input */}
            {creatingFolder && (
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-accent/20">
                <FolderPlus className="size-4 text-blue-500" />
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="New folder name"
                  className="h-8 flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateFolder();
                    } else if (e.key === "Escape") {
                      setCreatingFolder(false);
                      setNewFolderName("");
                    }
                  }}
                />
                <Button size="sm" onClick={handleCreateFolder}>
                  Create
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}

            {/* File list */}
            <FileList
              files={state.files}
              selectedItem={state.selectedItem}
              onSelect={handleSelect}
              onDoubleClick={handleDoubleClick}
              type={type}
              fileFilter={fileFilter}
              loading={state.loading}
              error={state.error}
            />
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-4 py-3 border-t gap-2">
          {mode === "create" && (
            <div className="flex-1 flex items-center gap-2 mr-4">
              <span className="text-sm text-muted-foreground shrink-0">
                File name:
              </span>
              <Input
                ref={filenameInputRef}
                value={state.filename}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, filename: e.target.value }))
                }
                placeholder="Enter filename"
                className="h-8"
              />
            </div>
          )}
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { FilePickerDialogProps, FileFilter, FilePickerItem } from "./types";
