"use client";

import { useEffect, useState } from "react";
import { fetchConfig, addMcpServer, deleteMcpServer } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export function McpConfig() {
    const [servers, setServers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [newServer, setNewServer] = useState<any>({
        name: "", type: "stdio", command: "", args: [], url: "", env: {}
    });
    const [isOpen, setIsOpen] = useState(false);

    // Tool Inspection State
    const [inspectingServer, setInspectingServer] = useState<string | null>(null);
    const [tools, setTools] = useState<any[]>([]);
    const [toolsLoading, setToolsLoading] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);

    // Deletion State
    const [deleteServerName, setDeleteServerName] = useState<string | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    useEffect(() => {
        loadServers();
    }, []);

    const loadServers = async () => {
        try {
            const data = await fetchConfig<any[]>("/mcp");
            setServers(data);
        } catch (err) {
            toast.error("Error", { description: "Failed to load MCP servers" });
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        try {
            const payload = { ...newServer };
            if (payload.type === "stdio" && payload.command) {
                const parts = payload.command.split(" ");
                payload.command = parts[0];
                payload.args = parts.slice(1);
            }

            await addMcpServer(payload);
            toast.success("Success", { description: "MCP server added" });
            setIsOpen(false);
            loadServers();
        } catch (err) {
            toast.error("Error", { description: "Failed to add server" });
        }
    };

    const confirmDelete = async () => {
        if (!deleteServerName) return;
        try {
            await deleteMcpServer(deleteServerName);
            toast.success("Success", { description: "MCP server deleted" });
            loadServers();
        } catch (err) {
            toast.error("Error", { description: "Failed to delete server" });
        } finally {
            setDeleteDialogOpen(false);
            setDeleteServerName(null);
        }
    };

    const handleDeleteClick = (name: string) => {
        setDeleteServerName(name);
        setDeleteDialogOpen(true);
    };

    const handleInspect = async (name: string) => {
        setInspectingServer(name);
        setToolsLoading(true);
        setToolsOpen(true);
        setTools([]); // clear previous
        try {
            const res = await fetchConfig<{ status: string, tools: any[] }>(`/mcp/${encodeURIComponent(name)}/tools`);
            setTools(res.tools);
        } catch (err) {
            toast.error("Error", { description: "Failed to inspect tools" });
        } finally {
            setToolsLoading(false);
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>MCP Servers</CardTitle>
                    <CardDescription>Manage Model Context Protocol servers</CardDescription>
                </div>
                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm"><Plus className="h-4 w-4 mr-2" /> Add Server</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add MCP Server</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Name</Label>
                                <Input
                                    value={newServer.name}
                                    onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                                    placeholder="my-server"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select
                                    value={newServer.type}
                                    onValueChange={(val) => setNewServer({ ...newServer, type: val })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="stdio">STDIO (Local Process)</SelectItem>
                                        <SelectItem value="sse">SSE (Legacy)</SelectItem>
                                        <SelectItem value="http">Streamable HTTP</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {newServer.type === "stdio" ? (
                                <div className="space-y-2">
                                    <Label>Command (with args)</Label>
                                    <Input
                                        value={newServer.command}
                                        onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                                        placeholder="uv run mcp-server-git"
                                    />
                                    <p className="text-xs text-muted-foreground">Full command line string</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label>URL</Label>
                                    <Input
                                        value={newServer.url}
                                        onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                                        placeholder="http://localhost:8000/sse"
                                    />
                                </div>
                            )}

                            <Button onClick={handleAdd} className="w-full">Add Server</Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Details</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {servers.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground">No servers configured</TableCell>
                            </TableRow>
                        )}
                        {servers.map((server) => (
                            <TableRow key={server.name}>
                                <TableCell className="font-medium">{server.name}</TableCell>
                                <TableCell><Badge variant="outline">{server.type}</Badge></TableCell>
                                <TableCell className="font-mono text-xs truncate max-w-[200px]">
                                    {server.type === "stdio"
                                        ? `${server.command} ${server.args.join(" ")}`
                                        : server.url}
                                </TableCell>
                                <TableCell>
                                    <Button variant="ghost" size="icon" onClick={() => handleInspect(server.name)} title="View Tools">
                                        <Wrench className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(server.name)} title="Delete Server">
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>

            <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Tools: {inspectingServer} ({tools.length})</DialogTitle>
                    </DialogHeader>
                    {toolsLoading ? (
                        <div className="py-8 text-center">Loading tools...</div>
                    ) : (
                        <div className="space-y-1">
                            {tools.length === 0 ? (
                                <p className="text-muted-foreground text-center py-4">No tools found.</p>
                            ) : (
                                tools.map((tool) => (
                                    <div key={tool.name} className="flex flex-col gap-1 py-2 px-3 rounded-md hover:bg-muted/50 border-b last:border-b-0">
                                        <code className="text-sm font-semibold text-primary">{tool.name}</code>
                                        <span className="text-sm text-muted-foreground">{tool.description || 'No description'}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>



            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the MCP server configuration for
                            <span className="font-semibold text-foreground"> {deleteServerName}</span>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete Server
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Toaster />
        </Card >
    );
}
