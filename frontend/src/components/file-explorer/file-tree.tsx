"use client";

import React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { File, Folder, FolderOpen, MoreHorizontal, AtSign } from "lucide-react";
import { FileEntry } from "./types";
import { useDraggable, useDroppable } from "@dnd-kit/core";

// We'll fallback if cn doesn't exist
function classNames(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(" ");
}

interface FileTreeProps {
    entry: FileEntry;
    depth?: number;
    onSelect?: (entry: FileEntry, e?: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent, entry: FileEntry) => void;
    expandedPaths?: Set<string>;
    onToggleExpand?: (path: string) => void;
    onExternalFileDrop?: (files: FileList, targetPath: string) => void;
    onMention?: (path: string) => void;
    onShowMenu?: (e: React.MouseEvent, entry: FileEntry) => void;
    // Inline rename props
    editingPath?: string | null;
    editingName?: string;
    onEditingNameChange?: (name: string) => void;
    onEditingSubmit?: () => void;
    onEditingCancel?: () => void;
    onEditingSelectionStart?: number;
    onEditingSelectionEnd?: number;
    onDoubleClick?: (entry: FileEntry) => void;
}

export function FileTreeItem({
    entry,
    depth = 0,
    onSelect,
    onContextMenu,
    expandedPaths,
    onToggleExpand,
    onExternalFileDrop,
    onMention,
    onShowMenu,
    editingPath,
    editingName,
    onEditingNameChange,
    onEditingSubmit,
    onEditingCancel,
    onEditingSelectionStart,
    onEditingSelectionEnd,
    onDoubleClick,
}: FileTreeProps) {
    const isEditing = editingPath === entry.path;
    const isExpanded = expandedPaths?.has(entry.path);
    const isDirectory = entry.is_directory;
    const [isExternalDragOver, setIsExternalDragOver] = React.useState(false);

    // Drag & Drop Hooks
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
        id: entry.path,
        data: entry,
    });

    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: entry.path,
        data: entry,
        // All items can be drop targets - dropping on file moves to its parent
    });



    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isDirectory && onToggleExpand) {
            onToggleExpand(entry.path);
        }
        if (onSelect) {
            onSelect(entry, e);
        }
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onDoubleClick) {
            onDoubleClick(entry);
        }
    };

    return (
        <div className="select-none">
            {/* Collapsible Root */}
            <Collapsible.Root
                open={isExpanded}
                onOpenChange={() => { }} // Controlled by onToggleExpand
            >
                {/* Row container: droppable + draggable */}
                <div
                    ref={(node) => {
                        setDropRef(node);
                        setDragRef(node);
                    }}
                    id={entry.path}
                    {...listeners}
                    {...attributes}
                    className={classNames(
                        "group relative flex items-center py-1 px-2 rounded-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        isOver && "bg-blue-100 dark:bg-blue-900 border border-blue-500",
                        isDragging && "opacity-50 bg-zinc-200 dark:bg-zinc-700",
                        isExternalDragOver && isDirectory && "ring-2 ring-blue-500 ring-inset bg-blue-50 dark:bg-blue-900/30",
                        isExternalDragOver && !isDirectory && "ring-1 ring-blue-400 ring-inset bg-blue-50/50 dark:bg-blue-900/20"
                    )}
                    style={{
                        paddingLeft: `${depth * 12 + 8}px`,
                    }}
                    onClick={handleToggle}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={(e) => onContextMenu && onContextMenu(e, entry)}
                    onDragOver={(e) => {
                        if (e.dataTransfer.types.includes("Files")) {
                            e.preventDefault();
                            setIsExternalDragOver(true);
                        }
                    }}
                    onDragLeave={(e) => {
                        e.preventDefault();
                        setIsExternalDragOver(false);
                    }}
                    onDrop={(e) => {
                        if (e.dataTransfer.types.includes("Files") && onExternalFileDrop) {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsExternalDragOver(false);

                            // If dropping on folder, upload to that folder
                            // If dropping on file, upload to file's parent directory
                            let targetPath: string;
                            if (isDirectory) {
                                targetPath = entry.path;
                            } else {
                                // Get parent directory
                                targetPath = entry.path.includes('/')
                                    ? entry.path.substring(0, entry.path.lastIndexOf('/'))
                                    : ''; // root
                            }
                            onExternalFileDrop(e.dataTransfer.files, targetPath);
                        }
                    }}
                >
                    {/* Icon */}
                    <span className="mr-1.5 shrink-0 text-zinc-500 dark:text-zinc-400">
                        {isDirectory ? (
                            isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />
                        ) : (
                            <File size={16} />
                        )}
                    </span>
                    {/* Name - inline edit when isEditing */}
                    {isEditing ? (
                        <input
                            type="text"
                            value={editingName || ''}
                            onChange={(e) => onEditingNameChange?.(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') onEditingSubmit?.();
                                if (e.key === 'Escape') onEditingCancel?.();
                            }}
                            onBlur={() => onEditingSubmit?.()}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={(e) => {
                                if (onEditingSelectionStart !== undefined && onEditingSelectionEnd !== undefined) {
                                    e.target.setSelectionRange(onEditingSelectionStart, onEditingSelectionEnd);
                                } else {
                                    e.target.select();
                                }
                            }}
                            className="flex-1 min-w-0 px-1 py-0 text-sm bg-white dark:bg-zinc-900 border border-blue-500 rounded outline-none"
                            autoFocus
                        />
                    ) : (
                        <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                            {entry.name}
                        </span>
                    )}
                    {/* Hover action buttons - appear right after name */}
                    <div className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center gap-0.5 ml-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onMention?.(entry.path);
                            }}
                            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-500 hover:text-blue-500"
                            title="Add to input (@)"
                        >
                            <AtSign size={14} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onShowMenu?.(e, entry);
                            }}
                            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-500"
                            title="More options"
                        >
                            <MoreHorizontal size={14} />
                        </button>
                    </div>
                </div>

                <Collapsible.Content className="overflow-hidden">
                    {isDirectory && entry.children && (
                        <div className="flex flex-col">
                            {entry.children.map((child) => (
                                <FileTreeItem
                                    key={child.path}
                                    entry={child}
                                    depth={depth + 1}
                                    onSelect={onSelect}
                                    onContextMenu={onContextMenu}
                                    expandedPaths={expandedPaths}
                                    onToggleExpand={onToggleExpand}
                                    onExternalFileDrop={onExternalFileDrop}
                                    onMention={onMention}
                                    onShowMenu={onShowMenu}
                                    editingPath={editingPath}
                                    editingName={editingName}
                                    onEditingNameChange={onEditingNameChange}
                                    onEditingSubmit={onEditingSubmit}
                                    onEditingCancel={onEditingCancel}
                                    onEditingSelectionStart={onEditingSelectionStart}
                                    onEditingSelectionEnd={onEditingSelectionEnd}
                                    onDoubleClick={onDoubleClick}
                                />
                            ))}
                        </div>
                    )}
                </Collapsible.Content>
            </Collapsible.Root>
        </div>
    );
}
