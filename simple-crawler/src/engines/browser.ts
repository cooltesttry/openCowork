/**
 * Browser Rendering Engine with Stealth
 * Uses Playwright-Extra with Stealth plugin for better anti-detection
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { EngineResult, ScrapeOptions } from '../types';
import { getRandomUserAgent } from './user-agent';

chromium.use(StealthPlugin());

// Domains to block (ads, trackers, etc.)
const BLOCKED_DOMAINS = [
    'doubleclick.net',
    'adservice.google.com',
    'googlesyndication.com',
    'googletagservices.com',
    'googletagmanager.com',
    'google-analytics.com',
    'adsystem.com',
    'adservice.com',
    'adnxs.com',
    'ads-twitter.com',
    'facebook.net',
    'fbcdn.net',
    'amazon-adsystem.com',
];

// Resource types to block for faster loading
const BLOCKED_RESOURCE_TYPES = ['media', 'font'];

let browserInstance: Browser | null = null;

/**
 * Get or create a browser instance with stealth
 */
async function getBrowser(): Promise<Browser> {
    if (!browserInstance || !browserInstance.isConnected()) {
        browserInstance = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
            ],
        });
    }
    return browserInstance;
}

/**
 * Close the browser instance
 */
export async function closeBrowser(): Promise<void> {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}

/**
 * Create a browser context with anti-detection features
 */
async function createContext(browser: Browser): Promise<BrowserContext> {
    const userAgent = getRandomUserAgent();

    const context = await browser.newContext({
        userAgent,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
        javaScriptEnabled: true,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: [],
        colorScheme: 'light',
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        },
    });

    // Block ads and trackers for faster loading
    await context.route('**/*', (route, request) => {
        const url = request.url();
        const resourceType = request.resourceType();

        if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
            return route.abort();
        }

        try {
            const hostname = new URL(url).hostname;
            if (BLOCKED_DOMAINS.some(domain => hostname.includes(domain))) {
                return route.abort();
            }
        } catch {
            // Invalid URL
        }

        return route.continue();
    });

    return context;
}

/**
 * Fetch a page using browser rendering with stealth
 */
export async function fetchWithBrowser(
    url: string,
    options: ScrapeOptions = {}
): Promise<EngineResult> {
    const browser = await getBrowser();
    const context = await createContext(browser);
    let page: Page | null = null;

    try {
        page = await context.newPage();

        const timeout = options.timeout ?? 30000;
        const waitAfterLoad = options.waitAfterLoad ?? 1000;

        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout,
        });

        if (waitAfterLoad > 0) {
            await page.waitForTimeout(waitAfterLoad);
        }

        const html = await page.content();
        const statusCode = response?.status() ?? 200;

        return {
            url: page.url(),
            html,
            statusCode,
            contentType: response?.headers()['content-type'],
        };
    } catch (error) {
        return {
            url,
            html: '',
            statusCode: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    } finally {
        if (page) {
            await page.close();
        }
        await context.close();
    }
}
