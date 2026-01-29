/**
 * Test script for search functionality
 * Usage: SEARCH_PROVIDER=serper SEARCH_API_KEY=xxx npx tsx src/test-search.ts
 */

import { createSearchProvider, getMaxResults } from './engines/search';

async function main() {
    const provider = createSearchProvider();
    const maxResults = getMaxResults();

    console.log('=== Search Provider Test ===');
    console.log(`Provider: ${provider?.name ?? 'NOT CONFIGURED'}`);
    console.log(`Max Results: ${maxResults}`);
    console.log('');

    if (!provider) {
        console.log('Error: Search not configured.');
        console.log('Set environment variables:');
        console.log('  SEARCH_PROVIDER=serper|tavily|brave');
        console.log('  SEARCH_API_KEY=your-api-key');
        process.exit(1);
    }

    const query = process.argv[2] ?? 'Claude AI anthropic';
    console.log(`Query: "${query}"`);
    console.log('');

    try {
        const results = await provider.search(query, maxResults);
        console.log(`Found ${results.length} results:\n`);

        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            console.log(`[${i + 1}] ${r.title}`);
            console.log(`    URL: ${r.url}`);
            console.log(`    ${r.snippet.substring(0, 150)}...`);
            if (r.date) {
                console.log(`    Date: ${r.date}`);
            }
            console.log('');
        }

        // Also output as JSON for verification against Python
        console.log('=== JSON Output ===');
        console.log(JSON.stringify(results, null, 2));
    } catch (error) {
        console.error('Search failed:', error);
        process.exit(1);
    }
}

main();
