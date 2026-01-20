"use client";

import React, { useEffect, useState, useCallback } from "react";
import { DndContext, DragEndEvent, DragStartEvent, DragMoveEvent, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { FileTreeItem } from "./file-tree";
import { FileEntry } from "./types";
import { Loader2, RefreshCw, File, Folder, AtSign, Pencil, Trash2, FolderPlus, FilePlus, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { FilePreviewPopup } from "./file-preview-popup";
import { fileWatcherClient, FileWatchEvent } from "@/lib/file-watcher";

const isCodeFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const codeExts = [
        'txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html',
        'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'php', 'rb', 'sh',
        'yaml', 'yml', 'xml', 'sql', 'ini', 'conf', 'env'
    ];
    return ext && codeExts.includes(ext);
};

interface FileExplorerProps {
    className?: string;
    onMentionFile?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    isPreviewPanelActive?: () => boolean;
}

export function FileExplorer({ className, onMentionFile, onOpenFile, onSelectFile, isPreviewPanelActive }: FileExplorerProps) {
    const [rootFiles, setRootFiles] = useState<FileEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

    // Custom Overlay Refs
    const customOverlayRef = React.useRef<HTMLDivElement>(null);
    const dragStartRectRef = React.useRef<{ left: number; top: number } | null>(null);

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
    const [activeItem, setActiveItem] = useState<FileEntry | null>(null);
    const [pendingConflict, setPendingConflict] = useState<{ sourcePath: string; destPath: string; fileName: string } | null>(null);
    const [isDraggingExternal, setIsDraggingExternal] = useState(false);
    const [uploadConflict, setUploadConflict] = useState<{ file: File; destination: string } | null>(null);
    const dragCounterRef = React.useRef(0);
    const containerRef = React.useRef<HTMLDivElement>(null);

    // Action dialog states
    const [editingPath, setEditingPath] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const [editingEntry, setEditingEntry] = useState<FileEntry | null>(null);
    const [editingSelectionStart, setEditingSelectionStart] = useState<number | undefined>(undefined);
    const [editingSelectionEnd, setEditingSelectionEnd] = useState<number | undefined>(undefined);
    const [deleteDialog, setDeleteDialog] = useState<FileEntry | null>(null);

    // Popup Preview State
    const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
    const [previewPosition, setPreviewPosition] = useState<{ x: number; y: number } | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const fetchFiles = useCallback(async () => {
        setIsLoading(true);
        try {
            // Fetch flat list or recursive? The backend supports recursive by default
            const res = await fetch("http://localhost:8000/api/files/list?subdir=&recursive=true");
            if (!res.ok) throw new Error("Failed to fetch files");
            const data = await res.json();

            // The backend returns a flat list of all files with paths? 
            // Wait, backend logic: list_files returns detailed recursive scan?
            // Let's re-verify backend return format.
            // Backend returns: FileItem { name, path, is_directory }
            // If we want a tree, we need to build it from the backend list if it is flat, or stricture it.
            // Backend implementation:
            // function scan_directory...
            // results.append(FileItem(... path=rel_path ...))
            // It returns a FLAT list of all files found recursively.
            // So frontend needs to rebuild the tree.

            const files: FileEntry[] = (data.files as FileEntry[]) || [];
            const tree = buildTree(files);
            setRootFiles(tree);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    // File watcher integration - auto-refresh on file system changes
    useEffect(() => {
        const handleFileChange = (event: FileWatchEvent) => {
            console.log("[FileExplorer] File change detected:", event);
            fetchFiles();
        };

        fileWatcherClient.connect(handleFileChange);

        return () => {
            fileWatcherClient.disconnect();
        };
    }, [fetchFiles]);

    // Helper to build tree from flat paths
    const buildTree = (flatFiles: FileEntry[]): FileEntry[] => {
        const root: FileEntry[] = [];
        const map: Record<string, FileEntry> = {};

        // First pass: create all entry objects
        flatFiles.forEach(f => {
            // Normalize path
            const path = f.path.endsWith('/') ? f.path.slice(0, -1) : f.path;
            map[path] = { ...f, path, children: [] };
        });

        // Second pass: attach to parents
        flatFiles.forEach(f => {
            const path = f.path.endsWith('/') ? f.path.slice(0, -1) : f.path;
            const entry = map[path];

            // Find parent path
            const parts = path.split('/');
            if (parts.length === 1) {
                root.push(entry);
            } else {
                const parentPath = parts.slice(0, -1).join('/');
                if (map[parentPath]) {
                    map[parentPath].children = map[parentPath].children || [];
                    map[parentPath].children!.push(entry);
                } else {
                    // Parent missing (maybe ignored?), push to root or ignore? 
                    // For now push to root if parent not found is risky, usually means partial scan.
                    // Or maybe the path includes the root dir name?
                    // Backend: rel_path = str(item.relative_to(base_path))
                    // So top level items have no slashes.
                    root.push(entry);
                }
            }
        });

        // Sort each level
        const sortFn = (a: FileEntry, b: FileEntry) => {
            if (a.is_directory === b.is_directory) return a.name.localeCompare(b.name);
            return a.is_directory ? -1 : 1;
        };

        const sortRecursive = (entries: FileEntry[]) => {
            entries.sort(sortFn);
            entries.forEach(e => {
                if (e.children) sortRecursive(e.children);
            });
        };

        sortRecursive(root);
        return root;
    };

    const handleToggleExpand = (path: string) => {
        const newSet = new Set(expandedPaths);
        if (newSet.has(path)) {
            newSet.delete(path);
        } else {
            newSet.add(path);
        }
        setExpandedPaths(newSet);
    };

    const onDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;

        // Don't do anything if dropping on self
        if (active.id === over.id) return;

        // Get the target entry data
        const targetEntry = over.data?.current as FileEntry | undefined;
        const sourcePath = active.id as string;
        const sourceEntry = active.data?.current as FileEntry | undefined;

        // Determine the actual destination directory
        // If dropping on a folder, use that folder
        // If dropping on a file, use that file's parent directory
        let destPath: string;
        if (targetEntry?.is_directory) {
            destPath = over.id as string;
        } else {
            // Get parent directory of the target file
            const targetPath = over.id as string;
            destPath = targetPath.includes('/')
                ? targetPath.substring(0, targetPath.lastIndexOf('/'))
                : '.'; // root level
        }

        // Check if source file's parent is the same as destination (no-op)
        const sourceParent = sourcePath.includes('/')
            ? sourcePath.substring(0, sourcePath.lastIndexOf('/'))
            : '.'; // root level files

        if (sourceParent === destPath) {
            // File is already in this folder, do nothing
            console.log("File already in target folder, skipping move");
            return;
        }

        // Prevent dragging a folder into itself or any of its children
        if (sourceEntry?.is_directory && (destPath === sourcePath || destPath.startsWith(sourcePath + '/'))) {
            console.log("Cannot move a folder into itself or its children");
            return;
        }

        console.log(`Moving ${sourcePath} into ${destPath}`);

        await performMove(sourcePath, destPath);
    };

    // Helper function to perform the actual move
    const performMove = async (sourcePath: string, destPath: string, force: boolean = false) => {
        try {
            const res = await fetch("http://localhost:8000/api/files/move", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    source_path: sourcePath,
                    destination_path: destPath,
                    force: force
                })
            });

            if (res.ok) {
                fetchFiles();
                setPendingConflict(null);
            } else if (res.status === 409) {
                // Conflict - file exists. Show confirmation dialog
                const fileName = sourcePath.includes('/')
                    ? sourcePath.substring(sourcePath.lastIndexOf('/') + 1)
                    : sourcePath;
                setPendingConflict({ sourcePath, destPath, fileName });
            } else {
                const errorData = await res.json().catch(() => ({}));
                console.error("Move failed:", res.status, errorData.detail || "Unknown error");
            }
        } catch (e) {
            console.error("Move request error:", e);
        }
    };

    const handleConfirmOverwrite = () => {
        if (pendingConflict) {
            performMove(pendingConflict.sourcePath, pendingConflict.destPath, true);
        }
    };

    const handleCancelOverwrite = () => {
        setPendingConflict(null);
    };

    // Upload file to server
    const uploadFile = async (file: File, destination: string = "", force: boolean = false) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("destination", destination);
        formData.append("force", String(force));

        try {
            const res = await fetch("http://localhost:8000/api/files/upload", {
                method: "POST",
                body: formData
            });

            if (res.ok) {
                fetchFiles();
                setUploadConflict(null);
            } else if (res.status === 409) {
                // File exists - show conflict dialog
                setUploadConflict({ file, destination });
            } else {
                const errorData = await res.json().catch(() => ({}));
                console.error("Upload failed:", res.status, errorData.detail || "Unknown error");
            }
        } catch (e) {
            console.error("Upload request error:", e);
        }
    };

    // External drag-drop handlers using counter for nested elements
    const handleExternalDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) {
            dragCounterRef.current++;
            setIsDraggingExternal(true);
        }
    };

    const handleExternalDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        // Keep accepting the drag
        if (e.dataTransfer.types.includes("Files")) {
            e.dataTransfer.dropEffect = "copy";
        }
    };

    const handleExternalDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setIsDraggingExternal(false);
        }
    };

    const handleExternalDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDraggingExternal(false);

        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        // Upload all dropped files to root
        for (let i = 0; i < files.length; i++) {
            await uploadFile(files[i], "");
        }
    };

    const handleConfirmUploadOverwrite = () => {
        if (uploadConflict) {
            uploadFile(uploadConflict.file, uploadConflict.destination, true);
        }
    };

    const handleCancelUploadOverwrite = () => {
        setUploadConflict(null);
    };

    // Start inline rename
    const startRename = (entry: FileEntry) => {
        setEditingPath(entry.path);
        setEditingName(entry.name);
        setEditingEntry(entry);
    };

    // Cancel inline rename
    const cancelRename = () => {
        setEditingPath(null);
        setEditingName('');
        setEditingEntry(null);
        setEditingSelectionStart(undefined);
        setEditingSelectionEnd(undefined);
    };

    // Rename handler - use ref to prevent duplicate calls
    const isRenamingRef = React.useRef(false);
    const handleRename = async () => {
        if (!editingEntry || !editingPath) {
            cancelRename();
            return;
        }

        // Prevent duplicate calls from blur/enter
        if (isRenamingRef.current) return;
        isRenamingRef.current = true;

        const newName = editingName.trim();
        if (!newName || newName === editingEntry.name) {
            cancelRename();
            isRenamingRef.current = false;
            return;
        }

        // Calculate new path
        const parentPath = editingEntry.path.includes('/')
            ? editingEntry.path.substring(0, editingEntry.path.lastIndexOf('/'))
            : '';
        const newPath = parentPath ? `${parentPath}/${newName}` : newName;

        try {
            const res = await fetch('http://localhost:8000/api/files/rename', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_path: editingEntry.path, new_path: newPath }),
            });

            if (res.status === 409) {
                toast.error(`"${newName}" 已存在，请使用其他名称`);
                isRenamingRef.current = false;
                // Don't cancel - let user edit again
                return;
            }

            if (!res.ok) {
                const error = await res.json();
                toast.error(`重命名失败: ${error.detail || '未知错误'}`);
                cancelRename();
                isRenamingRef.current = false;
                return;
            }

            cancelRename();
            isRenamingRef.current = false;
            fetchFiles();
        } catch (err) {
            console.error('Rename failed:', err);
            toast.error('重命名失败');
            cancelRename();
            isRenamingRef.current = false;
        }
    };

    // Delete handler
    const handleDelete = async () => {
        if (!deleteDialog) return;

        try {
            const res = await fetch('http://localhost:8000/api/files/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: deleteDialog.path }),
            });

            if (!res.ok) {
                const error = await res.json();
                alert(`删除失败: ${error.detail || '未知错误'}`);
                return;
            }

            setDeleteDialog(null);
            fetchFiles();
        } catch (err) {
            console.error('Delete failed:', err);
            alert('删除失败');
        }
    };

    // Create new folder immediately with unique name, then enter inline rename mode
    const createNewFolderInline = async (parentPath: string) => {
        // Find unique folder name
        const baseName = 'New_Folder';
        let folderName = baseName;
        let counter = 1;

        // Try to create, incrementing name if conflict
        while (true) {
            const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;

            try {
                const res = await fetch('http://localhost:8000/api/files/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: folderPath, is_directory: true }),
                });

                if (res.status === 409) {
                    // Name exists, try next
                    counter++;
                    folderName = `${baseName}_${counter}`;
                    continue;
                }

                if (!res.ok) {
                    const error = await res.json();
                    toast.error(`创建文件夹失败: ${error.detail || '未知错误'}`);
                    return;
                }

                // Success! Expand parent and refresh, then start inline rename
                if (parentPath) {
                    setExpandedPaths(prev => new Set([...prev, parentPath]));
                }
                await fetchFiles();

                // Start inline rename on the new folder
                const newFolderPath = folderPath;
                setEditingPath(newFolderPath);
                setEditingName(folderName);
                setEditingEntry({
                    name: folderName,
                    path: newFolderPath,
                    is_directory: true
                });
                break;
            } catch (err) {
                console.error('Create folder failed:', err);
                toast.error('创建文件夹失败');
                return;
            }
        }
    };

    // Create new file immediately with unique name, then enter inline rename mode
    const createNewFileInline = async (parentPath: string) => {
        // Find unique file name
        const baseName = 'Untitled';
        const extension = '.txt';
        let fileName = baseName + extension;
        let counter = 1;

        // Try to create, incrementing name if conflict
        while (true) {
            const filePath = parentPath ? `${parentPath}/${fileName}` : fileName;

            try {
                const res = await fetch('http://localhost:8000/api/files/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath, is_directory: false }),
                });

                if (res.status === 409) {
                    // Name exists, try next
                    counter++;
                    fileName = `${baseName}-${counter}${extension}`;
                    continue;
                }

                if (!res.ok) {
                    const error = await res.json();
                    toast.error(`创建文件失败: ${error.detail || '未知错误'}`);
                    return;
                }

                // Success! Expand parent and refresh, then start inline rename
                if (parentPath) {
                    setExpandedPaths(prev => new Set([...prev, parentPath]));
                }
                await fetchFiles();

                // Start inline rename on the new file
                const newFilePath = filePath;
                setEditingPath(newFilePath);
                setEditingName(fileName);
                setEditingEntry({
                    name: fileName,
                    path: newFilePath,
                    is_directory: false
                });
                break;
            } catch (err) {
                console.error('Create file failed:', err);
                toast.error('创建文件失败');
                return;
            }
        }
    };

    // Duplicate file/folder and enter inline rename mode
    const duplicateItem = async (entry: FileEntry) => {
        try {
            const res = await fetch('http://localhost:8000/api/files/duplicate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: entry.path }),
            });

            if (!res.ok) {
                const error = await res.json();
                toast.error(`复制失败: ${error.detail || '未知错误'}`);
                return;
            }

            const data = await res.json();

            // Expand parent folder if needed
            const parentPath = entry.path.includes('/')
                ? entry.path.substring(0, entry.path.lastIndexOf('/'))
                : '';
            if (parentPath) {
                setExpandedPaths(prev => new Set([...prev, parentPath]));
            }

            await fetchFiles();

            // Start inline rename on the duplicated item
            // Calculate selection range to only select the " copy" or " copy N" part
            const newName: string = data.new_name;
            const originalName = entry.name;

            // For files with extension, the pattern is: "stem copy.ext" or "stem copy N.ext"
            // For folders, the pattern is: "name copy" or "name copy N"
            // We want to select only the " copy" or " copy N" part (before extension if file)
            let selectionStart: number;
            let selectionEnd: number;

            if (!entry.is_directory && originalName.includes('.')) {
                // File with extension: find the stem and extension
                const origStem = originalName.substring(0, originalName.lastIndexOf('.'));
                const extIndex = newName.lastIndexOf('.');
                // Select from after original stem to before extension
                selectionStart = origStem.length;
                selectionEnd = extIndex;
            } else {
                // Folder or file without extension: select from after original name to end
                selectionStart = originalName.length;
                selectionEnd = newName.length;
            }

            setEditingPath(data.new_path);
            setEditingName(newName);
            setEditingEntry({
                name: newName,
                path: data.new_path,
                is_directory: entry.is_directory
            });
            setEditingSelectionStart(selectionStart);
            setEditingSelectionEnd(selectionEnd);
        } catch (err) {
            console.error('Duplicate failed:', err);
            toast.error('复制失败');
        }
    };

    // Open file/folder with system default application
    const openWithDefaultApp = async (entry: FileEntry) => {
        try {
            const res = await fetch('http://localhost:8000/api/files/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: entry.path }),
            });

            if (!res.ok) {
                const error = await res.json();
                toast.error(`打开失败: ${error.detail || '未知错误'}`);
                return;
            }

            toast.success(`已打开: ${entry.name}`);
        } catch (err) {
            console.error('Open failed:', err);
            toast.error('打开失败');
        }
    };

    const handleOpen = async (entry: FileEntry) => {
        if (entry.is_directory) {
            handleToggleExpand(entry.path);
            return;
        }

        // Try to open in editor if it's a code file and we have the callback
        if (onOpenFile && isCodeFile(entry.name)) {
            onOpenFile(entry.path);
            return;
        }

        // Fallback to system default
        await openWithDefaultApp(entry);
    };

    const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
        e.preventDefault();

        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const menuWidth = 192; // w-48 = 12rem = 192px
        const menuHeight = 200; // approximate max height
        const padding = 8;

        // Calculate position relative to the container
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        // Check right edge relative to container width
        if (x + menuWidth + padding > rect.width) {
            x = rect.width - menuWidth - padding;
        }
        // Check bottom edge relative to container height
        if (y + menuHeight + padding > rect.height) {
            y = rect.height - menuHeight - padding;
        }

        // Ensure not negative
        x = Math.max(padding, x);
        y = Math.max(padding, y);

        setContextMenu({ x, y, entry });
    };

    // Close context menu on click elsewhere
    useEffect(() => {
        if (!contextMenu) return;

        const closeMenu = (e: MouseEvent) => {
            // Check if click is outside the menu
            const target = e.target as HTMLElement;
            if (!target.closest('[data-context-menu]')) {
                setContextMenu(null);
            }
        };

        // Use mousedown for more responsive closing
        document.addEventListener("mousedown", closeMenu);
        return () => document.removeEventListener("mousedown", closeMenu);
    }, [contextMenu]);

    // Reset drag state when drag ends anywhere (including outside the browser)
    useEffect(() => {
        const resetDragState = () => {
            dragCounterRef.current = 0;
            setIsDraggingExternal(false);
        };

        // dragend fires when drag ends (drop or cancel)
        document.addEventListener("dragend", resetDragState);
        // Also listen for drop anywhere in case drop happens outside our container
        document.addEventListener("drop", resetDragState);

        const handleDocumentDragLeave = (e: DragEvent) => {
            // Check if drag left the window (relatedTarget is null and position is outside viewport)
            if (e.clientX === 0 && e.clientY === 0) {
                resetDragState();
            }
        };
        document.addEventListener("dragleave", handleDocumentDragLeave);

        return () => {
            document.removeEventListener("dragend", resetDragState);
            document.removeEventListener("drop", resetDragState);
            document.removeEventListener("dragleave", handleDocumentDragLeave);
        };
    }, []);

    const handleSelect = (entry: FileEntry, e?: React.MouseEvent) => {
        // Smart file click logic:
        // 1. If Preview Panel is active, show in Panel (call onSelectFile)
        // 2. If Preview Panel is not active, show Popup

        if (!entry.is_directory && e) {
            // Check if Preview Panel is currently active
            const isPanelActive = isPreviewPanelActive?.() ?? false;

            if (isPanelActive) {
                // Panel is active - update Panel Preview, no popup
                if (onSelectFile) {
                    onSelectFile(entry);
                }
                // Close any existing popup
                setPreviewEntry(null);
            } else {
                // Panel not active - show Popup Preview
                // Toggle off if clicking same file
                if (previewEntry?.path === entry.path) {
                    setPreviewEntry(null);
                } else {
                    // Calculate position based on click or element
                    const target = e.currentTarget as HTMLElement;
                    const rect = target.getBoundingClientRect();

                    // Position to the LEFT of the SIDEBAR CONTAINER
                    let xPos = rect.left - 10;
                    if (containerRef.current) {
                        const containerRect = containerRef.current.getBoundingClientRect();
                        xPos = containerRect.left - 10;
                    }

                    setPreviewPosition({
                        x: xPos,
                        y: rect.top
                    });
                    setPreviewEntry(entry);
                }
            }
        } else {
            // Directory selected - close popup
            setPreviewEntry(null);
        }
    };

    return (
        <div
            ref={containerRef}
            className={`h-full flex flex-col bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 relative ${className} ${isDraggingExternal ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
            onDragEnter={handleExternalDragEnter}
            onDragOver={handleExternalDragOver}
            onDragLeave={handleExternalDragLeave}
            onDrop={handleExternalDrop}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                <span>Explorer</span>
                <button onClick={fetchFiles} className="hover:bg-zinc-200 dark:hover:bg-zinc-800 p-1 rounded">
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* Tree */}
            {isLoading && rootFiles.length === 0 ? (
                <div className="flex-1 overflow-auto py-2">
                    <div className="flex items-center justify-center p-4 text-zinc-400">
                        <Loader2 className="animate-spin mr-2" size={16} /> Loading...
                    </div>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={(event: DragStartEvent) => {
                        const entry = event.active.data?.current as FileEntry || null;
                        setActiveItem(entry);

                        // Capture initial positions
                        const node = document.getElementById(entry.path);
                        if (node) {
                            const rect = node.getBoundingClientRect();
                            dragStartRectRef.current = { left: rect.left, top: rect.top };

                            // Initialize position immediately to avoid flicker
                            if (containerRef.current && customOverlayRef.current) {
                                const container = containerRef.current.getBoundingClientRect();
                                const x = rect.left - container.left;
                                const y = rect.top - container.top;
                                customOverlayRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
                            }
                        }
                    }}
                    onDragMove={(event: DragMoveEvent) => {
                        if (!containerRef.current || !customOverlayRef.current || !dragStartRectRef.current) return;

                        const { delta } = event;
                        const container = containerRef.current.getBoundingClientRect();
                        const start = dragStartRectRef.current;

                        // Current Viewport Position = Start + Delta
                        const currentLeft = start.left + delta.x;
                        const currentTop = start.top + delta.y;

                        // Relative Position = Current Viewport - Container Viewport
                        const x = currentLeft - container.left;
                        const y = currentTop - container.top;

                        customOverlayRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
                    }}
                    onDragEnd={(event) => {
                        setActiveItem(null);
                        dragStartRectRef.current = null;
                        onDragEnd(event);
                    }}
                >
                    <div className="flex-1 overflow-auto py-2">
                        {rootFiles.map(entry => (
                            <FileTreeItem
                                key={entry.path}
                                entry={entry}
                                onSelect={handleSelect}
                                expandedPaths={expandedPaths}
                                onToggleExpand={handleToggleExpand}
                                onContextMenu={handleContextMenu}
                                onExternalFileDrop={async (files, targetPath) => {
                                    // Explicitly reset global drag state because the child component calls stopPropagation(),
                                    // which prevents the global 'drop' listener from firing.
                                    dragCounterRef.current = 0;
                                    setIsDraggingExternal(false);

                                    for (let i = 0; i < files.length; i++) {
                                        await uploadFile(files[i], targetPath);
                                    }
                                }}
                                onMention={(path) => onMentionFile?.(path)}
                                onShowMenu={handleContextMenu}
                                editingPath={editingPath}
                                editingName={editingName}
                                onEditingNameChange={setEditingName}
                                onEditingSubmit={handleRename}
                                onEditingCancel={cancelRename}
                                onEditingSelectionStart={editingSelectionStart}
                                onEditingSelectionEnd={editingSelectionEnd}
                                onDoubleClick={(entry) => handleOpen(entry)}
                            />
                        ))}
                    </div>

                    {/* Custom Manual Drag Overlay - Rendered in DOM but positioned manually */}
                    <div
                        ref={customOverlayRef}
                        className={`absolute top-0 left-0 z-50 pointer-events-none ${activeItem ? '' : 'hidden'}`}
                        style={{ willChange: 'transform' }} // Optimization
                    >
                        {activeItem ? (
                            <div className="flex items-center gap-2 px-2 py-1 bg-white dark:bg-zinc-800 rounded-sm shadow-xl border border-blue-500 text-sm opacity-90">
                                {activeItem.is_directory ? (
                                    <Folder size={16} className="text-zinc-500" />
                                ) : (
                                    <File size={16} className="text-zinc-500" />
                                )}
                                <span className="text-zinc-700 dark:text-zinc-300">{activeItem.name}</span>
                            </div>
                        ) : null}
                    </div>
                </DndContext>
            )}


            {/* Custom Context Menu */}
            {
                contextMenu && (
                    <div
                        data-context-menu
                        className="absolute bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg rounded-md py-1 z-50 w-48 text-sm"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-3 py-1 font-medium text-zinc-400 text-xs border-b border-zinc-100 dark:border-zinc-700 mb-1 truncate">
                            {contextMenu.entry.name}
                        </div>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2"
                            onClick={() => {
                                handleOpen(contextMenu.entry);
                                setContextMenu(null);
                            }}
                        >
                            <ExternalLink size={14} className="text-green-500" />
                            <span>Open</span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2"
                            onClick={() => {
                                onMentionFile?.(contextMenu.entry.path);
                                setContextMenu(null);
                            }}
                        >
                            <AtSign size={14} className="text-blue-500" />
                            <span>Add to Input</span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2"
                            onClick={() => {
                                startRename(contextMenu.entry);
                                setContextMenu(null);
                            }}
                        >
                            <Pencil size={14} className="text-zinc-500" />
                            <span>Rename</span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2"
                            onClick={() => {
                                duplicateItem(contextMenu.entry);
                                setContextMenu(null);
                            }}
                        >
                            <Copy size={14} className="text-zinc-500" />
                            <span>Duplicate</span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500 flex items-center gap-2"
                            onClick={() => {
                                setDeleteDialog(contextMenu.entry);
                                setContextMenu(null);
                            }}
                        >
                            <Trash2 size={14} />
                            <span>Delete</span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-700 mt-1 pt-1.5"
                            onClick={() => {
                                // For directories: create inside. For files: create in same parent directory
                                const parentPath = contextMenu.entry.is_directory
                                    ? contextMenu.entry.path
                                    : (contextMenu.entry.path.includes('/')
                                        ? contextMenu.entry.path.substring(0, contextMenu.entry.path.lastIndexOf('/'))
                                        : '');
                                createNewFileInline(parentPath);
                                setContextMenu(null);
                            }}
                        >
                            <FilePlus size={14} className="text-zinc-500" />
                            <span>New File</span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2"
                            onClick={() => {
                                // For directories: create inside. For files: create in same parent directory
                                const parentPath = contextMenu.entry.is_directory
                                    ? contextMenu.entry.path
                                    : (contextMenu.entry.path.includes('/')
                                        ? contextMenu.entry.path.substring(0, contextMenu.entry.path.lastIndexOf('/'))
                                        : '');
                                createNewFolderInline(parentPath);
                                setContextMenu(null);
                            }}
                        >
                            <FolderPlus size={14} className="text-zinc-500" />
                            <span>New Folder</span>
                        </button>
                    </div>
                )
            }

            {/* File Conflict Confirmation Dialog */}
            {
                pendingConflict && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleCancelOverwrite}>
                        <div
                            className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl p-5 max-w-sm mx-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                                文件已存在
                            </h3>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                                目标位置已存在名为 <span className="font-medium text-zinc-800 dark:text-zinc-200">&quot;{pendingConflict.fileName}&quot;</span> 的文件。是否覆盖？
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={handleCancelOverwrite}
                                    className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleConfirmOverwrite}
                                    className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
                                >
                                    覆盖
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Upload Conflict Confirmation Dialog */}
            {
                uploadConflict && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleCancelUploadOverwrite}>
                        <div
                            className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl p-5 max-w-sm mx-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                                文件已存在
                            </h3>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                                目标位置已存在名为 <span className="font-medium text-zinc-800 dark:text-zinc-200">&quot;{uploadConflict.file.name}&quot;</span> 的文件。是否覆盖？
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={handleCancelUploadOverwrite}
                                    className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleConfirmUploadOverwrite}
                                    className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
                                >
                                    覆盖
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Delete Confirmation Dialog */}
            {
                deleteDialog && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteDialog(null)}>
                        <div
                            className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl p-5 max-w-sm mx-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                                确认删除
                            </h3>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                                确定要删除 <span className="font-medium text-zinc-800 dark:text-zinc-200">&quot;{deleteDialog.name}&quot;</span>
                                {deleteDialog.is_directory ? ' 及其所有内容' : ''}？此操作无法撤销。
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setDeleteDialog(null)}
                                    className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleDelete}
                                    className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
                                >
                                    删除
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Popup Preview */}
            {previewEntry && previewPosition && (
                <FilePreviewPopup
                    entry={previewEntry}
                    position={previewPosition}
                    anchor="left"
                    onClose={() => setPreviewEntry(null)}
                />
            )}
        </div >
    );
}
