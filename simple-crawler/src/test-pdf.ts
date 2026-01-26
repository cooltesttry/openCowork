/**
 * Test PDF Support with reliable URLs
 */

import { scrape, cleanup, isPdfUrl } from './index.js';

async function main() {
    console.log('📄 PDF Support Test\n');
    console.log('='.repeat(60));

    // More reliable PDF test URLs
    const pdfUrls = [
        // Mozilla PDF.js test file
        'https://raw.githubusercontent.com/nicobytes/pdf-test/main/sample.pdf',
        // Another option
        'https://pdfobject.com/pdf/sample.pdf',
    ];

    // First check if isPdfUrl works correctly
    console.log('\n🔍 Testing isPdfUrl function:');
    console.log(`   isPdfUrl("https://example.com/doc.pdf") = ${isPdfUrl("https://example.com/doc.pdf")}`);
    console.log(`   isPdfUrl("https://example.com/page") = ${isPdfUrl("https://example.com/page")}`);
    console.log(`   isPdfUrl("https://example.com/file.pdf/view") = ${isPdfUrl("https://example.com/file.pdf/view")}`);

    for (const url of pdfUrls) {
        console.log(`\n📄 Testing: ${url}`);
        console.log('-'.repeat(60));

        try {
            const result = await scrape(url, { timeout: 30000 });

            if (result.success) {
                console.log(`✅ Success!`);
                console.log(`   Engine: ${result.engine}`);
                console.log(`   Status: ${result.statusCode}`);
                console.log(`   Content length: ${result.markdown?.length ?? 0} chars`);
                console.log(`\n   Preview (first 500 chars):`);
                const preview = result.markdown?.slice(0, 500).replace(/\n/g, '\n   ') ?? '';
                console.log('   ' + preview);
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
