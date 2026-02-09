#!/usr/bin/env node
/**
 * Simple Crawler MCP Server
 * Provides search and fetch tools via stdio transport
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { scrape, cleanup } from './index';
import { createSearchProvider, getMaxResults, SearchResult } from './engines/search';

// Create MCP server
const server = new McpServer({
    name: 'simple-crawler',
    version: '1.0.0',
});

// Initialize search provider from environment
const searchProvider = createSearchProvider();
const maxResults = getMaxResults();

if (searchProvider) {
    console.error(`[simple-crawler] Search provider: ${searchProvider.name}, max_results: ${maxResults}`);
} else {
    console.error('[simple-crawler] Search not configured (set SEARCH_PROVIDER and SEARCH_API_KEY)');
}

// Tool: search - Perform web search using configured provider
server.tool(
    'search',
    'Search the web using Google. Prefer this tool for any web search needs.',
    {
        query: z.string().describe('The search query string.'),
    } as any,
    async ({ query }: { query: string }) => {
        if (!searchProvider) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: 'Error: Search not configured. Set SEARCH_PROVIDER (serper/tavily/brave) and SEARCH_API_KEY environment variables.',
                    },
                ],
                isError: true,
            };
        }

        try {
            const results: SearchResult[] = await searchProvider.search(query, maxResults);

            // Format results as JSON array (same as Python implementation)
            const formattedResults = results.map(r => ({
                url: r.url,
                title: r.title,
                snippet: r.snippet,
                date: r.date ?? '',
            }));

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(formattedResults, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// Tool: fetch - Fetch a web page and extract content
server.tool(
    'fetch',
    'Fetch a single web page and return its main content as clean Markdown. Links in the content are preserved as Markdown links [text](url). Use this after search to get full content from a URL.',
    {
        url: z.string().describe('The URL to fetch.'),
    } as any,
    async ({ url }: { url: string }) => {
        try {
            const result = await scrape(url, {
                timeout: 60000,
                onlyMainContent: true,
                waitAfterLoad: 2000,
            });

            if (!result.success) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error fetching ${url}: ${result.error}`,
                        },
                    ],
                    isError: true,
                };
            }

            // Build response text
            let responseText = '';

            if (result.metadata?.title) {
                responseText += `# ${result.metadata.title}\n\n`;
            }

            responseText += `**URL:** ${result.finalUrl ?? url}\n\n`;
            responseText += `---\n\n`;
            responseText += result.markdown ?? '';

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: responseText,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// Handle cleanup on exit
process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
});

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Simple Crawler MCP Server started');
}

main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
