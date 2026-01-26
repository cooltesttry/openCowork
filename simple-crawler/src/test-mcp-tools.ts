/**
 * Test MCP Server Tools
 */

import { scrape, extractLinksWithMetadata, cleanup } from './index.js';

async function testWebFetch(url: string) {
    console.log('\n=== Testing web_fetch ===');
    console.log(`URL: ${url}\n`);

    const result = await scrape(url, {
        timeout: 60000,
        onlyMainContent: true,
    });

    if (!result.success) {
        console.log(`Error: ${result.error}`);
        return;
    }

    console.log(`Title: ${result.metadata?.title}`);
    console.log(`Engine: ${result.engine}`);
    console.log(`Status: ${result.statusCode}`);
    console.log(`Content: ${result.markdown?.length} chars`);
    console.log('\nPreview:');
    console.log(result.markdown?.slice(0, 500));
}

async function testGetLinks(url: string) {
    console.log('\n=== Testing get_links ===');
    console.log(`URL: ${url}\n`);

    const result = await scrape(url, {
        timeout: 60000,
        onlyMainContent: false,
    });

    if (!result.success || !result.rawHtml) {
        console.log(`Error: ${result.error ?? 'No content'}`);
        return;
    }

    const links = extractLinksWithMetadata(result.rawHtml, result.finalUrl ?? url);

    console.log(`Total links: ${links.length}`);
    console.log(`Engine: ${result.engine}\n`);

    // Show first 10 links
    console.log('First 10 links:');
    links.slice(0, 10).forEach((link, i) => {
        const text = link.text.trim() || '(no text)';
        const displayText = text.length > 50 ? text.slice(0, 50) + '...' : text;
        console.log(`${i + 1}. "${displayText}"`);
        console.log(`   URL: ${link.url}`);
        console.log(`   External: ${link.isExternal}`);
    });
}

async function main() {
    const testUrl = 'https://example.com';

    await testWebFetch(testUrl);
    await testGetLinks(testUrl);

    await cleanup();
    console.log('\n✨ Done!');
}

main().catch(console.error);
