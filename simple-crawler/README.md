# Simple Crawler

A lightweight, independent single-page web crawler with intelligent HTTP/browser fallback.

## Features

- 🚀 **Direct HTTP Fetch** - Fast, lightweight scraping for static pages
- 🌐 **Browser Rendering** - Automatic fallback to Playwright for JavaScript-heavy pages
- 🛡️ **Anti-Detection** - Randomized User-Agent, request headers, and browser fingerprint masking
- 🧹 **Content Cleaning** - Removes headers, footers, navigation, ads, and other non-essential content
- 📝 **Markdown Conversion** - Converts cleaned HTML to clean Markdown with GFM support
- 🔗 **Link Extraction** - Extracts and normalizes all page links
- 📊 **Metadata Extraction** - Extracts title, description, Open Graph data, etc.

## Installation

```bash
cd simple-crawler
pnpm install
npx playwright install chromium
```

## Usage

### Basic Usage

```typescript
import { scrape, cleanup } from 'simple-crawler';

// Scrape a single page
const result = await scrape('https://example.com');

console.log(result.markdown);  // Cleaned markdown content
console.log(result.links);     // Array of extracted links
console.log(result.metadata);  // Page metadata

// Clean up browser resources when done
await cleanup();
```

### With Options

```typescript
const result = await scrape('https://example.com', {
  // Timeout in milliseconds
  timeout: 30000,
  
  // Wait time after page load (for JS rendering)
  waitAfterLoad: 2000,
  
  // Only extract main content (removes nav, footer, etc.)
  onlyMainContent: true,
  
  // Force using browser instead of HTTP fetch
  forceBrowser: false,
  
  // Custom request headers
  headers: {
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
  
  // Include only specific elements (CSS selectors)
  includeTags: ['article', '.content'],
  
  // Exclude specific elements (CSS selectors)
  excludeTags: ['.comments', '.related-posts'],
});
```

### Scrape Multiple URLs

```typescript
import { scrapeMultiple, cleanup } from 'simple-crawler';

const results = await scrapeMultiple(
  ['https://example.com', 'https://news.ycombinator.com'],
  { timeout: 30000 },
  3  // concurrency
);

await cleanup();
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                      Input URL                          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   HTTP Fetch Engine                     │
│  - Random User-Agent                                    │
│  - Realistic request headers                            │
└────────────────────────┬────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │   Check for issues:     │
            │   - 403/429/503 status  │
            │   - Empty content       │
            │   - Anti-bot patterns   │
            │   - JS-required pages   │
            └────────────┬────────────┘
                 │               │
           Success          Need Browser
                 │               │
                 │               ▼
                 │    ┌─────────────────────────────┐
                 │    │    Browser Render Engine    │
                 │    │  - Playwright (Chromium)    │
                 │    │  - Anti-detection scripts   │
                 │    │  - Ad/tracker blocking      │
                 │    │  - Auto-scroll for lazy     │
                 │    │    loading                  │
                 │    └─────────────────────────────┘
                 │               │
                 └───────┬───────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   HTML Processing                       │
│  1. Clean HTML (remove nav, footer, ads, etc.)         │
│  2. Convert to Markdown (Turndown + GFM)                │
│  3. Extract Links (resolve relative URLs)               │
│  4. Extract Metadata (title, description, OG, etc.)     │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                      Output                             │
│  {                                                      │
│    success: true,                                       │
│    markdown: "...",                                     │
│    links: ["https://...", ...],                         │
│    metadata: { title: "...", ... },                     │
│    engine: "fetch" | "browser"                          │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
```

## Anti-Detection Features

### HTTP Engine
- Randomized User-Agent from a pool of real browser strings
- Realistic request headers (Accept, Accept-Language, etc.)
- Proper Sec-Fetch-* headers

### Browser Engine
- Override `navigator.webdriver` to prevent detection
- Randomized User-Agent matching browser
- Block ad/tracking domains to speed up loading
- Block unnecessary resource types (media, fonts)
- Simulate human scrolling behavior
- Proper Chrome/browser properties

## Project Structure

```
simple-crawler/
├── src/
│   ├── index.ts           # Main entry point
│   ├── types.ts           # Type definitions
│   ├── demo.ts            # Demo script
│   ├── engines/
│   │   ├── http.ts        # HTTP fetch engine
│   │   ├── browser.ts     # Playwright browser engine
│   │   └── user-agent.ts  # User-Agent generator
│   └── processors/
│       ├── html-cleaner.ts # HTML content cleaning
│       ├── markdown.ts     # HTML to Markdown conversion
│       ├── links.ts        # Link extraction
│       └── metadata.ts     # Metadata extraction
├── package.json
├── tsconfig.json
└── README.md
```

## Running the Demo

```bash
pnpm demo
```

## Building

```bash
pnpm build
```

## License

MIT
