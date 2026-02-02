"use client";

import { useEffect, useMemo, useState } from "react";
import { API_ROOT, fetchAgentConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type ChunkResult = {
    chunk_id: number;
    path: string;
    snippet: string;
    start_line?: number | null;
    end_line?: number | null;
    bm25?: number | null;
    distance?: number | null;
    rrf: number;
};

type FileResult = {
    path: string;
    snippet: string;
    start_line?: number | null;
    end_line?: number | null;
    score: number;
    bm25?: number | null;
    distance?: number | null;
};

type SearchMode = "files" | "chunks";

export default function SearchLabPage() {
    const [mode, setMode] = useState<SearchMode>("files");
    const [query, setQuery] = useState("");
    const [filenameQuery, setFilenameQuery] = useState("");
    const [pathPrefix, setPathPrefix] = useState("");
    const [limit, setLimit] = useState(10);
    const [vectorK, setVectorK] = useState(20);
    const [useVector, setUseVector] = useState(true);
    const [useFts, setUseFts] = useState(true);
    const [useFilename, setUseFilename] = useState(false);
    const [excludeOpenCowork, setExcludeOpenCowork] = useState(true);
    const [rerank, setRerank] = useState<"rrf" | "bm25" | "alpha">("rrf");
    const [alpha, setAlpha] = useState(0.75);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<Array<ChunkResult | FileResult>>([]);
    const [workdir, setWorkdir] = useState<string | null>(null);

    useEffect(() => {
        fetchAgentConfig()
            .then((data) => setWorkdir(data.default_workdir))
            .catch(() => setWorkdir(null));
    }, []);

    const isFileMode = mode === "files";
    const hasQuery = query.trim().length > 0;
    const hasFilenameQuery = filenameQuery.trim().length > 0;
    const wantsContent = useFts || useVector;
    const wantsFilename = isFileMode && useFilename;
    const canSearch = (wantsContent && hasQuery) || (wantsFilename && hasFilenameQuery);

    const summary = useMemo(() => {
        if (!results.length) return "暂无结果";
        return `${results.length} 条结果`;
    }, [results.length]);

    const submitSearch = async () => {
        if (!canSearch) {
            if (wantsContent && !hasQuery && wantsFilename && !hasFilenameQuery) {
                setError("请输入内容关键词或文件名关键词。");
            } else if (wantsContent && !hasQuery) {
                setError("请输入内容关键词。");
            } else if (wantsFilename && !hasFilenameQuery) {
                setError("请输入文件名关键词。");
            } else {
                setError("请选择至少一种搜索方式。");
            }
            return;
        }
        setError(null);
        setLoading(true);
        setResults([]);

        const payload: Record<string, unknown> = {
            query: query.trim() || filenameQuery.trim(),
            limit,
            vector_k: vectorK,
            use_vector: useVector,
            use_fts: useFts,
            mode,
            rerank,
            alpha,
        };

        if (workdir) {
            payload.workdir = workdir;
        }

        if (excludeOpenCowork) {
            payload.exclude_paths = [".opencowork"];
        } else {
            payload.exclude_paths = [".opencowork/search"];
        }

        if (pathPrefix.trim()) {
            payload.path_prefix = pathPrefix.trim();
        }

        if (isFileMode && useFilename && filenameQuery.trim()) {
            payload.filename_query = filenameQuery.trim();
        }

        try {
            const res = await fetch(`${API_ROOT}/search/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "搜索失败");
            }
            const data = await res.json();
            setResults(data.results || []);
        } catch (err: any) {
            setError(err?.message || "搜索失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto max-w-5xl py-10 space-y-6">
            <div className="space-y-1">
                <h1 className="text-3xl font-bold tracking-tight">Search Lab</h1>
                <p className="text-muted-foreground">
                    体验文件搜索与 Retrieval 搜索（默认使用后台配置的工作目录）。
                </p>
                <p className="text-xs text-muted-foreground">
                    当前工作目录：{workdir || "未读取到（请检查后端 /api/config/agent）"}
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>搜索面板</CardTitle>
                    <CardDescription>支持关键词 + 向量混合检索；文件搜索可附加文件名匹配。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <Tabs value={mode} onValueChange={(value) => setMode(value as SearchMode)}>
                        <TabsList>
                            <TabsTrigger value="files">文件搜索</TabsTrigger>
                            <TabsTrigger value="chunks">Retrieval 搜索</TabsTrigger>
                        </TabsList>
                        <TabsContent value="files" className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="query-files">内容关键词</Label>
                                    <Input
                                        id="query-files"
                                        placeholder="例如：猫粮 / 记忆迁徙者"
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="filename-query">文件名关键词（可选）</Label>
                                    <Input
                                        id="filename-query"
                                        placeholder="例如：*.md / memory"
                                        value={filenameQuery}
                                        onChange={(event) => setFilenameQuery(event.target.value)}
                                    />
                                </div>
                            </div>
                        </TabsContent>
                        <TabsContent value="chunks" className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="query-chunks">内容关键词</Label>
                                <Input
                                    id="query-chunks"
                                    placeholder="例如：vector search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                            </div>
                        </TabsContent>
                    </Tabs>

                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="path-prefix">路径过滤（可选，支持相对路径）</Label>
                            <Input
                                id="path-prefix"
                                placeholder="例如：goodboy/ 或 memory/"
                                value={pathPrefix}
                                onChange={(event) => setPathPrefix(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="limit">返回条数</Label>
                            <Input
                                id="limit"
                                type="number"
                                min={1}
                                max={200}
                                value={limit}
                                onChange={(event) => setLimit(Number(event.target.value || 0))}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="vector-k">向量检索条数</Label>
                            <Input
                                id="vector-k"
                                type="number"
                                min={1}
                                max={200}
                                value={vectorK}
                                onChange={(event) => setVectorK(Number(event.target.value || 0))}
                            />
                        </div>
                        <div className="space-y-3 pt-2">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-muted-foreground">向量搜索</span>
                                <Switch checked={useVector} onCheckedChange={setUseVector} />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-muted-foreground">全文搜索</span>
                                <Switch checked={useFts} onCheckedChange={setUseFts} />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className={`text-sm ${isFileMode ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                                    文件名搜索
                                </span>
                                <Switch
                                    checked={useFilename}
                                    onCheckedChange={setUseFilename}
                                    disabled={!isFileMode}
                                />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-muted-foreground">排除 .opencowork</span>
                                <Switch checked={excludeOpenCowork} onCheckedChange={setExcludeOpenCowork} />
                            </div>
                        </div>
                        <div className="flex items-center justify-end pt-4">
                            <Button onClick={submitSearch} disabled={loading}>
                                {loading ? "搜索中..." : "开始搜索"}
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span>重排方式：</span>
                        <Button
                            type="button"
                            variant={rerank === "rrf" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setRerank("rrf")}
                        >
                            RRF 混合
                        </Button>
                        <Button
                            type="button"
                            variant={rerank === "bm25" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setRerank("bm25")}
                        >
                            BM25 重排
                        </Button>
                        <Button
                            type="button"
                            variant={rerank === "alpha" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setRerank("alpha")}
                        >
                            Alpha 融合
                        </Button>
                        <span className="text-xs text-muted-foreground/80">
                            BM25 重排更偏向关键词匹配（需开启全文搜索）
                        </span>
                    </div>
                    {rerank === "alpha" && (
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <span>Alpha：</span>
                            <Input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={alpha}
                                onChange={(event) => setAlpha(Number(event.target.value))}
                                className="w-56"
                            />
                            <span className="text-xs">当前：{alpha.toFixed(2)}</span>
                            <span className="text-xs text-muted-foreground/80">
                                0 偏关键词，1 偏向语义向量
                            </span>
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                            {error}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>搜索结果</CardTitle>
                    <CardDescription>{summary}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {results.length === 0 && !loading && (
                        <p className="text-sm text-muted-foreground">还没有结果，输入关键词开始搜索。</p>
                    )}
                    {results.map((item, index) => {
                        const isChunk = (item as ChunkResult).chunk_id !== undefined;
                        return (
                            <div key={`${item.path}-${index}`} className="rounded-lg border p-4 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">{isChunk ? "Chunk" : "File"}</Badge>
                                    <span className="text-sm font-medium break-all">{item.path}</span>
                                </div>
                                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                                    {(item.snippet || "").slice(0, 600)}
                                </p>
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    {"start_line" in item && item.start_line !== null && item.start_line !== undefined && (
                                        <span>Lines: {item.start_line} - {item.end_line ?? item.start_line}</span>
                                    )}
                                    {"rrf" in item && <span>RRF: {item.rrf.toFixed(4)}</span>}
                                    {"score" in item && <span>Score: {item.score.toFixed(4)}</span>}
                                    {"bm25" in item && item.bm25 !== null && item.bm25 !== undefined && (
                                        <span>BM25: {item.bm25.toFixed(4)}</span>
                                    )}
                                    {"distance" in item && item.distance !== null && item.distance !== undefined && (
                                        <span>Distance: {item.distance.toFixed(4)}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>
        </div>
    );
}
