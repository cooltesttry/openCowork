/**
 * HTML to Markdown Converter
 * Converts cleaned HTML to Markdown format
 */

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

// Create and configure turndown instance
const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
});

// Use GitHub Flavored Markdown plugin
turndownService.use(gfm);

// Custom rule for inline links with better formatting
turndownService.addRule('inlineLink', {
    filter: function (node, options) {
        return (
            options.linkStyle === 'inlined' &&
            node.nodeName === 'A' &&
            !!node.getAttribute('href')
        );
    },
    replacement: function (content, node) {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute('href')?.trim() ?? '';
        const title = element.title ? ` "${element.title}"` : '';
        return `[${content.trim()}](${href}${title})`;
    },
});

// Remove data URIs from images (too long for markdown)
turndownService.addRule('removeDataImages', {
    filter: function (node) {
        if (node.nodeName !== 'IMG') return false;
        const src = (node as HTMLImageElement).getAttribute('src') ?? '';
        return src.startsWith('data:');
    },
    replacement: function () {
        return '';
    },
});

// Better handling of code blocks
turndownService.addRule('codeBlock', {
    filter: function (node) {
        return (
            node.nodeName === 'PRE' &&
            node.firstChild !== null &&
            node.firstChild.nodeName === 'CODE'
        );
    },
    replacement: function (content, node) {
        const codeNode = node.firstChild as HTMLElement;
        const className = codeNode.getAttribute('class') ?? '';
        const languageMatch = className.match(/language-(\w+)/);
        const language = languageMatch ? languageMatch[1] : '';
        const code = codeNode.textContent ?? '';
        return `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    },
});

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
    if (!html || !html.trim()) {
        return '';
    }

    try {
        let markdown = turndownService.turndown(html);

        // Post-processing
        markdown = postProcessMarkdown(markdown);

        return markdown;
    } catch (error) {
        console.error('Error converting HTML to Markdown:', error);
        return '';
    }
}

/**
 * Post-process markdown for better formatting
 */
function postProcessMarkdown(markdown: string): string {
    // Remove excessive blank lines
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    // Remove "Skip to content" links
    markdown = markdown.replace(/\[Skip to [Cc]ontent\]\(#[^)]*\)/gi, '');

    // Fix broken multi-line links
    markdown = processMultiLineLinks(markdown);

    // Remove empty links
    markdown = markdown.replace(/\[\s*\]\([^)]*\)/g, '');

    // Trim whitespace
    markdown = markdown.trim();

    return markdown;
}

/**
 * Fix multi-line link content
 */
function processMultiLineLinks(markdown: string): string {
    let result = '';
    let insideLinkContent = false;
    let linkOpenCount = 0;

    for (let i = 0; i < markdown.length; i++) {
        const char = markdown[i];

        if (char === '[') {
            linkOpenCount++;
        } else if (char === ']') {
            linkOpenCount = Math.max(0, linkOpenCount - 1);
        }

        insideLinkContent = linkOpenCount > 0;

        if (insideLinkContent && char === '\n') {
            result += ' ';
        } else {
            result += char;
        }
    }

    return result;
}
