/**
 * Check TechCrunch result
 */

import { scrape, cleanup } from './index.js';

async function main() {
    const result = await scrape('https://techcrunch.com', {
        timeout: 45000,
        waitAfterLoad: 2000,
        onlyMainContent: true,
    });

    console.log('=== TechCrunch 爬取结果 ===');
    console.log('Engine:', result.engine);
    console.log('Status:', result.statusCode);
    console.log('Title:', result.metadata?.title);
    console.log('Links:', result.links?.length);
    console.log('Content length:', result.markdown?.length, 'chars');
    console.log('');
    console.log('=== 前 2000 字符内容 ===');
    console.log(result.markdown?.slice(0, 2000));
    console.log('');
    console.log('=== 检查是否包含 robot 关键词 ===');
    const hasRobot = result.markdown?.toLowerCase().includes('robot');
    const hasCaptcha = result.markdown?.toLowerCase().includes('captcha');
    console.log('Contains "robot":', hasRobot);
    console.log('Contains "captcha":', hasCaptcha);

    // Show context around "robot" if found
    if (hasRobot) {
        const idx = result.markdown?.toLowerCase().indexOf('robot') ?? -1;
        if (idx > -1) {
            const start = Math.max(0, idx - 100);
            const end = Math.min(result.markdown?.length ?? 0, idx + 100);
            console.log('');
            console.log('=== robot 关键词上下文 ===');
            console.log('...' + result.markdown?.slice(start, end) + '...');
        }
    }

    await cleanup();
}

main().catch(console.error);
