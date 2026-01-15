/**
 * Demo script for Simple Crawler
 * Run with: pnpm demo
 */

import { scrape, cleanup } from './index.js';

async function main() {
    const urls = [
        'https://example.com',
        'https://news.ycombinator.com',
        'https://github.com',
    ];

    console.log('🔥 Simple Crawler Demo\n');
    console.log('='.repeat(60));

    for (const url of urls) {
        console.log(`\n📄 Scraping: ${url}`);
        console.log('-'.repeat(60));

        try {
            const result = await scrape(url, {
                timeout: 30000,
                onlyMainContent: true,
            });

            if (result.success) {
                console.log(`✅ Success! (Engine: ${result.engine})`);
                console.log(`   Status: ${result.statusCode}`);
                console.log(`   Final URL: ${result.finalUrl}`);
                console.log(`   Title: ${result.metadata?.title ?? 'N/A'}`);
                console.log(`   Links found: ${result.links?.length ?? 0}`);
                console.log(`   Markdown length: ${result.markdown?.length ?? 0} chars`);

                // Show first 500 chars of markdown
                if (result.markdown) {
                    console.log(`\n   Content preview:`);
                    console.log('   ' + result.markdown.slice(0, 500).replace(/\n/g, '\n   '));
                    if (result.markdown.length > 500) {
                        console.log('   ...(truncated)');
                    }
                }

                // Show first 5 links
                if (result.links && result.links.length > 0) {
                    console.log(`\n   Sample links:`);
                    result.links.slice(0, 5).forEach(link => {
                        console.log(`   - ${link}`);
                    });
                    if (result.links.length > 5) {
                        console.log(`   ... and ${result.links.length - 5} more`);
                    }
                }
            } else {
                console.log(`❌ Failed: ${result.error}`);
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
