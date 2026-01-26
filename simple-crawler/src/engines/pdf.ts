/**
 * PDF Engine
 * Extracts text content from PDF files using pdf-parse v1.x
 */

import { createRequire } from 'module';
import type { EngineResult } from '../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

/**
 * Check if a URL points to a PDF file
 */
export function isPdfUrl(url: string): boolean {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();
        return pathname.endsWith('.pdf') || pathname.includes('.pdf/');
    } catch {
        return false;
    }
}

/**
 * Check if content type indicates PDF
 */
export function isPdfContentType(contentType: string | undefined): boolean {
    return contentType?.includes('application/pdf') ?? false;
}

/**
 * Fetch and parse a PDF from a URL
 */
export async function fetchPdf(
    url: string,
    options: { timeout?: number } = {}
): Promise<EngineResult> {
    const timeout = options.timeout ?? 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        // Fetch the PDF file
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });

        if (!response.ok) {
            return {
                url,
                html: '',
                statusCode: response.status,
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }

        // Check content type
        const contentType = response.headers.get('content-type') ?? '';
        if (!isPdfContentType(contentType) && !isPdfUrl(url)) {
            return {
                url: response.url,
                html: '',
                statusCode: response.status,
                error: 'Response is not a PDF',
                contentType,
            };
        }

        // Get the PDF buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Parse the PDF (pdf-parse v1 returns { text, numpages, info, metadata })
        const pdfData = await pdfParse(buffer);

        // Return the extracted text
        return {
            url: response.url,
            html: pdfData.text,
            statusCode: response.status,
            contentType: 'application/pdf',
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
 * Parse PDF from a buffer
 */
export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
}
