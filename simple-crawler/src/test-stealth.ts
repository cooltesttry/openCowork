/**
 * Stealth Plugin Comparison Test
 * Compare results with different sites
 */

import { scrape, cleanup } from './index.js';

async function main() {
    console.log('🕵️ Stealth Plugin Test\n');
    console.log('='.repeat(60));

    const testUrls = [
        // News sites
        { url: 'https://www.bbc.com/news', name: 'BBC News' },
        { url: 'https://www.nytimes.com', name: 'NY Times' },
        { url: 'https://www.reuters.com', name: 'Reuters' },

        // Tech sites
        { url: 'https://techcrunch.com', name: 'TechCrunch' },

        // E-commerce (often protected)
        { url: 'https://www.amazon.com', name: 'Amazon' },
    ];

    const results: { name: string; engine: string; status: number; success: boolean; title?: string }[] = [];

    for (const test of testUrls) {
        console.log(`\n📄 Testing: ${test.name}`);
        console.log('-'.repeat(60));

        try {
            const result = await scrape(test.url, {
                timeout: 45000,
                waitAfterLoad: 2000,
                onlyMainContent: true,
            });

            const summary = {
                name: test.name,
                engine: result.engine ?? 'unknown',
                status: result.statusCode ?? 0,
                success: result.success && !result.markdown?.toLowerCase().includes('robot'),
                title: result.metadata?.title?.slice(0, 40),
            };
            results.push(summary);

            if (result.success) {
                const isBlocked = result.markdown?.toLowerCase().includes('robot') ||
                    result.markdown?.toLowerCase().includes('captcha') ||
                    result.markdown?.toLowerCase().includes('blocked');
                console.log(`${isBlocked ? '⚠️' : '✅'} ${result.engine?.toUpperCase()} | Status: ${result.statusCode}`);
                console.log(`   Title: ${result.metadata?.title?.slice(0, 50) ?? 'N/A'}`);
                console.log(`   Content: ${result.markdown?.length ?? 0} chars`);
                if (isBlocked) {
                    console.log(`   ⚠️ Possible anti-bot detection!`);
                }
            } else {
                console.log(`❌ Failed: ${result.error}`);
            }
        } catch (error) {
            console.log(`❌ Error: ${error instanceof Error ? error.message : error}`);
            results.push({ name: test.name, engine: 'error', status: 0, success: false });
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Summary:\n');
    console.log('| Site | Engine | Status | Result |');
    console.log('|------|--------|--------|--------|');
    for (const r of results) {
        console.log(`| ${r.name} | ${r.engine} | ${r.status} | ${r.success ? '✅' : '❌'} |`);
    }

    console.log('\n🧹 Cleaning up...');
    await cleanup();
    console.log('✨ Done!');
}

main().catch(console.error);
