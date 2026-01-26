/**
 * Combined Test: Normal Web Pages + PDF
 */

import { scrape, cleanup } from './index.js';

async function main() {
    console.log('🔥 Combined Scrape Test\n');
    console.log('='.repeat(60));

    const tests = [
        // Normal web pages
        { url: 'https://example.com', type: 'HTML' },
        { url: 'https://news.ycombinator.com', type: 'HTML' },

        // PDF files
        { url: 'https://pdfobject.com/pdf/sample.pdf', type: 'PDF' },
    ];

    const results: { url: string; type: string; success: boolean; engine?: string; chars?: number }[] = [];

    for (const test of tests) {
        console.log(`\n📄 [${test.type}] ${test.url}`);
        console.log('-'.repeat(60));

        try {
            const result = await scrape(test.url, { timeout: 30000 });

            if (result.success) {
                console.log(`✅ Success! Engine: ${result.engine}, Status: ${result.statusCode}`);
                console.log(`   Content: ${result.markdown?.length ?? 0} chars`);
                console.log(`   Preview: ${result.markdown?.slice(0, 150).replace(/\n/g, ' ') ?? ''}...`);
                results.push({ url: test.url, type: test.type, success: true, engine: result.engine, chars: result.markdown?.length });
            } else {
                console.log(`❌ Failed: ${result.error}`);
                results.push({ url: test.url, type: test.type, success: false });
            }
        } catch (error) {
            console.log(`❌ Error: ${error instanceof Error ? error.message : error}`);
            results.push({ url: test.url, type: test.type, success: false });
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Summary:\n');
    console.log('| Type | URL | Engine | Chars | Result |');
    console.log('|------|-----|--------|-------|--------|');
    for (const r of results) {
        const shortUrl = r.url.length > 30 ? r.url.slice(0, 30) + '...' : r.url;
        console.log(`| ${r.type} | ${shortUrl} | ${r.engine ?? '-'} | ${r.chars ?? 0} | ${r.success ? '✅' : '❌'} |`);
    }

    console.log('\n🧹 Cleaning up...');
    await cleanup();
    console.log('✨ Done!');
}

main().catch(console.error);
