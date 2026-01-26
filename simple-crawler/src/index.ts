/**
 * Simple Crawler
 * A lightweight single-page web crawler with HTTP fetch and browser rendering fallback
 */

import type { ScrapeOptions, ScrapeResult, EngineResult } from './types.js';
import { fetchWithHttp, shouldFallbackToBrowser, fetchWithBrowser, closeBrowser, isPdfUrl, fetchPdf } from './engines/index.js';
import { cleanHtml, htmlToMarkdown, extractLinks, extractMetadata } from './processors/index.js';

export * from './types.js';
export * from './engines/index.js';
export * from './processors/index.js';

/**
 * Scrape a single URL and extract content
 * 
 * @param url - The URL to scrape
 * @param options - Scraping options
 * @returns ScrapeResult with markdown, links, and metadata
 * 
 * @example
 * ```ts
 * import { scrape } from 'simple-crawler';
 * 
 * const result = await scrape('https://example.com');
 * console.log(result.markdown);
 * console.log(result.links);
 * ```
 */
export async function scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    // Validate URL
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return {
            success: false,
            url,
            error: 'Invalid URL',
        };
    }

    // Check if URL is a PDF
    if (isPdfUrl(url)) {
        return scrapePdf(url, options);
    }

    let engineResult: EngineResult;
    let engine: 'fetch' | 'browser' | 'pdf' = 'fetch';

    // Try HTTP fetch first (unless forced to use browser)
    if (!options.forceBrowser) {
        engineResult = await fetchWithHttp(url, options);

        // Check if response is a PDF (by content-type)
        if (engineResult.contentType?.includes('application/pdf')) {
            return scrapePdf(url, options);
        }

        // Check if we should fall back to browser
        if (shouldFallbackToBrowser(engineResult)) {
            console.log(`[simple-crawler] HTTP fetch failed or blocked, falling back to browser for: ${url}`);
            engine = 'browser';
            engineResult = await fetchWithBrowser(url, options);
        }
    } else {
        engine = 'browser';
        engineResult = await fetchWithBrowser(url, options);
    }

    // Check for errors
    if (engineResult.error) {
        return {
            success: false,
            url,
            finalUrl: engineResult.url,
            statusCode: engineResult.statusCode,
            error: engineResult.error,
            engine,
        };
    }

    // Process the HTML
    const rawHtml = engineResult.html;

    // Clean HTML
    const cleanedHtml = cleanHtml(rawHtml, {
        onlyMainContent: options.onlyMainContent ?? true,
        includeTags: options.includeTags,
        excludeTags: options.excludeTags,
        baseUrl: engineResult.url,
    });

    // Convert to markdown
    const markdown = htmlToMarkdown(cleanedHtml);

    // Extract links from raw HTML (before cleaning)
    const links = extractLinks(rawHtml, engineResult.url);

    // Extract metadata
    const metadata = extractMetadata(rawHtml);

    return {
        success: true,
        url,
        finalUrl: engineResult.url,
        markdown,
        html: cleanedHtml,
        rawHtml,
        links,
        metadata,
        statusCode: engineResult.statusCode,
        engine,
    };
}

/**
 * Scrape a PDF file
 */
async function scrapePdf(url: string, options: ScrapeOptions): Promise<ScrapeResult> {
    const result = await fetchPdf(url, { timeout: options.timeout });

    if (result.error) {
        return {
            success: false,
            url,
            finalUrl: result.url,
            statusCode: result.statusCode,
            error: result.error,
            engine: 'pdf',
        };
    }

    // PDF text is returned in html field
    const text = result.html;

    return {
        success: true,
        url,
        finalUrl: result.url,
        markdown: text,
        html: text,
        rawHtml: text,
        links: [],
        metadata: {
            title: url.split('/').pop() ?? 'PDF Document',
        },
        statusCode: result.statusCode,
        engine: 'pdf',
    };
}

/**
 * Scrape multiple URLs
 * 
 * @param urls - Array of URLs to scrape
 * @param options - Scraping options
 * @param concurrency - Number of concurrent requests (default: 3)
 */
export async function scrapeMultiple(
    urls: string[],
    options: ScrapeOptions = {},
    concurrency: number = 3
): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];

    // Process in batches
    for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const batchResults = await Promise.all(
            batch.map(url => scrape(url, options))
        );
        results.push(...batchResults);
    }

    return results;
}

/**
 * Clean up resources (close browser if opened)
 */
export async function cleanup(): Promise<void> {
    await closeBrowser();
}

// Default export
export default {
    scrape,
    scrapeMultiple,
    cleanup,
};
