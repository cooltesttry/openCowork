/**
 * Link Extractor
 * Extracts and normalizes links from HTML content
 */

import { load } from 'cheerio';

export interface ExtractedLink {
    url: string;
    text: string;
    isExternal: boolean;
}

/**
 * Extract all links from HTML
 */
export function extractLinks(html: string, baseUrl: string): string[] {
    const $ = load(html);
    const links = new Set<string>();

    // Get base href if present
    const baseHref = $('base[href]').first().attr('href') ?? '';
    const resolveBase = getResolutionBase(baseUrl, baseHref);

    $('a[href]').each((_, element) => {
        const href = $(element).attr('href')?.trim();
        if (href) {
            const resolved = resolveUrl(href, resolveBase);
            if (resolved) {
                links.add(resolved);
            }
        }
    });

    return Array.from(links);
}

/**
 * Extract links with additional metadata
 */
export function extractLinksWithMetadata(html: string, baseUrl: string): ExtractedLink[] {
    const $ = load(html);
    const links: ExtractedLink[] = [];
    const seen = new Set<string>();

    const baseHref = $('base[href]').first().attr('href') ?? '';
    const resolveBase = getResolutionBase(baseUrl, baseHref);
    const baseHostname = new URL(baseUrl).hostname;

    $('a[href]').each((_, element) => {
        const el = $(element);
        const href = el.attr('href')?.trim();
        if (!href) return;

        const resolved = resolveUrl(href, resolveBase);
        if (!resolved || seen.has(resolved)) return;

        seen.add(resolved);

        let isExternal = false;
        try {
            isExternal = new URL(resolved).hostname !== baseHostname;
        } catch {
            // Invalid URL
        }

        links.push({
            url: resolved,
            text: el.text().trim(),
            isExternal,
        });
    });

    return links;
}

/**
 * Get the base URL for resolving relative links
 */
function getResolutionBase(pageUrl: string, baseHref: string): string {
    if (!baseHref) {
        return pageUrl;
    }

    try {
        // Check if baseHref is absolute
        new URL(baseHref);
        return baseHref;
    } catch {
        // baseHref is relative, resolve against page URL
        try {
            return new URL(baseHref, pageUrl).href;
        } catch {
            return pageUrl;
        }
    }
}

/**
 * Resolve a URL against a base URL
 */
function resolveUrl(href: string, baseUrl: string): string | null {
    // Skip these types of links
    if (
        href.startsWith('#') ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('data:')
    ) {
        return null;
    }

    try {
        // Already absolute
        if (href.startsWith('http://') || href.startsWith('https://')) {
            return href;
        }

        // Resolve relative URL
        return new URL(href, baseUrl).href;
    } catch {
        return null;
    }
}

/**
 * Filter links to only include those matching certain patterns
 */
export function filterLinks(
    links: string[],
    options: {
        /** Only include links matching these patterns (regex) */
        include?: RegExp[];
        /** Exclude links matching these patterns (regex) */
        exclude?: RegExp[];
        /** Only include internal links */
        internalOnly?: boolean;
        /** Base URL for determining internal links */
        baseUrl?: string;
    } = {}
): string[] {
    let filtered = links;

    if (options.internalOnly && options.baseUrl) {
        const baseHostname = new URL(options.baseUrl).hostname;
        filtered = filtered.filter(link => {
            try {
                return new URL(link).hostname === baseHostname;
            } catch {
                return false;
            }
        });
    }

    if (options.include && options.include.length > 0) {
        filtered = filtered.filter(link =>
            options.include!.some(pattern => pattern.test(link))
        );
    }

    if (options.exclude && options.exclude.length > 0) {
        filtered = filtered.filter(link =>
            !options.exclude!.some(pattern => pattern.test(link))
        );
    }

    return filtered;
}
