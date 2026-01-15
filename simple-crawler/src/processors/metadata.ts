/**
 * Metadata Extractor
 * Extracts page metadata from HTML
 */

import { load } from 'cheerio';
import type { PageMetadata } from '../types.js';

/**
 * Extract metadata from HTML
 */
export function extractMetadata(html: string): PageMetadata {
    const $ = load(html);

    const metadata: PageMetadata = {};

    // Title
    metadata.title = $('title').first().text().trim() ||
        $('meta[property="og:title"]').attr('content')?.trim() ||
        $('h1').first().text().trim();

    // Description
    metadata.description = $('meta[name="description"]').attr('content')?.trim() ||
        $('meta[property="og:description"]').attr('content')?.trim();

    // Language
    metadata.language = $('html').attr('lang') ||
        $('meta[http-equiv="content-language"]').attr('content');

    // Keywords
    metadata.keywords = $('meta[name="keywords"]').attr('content')?.trim();

    // Open Graph
    metadata.ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
    metadata.ogDescription = $('meta[property="og:description"]').attr('content')?.trim();
    metadata.ogImage = $('meta[property="og:image"]').attr('content')?.trim();

    // Author
    metadata.author = $('meta[name="author"]').attr('content')?.trim() ||
        $('meta[property="article:author"]').attr('content')?.trim() ||
        $('[rel="author"]').first().text().trim();

    // Published time
    metadata.publishedTime = $('meta[property="article:published_time"]').attr('content')?.trim() ||
        $('time[datetime]').first().attr('datetime')?.trim() ||
        $('meta[name="date"]').attr('content')?.trim();

    // Clean up undefined values
    Object.keys(metadata).forEach(key => {
        if (metadata[key as keyof PageMetadata] === undefined ||
            metadata[key as keyof PageMetadata] === '') {
            delete metadata[key as keyof PageMetadata];
        }
    });

    return metadata;
}
