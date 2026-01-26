/**
 * Browser Fallback Test
 * Test websites that require browser rendering
 */

import { scrape, cleanup } from './index.js';

async function main() {
    console.log('🔥 Browser Fallback Test\n');
    console.log('='.repeat(60));

    // Sites that typically require browser rendering:
    // 1. Sites with heavy JavaScript (SPA)
    // 2. Sites with anti-bot protection
    // 3. Sites that check for browser features

    const testUrls = [
        // Force browser mode test
        { url: 'https://example.com', forceBrowser: true, name: 'Example (forced browser)' },

        // JavaScript-heavy sites
        { url: 'https://www.bloomberg.com', forceBrowser: false, name: 'Bloomberg (may need JS)' },

        // Anti-bot protected sites
        { url: 'https://www.cloudflare.com', forceBrowser: false, name: 'Cloudflare (protected)' },
    ];

    for (const test of testUrls) {
        console.log(`\n📄 Testing: ${test.name}`);
        console.log(`   URL: ${test.url}`);
        console.log('-'.repeat(60));

        try {
            const startTime = Date.now();
            const result = await scrape(test.url, {
                timeout: 45000,
                waitAfterLoad: 2000,
                onlyMainContent: true,
                forceBrowser: test.forceBrowser,
            });
            const elapsed = Date.now() - startTime;

            if (result.success) {
                console.log(`✅ Success!`);
                console.log(`   Engine: ${result.engine?.toUpperCase()}`);
                console.log(`   Status: ${result.statusCode}`);
                console.log(`   Time: ${elapsed}ms`);
                console.log(`   Title: ${result.metadata?.title?.slice(0, 50) ?? 'N/A'}...`);
                console.log(`   Links: ${result.links?.length ?? 0}`);
                console.log(`   Content: ${result.markdown?.length ?? 0} chars`);

                // Show preview
                if (result.markdown && result.markdown.length > 0) {
                    console.log(`\n   Preview:`);
                    console.log('   ' + result.markdown.slice(0, 300).replace(/\n/g, '\n   '));
                }
            } else {
                console.log(`❌ Failed: ${result.error}`);
                console.log(`   Engine: ${result.engine}`);
                console.log(`   Status: ${result.statusCode}`);
            }
        } catch (error) {
            console.log(`❌ Error: ${error instanceof Error ? error.message : error}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🧹 Cleaning up...');
    await cleanup();
    console.log('✨ Done!');
}

main().catch(console.error);
