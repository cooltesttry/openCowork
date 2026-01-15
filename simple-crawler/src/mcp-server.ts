#!/usr/bin/env node
/**
 * Simple Crawler MCP Server
 * Provides web_fetch tool via stdio transport
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { scrape, cleanup } from './index.js';

// Create MCP server
const server = new McpServer({
    name: 'simple-crawler',
    version: '1.0.0',
});

// Tool: web_fetch - Fetch a web page and extract content
server.tool(
    'web_fetch',
    'Fetch a single web page and return its main content as clean Markdown. Links in the content are preserved as Markdown links [text](url).',
    {
        url: z.string().describe('The URL to fetch.'),
    },
    async ({ url }) => {
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
