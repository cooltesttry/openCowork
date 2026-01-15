/**
 * HTML Content Cleaner
 * Removes non-essential elements and cleans HTML for content extraction
 */

import { load, type CheerioAPI } from 'cheerio';

// Tags to remove when extracting main content
const EXCLUDE_NON_MAIN_TAGS = [
    // Semantic elements
    'header',
    'footer',
    'nav',
    'aside',

    // Common class/id patterns
    '.header',
    '.top',
    '.navbar',
    '#header',
    '.footer',
    '.bottom',
    '#footer',
    '.sidebar',
    '.side',
    '.aside',
    '#sidebar',
    '.modal',
    '.popup',
    '#modal',
    '.overlay',
    '.ad',
    '.ads',
    '.advert',
    '#ad',
    '.advertisement',
    '.banner',
    '.lang-selector',
    '.language',
    '#language-selector',
    '.social',
    '.social-media',
    '.social-links',
    '#social',
    '.menu',
    '.navigation',
    '#nav',
    '.breadcrumbs',
    '#breadcrumbs',
    '.breadcrumb',
    '.share',
    '#share',
    '.widget',
    '#widget',
    '.cookie',
    '#cookie',
    '.cookie-banner',
    '.cookie-notice',
    '.comments',
    '#comments',
    '.comment-section',
    '.related',
    '.related-posts',
    '.recommended',
    '.subscribe',
    '.newsletter',
    '.signup',
    '.login',
    '.search',
    '#search',
    '.search-form',
];

// Tags that should always be preserved
const PRESERVE_TAGS = [
    '#main',
    '.main',
    'main',
    'article',
    '.article',
    '.content',
    '#content',
    '.post',
    '.entry',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.article-body',
    '.story',
    '.story-body',
];

export interface CleanOptions {
    /** Only extract main content, removing nav, footer, etc. */
    onlyMainContent?: boolean;
    /** CSS selectors for tags to include */
    includeTags?: string[];
    /** CSS selectors for tags to exclude */
    excludeTags?: string[];
    /** Base URL for resolving relative links */
    baseUrl?: string;
}

/**
 * Clean HTML content
 */
export function cleanHtml(html: string, options: CleanOptions = {}): string {
    const $ = load(html);

    // Always remove these elements
    $('script, style, noscript, meta, head, iframe, svg').remove();

    // Remove layout tables (tables used for layout, not data)
    // Unwrap tables that don't have proper table headers
    $('table').each((_, element) => {
        const el = $(element);
        const hasHeaders = el.find('th').length > 0;

        // If it's a layout table (no headers), extract the content
        if (!hasHeaders) {
            // Get all text content from cells, separated by spaces
            const cells = el.find('td');
            const contents: any[] = [];
            cells.each((_, cell) => {
                contents.push($(cell).contents());
            });
            // Replace table with its cell contents wrapped in divs
            const wrapper = $('<div></div>');
            contents.forEach(content => {
                const div = $('<div></div>');
                div.append(content);
                wrapper.append(div);
            });
            el.replaceWith(wrapper.contents());
        }
    });

    // Remove comments
    $('*').contents().filter(function () {
        return this.type === 'comment';
    }).remove();

    // Apply custom include tags
    if (options.includeTags && options.includeTags.length > 0) {
        const newRoot = load('<div></div>')('div');
        options.includeTags.forEach(tag => {
            $(tag).each((_, element) => {
                newRoot.append($(element).clone());
            });
        });
        return newRoot.html() ?? '';
    }

    // Apply custom exclude tags
    if (options.excludeTags && options.excludeTags.length > 0) {
        options.excludeTags.forEach(tag => {
            $(tag).remove();
        });
    }

    // Remove non-main content if requested
    if (options.onlyMainContent !== false) {
        removeNonMainContent($);
    }

    // Resolve relative URLs
    if (options.baseUrl) {
        resolveUrls($, options.baseUrl);
    }

    // Clean up whitespace
    return $.html().replace(/\s+/g, ' ').trim();
}

/**
 * Remove non-main content elements
 */
function removeNonMainContent($: CheerioAPI): void {
    // Check if any preserve tags exist
    const hasPreservedContent = PRESERVE_TAGS.some(tag => $(tag).length > 0);

    // Only remove non-main tags if we have preserved content
    // This prevents removing everything from simple pages
    if (hasPreservedContent) {
        EXCLUDE_NON_MAIN_TAGS.forEach(selector => {
            // Don't remove if it contains preserved content
            $(selector).each((_, element) => {
                const el = $(element);
                const containsPreserved = PRESERVE_TAGS.some(preserve =>
                    el.find(preserve).length > 0 || el.is(preserve)
                );
                if (!containsPreserved) {
                    el.remove();
                }
            });
        });
    }

    // Remove empty elements
    $('div, span, p').each((_, element) => {
        const el = $(element);
        if (el.text().trim() === '' && el.find('img, video, audio').length === 0) {
            el.remove();
        }
    });
}

/**
 * Resolve relative URLs to absolute
 */
function resolveUrls($: CheerioAPI, baseUrl: string): void {
    // Resolve image sources
    $('img[src]').each((_, element) => {
        const el = $(element);
        const src = el.attr('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
            try {
                el.attr('src', new URL(src, baseUrl).href);
            } catch {
                // Invalid URL, leave as is
            }
        }
    });

    // Resolve link hrefs
    $('a[href]').each((_, element) => {
        const el = $(element);
        const href = el.attr('href');
        if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('#')) {
            try {
                el.attr('href', new URL(href, baseUrl).href);
            } catch {
                // Invalid URL, leave as is
            }
        }
    });
}

/**
 * Get the best image source from srcset
 */
function getBestImageSrc($: CheerioAPI): void {
    $('img[srcset]').each((_, element) => {
        const el = $(element);
        const srcset = el.attr('srcset');
        if (!srcset) return;

        const sizes = srcset.split(',').map(s => {
            const parts = s.trim().split(' ');
            return {
                url: parts[0],
                size: parseInt((parts[1] ?? '1x').slice(0, -1), 10) || 1,
            };
        });

        // Sort by size descending and take the largest
        sizes.sort((a, b) => b.size - a.size);
        if (sizes[0]) {
            el.attr('src', sizes[0].url);
        }
    });
}
