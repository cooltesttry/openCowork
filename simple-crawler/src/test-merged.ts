/**
 * Test merged web_fetch tool
 */

import { scrape, extractLinksWithMetadata, cleanup } from './index.js';

async function webFetch(url: string, includeLinks: boolean = false) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: url="${url}", includeLinks=${includeLinks}`);
    console.log('='.repeat(60));

    const result = await scrape(url, {
        timeout: 60000,
        onlyMainContent: true,
        waitAfterLoad: 2000,
    });

    if (!result.success) {
        console.log(`Error: ${result.error}`);
        return;
    }

    let responseText = '';

    if (result.metadata?.title) {
        responseText += `# ${result.metadata.title}\n\n`;
    }

    responseText += `**URL:** ${result.finalUrl ?? url}\n\n`;
    responseText += `---\n\n`;
    responseText += result.markdown ?? '';

    if (includeLinks && result.rawHtml) {
        const links = extractLinksWithMetadata(result.rawHtml, result.finalUrl ?? url);

        responseText += `\n\n---\n\n`;
        responseText += `## Links (${links.length} found)\n\n`;

        links.slice(0, 10).forEach((link, index) => {
            const text = link.text.trim() || '(no text)';
            const displayText = text.length > 60 ? text.slice(0, 60) + '...' : text;
            responseText += `${index + 1}. [${displayText}](${link.url})`;
            if (link.isExternal) {
                responseText += ' _(external)_';
            }
            responseText += '\n';
        });

        if (links.length > 10) {
            responseText += `\n... and ${links.length - 10} more links\n`;
        }
    }

    console.log('\n--- OUTPUT ---\n');
    console.log(responseText);
}

async function main() {
    // Test 1: Without links
    await webFetch('https://example.com', false);

    // Test 2: With links
    await webFetch('https://example.com', true);

    await cleanup();
    console.log('\n✨ Done!');
}

main().catch(console.error);
