/**
 * HTTP Fetch Engine
 * Direct HTTP requests using native fetch API
 */

import type { EngineResult, ScrapeOptions } from '../types.js';
import { getRandomUserAgent } from './user-agent.js';

const DEFAULT_HEADERS: Record<string, string> = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

export async function fetchWithHttp(
    url: string,
    options: ScrapeOptions = {}
): Promise<EngineResult> {
    const controller = new AbortController();
    const timeout = options.timeout ?? 30000;

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const headers = {
            ...DEFAULT_HEADERS,
            'User-Agent': getRandomUserAgent(),
            ...(options.headers ?? {}),
        };

        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'follow',
            signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') ?? undefined;

        // Read response body
        const buffer = await response.arrayBuffer();
        let html = new TextDecoder('utf-8').decode(buffer);

        // Try to detect charset from meta tag and re-decode if needed
        const charsetMatch = html.match(/<meta\b[^>]*charset\s*=\s*["']?([^"'\s/>]+)/i);
        if (charsetMatch?.[1] && charsetMatch[1].toLowerCase() !== 'utf-8') {
            try {
                html = new TextDecoder(charsetMatch[1].trim()).decode(buffer);
            } catch {
                // Keep UTF-8 decoded version
            }
        }

        return {
            url: response.url,
            html,
            statusCode: response.status,
            contentType,
        };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return {
                url,
                html: '',
                statusCode: 0,
                error: 'Request timeout',
            };
        }

        return {
            url,
            html: '',
            statusCode: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Check if the result indicates we should fall back to browser rendering
 */
export function shouldFallbackToBrowser(result: EngineResult): boolean {
    // HTTP errors that often indicate anti-bot protection
    const blockedStatusCodes = [403, 429, 503];
    if (blockedStatusCodes.includes(result.statusCode)) {
        return true;
    }

    // Check for empty or very short content
    if (!result.html || result.html.trim().length < 100) {
        return true;
    }

    // Check for common anti-bot patterns
    const antiPatterns = [
        'cf-browser-verification',
        'challenge-running',
        'Just a moment...',
        'Checking your browser',
        'Please enable JavaScript',
        'needs JavaScript to work',
        'enable cookies',
        'captcha',
        'recaptcha',
        'hcaptcha',
        'Access denied',
        'blocked',
        'Please verify you are human',
    ];

    const lowerHtml = result.html.toLowerCase();
    for (const pattern of antiPatterns) {
        if (lowerHtml.includes(pattern.toLowerCase())) {
            return true;
        }
    }

    return false;
}
