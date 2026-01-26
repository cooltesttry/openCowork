/**
 * Test MCP Server web_fetch tool with HTML and PDF
 */

import { scrape, cleanup } from './index.js';

async function webFetch(url: string) {
    const result = await scrape(url, {
        timeout: 60000,
        onlyMainContent: true,
        waitAfterLoad: 2000,
    });

    if (!result.success) {
        return `Error fetching ${url}: ${result.error}`;
    }

    let responseText = '';

    if (result.metadata?.title) {
        responseText += `# ${result.metadata.title}\n\n`;
    }

    responseText += `**URL:** ${result.finalUrl ?? url}\n\n`;
    responseText += `---\n\n`;
    responseText += result.markdown ?? '';

    return responseText;
}

async function main() {
    console.log('🔥 MCP Server web_fetch Test\n');
    console.log('='.repeat(60));

    const tests = [
        { url: 'https://example.com', type: 'HTML' },
        { url: 'https://pdfobject.com/pdf/sample.pdf', type: 'PDF' },
    ];

    for (const test of tests) {
        console.log(`\n📄 [${test.type}] ${test.url}`);
        console.log('-'.repeat(60));

        const output = await webFetch(test.url);

        // Show first 500 chars of output
        console.log('\nOutput preview:');
        console.log(output.slice(0, 500));
        if (output.length > 500) {
            console.log(`\n... (${output.length - 500} more chars)`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🧹 Cleaning up...');
    await cleanup();
    console.log('✨ Done!');
}

main().catch(console.error);
