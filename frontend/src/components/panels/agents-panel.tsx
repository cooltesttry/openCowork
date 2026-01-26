'use client';

import { useState, useEffect, useCallback } from 'react';
import { IDockviewPanelProps } from "dockview";
import { listWorkers, createWorker, updateWorker, deleteWorker, WorkerConfig, fetchConfig } from '@/lib/api';
import { toast } from 'sonner';
import { Trash2, Plus, Save, RotateCcw } from 'lucide-react';
import { WorkerModelSelector } from './worker-model-selector';

// MCP Server Selection Component
interface SearchConfig {
    provider: "serper" | "tavily" | "brave" | "none";
    api_key: string | null;
    enabled: boolean;
}

function McpServersList({
    selectedServers,
    onSelectedChange
}: {
    selectedServers: string[];
    onSelectedChange: (servers: string[]) => void
}) {
    const [systemServers, setSystemServers] = useState<{ name: string; command?: string; type?: string }[]>([]);
    const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            fetchConfig<{ name: string; command: string }[]>("/mcp"),
            fetchConfig<SearchConfig>("/search")
        ])
            .then(([mcpData, searchData]) => {
                setSystemServers(mcpData || []);
                setSearchConfig(searchData);
            })
            .catch(() => {
                setSystemServers([]);
                setSearchConfig(null);
            })
            .finally(() => setLoading(false));
    }, []);

    const handleToggle = (name: string, checked: boolean) => {
        if (checked) {
            onSelectedChange([...selectedServers, name]);
        } else {
            onSelectedChange(selectedServers.filter(s => s !== name));
        }
    };

    // Check if search is configured (has provider and api_key)
    const isSearchConfigured = searchConfig &&
        searchConfig.provider !== "none" &&
        searchConfig.api_key;

    if (loading) return <div className="text-xs text-gray-500">Loading MCP servers...</div>;
    if (!isSearchConfigured && systemServers.length === 0) {
        return <div className="text-xs text-gray-500">No MCP servers or search tool configured in system settings.</div>;
    }

    return (
        <div className="space-y-2 mt-2">
            {/* Search Tool - Always First when configured */}
            {isSearchConfigured && searchConfig && (
                <label className="flex items-center space-x-2 text-sm cursor-pointer p-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                    <input
                        type="checkbox"
                        checked={selectedServers.includes("search-tools")}
                        onChange={(e) => handleToggle("search-tools", e.target.checked)}
                        className="rounded"
                    />
                    <span className="font-medium">搜索工具</span>
                    <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-800 rounded">{searchConfig.provider}</span>
                </label>
            )}

            {/* Regular MCP Servers */}
            {systemServers.map(server => (
                <label key={server.name} className="flex items-center space-x-2 text-sm cursor-pointer p-2 rounded hover:bg-gray-50 dark:hover:bg-zinc-800">
                    <input
                        type="checkbox"
                        checked={selectedServers.includes(server.name)}
                        onChange={(e) => handleToggle(server.name, e.target.checked)}
                        className="rounded"
                    />
                    <span>{server.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{server.command}</span>
                </label>
            ))}
        </div>
    );
}

interface AgentsPanelProps extends IDockviewPanelProps {
    params: Record<string, unknown>;
}

const EMPTY_WORKER: WorkerConfig = {
    id: '',
    name: '',
    model: 'claude-3-5-sonnet-20241022',
    provider: 'openrouter',
    api_key: '',
    endpoint: '',
    mcp_inherit_system: true,
    mcp_selected: [],
    mcp_servers: [],
    prompt: { system: '', user: '' },
    tools_allow: [],
    tools_block: [],
    env: {},
    cwd: '',
    max_turns: 0,
    max_tokens: 0,
    max_thinking_tokens: 0,
    setting_sources: ['project'],
    permission_mode: undefined,
    include_partial_messages: false,
    output_format: undefined,
    preserve_context: false,
};

export function AgentsPanel({ }: AgentsPanelProps) {
    const [workers, setWorkers] = useState<WorkerConfig[]>([]);
    const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
    const [editingWorker, setEditingWorker] = useState<WorkerConfig>(EMPTY_WORKER);
    const [activeTab, setActiveTab] = useState<'basic' | 'advanced' | 'prompts' | 'mcp' | 'tools'>('basic');
    const [isNew, setIsNew] = useState(false);
    const [loading, setLoading] = useState(false);

    const selectWorker = (id: string) => {
        setSelectedWorkerId(id);
        setIsNew(false);
        setActiveTab('basic');
    };

    // Ensure editingWorker stays in sync with selected worker
    useEffect(() => {
        if (selectedWorkerId && !isNew) {
            const worker = workers.find(w => w.id === selectedWorkerId);
            if (worker) {
                setEditingWorker({ ...worker });
            }
        }
    }, [selectedWorkerId, workers, isNew]);

    const loadWorkers = useCallback(async () => {
        try {
            const response = await listWorkers();
            setWorkers(response.workers);
        } catch (error) {
            console.error('Failed to load workers:', error);
            toast.error('Failed to load worker templates');
        }
    }, []);

    // Load workers on mount
    useEffect(() => {
        loadWorkers();
    }, [loadWorkers]);

    // Auto-select default worker if needed
    useEffect(() => {
        if (workers.length > 0 && !selectedWorkerId && !isNew) {
            const defaultWorker = workers.find(w => w.id === 'default') || workers[0];
            selectWorker(defaultWorker.id);
        }
    }, [workers, selectedWorkerId, isNew]);



    const handleNew = () => {
        setEditingWorker(EMPTY_WORKER);
        setSelectedWorkerId(null);
        setIsNew(true);
        setActiveTab('basic');
    };

    const handleSave = async () => {
        // Validation - allow empty model for System inheritance
        if (!editingWorker.id || !editingWorker.name) {
            toast.error('Please fill in ID and Name');
            return;
        }

        setLoading(true);
        try {
            if (isNew) {
                await createWorker(editingWorker);
                toast.success(`Worker "${editingWorker.name}" created`);
            } else if (selectedWorkerId) {
                // Ensure ID matches the selected worker ID to prevent API errors
                const payload = { ...editingWorker, id: selectedWorkerId };
                await updateWorker(selectedWorkerId, payload);
                toast.success(`Worker "${editingWorker.name}" updated`);
            }
            await loadWorkers();
            setSelectedWorkerId(editingWorker.id);
            setIsNew(false);
        } catch (error: unknown) {
            console.error('Failed to save worker:', error);
            const message = error instanceof Error ? error.message : 'Failed to save worker';
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedWorkerId) return;
        if (selectedWorkerId === 'default') {
            toast.error('Cannot delete default worker');
            return;
        }

        if (!confirm(`Delete worker "${editingWorker.name}"?`)) return;

        setLoading(true);
        try {
            await deleteWorker(selectedWorkerId);
            toast.success('Worker deleted');
            await loadWorkers();
            setSelectedWorkerId(null);
            setEditingWorker(EMPTY_WORKER);
        } catch (error: unknown) {
            console.error('Failed to delete worker:', error);
            const message = error instanceof Error ? error.message : 'Failed to delete worker';
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const handleReset = () => {
        if (selectedWorkerId) {
            const worker = workers.find(w => w.id === selectedWorkerId);
            if (worker) {
                setEditingWorker({ ...worker });
            }
        } else {
            setEditingWorker(EMPTY_WORKER);
        }
    };

    const updateField = (field: keyof WorkerConfig, value: unknown) => {
        setEditingWorker(prev => ({ ...prev, [field]: value }));
    };

    const renderBasicTab = () => {
        const isSystem = !editingWorker.model;

        const handleSystemToggle = (checked: boolean) => {
            if (checked) {
                setEditingWorker(prev => ({
                    ...prev,
                    model: '',
                    provider: undefined,
                    endpoint: undefined,
                    api_key: undefined
                }));
            } else {
                setEditingWorker(prev => ({
                    ...prev,
                    model: 'claude-3-5-sonnet-20241022',
                    provider: 'openrouter'
                }));
            }
        };

        return (
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Worker ID *</label>
                    <input
                        type="text"
                        value={editingWorker.id}
                        onChange={(e) => updateField('id', e.target.value)}
                        disabled={!isNew}
                        className="w-full p-2 border rounded text-sm disabled:bg-gray-100 dark:disabled:bg-zinc-800"
                        placeholder="e.g., research"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Worker Name *</label>
                    <input
                        type="text"
                        value={editingWorker.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        className="w-full p-2 border rounded text-sm"
                        placeholder="e.g., Research Assistant"
                    />
                </div>

                <div className="p-4 border rounded-md bg-gray-50 dark:bg-zinc-900/50 space-y-4">
                    <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium">Model Configuration</label>
                        <label className="flex items-center space-x-2 text-xs text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isSystem}
                                onChange={(e) => handleSystemToggle(e.target.checked)}
                                className="rounded"
                            />
                            <span>Follow System Settings</span>
                        </label>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Model Selector</label>
                        <WorkerModelSelector
                            worker={editingWorker}
                            onUpdate={(updates) => setEditingWorker(prev => ({ ...prev, ...updates }))}
                            disabled={isSystem}
                        />
                    </div>
                </div>

                <div className="p-4 border rounded-md bg-gray-50 dark:bg-zinc-900/50">
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium">Max Turns</label>
                        <label className="flex items-center space-x-2 text-xs text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={!editingWorker.max_turns}
                                onChange={(e) => updateField('max_turns', e.target.checked ? 0 : 30)}
                                className="rounded"
                            />
                            <span>System</span>
                        </label>
                    </div>
                    <input
                        type="number"
                        value={editingWorker.max_turns || ''}
                        onChange={(e) => updateField('max_turns', parseInt(e.target.value) || 0)}
                        disabled={!editingWorker.max_turns}
                        className="w-full p-2 border rounded text-sm disabled:opacity-50"
                        min="1"
                        placeholder="System Default"
                    />
                </div>
            </div>
        );
    };

    const renderAdvancedTab = () => (
        <div className="space-y-4">
            <div className="p-4 border rounded-md bg-gray-50 dark:bg-zinc-900/50">
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">Max Tokens</label>
                    <label className="flex items-center space-x-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!editingWorker.max_tokens}
                            onChange={(e) => updateField('max_tokens', e.target.checked ? 0 : 8000)}
                            className="rounded"
                        />
                        <span>System</span>
                    </label>
                </div>
                <input
                    type="number"
                    value={editingWorker.max_tokens || ''}
                    onChange={(e) => updateField('max_tokens', parseInt(e.target.value) || 0)}
                    disabled={!editingWorker.max_tokens}
                    className="w-full p-2 border rounded text-sm disabled:opacity-50"
                    min="1"
                    placeholder="System Default"
                />
            </div>

            <div className="p-4 border rounded-md bg-gray-50 dark:bg-zinc-900/50">
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">Max Thinking Tokens</label>
                    <label className="flex items-center space-x-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!editingWorker.max_thinking_tokens}
                            onChange={(e) => updateField('max_thinking_tokens', e.target.checked ? 0 : 1000)}
                            className="rounded"
                        />
                        <span>System</span>
                    </label>
                </div>
                <input
                    type="number"
                    value={editingWorker.max_thinking_tokens || ''}
                    onChange={(e) => updateField('max_thinking_tokens', parseInt(e.target.value) || 0)}
                    disabled={!editingWorker.max_thinking_tokens}
                    className="w-full p-2 border rounded text-sm disabled:opacity-50"
                    min="0"
                    placeholder="System Default"
                />
            </div>

            <div className="p-4 border rounded-md bg-gray-50 dark:bg-zinc-900/50">
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">Permission Mode</label>
                    <label className="flex items-center space-x-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!editingWorker.permission_mode}
                            onChange={(e) => updateField('permission_mode', e.target.checked ? undefined : 'default')}
                            className="rounded"
                        />
                        <span>System</span>
                    </label>
                </div>
                <select
                    value={editingWorker.permission_mode || ''}
                    onChange={(e) => updateField('permission_mode', e.target.value || undefined)}
                    disabled={!editingWorker.permission_mode}
                    className="w-full p-2 border rounded text-sm disabled:opacity-50"
                >
                    <option value="">System Default</option>
                    <option value="default">Default (Ask)</option>
                    <option value="bypassPermissions">Bypass Permissions</option>
                    <option value="plan">Plan Mode</option>
                    <option value="acceptEdits">Accept Edits</option>
                </select>
            </div>

            <div className="p-4 border rounded-md bg-gray-50 dark:bg-zinc-900/50">
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">Working Directory</label>
                    <label className="flex items-center space-x-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!editingWorker.cwd}
                            onChange={(e) => updateField('cwd', e.target.checked ? undefined : '/')}
                            className="rounded"
                        />
                        <span>System</span>
                    </label>
                </div>
                <input
                    type="text"
                    value={editingWorker.cwd || ''}
                    onChange={(e) => updateField('cwd', e.target.value)}
                    disabled={!editingWorker.cwd}
                    className="w-full p-2 border rounded text-sm disabled:opacity-50"
                    placeholder="System Default"
                />
            </div>

            <div>
                <label className="flex items-center space-x-2 text-sm">
                    <input
                        type="checkbox"
                        checked={editingWorker.include_partial_messages}
                        onChange={(e) => updateField('include_partial_messages', e.target.checked)}
                        className="rounded"
                    />
                    <span>Include Partial Messages (Streaming)</span>
                </label>
                <p className="text-xs text-gray-500 mt-1">Enable real-time incremental output</p>
            </div>

            <div>
                <label className="flex items-center space-x-2 text-sm">
                    <input
                        type="checkbox"
                        checked={editingWorker.preserve_context}
                        onChange={(e) => updateField('preserve_context', e.target.checked)}
                        className="rounded"
                    />
                    <span>Preserve Context (Multi-turn)</span>
                </label>
                <p className="text-xs text-gray-500 mt-1">Preserve context: each turn continues based on previous history</p>
            </div>
        </div>
    );

    const renderPromptsTab = () => (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium mb-1">System Prompt</label>
                <textarea
                    value={editingWorker.prompt?.system || ''}
                    onChange={(e) => updateField('prompt', { ...editingWorker.prompt, system: e.target.value })}
                    className="w-full p-2 border rounded text-sm font-mono"
                    rows={6}
                    placeholder="You are a helpful assistant..."
                />
            </div>

            <div>
                <label className="block text-sm font-medium mb-1">User Prompt Template</label>
                <textarea
                    value={editingWorker.prompt?.user || ''}
                    onChange={(e) => updateField('prompt', { ...editingWorker.prompt, user: e.target.value })}
                    className="w-full p-2 border rounded text-sm font-mono"
                    rows={4}
                    placeholder="Optional initial user prompt..."
                />
            </div>
        </div>
    );

    const renderToolsTab = () => (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium mb-1">Allowed Tools</label>
                <textarea
                    value={editingWorker.tools_allow?.join(', ') || ''}
                    onChange={(e) => updateField('tools_allow', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    className="w-full p-2 border rounded text-sm font-mono"
                    rows={3}
                    placeholder="Read, Write, Edit, Bash, Glob"
                />
                <p className="text-xs text-gray-500 mt-1">Comma-separated list</p>
            </div>

            <div>
                <label className="block text-sm font-medium mb-1">Blocked Tools</label>
                <textarea
                    value={editingWorker.tools_block?.join(', ') || ''}
                    onChange={(e) => updateField('tools_block', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    className="w-full p-2 border rounded text-sm font-mono"
                    rows={2}
                    placeholder="WebSearch, WebFetch"
                />
                <p className="text-xs text-gray-500 mt-1">Comma-separated list</p>
            </div>

            <div>
                <label className="block text-sm font-medium mb-1">Setting Sources</label>
                <div className="space-y-2">
                    <label className="flex items-center space-x-2 text-sm">
                        <input
                            type="checkbox"
                            checked={editingWorker.setting_sources?.includes('project')}
                            onChange={(e) => {
                                const sources = editingWorker.setting_sources || [];
                                updateField('setting_sources', e.target.checked
                                    ? [...sources, 'project'].filter((v, i, a) => a.indexOf(v) === i)
                                    : sources.filter(s => s !== 'project'));
                            }}
                            className="rounded"
                        />
                        <span>Project ({'{cwd}'}/.claude/skills/)</span>
                    </label>
                    <label className="flex items-center space-x-2 text-sm">
                        <input
                            type="checkbox"
                            checked={editingWorker.setting_sources?.includes('user')}
                            onChange={(e) => {
                                const sources = editingWorker.setting_sources || [];
                                updateField('setting_sources', e.target.checked
                                    ? [...sources, 'user'].filter((v, i, a) => a.indexOf(v) === i)
                                    : sources.filter(s => s !== 'user'));
                            }}
                            className="rounded"
                        />
                        <span>User (~/.claude/skills/)</span>
                    </label>
                </div>
                <p className="text-xs text-gray-500 mt-1">Where to load Skills from</p>
            </div>
        </div>
    );

    const renderMcpTab = () => (
        <div className="space-y-4">
            <div className="p-4 border rounded-md bg-gray-50 dark:bg-zinc-900/50 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <label className="block text-sm font-medium">MCP Servers</label>
                        <p className="text-xs text-gray-500">Model Context Protocol servers for this worker</p>
                    </div>
                    <label className="flex items-center space-x-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={editingWorker.mcp_inherit_system !== false}
                            onChange={(e) => updateField('mcp_inherit_system', e.target.checked)}
                            className="rounded"
                        />
                        <span>Inherit System</span>
                    </label>
                </div>

                {editingWorker.mcp_inherit_system === false && (
                    <McpServersList
                        selectedServers={editingWorker.mcp_selected || []}
                        onSelectedChange={(selected) => updateField('mcp_selected', selected)}
                    />
                )}
            </div>

            <div className="p-3 border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                    <strong>Note:</strong> WebSearch and WebFetch tools are automatically disabled for all Super Agent sessions.
                </p>
            </div>
        </div>
    );

    return (
        <div className="h-full flex">
            {/* Left sidebar - Worker list */}
            <div className="w-56 border-r border-zinc-200 dark:border-zinc-700 flex flex-col">
                <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Workers</h3>
                    <button
                        onClick={handleNew}
                        className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                        title="New Worker"
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {workers.map(worker => (
                        <div
                            key={worker.id}
                            onClick={() => selectWorker(worker.id)}
                            className={`px-3 py-2 cursor-pointer border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${selectedWorkerId === worker.id && !isNew ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                                }`}
                        >
                            <div className="text-sm font-medium truncate">{worker.name}</div>
                            <div className="text-xs text-gray-500 truncate">ID: {worker.id}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right panel - Editor */}
            <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
                    <h2 className="text-lg font-semibold">
                        {isNew ? 'New Worker' : editingWorker.name || 'Worker'}
                    </h2>
                </div>

                {/* Tabs */}
                <div className="border-b border-zinc-200 dark:border-zinc-700">
                    <div className="flex space-x-1 px-4">
                        {(['basic', 'advanced', 'prompts', 'mcp', 'tools'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${activeTab === tab
                                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === 'basic' && renderBasicTab()}
                    {activeTab === 'advanced' && renderAdvancedTab()}
                    {activeTab === 'prompts' && renderPromptsTab()}
                    {activeTab === 'mcp' && renderMcpTab()}
                    {activeTab === 'tools' && renderToolsTab()}

                </div>

                {/* Action buttons */}
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                    <div className="flex space-x-2">
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm flex items-center space-x-2 disabled:opacity-50"
                        >
                            <Save className="h-4 w-4" />
                            <span>{isNew ? 'Create' : 'Save'}</span>
                        </button>

                        <button
                            onClick={handleReset}
                            disabled={loading}
                            className="px-4 py-2 bg-gray-200 dark:bg-zinc-700 rounded hover:bg-gray-300 dark:hover:bg-zinc-600 transition-colors text-sm flex items-center space-x-2 disabled:opacity-50"
                        >
                            <RotateCcw className="h-4 w-4" />
                            <span>Reset</span>
                        </button>
                    </div>

                    {!isNew && selectedWorkerId !== 'default' && (
                        <button
                            onClick={handleDelete}
                            disabled={loading}
                            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm flex items-center space-x-2 disabled:opacity-50"
                        >
                            <Trash2 className="h-4 w-4" />
                            <span>Delete</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
