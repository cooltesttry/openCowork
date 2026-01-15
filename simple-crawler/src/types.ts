/**
 * Type definitions for Simple Crawler
 */

export interface ScrapeOptions {
    /** Timeout in milliseconds for the entire scrape operation */
    timeout?: number;
    /** Wait time after page load (for JavaScript rendering) */
    waitAfterLoad?: number;
    /** Custom headers to send with the request */
    headers?: Record<string, string>;
    /** Whether to only extract main content (remove nav, footer, etc.) */
    onlyMainContent?: boolean;
    /** Force using browser rendering instead of HTTP fetch */
    forceBrowser?: boolean;
    /** Tags to include (CSS selectors) */
    includeTags?: string[];
    /** Tags to exclude (CSS selectors) */
    excludeTags?: string[];
}

export interface ScrapeResult {
    /** Whether the scrape was successful */
    success: boolean;
    /** The source URL */
    url: string;
    /** Final URL after redirects */
    finalUrl?: string;
    /** Extracted markdown content */
    markdown?: string;
    /** Cleaned HTML content */
    html?: string;
    /** Raw HTML before cleaning */
    rawHtml?: string;
    /** Extracted links from the page */
    links?: string[];
    /** Page metadata */
    metadata?: PageMetadata;
    /** HTTP status code */
    statusCode?: number;
    /** Error message if failed */
    error?: string;
    /** Which engine was used (fetch or browser) */
    engine?: 'fetch' | 'browser';
}

export interface PageMetadata {
    title?: string;
    description?: string;
    language?: string;
    keywords?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    author?: string;
    publishedTime?: string;
}

export interface EngineResult {
    url: string;
    html: string;
    statusCode: number;
    error?: string;
    contentType?: string;
}
