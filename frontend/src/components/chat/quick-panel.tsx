"use client"

import * as React from "react"
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { FileIcon, FolderIcon, ChevronRight } from "lucide-react"

// Types
export interface SlashCommand {
    command: string
    description: string
}

export interface FileItem {
    name: string
    path: string      // relative path
    isDirectory: boolean
}

interface QuickPanelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    type: 'slash' | 'mention'
    filterText: string
    onSelect: (item: string) => void
    // Data
    slashCommands?: SlashCommand[]
    files?: FileItem[]
    // Anchor element for positioning
    anchorRef: React.RefObject<HTMLTextAreaElement | null>
}

export function QuickPanel({
    open,
    onOpenChange,
    type,
    filterText,
    onSelect,
    slashCommands = [],
    files = [],
    // anchorRef is kept in interface for API compatibility but not used
}: QuickPanelProps) {
    const commandRef = React.useRef<HTMLDivElement>(null)
    const [selectedIndex, setSelectedIndex] = React.useState(0)

    // Current directory for file navigation (empty = root)
    const [currentDir, setCurrentDir] = React.useState("")

    // Get items based on type, filter, and current directory
    const items = React.useMemo(() => {
        const search = filterText.toLowerCase()

        if (type === 'slash') {
            return slashCommands.filter(cmd =>
                cmd.command.toLowerCase().includes(search) ||
                cmd.description.toLowerCase().includes(search)
            )
        } else {
            // File mode
            if (search) {
                // When typing, show all matching files across all directories
                return files.filter(file =>
                    file.name.toLowerCase().includes(search) ||
                    file.path.toLowerCase().includes(search)
                )
            } else {
                // When not typing, show only items in current directory
                return files.filter(file => {
                    const filePath = file.path.replace(/\/$/, '') // Remove trailing slash
                    const fileDir = filePath.includes('/')
                        ? filePath.substring(0, filePath.lastIndexOf('/'))
                        : ''
                    return fileDir === currentDir
                })
            }
        }
    }, [type, filterText, slashCommands, files, currentDir])

    // Reset selection when items change
    React.useEffect(() => {
        setSelectedIndex(0)
    }, [items.length, filterText, currentDir])

    // Reset current directory when panel closes or type changes
    React.useEffect(() => {
        if (!open) {
            setCurrentDir("")
        }
    }, [open])

    // Scroll selected item into view
    React.useEffect(() => {
        if (!open) return
        const container = commandRef.current?.querySelector('.overflow-y-auto')
        const selectedEl = container?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement
        if (selectedEl && container) {
            selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
    }, [selectedIndex, open])

    // Handle keyboard navigation
    React.useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!open) return

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    e.stopPropagation()
                    setSelectedIndex(prev => Math.min(prev + 1, items.length - 1))
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    e.stopPropagation()
                    setSelectedIndex(prev => Math.max(prev - 1, 0))
                    break
                case 'ArrowRight':
                    // Enter directory if selected item is a directory
                    if (type === 'mention' && items.length > 0 && selectedIndex < items.length) {
                        const item = items[selectedIndex] as FileItem
                        if (item.isDirectory) {
                            e.preventDefault()
                            e.stopPropagation()
                            // Navigate into directory
                            const newDir = item.path.replace(/\/$/, '')
                            setCurrentDir(newDir)
                            setSelectedIndex(0)
                        }
                    }
                    break
                case 'ArrowLeft':
                    // Go to parent directory
                    if (type === 'mention' && currentDir) {
                        e.preventDefault()
                        e.stopPropagation()
                        // Navigate to parent directory
                        const parentDir = currentDir.includes('/')
                            ? currentDir.substring(0, currentDir.lastIndexOf('/'))
                            : ''
                        setCurrentDir(parentDir)
                        setSelectedIndex(0)
                    }
                    break
                case 'Enter':
                    e.preventDefault()
                    e.stopPropagation()
                    if (items.length > 0 && selectedIndex < items.length) {
                        const item = items[selectedIndex]
                        if (type === 'slash') {
                            onSelect((item as SlashCommand).command)
                        } else {
                            const fileItem = item as FileItem
                            if (fileItem.isDirectory) {
                                // Enter directory instead of selecting
                                const newDir = fileItem.path.replace(/\/$/, '')
                                setCurrentDir(newDir)
                                setSelectedIndex(0)
                            } else {
                                onSelect(fileItem.path)
                            }
                        }
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    e.stopPropagation()
                    onOpenChange(false)
                    break
            }
        }

        // Listen on document to catch events from textarea
        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [open, items, selectedIndex, type, onSelect, onOpenChange, currentDir])

    if (items.length === 0) {
        return null
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverAnchor asChild>
                <span
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: 1,
                        height: 1,
                        pointerEvents: 'none'
                    }}
                />
            </PopoverAnchor>
            <PopoverContent
                className="w-[360px] p-0"
                side="top"
                align="start"
                sideOffset={0}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                <div ref={commandRef} className="rounded-lg border shadow-md bg-popover">
                    <div className="max-h-[300px] overflow-y-auto">
                        {type === 'slash' && (
                            <div className="p-0.5">
                                <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                                    Slash Commands
                                </div>
                                {(items as SlashCommand[]).map((cmd, index) => (
                                    <div
                                        key={cmd.command}
                                        data-index={index}
                                        className={`flex flex-col items-start gap-0.5 px-2 py-1 cursor-pointer rounded-sm text-xs ${index === selectedIndex
                                            ? 'bg-accent text-accent-foreground'
                                            : 'hover:bg-accent/50'
                                            }`}
                                        onClick={() => onSelect(cmd.command)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <span className="font-medium text-primary text-xs">{cmd.command}</span>
                                        {cmd.description && (
                                            <span className="text-[10px] text-muted-foreground">{cmd.description}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {type === 'mention' && (
                            <div className="p-0.5">
                                <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground flex items-center justify-between">
                                    <span>
                                        {filterText ? 'Search' : (currentDir ? `📁 ${currentDir}/` : '📁 Root')}
                                    </span>
                                    {currentDir && !filterText && (
                                        <span className="text-[9px] opacity-60">← back</span>
                                    )}
                                </div>
                                {(items as FileItem[]).map((file, index) => (
                                    <div
                                        key={file.path}
                                        data-index={index}
                                        className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded-sm text-xs ${index === selectedIndex
                                            ? 'bg-accent text-accent-foreground'
                                            : 'hover:bg-accent/50'
                                            }`}
                                        onClick={() => {
                                            if (file.isDirectory) {
                                                const newDir = file.path.replace(/\/$/, '')
                                                setCurrentDir(newDir)
                                                setSelectedIndex(0)
                                            } else {
                                                onSelect(file.path)
                                            }
                                        }}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        {file.isDirectory ? (
                                            <FolderIcon className="h-3 w-3 text-blue-500 shrink-0" />
                                        ) : (
                                            <FileIcon className="h-3 w-3 text-gray-500 shrink-0" />
                                        )}
                                        <span className="text-xs truncate flex-1">
                                            {filterText ? file.path : file.name}
                                        </span>
                                        {file.isDirectory && (
                                            <ChevronRight className="h-2.5 w-2.5 opacity-50 shrink-0" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
