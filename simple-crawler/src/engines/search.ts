/**
 * Search Engine Providers
 * Supports Serper (Google), Tavily, and Brave Search APIs
 * 
 * Configuration is read from storage/config.json (same as Python implementation)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SearchResult {
    url: string;
    title: string;
    snippet: string;
    date?: string;
}

export interface SearchProvider {
    name: string;
    search(query: string, maxResults: number): Promise<SearchResult[]>;
}

export interface SearchConfig {
    provider?: string;
    api_key?: string;
    max_results?: number;
    enabled?: boolean;
}

/**
 * Load configuration from storage/config.json
 * Path: simple-crawler/../storage/config.json
 */
function loadConfig(): { search: SearchConfig } {
    // Resolve path relative to compiled file location
    // dist/engines/search.js -> ../../../storage/config.json (openCowork/storage/config.json)
    const configPath = path.resolve(__dirname, '..', '..', '..', 'storage', 'config.json');
    console.error(`[search] Looking for config at: ${configPath}`);

    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.error('[search] Failed to load config.json:', error);
    }

    return { search: {} };
}

/**
 * Serper - Google Search API
 * https://serper.dev
 */
export class SerperProvider implements SearchProvider {
    name = 'serper';

    constructor(private apiKey: string) { }

    async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: query, num: maxResults }),
        });

        if (!response.ok) {
            throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const results: SearchResult[] = [];

        for (const item of (data.organic ?? []).slice(0, maxResults)) {
            results.push({
                url: item.link ?? '',
                title: item.title ?? '',
                snippet: item.snippet ?? '',
                date: item.date ?? '',
            });
        }

        return results;
    }
}

/**
 * Tavily - AI-optimized Search API
 * https://tavily.com
 */
export class TavilyProvider implements SearchProvider {
    name = 'tavily';

    constructor(private apiKey: string) { }

    async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: this.apiKey,
                query: query,
                max_results: maxResults,
                search_depth: 'basic',
            }),
        });

        if (!response.ok) {
            throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const results: SearchResult[] = [];

        for (const item of (data.results ?? [])) {
            results.push({
                url: item.url ?? '',
                title: item.title ?? '',
                snippet: item.content ?? '',
            });
        }

        return results;
    }
}

/**
 * Brave Search API
 * https://brave.com/search/api/
 */
export class BraveProvider implements SearchProvider {
    name = 'brave';

    constructor(private apiKey: string) { }

    async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', query);
        url.searchParams.set('count', String(maxResults));

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'X-Subscription-Token': this.apiKey,
            },
        });

        if (!response.ok) {
            throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const results: SearchResult[] = [];

        const webResults = data.web?.results ?? [];
        for (const item of webResults) {
            results.push({
                url: item.url ?? '',
                title: item.title ?? '',
                snippet: item.description ?? '',
            });
        }

        return results;
    }
}

/**
 * Create a search provider based on config.json configuration
 * (Same approach as Python run_search_server.py)
 */
export function createSearchProvider(): SearchProvider | null {
    const config = loadConfig();
    const searchConfig = config.search ?? {};

    const provider = searchConfig.provider?.toLowerCase();
    const apiKey = searchConfig.api_key;

    console.error(`[search] Config loaded: provider=${provider}, api_key=${apiKey ? '***' : 'NOT SET'}`);

    if (!apiKey) {
        return null;
    }

    switch (provider) {
        case 'serper':
            return new SerperProvider(apiKey);
        case 'tavily':
            return new TavilyProvider(apiKey);
        case 'brave':
            return new BraveProvider(apiKey);
        default:
            // Default to serper if provider not specified but key exists
            if (apiKey) {
                return new SerperProvider(apiKey);
            }
            return null;
    }
}

/**
 * Get max results from config or default
 */
export function getMaxResults(): number {
    const config = loadConfig();
    const maxResults = config.search?.max_results ?? 5;
    return Math.max(1, Math.min(maxResults, 20));
}
