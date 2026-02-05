"use client";

import { useEffect, useMemo, useState } from "react";
import {
    fetchSkillsCatalog,
    SkillsCatalog,
    SkillsCatalogEntry,
    SkillSourceSearchResult,
    searchSkillSources,
    installSkillFromSource,
    removeSkillFromLibrary,
} from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Library, Folder, Trash2, Search } from "lucide-react";

type CatalogPayload = {
    catalog: SkillsCatalog;
    path: string;
    skills_dir: string;
};

export function SkillsConfig() {
    const [payload, setPayload] = useState<CatalogPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [searchSource, setSearchSource] = useState("skills.sh");
    const [searchQuery, setSearchQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<SkillSourceSearchResult[]>([]);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [manualPackage, setManualPackage] = useState("");
    const [manualSkill, setManualSkill] = useState("");
    const [manualInstalling, setManualInstalling] = useState(false);

    const loadCatalog = async () => {
        setLoading(true);
        try {
            const res = await fetchSkillsCatalog();
            setPayload({ catalog: res.catalog, path: res.path, skills_dir: res.skills_dir });
        } catch {
            toast.error("Error", { description: "Failed to load skills catalog" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadCatalog();
    }, []);

    const handleRemove = async (skillId: string) => {
        setRemovingId(skillId);
        try {
            const res = await removeSkillFromLibrary({ skill_id: skillId });
            setPayload((prev) =>
                prev ? { ...prev, catalog: res.catalog } : prev
            );
            toast.success("Skill removed", { description: skillId });
        } catch {
            toast.error("Error", { description: "Failed to remove skill" });
        } finally {
            setRemovingId(null);
        }
    };

    const handleSearch = async () => {
        setSearching(true);
        try {
            const res = await searchSkillSources({
                source: searchSource,
                query: searchQuery || undefined,
                limit: 20,
            });
            setSearchResults(res.results || []);
        } catch {
            toast.error("Error", { description: "Failed to search skills" });
        } finally {
            setSearching(false);
        }
    };

    const handleInstall = async (entry: SkillSourceSearchResult) => {
        const installId = `${entry.package}@${entry.name}`;
        setInstallingId(installId);
        try {
            const res = await installSkillFromSource({
                package: entry.package,
                skill: entry.name,
            });
            setPayload((prev) =>
                prev ? { ...prev, catalog: res.catalog } : prev
            );
            toast.success("Skill installed", { description: entry.name });
        } catch {
            toast.error("Error", { description: "Failed to install skill" });
        } finally {
            setInstallingId(null);
        }
    };

    const handleManualInstall = async () => {
        if (!manualPackage.trim()) {
            toast.error("Error", { description: "Enter a source (repo, URL, or path)" });
            return;
        }
        setManualInstalling(true);
        try {
            const res = await installSkillFromSource({
                package: manualPackage.trim(),
                skill: manualSkill.trim() || undefined,
            });
            setPayload((prev) =>
                prev ? { ...prev, catalog: res.catalog } : prev
            );
            toast.success("Skill installed", { description: manualPackage.trim() });
            setManualPackage("");
            setManualSkill("");
        } catch {
            toast.error("Error", { description: "Failed to install skill" });
        } finally {
            setManualInstalling(false);
        }
    };

    const entries = useMemo(() => {
        const catalog = payload?.catalog;
        if (!catalog?.skills) return [] as SkillsCatalogEntry[];
        return Object.values(catalog.skills)
            .filter((entry) => entry.status?.state !== "removed")
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }, [payload]);

    return (
        <div className="space-y-6">
            <Tabs defaultValue="library" className="w-full">
                <TabsList className="w-full justify-start">
                    <TabsTrigger value="library" className="flex-1 sm:flex-none">
                        <Library className="h-4 w-4" />
                        Skills Library
                    </TabsTrigger>
                    <TabsTrigger value="manage" className="flex-1 sm:flex-none">
                        <Folder className="h-4 w-4" />
                        Manage
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="library" className="mt-4 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Install Skills</CardTitle>
                            <CardDescription>
                                Search skills.sh or install from a repo, URL, or local path.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-3">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                                    <Select value={searchSource} onValueChange={setSearchSource}>
                                        <SelectTrigger className="w-full md:w-60">
                                            <SelectValue placeholder="Select source" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="skills.sh">skills.sh</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search by skill or repo"
                                        className="flex-1"
                                    />
                                <Button onClick={handleSearch} disabled={searching} className="w-28">
                                    <Search className={`mr-2 h-4 w-4 ${searching ? "animate-pulse" : ""}`} />
                                    Search
                                </Button>
                                </div>

                                {searchResults.length > 0 && (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Repository</TableHead>
                                                <TableHead className="text-right">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {searchResults.map((entry) => {
                                                const installId = `${entry.package}@${entry.name}`;
                                                return (
                                                    <TableRow key={installId}>
                                                        <TableCell className="max-w-[240px] whitespace-normal">
                                                            <div className="flex flex-col gap-1">
                                                                <span className="font-medium">{entry.name}</span>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {entry.package}
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-xs text-muted-foreground">
                                                            {entry.package}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleInstall(entry)}
                                                                disabled={installingId === installId}
                                                            >
                                                                {installingId === installId ? "Installing..." : "Install"}
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                )}
                            </div>

                            <div className="space-y-3">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                                    <Input
                                        value={manualSkill}
                                        onChange={(e) => setManualSkill(e.target.value)}
                                        placeholder="Skill name (optional)"
                                        className="w-full md:w-60"
                                    />
                                    <Input
                                        value={manualPackage}
                                        onChange={(e) => setManualPackage(e.target.value)}
                                        placeholder="URL / repo / path"
                                        className="flex-1"
                                    />
                                    <Button onClick={handleManualInstall} disabled={manualInstalling} className="w-28">
                                        {manualInstalling ? "Installing..." : "Install"}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Installed Skills</CardTitle>
                            <CardDescription>
                                Skills currently in your library.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <div>Loading...</div>
                            ) : entries.length === 0 ? (
                                <div className="text-sm text-muted-foreground">
                                    No skills found yet. Import a skill or add one under <span className="font-mono">storage/skills</span>.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {entries.map((entry) => (
                                        <div
                                            key={entry.skill_id}
                                            className="flex flex-col gap-2 rounded-lg border border-muted/60 bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate font-medium">{entry.name}</div>
                                                <div className="text-sm text-muted-foreground">
                                                    {entry.description || "—"}
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleRemove(entry.skill_id)}
                                                disabled={removingId === entry.skill_id}
                                            >
                                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="manage" className="mt-4 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Workspace Sync</CardTitle>
                            <CardDescription>
                                Manage how skills are linked or copied into each workspace.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                            <p>
                                This panel will manage per-workspace skill linking (symlink/junction/copy)
                                and write <span className="font-mono">.claude/skills.lock.json</span>.
                            </p>
                            <p>
                                For now, place skills under <span className="font-mono">storage/skills</span> and
                                manually link or copy into <span className="font-mono">.claude/skills</span>.
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>

            </Tabs>
            <Toaster />
        </div>
    );
}
