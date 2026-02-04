"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { DndContext, DragEndEvent, DragStartEvent, DragMoveEvent, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { FileTreeItem } from "./file-tree";
import { FileEntry } from "./types";
import type { FilePanelOpenEntry } from "@/components/panels/file-panel";
import { Loader2, RefreshCw, File, Folder, AtSign, Pencil, Trash2, FolderPlus, FilePlus, Copy, ExternalLink, Search, X, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { FilePreviewPopup } from "./file-preview-popup";
import { fileWatcherClient, FileWatchEvent } from "@/lib/file-watcher";
import { useWorkspace } from "@/lib/workspace-store";
import { enqueueAudio } from "@/lib/audio-player";
import { FileIcon } from "./file-icons";
import type { OpenImageOptions } from "@/components/image-editor/types";

type CategoryType = "images" | "documents" | "video" | "audio" | "code";
type ViewFilter = "all" | CategoryType;
type SortField = "name" | "modified";
type SortDirection = "asc" | "desc";

const SORT_CYCLE: { field: SortField; direction: SortDirection; label: string }[] = [
    { field: "name", direction: "asc", label: "Name ↑" },
    { field: "name", direction: "desc", label: "Name ↓" },
    { field: "modified", direction: "asc", label: "Date ↑" },
    { field: "modified", direction: "desc", label: "Date ↓" },
];

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "tif", "tiff", "heic", "heif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpg", "mpeg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus"]);
const DOC_EXTS = new Set([
    "md", "markdown", "mdx",
    "doc", "docx", "docs", "rtf", "odt",
    "xls", "xlsx", "csv", "tsv", "ods",
    "ppt", "pptx", "odp",
    "pdf", "txt"
]);
const CODE_EXTS = new Set([
    "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "hpp", "go", "rs", "php",
    "rb", "sh", "bash", "zsh", "yaml", "yml", "xml", "sql", "ini", "conf", "env",
    "toml", "json", "css", "scss", "less", "html", "htm", "vue", "svelte"
]);

const getExtension = (filename: string) => {
    const parts = filename.split(".");
    if (parts.length <= 1) return "";
    return parts.pop()!.toLowerCase();
};

const hasHiddenDir = (path: string) => {
    const parts = path.split("/");
    return parts.slice(0, -1).some((segment) => segment.startsWith(".") && segment.length > 1);
};

const getCategoryForFile = (filename: string): CategoryType | null => {
    const ext = getExtension(filename);
    if (!ext) return null;
    if (IMAGE_EXTS.has(ext)) return "images";
    if (VIDEO_EXTS.has(ext)) return "video";
    if (AUDIO_EXTS.has(ext)) return "audio";
    if (DOC_EXTS.has(ext)) return "documents";
    if (CODE_EXTS.has(ext)) return "code";
    return null;
};

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
    onOpenInPanel?: (entry: FilePanelOpenEntry, options?: { initialMode?: 'editor' | 'preview' | 'image'; openInAITool?: boolean }) => void;
    onSelectFile?: (entry: { path: string, name: string, is_directory: boolean }) => void;
    onOpenImage?: (path: string, options?: OpenImageOptions) => void;
    isPreviewPanelActive?: () => boolean;
    /** Workspace ID - when this changes, files are refetched */
    workspaceId?: string | null;
    /** External control for viewFilter - when provided, syncs to internal state */
    externalViewFilter?: ViewFilter;
    externalViewFilterToken?: number;
}

export function FileExplorer({ className, onMentionFile, onOpenFile, onOpenInPanel, onSelectFile, onOpenImage, isPreviewPanelActive, workspaceId, externalViewFilter, externalViewFilterToken }: FileExplorerProps) {
    const { currentWorkspace } = useWorkspace();
    const [flatFiles, setFlatFiles] = useState<FileEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const [sortIndex, setSortIndex] = useState(0);
    const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Array<{
        path: string;
        name: string;
        snippet?: string;
        score: number;
        source: "semantic" | "filename" | "merged";
        start_line?: number | null;
        end_line?: number | null;
    }>>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const searchRequestRef = React.useRef(0);

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
            setFlatFiles(files);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    // Refetch files when workspace changes
    useEffect(() => {
        if (workspaceId !== undefined) {
            // Clear expanded paths when workspace changes
            setExpandedPaths(new Set());
            // Refetch files for new workspace
            fetchFiles();
        }
    }, [workspaceId, fetchFiles]);

    // Sync internal viewFilter when external viewFilter changes
    useEffect(() => {
        if (externalViewFilter !== undefined) {
            setViewFilter(externalViewFilter);
        }
    }, [externalViewFilter, externalViewFilterToken]);

    // File watcher integration - auto-refresh on file system changes
    useEffect(() => {
        const handleFileChange = (event: FileWatchEvent) => {
            fetchFiles();
        };

        fileWatcherClient.connect(handleFileChange);

        return () => {
            fileWatcherClient.disconnect();
        };
    }, [fetchFiles]);

    const sortMode = SORT_CYCLE[sortIndex];

    const compareEntries = (a: FileEntry, b: FileEntry) => {
        if (a.is_directory !== b.is_directory) {
            return a.is_directory ? -1 : 1;
        }

        const nameCompare = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        let cmp = 0;
        if (sortMode.field === "name") {
            cmp = nameCompare;
        } else {
            const timeA = a.modified_at ?? 0;
            const timeB = b.modified_at ?? 0;
            cmp = timeA - timeB;
        }

        if (cmp === 0) cmp = nameCompare;
        if (sortMode.direction === "desc") cmp *= -1;
        return cmp;
    };

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
                    root.push(entry);
                }
            }
        });

        const computeDirectoryModified = (entry: FileEntry): number => {
            if (!entry.is_directory) return entry.modified_at ?? 0;
            let maxModified = 0;
            if (entry.children && entry.children.length > 0) {
                entry.children.forEach((child) => {
                    maxModified = Math.max(maxModified, computeDirectoryModified(child));
                });
            }
            if (entry.modified_at === undefined || entry.modified_at === null) {
                entry.modified_at = maxModified;
            }
            return entry.modified_at ?? maxModified;
        };

        const sortRecursive = (entries: FileEntry[]) => {
            entries.sort(compareEntries);
            entries.forEach(e => {
                if (e.children) sortRecursive(e.children);
            });
        };

        root.forEach((entry) => computeDirectoryModified(entry));
        sortRecursive(root);
        return root;
    };

    const treeFiles = useMemo(() => buildTree(flatFiles), [flatFiles, sortMode]);

    const categoryFiles = useMemo(() => {
        if (viewFilter === "all") return [];
        const filtered = flatFiles.filter((entry) => {
            if (entry.is_directory) return false;
            if (hasHiddenDir(entry.path)) return false;
            return getCategoryForFile(entry.name) === viewFilter;
        });

        return filtered.sort((a, b) => {
            const nameCompare = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
            let cmp = 0;
            if (sortMode.field === "name") {
                cmp = nameCompare;
            } else {
                const timeA = a.modified_at ?? 0;
                const timeB = b.modified_at ?? 0;
                cmp = timeA - timeB;
            }
            if (cmp === 0) cmp = nameCompare;
            if (sortMode.direction === "desc") cmp *= -1;
            return cmp;
        });
    }, [flatFiles, viewFilter, sortMode]);

    const viewMode = viewFilter === "all" ? "tree" : "category";
    const showImageGrid = viewMode === "category" && viewFilter === "images";

    const fileMap = useMemo(() => {
        const map = new Map<string, FileEntry>();
        flatFiles.forEach((entry) => {
            map.set(entry.path, entry);
        });
        return map;
    }, [flatFiles]);

    const getEntriesForFilter = useCallback((filter: ViewFilter) => {
        if (filter === "all") {
            return flatFiles.filter((entry) => !entry.is_directory);
        }
        return flatFiles.filter((entry) => {
            if (entry.is_directory) return false;
            return getCategoryForFile(entry.name) === filter;
        });
    }, [flatFiles]);

    const searchTokens = useMemo(() => {
        return searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    }, [searchQuery]);

    const computeFilenameScore = (entry: FileEntry, tokens: string[]) => {
        if (!tokens.length) return null;
        const haystack = entry.name.toLowerCase();
        let score = 0;
        for (const token of tokens) {
            const idx = haystack.indexOf(token);
            if (idx < 0) return null;
            score += token.length / Math.max(haystack.length, 1);
            if (idx === 0) score += 0.1;
        }
        return score;
    };

    const filenameSearchEntries = useMemo(() => {
        if (!searchTokens.length) return [];
        const candidates = getEntriesForFilter(viewFilter);
        const scored = candidates
            .map((entry) => {
                const score = computeFilenameScore(entry, searchTokens);
                return score === null ? null : { entry, score };
            })
            .filter((item): item is { entry: FileEntry; score: number } => item !== null);
        scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
        return scored.map((item) => item.entry);
    }, [searchTokens, getEntriesForFilter, viewFilter]);

    const isSearchActive = searchTokens.length > 0;
    const isFilenameOnlySearch = isSearchActive && (viewFilter === "images" || viewFilter === "video" || viewFilter === "audio");
    const isSemanticSearch = isSearchActive && (viewFilter === "all" || viewFilter === "documents" || viewFilter === "code");

    const normalizeResultPath = useCallback(
        (path: string) => {
            if (!currentWorkspace?.path) return path;
            const root = currentWorkspace.path.replace(/\/+$/, "");
            if (path === root) return "";
            if (path.startsWith(root + "/")) {
                return path.slice(root.length + 1);
            }
            return path;
        },
        [currentWorkspace?.path]
    );

    useEffect(() => {
        if (!isSearchActive) {
            setSearchResults([]);
            setSearchError(null);
            setSearchLoading(false);
            return;
        }

        if (isFilenameOnlySearch) {
            const results = filenameSearchEntries.map((entry, index) => ({
                path: entry.path,
                name: entry.name,
                snippet: undefined,
                score: 1 / (60 + index + 1),
                source: "filename" as const,
            }));
            setSearchResults(results);
            setSearchError(null);
            setSearchLoading(false);
            return;
        }

        if (!isSemanticSearch) {
            setSearchResults([]);
            setSearchError(null);
            setSearchLoading(false);
            return;
        }

        const requestId = ++searchRequestRef.current;
        setSearchLoading(true);
        setSearchError(null);

        const runSearch = async () => {
            try {
                const res = await fetch("http://localhost:8000/api/search/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        workdir: currentWorkspace?.path,
                        query: searchQuery.trim(),
                        limit: 30,
                        vector_k: 60,
                        use_vector: true,
                        use_fts: true,
                        mode: "files",
                        rerank: "alpha",
                        alpha: 0.5,
                        exclude_paths: [".opencowork"],
                    }),
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || "Search failed");
                }

                const data = await res.json();
                if (searchRequestRef.current !== requestId) return;

                let semanticResults: {
                    path: string;
                    snippet?: string;
                    start_line?: number | null;
                    end_line?: number | null;
                }[] = data.results || [];

                semanticResults = semanticResults.map((item) => ({
                    ...item,
                    path: normalizeResultPath(item.path),
                }));

                if (viewFilter === "documents" || viewFilter === "code") {
                    const allowed = viewFilter === "documents" ? DOC_EXTS : CODE_EXTS;
                    semanticResults = semanticResults.filter((item) => {
                        const ext = getExtension(item.path);
                        return ext ? allowed.has(ext) : false;
                    });
                }

                const semanticRanked = semanticResults.map((item, index) => ({
                    path: item.path,
                    name: item.path.split("/").pop() || item.path,
                    snippet: item.snippet,
                    start_line: item.start_line ?? null,
                    end_line: item.end_line ?? null,
                    score: 1 / (60 + index + 1),
                    source: "semantic" as const,
                }));

                let merged: {
                    path: string;
                    name: string;
                    snippet?: string;
                    score: number;
                    source: "semantic" | "filename" | "merged";
                    start_line?: number | null;
                    end_line?: number | null;
                }[] = semanticRanked;

                if (viewFilter === "all" || viewFilter === "documents" || viewFilter === "code") {
                    const filenameCandidates = getEntriesForFilter(viewFilter === "all" ? "all" : viewFilter);
                    const filenameScored = filenameCandidates
                        .map((entry) => {
                            const score = computeFilenameScore(entry, searchTokens);
                            return score === null ? null : { entry, score };
                        })
                        .filter((item): item is { entry: FileEntry; score: number } => item !== null);
                    filenameScored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

                    const filenameRanked = filenameScored.map((item, index) => ({
                        path: item.entry.path,
                        name: item.entry.name,
                        score: 1 / (60 + index + 1),
                        source: "filename" as const,
                    }));

                    const mergedMap = new Map<string, { path: string; name: string; snippet?: string; score: number; source: "semantic" | "filename" | "merged"; start_line?: number | null; end_line?: number | null }>();
                    semanticRanked.forEach((item) => {
                        const key = normalizeResultPath(item.path);
                        mergedMap.set(key, { ...item, path: key });
                    });
                    filenameRanked.forEach((item) => {
                        const key = normalizeResultPath(item.path);
                        const existing = mergedMap.get(key);
                        if (existing) {
                            mergedMap.set(key, {
                                ...existing,
                                score: existing.score + item.score,
                                source: "merged",
                            });
                        } else {
                            mergedMap.set(key, {
                                path: key,
                                name: item.name,
                                snippet: undefined,
                                score: item.score,
                                source: "filename",
                            });
                        }
                    });

                    merged = Array.from(mergedMap.values()).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
                }

                setSearchResults(merged);
                setSearchError(null);
            } catch (err) {
                if (searchRequestRef.current !== requestId) return;
                const message = err instanceof Error ? err.message : "Search failed";
                setSearchError(message);
                setSearchResults([]);
            } finally {
                if (searchRequestRef.current === requestId) {
                    setSearchLoading(false);
                }
            }
        };

        const timer = setTimeout(runSearch, 250);
        return () => clearTimeout(timer);
    }, [
        isSearchActive,
        isFilenameOnlySearch,
        isSemanticSearch,
        filenameSearchEntries,
        viewFilter,
        searchQuery,
        searchTokens,
        currentWorkspace?.path,
        getEntriesForFilter,
    ]);

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
            return;
        }

        // Prevent dragging a folder into itself or any of its children
        if (sourceEntry?.is_directory && (destPath === sourcePath || destPath.startsWith(sourcePath + '/'))) {
            return;
        }

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

        const ext = getExtension(entry.name);

        // Audio files - play in audio player
        if (AUDIO_EXTS.has(ext)) {
            enqueueAudio({ path: entry.path, name: entry.name });
            return;
        }

        // Image files - open in File Panel image mode
        if (IMAGE_EXTS.has(ext)) {
            if (onOpenInPanel) {
                onOpenInPanel(entry, { initialMode: 'image', openInAITool: true });
                return;
            }
            if (onOpenImage) {
                onOpenImage(entry.path);
                return;
            }
            return;
        }

        // Code files - open in editor
        if (onOpenFile && isCodeFile(entry.name)) {
            onOpenFile(entry.path);
            return;
        }

        // Fallback to system default
        await openWithDefaultApp(entry);
    };

    const handleOpenFromExplorer = (entry: FileEntry) => {
        if (entry.is_directory) {
            handleOpen(entry);
            return;
        }

        const ext = getExtension(entry.name);
        const isAudio = AUDIO_EXTS.has(ext);
        const isImage = IMAGE_EXTS.has(ext);

        if (isAudio) {
            handleOpen(entry);
            return;
        }

        if (!isImage && onOpenInPanel) {
            onOpenInPanel(entry);
            return;
        }

        handleOpen(entry);
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
            <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                <select
                    value={viewFilter}
                    onChange={(e) => setViewFilter(e.target.value as ViewFilter)}
                    className="h-6 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-medium text-zinc-700 dark:text-zinc-200"
                >
                    <option value="all">All</option>
                    <option value="documents">Documents</option>
                    <option value="images">Images</option>
                    <option value="video">Video</option>
                    <option value="audio">Audio</option>
                    <option value="code">Code</option>
                </select>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => setSortIndex((prev) => (prev + 1) % SORT_CYCLE.length)}
                        className="h-6 px-2 rounded text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 leading-none"
                        title="Toggle sort"
                    >
                        {sortMode.label}
                    </button>
                    <button onClick={fetchFiles} className="hover:bg-zinc-200 dark:hover:bg-zinc-800 p-1 rounded">
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>
            <div className="px-3 pb-2">
                <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search..."
                        className="w-full h-7 pl-7 pr-8 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                    />
                    {searchLoading && (
                        <Loader2 className="absolute right-7 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 animate-spin" />
                    )}
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500"
                            title="Clear"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            {isLoading && (viewMode === "tree" ? treeFiles.length === 0 : categoryFiles.length === 0) ? (
                <div className="flex-1 overflow-auto py-2">
                    <div className="flex items-center justify-center p-4 text-zinc-400">
                        <Loader2 className="animate-spin mr-2" size={16} /> Loading...
                    </div>
                </div>
            ) : (
                isSearchActive && isSemanticSearch ? (
                    <div className="flex-1 overflow-auto py-2">
                        {searchError && (
                            <div className="mx-3 mb-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-2 py-1">
                                {searchError}
                            </div>
                        )}
                        {!searchLoading && searchResults.length === 0 && !searchError && (
                            <div className="flex items-center justify-center p-4 text-zinc-400 text-xs">
                                No results
                            </div>
                        )}
                        {searchResults.length > 0 && (
                            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                {searchResults.map((result) => {
                                    const entry = fileMap.get(result.path) || {
                                        name: result.name,
                                        path: result.path,
                                        is_directory: false,
                                    };
                                    return (
                                        <div
                                            key={result.path}
                                            className="px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                                            onClick={(e) => handleSelect(entry, e)}
                                            onDoubleClick={() => handleOpenFromExplorer(entry)}
                                        >
                                            <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                {result.name}
                                            </div>
                                            {result.snippet && (
                                                <div className="text-[11px] text-zinc-600 dark:text-zinc-300 line-clamp-2 mt-0.5">
                                                    {result.snippet.slice(0, 160)}
                                                </div>
                                            )}
                                            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate font-mono mt-0.5">
                                                {result.path}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : showImageGrid && (!isSearchActive || viewFilter === "images") ? (
                    <div className="flex-1 overflow-auto py-2 px-2">
                        {isSearchActive && filenameSearchEntries.length === 0 ? (
                            <div className="flex items-center justify-center p-4 text-zinc-400 text-xs">
                                No results
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2">
                                {(isSearchActive ? filenameSearchEntries : categoryFiles).map(entry => {
                                    const ext = getExtension(entry.name);
                                    const isSvg = ext === "svg";
                                    const imageSrc = isSvg
                                        ? `http://localhost:8000/api/files/raw?path=${encodeURIComponent(entry.path)}`
                                        : `http://localhost:8000/api/files/thumbnail?path=${encodeURIComponent(entry.path)}&size=256`;
                                    return (
                                        <div
                                            key={entry.path}
                                            className="group rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 cursor-pointer"
                                            onClick={(e) => handleSelect(entry, e)}
                                            onDoubleClick={() => handleOpenFromExplorer(entry)}
                                        >
                                            <div className="aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                                                <img
                                                    src={imageSrc}
                                                    alt={entry.name}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            </div>
                                            <div className="px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 truncate">
                                                {entry.name}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : viewMode === "category" ? (
                    <div className="flex-1 overflow-auto py-2">
                        {(isSearchActive ? filenameSearchEntries : categoryFiles).length === 0 ? (
                            <div className="flex items-center justify-center p-4 text-zinc-400 text-xs">
                                No results
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                {(isSearchActive ? filenameSearchEntries : categoryFiles).map((entry) => (
                                    <div
                                        key={entry.path}
                                        className="group relative flex items-center py-1 px-2 rounded-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                        onClick={(e) => handleSelect(entry, e)}
                                        onDoubleClick={() => handleOpenFromExplorer(entry)}
                                        onContextMenu={(e) => handleContextMenu(e, entry)}
                                    >
                                        <span className="mr-1.5 shrink-0 text-zinc-500 dark:text-zinc-400">
                                            {entry.is_directory ? (
                                                <Folder size={16} />
                                            ) : (
                                                <FileIcon filename={entry.name} size={16} />
                                            )}
                                        </span>
                                        <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                                            {entry.name}
                                        </span>
                                        <div className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center gap-0.5 ml-1">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onMentionFile?.(entry.path);
                                                }}
                                                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-500 hover:text-blue-500"
                                                title="Add to input (@)"
                                            >
                                                <AtSign size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleContextMenu(e, entry);
                                                }}
                                                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-500"
                                                title="More options"
                                            >
                                                <MoreHorizontal size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
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
                            {treeFiles.map(entry => (
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
                                    onDoubleClick={(entry) => handleOpenFromExplorer(entry)}
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
                )
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
                                const ext = getExtension(contextMenu.entry.name);
                                const isAudio = AUDIO_EXTS.has(ext);
                                if (contextMenu.entry.is_directory || isAudio) {
                                    handleOpen(contextMenu.entry);
                                } else if (onOpenInPanel) {
                                    onOpenInPanel(contextMenu.entry);
                                } else {
                                    handleOpen(contextMenu.entry);
                                }
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
