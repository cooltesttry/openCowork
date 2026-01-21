"use client"

import { useState, KeyboardEvent, forwardRef, useImperativeHandle, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendIcon, Square, Paperclip, Slash, AtSign, ShieldCheck, ShieldAlert, ShieldOff, X } from "lucide-react";
import { ModelSelector } from "./model-selector";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { QuickPanel, SlashCommand, FileItem } from "./quick-panel";
import { fetchWorkingDirectoryFiles } from "@/lib/api";

// Security mode types matching backend permission_mode
export type SecurityMode = 'default' | 'acceptEdits' | 'bypassPermissions';

// Short display names for each mode
const SECURITY_MODES: { value: SecurityMode; label: string; icon: React.ReactNode; description: string; color: string }[] = [
    {
        value: 'default',
        label: 'Ask',
        icon: <ShieldCheck className="h-4 w-4" />,
        description: 'Ask before every tool',
        color: 'text-green-600 dark:text-green-400'
    },
    {
        value: 'acceptEdits',
        label: 'AutoEdit',
        icon: <ShieldAlert className="h-4 w-4" />,
        description: 'Auto-approve file edits only',
        color: 'text-yellow-600 dark:text-yellow-400'
    },
    {
        value: 'bypassPermissions',
        label: 'Bypass',
        icon: <ShieldOff className="h-4 w-4" />,
        description: 'Skip all permission checks',
        color: 'text-red-600 dark:text-red-400'
    },
];

// Default slash commands (minimal set - SDK will provide the full list)
const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
    { command: '/compact', description: '' },
    { command: '/context', description: '' },
    { command: '/cost', description: '' },
    { command: '/init', description: '' },
    { command: '/review', description: '' },
];

interface InputAreaProps {
    onSend: (message: string, attachedFiles?: string[]) => void;
    isRunning?: boolean;      // Session is running - show stop button
    onInterrupt?: () => void; // Callback to interrupt running session
    securityMode?: SecurityMode;
    onSecurityModeChange?: (mode: SecurityMode) => void;
    // New props for smart input
    slashCommands?: SlashCommand[];
    files?: FileItem[];
    onFileSelect?: () => void;
}

export interface InputAreaRef {
    focus: () => void;
    insertText: (text: string) => void;
}

export const InputArea = forwardRef<InputAreaRef, InputAreaProps>(
    function InputArea({
        onSend,
        isRunning = false,
        onInterrupt,
        securityMode = 'bypassPermissions',
        onSecurityModeChange,
        slashCommands = DEFAULT_SLASH_COMMANDS,
        files: filesProp,
        onFileSelect,
    }, ref) {
        const [content, setContent] = useState("");
        const textareaRef = useRef<HTMLTextAreaElement>(null);
        const fileInputRef = useRef<HTMLInputElement>(null);

        // File list state - fetched from API
        const [workingDirFiles, setWorkingDirFiles] = useState<FileItem[]>([]);

        // Use prop files if provided, otherwise use API-fetched files
        const files = filesProp ?? workingDirFiles;

        // Quick Panel state
        const [quickPanelOpen, setQuickPanelOpen] = useState(false);
        const [triggerType, setTriggerType] = useState<'slash' | 'mention' | null>(null);
        const [triggerPosition, setTriggerPosition] = useState<number | null>(null);
        const [filterText, setFilterText] = useState('');

        // Attached files state - stores {fullPath, displayName}
        const [attachedFiles, setAttachedFiles] = useState<{ fullPath: string, displayName: string }[]>([]);

        // Fetch working directory files on mount
        useEffect(() => {
            const loadFiles = async () => {
                try {
                    const response = await fetchWorkingDirectoryFiles();
                    if (response.status === 'success' && response.files) {
                        setWorkingDirFiles(response.files.map(f => ({
                            name: f.name,
                            path: f.path,
                            isDirectory: f.is_directory,
                        })));
                    }
                } catch (error) {
                    console.error('Failed to load working directory files:', error);
                }
            };
            loadFiles();
        }, []);

        // Expose focus and insertText methods to parent
        useImperativeHandle(ref, () => ({
            focus: () => {
                textareaRef.current?.focus();
            },
            insertText: (text: string) => {
                // Get current content directly from textarea to avoid stale closure
                const currentContent = textareaRef.current?.value ?? '';
                const cursorPos = textareaRef.current?.selectionStart ?? currentContent.length;
                const before = currentContent.slice(0, cursorPos);
                const after = currentContent.slice(cursorPos);

                // Add space before @ if needed
                const needsSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
                const insertStr = (needsSpace ? ' ' : '') + '@' + text + ' ';

                const newContent = before + insertStr + after;
                setContent(newContent);

                // Focus and move cursor after inserted text
                requestAnimationFrame(() => {
                    const newPos = cursorPos + insertStr.length;
                    textareaRef.current?.setSelectionRange(newPos, newPos);
                    textareaRef.current?.focus();
                });
            }
        }));

        // Handle content change with trigger detection
        const handleContentChange = useCallback((value: string) => {
            setContent(value);

            const cursorPos = textareaRef.current?.selectionStart ?? value.length;
            const textBeforeCursor = value.slice(0, cursorPos);

            // Get current line (line where cursor is)
            const lastNewline = textBeforeCursor.lastIndexOf('\n');
            const currentLine = textBeforeCursor.slice(lastNewline + 1);

            // Detect / trigger: first non-space character on line
            // Match: optional spaces at start + / + filter text
            const slashMatch = currentLine.match(/^\s*\/([^\s]*)$/);
            if (slashMatch) {
                setTriggerType('slash');
                setTriggerPosition(cursorPos - slashMatch[1].length - 1);
                setFilterText(slashMatch[1]);
                setQuickPanelOpen(true);
                return;
            }

            // Detect @ trigger: line start OR anywhere preceded by space
            // Pattern 1: at line start (possibly with spaces)
            const atLineStartMatch = currentLine.match(/^\s*@([^\s]*)$/);
            // Pattern 2: after space anywhere
            const atAfterSpaceMatch = textBeforeCursor.match(/\s@([^\s]*)$/);

            if (atLineStartMatch) {
                setTriggerType('mention');
                setTriggerPosition(cursorPos - atLineStartMatch[1].length - 1);
                setFilterText(atLineStartMatch[1]);
                setQuickPanelOpen(true);
                return;
            }

            if (atAfterSpaceMatch) {
                setTriggerType('mention');
                setTriggerPosition(cursorPos - atAfterSpaceMatch[1].length - 1);
                setFilterText(atAfterSpaceMatch[1]);
                setQuickPanelOpen(true);
                return;
            }

            // No trigger - continue typing cancels panel
            if (quickPanelOpen) {
                setQuickPanelOpen(false);
                setTriggerType(null);
                setFilterText('');
            }
        }, [quickPanelOpen]);

        // Handle Quick Panel selection
        const handleQuickPanelSelect = useCallback((item: string) => {
            if (triggerPosition !== null) {
                const before = content.slice(0, triggerPosition);
                const afterStartPos = triggerPosition + 1 + filterText.length;
                const after = content.slice(afterStartPos);

                // For slash commands: keep the full command (starts with /)
                // For @ mentions: keep the @ symbol with the path
                const insertText = triggerType === 'slash' ? item + ' ' : '@' + item + ' ';

                const newContent = before + insertText + after;
                setContent(newContent);

                // Move cursor after inserted text
                setTimeout(() => {
                    const newPos = before.length + insertText.length;
                    textareaRef.current?.setSelectionRange(newPos, newPos);
                    textareaRef.current?.focus();
                }, 0);
            }

            setQuickPanelOpen(false);
            setTriggerType(null);
            setFilterText('');
        }, [content, triggerPosition, filterText, triggerType]);

        // Handle toolbar button clicks
        const handleSlashClick = useCallback((e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Save current cursor position before any state changes
            const cursorPos = textareaRef.current?.selectionStart ?? content.length;
            const before = content.slice(0, cursorPos);
            const after = content.slice(cursorPos);

            // Check if we need to add a newline first
            const needsNewline = before.length > 0 && !before.endsWith('\n') && !before.endsWith(' ');
            const insertText = needsNewline ? '\n/' : '/';

            const newContent = before + insertText + after;
            const newCursorPos = before.length + insertText.length;

            setContent(newContent);

            // Trigger the panel and restore cursor
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus();
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
                }
                setTriggerType('slash');
                setTriggerPosition(before.length + (needsNewline ? 1 : 0));
                setFilterText('');
                setQuickPanelOpen(true);
            });
        }, [content]);

        const handleAtClick = useCallback((e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Save current cursor position before any state changes
            const cursorPos = textareaRef.current?.selectionStart ?? content.length;
            const before = content.slice(0, cursorPos);
            const after = content.slice(cursorPos);

            // Need space before @ unless at start or after newline
            const needsSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
            const insertText = needsSpace ? ' @' : '@';

            const newContent = before + insertText + after;
            const newCursorPos = before.length + insertText.length;

            setContent(newContent);

            // Trigger the panel and restore cursor
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus();
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
                }
                setTriggerType('mention');
                setTriggerPosition(before.length + (needsSpace ? 1 : 0));
                setFilterText('');
                setQuickPanelOpen(true);
            });
        }, [content]);

        // Button state: 'stop' | 'disabled' | 'send'
        const buttonState = useMemo(() => {
            if (isRunning) return 'stop';
            if (!content.trim() && attachedFiles.length === 0) return 'disabled';
            return 'send';
        }, [isRunning, content, attachedFiles.length]);

        const handleSend = () => {
            if ((content.trim() || attachedFiles.length > 0) && !isRunning) {
                // Format message with attachments according to SDK format
                // Use full absolute paths as required by SDK
                let messageText = content.trim();
                if (attachedFiles.length > 0) {
                    const filePaths = attachedFiles.map(f => f.fullPath).join('\n');
                    messageText = messageText
                        ? `${messageText}\n\nAttached files:\n${filePaths}`
                        : `Attached files:\n${filePaths}`;
                }
                onSend(messageText, attachedFiles.map(f => f.fullPath));
                setContent("");
                setAttachedFiles([]);
            }
        };

        // Handle button click based on state
        const handleButtonClick = () => {
            if (buttonState === 'stop') {
                onInterrupt?.();
            } else if (buttonState === 'send') {
                handleSend();
            }
        };

        const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
            // If quick panel is open, it handles Arrow/Enter via document listener
            // We just need to prevent default Enter behavior and let Escape close the panel
            if (quickPanelOpen) {
                // Block Enter from sending message when panel is open
                if (e.key === 'Enter') {
                    e.preventDefault();
                    return;
                }
                // Let Escape close the panel (handled by QuickPanel's document listener)
                if (e.key === 'Escape') {
                    return;
                }
                // Arrow keys are handled by QuickPanel's document listener
                if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
                    return;
                }
            }

            // Normal Enter to send (blocked when session is running)
            if (e.key === "Enter" && !e.shiftKey && !quickPanelOpen) {
                e.preventDefault();
                // Only send if not running
                if (!isRunning) {
                    handleSend();
                }
            }
        };

        const currentMode = SECURITY_MODES.find(m => m.value === securityMode) || SECURITY_MODES[2];

        return (

            <div className="p-4 border-t bg-zinc-50 dark:bg-zinc-900 relative">
                <div className="mx-auto relative w-full">
                    {/* Unified Input Box Container */}
                    <div className="flex flex-col border rounded-xl bg-white dark:bg-zinc-800 shadow-sm focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-all">

                        {/* Top Section: Text Extraction Area */}
                        <div className="relative flex items-end pr-2 gap-2">
                            <Textarea
                                ref={textareaRef}
                                value={content}
                                onChange={(e) => handleContentChange(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={isRunning ? "Session is running... (type here, press Stop to interrupt)" : "Type a message... (/ for commands, @ for files)"}
                                className="min-h-[48px] max-h-[200px] w-full resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent px-3 pt-1 pb-0 flex-1"
                            />
                            {/* Send/Stop Button */}
                            <Button
                                onClick={handleButtonClick}
                                disabled={buttonState === 'disabled'}
                                size="icon"
                                className={cn(
                                    "h-8 w-8 rounded-lg mb-1 transition-colors",
                                    buttonState === 'stop' && "bg-red-500 hover:bg-red-600 text-white"
                                )}
                                title={buttonState === 'stop' ? 'Stop' : 'Send'}
                            >
                                {buttonState === 'stop' ? (
                                    <Square className="h-4 w-4 fill-current" />
                                ) : (
                                    <SendIcon className="h-4 w-4" />
                                )}
                            </Button>
                        </div>

                        {/* Middle Section: Attached Files (if any) */}
                        {attachedFiles.length > 0 && (
                            <div className="px-3 pb-2 flex items-center gap-2 overflow-x-auto">
                                {attachedFiles.map((file, index) => (
                                    <div
                                        key={`${file.fullPath}-${index}`}
                                        className="flex items-center gap-1 px-2 py-1 bg-accent/50 rounded-md text-xs border border-accent/50 shrink-0"
                                        title={file.fullPath}
                                    >
                                        <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                                        <span className="truncate max-w-[120px]">{file.displayName}</span>
                                        <button
                                            type="button"
                                            className="ml-1 p-0.5 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors"
                                            onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== index))}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}


                        {/* Bottom Section: Toolbar */}
                        <div className="flex items-center justify-between px-2 pb-0 pt-0 rounded-b-xl">
                            {/* Left Actions */}

                            <div className="flex items-center gap-0">
                                {/* Add Attachment */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                <Paperclip className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            <p>添加附件</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    multiple
                                    onChange={(e) => {
                                        const selectedFiles = e.target.files;
                                        if (selectedFiles && selectedFiles.length > 0) {
                                            const newFiles = Array.from(selectedFiles).map(f => ({
                                                fullPath: (f as File & { path?: string }).path || f.name,
                                                displayName: f.name
                                            }));
                                            setAttachedFiles(prev => [...prev, ...newFiles]);
                                            onFileSelect?.();
                                        }
                                        e.target.value = '';
                                    }}
                                />

                                {/* Slash Command */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                onClick={handleSlashClick}
                                            >
                                                <Slash className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            <p>斜杠命令</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                {/* File Reference */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                onClick={handleAtClick}
                                            >
                                                <AtSign className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            <p>引用文件</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                {/* Model Selector - shows only short model name */}
                                <ModelSelector />
                            </div>

                            {/* Right Actions: Security Only */}
                            <div className="flex items-center gap-2">
                                {/* Security Mode */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <DropdownMenu>
                                            <TooltipTrigger asChild>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className={`h-6 px-1.5 gap-1 font-normal ${currentMode.color}`}
                                                    >
                                                        {currentMode.icon}
                                                        <span className="text-xs">{currentMode.label}</span>
                                                    </Button>
                                                </DropdownMenuTrigger>
                                            </TooltipTrigger>
                                            <DropdownMenuContent align="end" className="w-56">
                                                {SECURITY_MODES.map((mode) => (
                                                    <DropdownMenuItem
                                                        key={mode.value}
                                                        onClick={() => onSecurityModeChange?.(mode.value)}
                                                        className={`flex items-center gap-2 py-2 cursor-pointer ${securityMode === mode.value ? 'bg-accent' : ''}`}
                                                    >
                                                        <div className={`p-1 rounded-md bg-background border ${mode.color.replace('text-', 'border-').split(' ')[0]}`}>
                                                            {mode.icon}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium text-sm">{mode.label}</span>
                                                            <span className="text-[10px] text-muted-foreground">{mode.description}</span>
                                                        </div>
                                                        {securityMode === mode.value && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                        <TooltipContent side="top">
                                            <p>Security Mode: {currentMode.label}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        </div>
                    </div>

                    {/* Quick Panel */}
                    <QuickPanel
                        open={quickPanelOpen}
                        onOpenChange={setQuickPanelOpen}
                        type={triggerType || 'slash'}
                        filterText={filterText}
                        onSelect={handleQuickPanelSelect}
                        slashCommands={slashCommands}
                        files={files}
                        anchorRef={textareaRef}
                    />
                </div>
            </div>
        );
    }
);
