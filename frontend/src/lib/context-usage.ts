import type { ContextUsageCalibration, Message } from './types';

const CONTEXT_HEADER = '## Context Usage';
const CONTEXT_SECTION = '### Estimated usage by category';
const CONTEXT_TABLE_HEADER = '| Category | Tokens | Percentage |';

const parseCompactNumber = (value: string): number | null => {
    if (!value) return null;
    const raw = value
        .trim()
        .toLowerCase()
        .replace(/,/g, '')
        .replace(/\s+/g, '');
    const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([km]?)$/);
    if (!match) return null;
    let number = Number.parseFloat(match[1]);
    const suffix = match[2];
    if (suffix === 'k') {
        number *= 1000;
    } else if (suffix === 'm') {
        number *= 1_000_000;
    }
    if (!Number.isFinite(number)) return null;
    return Math.round(number);
};

const extractContextUsageTokens = (content: string): { usedTokens: number; windowTokens: number } | null => {
    if (!content.startsWith(CONTEXT_HEADER)) return null;
    if (!content.includes(CONTEXT_SECTION) || !content.includes(CONTEXT_TABLE_HEADER)) return null;
    const tokensLine = content
        .split('\n')
        .map(line => line.trim())
        .find(line => line && /tokens:/i.test(line));
    if (!tokensLine) return null;
    const cleaned = tokensLine.replace(/\*\*/g, '');
    const match = cleaned.match(/Tokens:\s*([^/]+)\s*\/\s*([^\s(]+)/i);
    if (!match) return null;
    const usedTokens = parseCompactNumber(match[1].trim());
    const windowTokens = parseCompactNumber(match[2].trim());
    if (usedTokens == null || windowTokens == null) return null;
    return { usedTokens, windowTokens };
};

const sumAssistantUsage = (messages: Message[]): number => {
    return messages.reduce((sum, msg) => {
        if (msg.role !== 'assistant') return sum;
        const tokens = msg.usage?.total_tokens;
        return sum + (typeof tokens === 'number' ? tokens : 0);
    }, 0);
};

export const buildContextUsageCalibration = (
    messages: Message[],
    content: string,
    sourceMessageId?: string
): ContextUsageCalibration | null => {
    const parsed = extractContextUsageTokens(content);
    if (!parsed) return null;
    const totalUsage = sumAssistantUsage(messages);
    return {
        offset_tokens: parsed.usedTokens - totalUsage,
        window_tokens: parsed.windowTokens,
        updated_at: Date.now() / 1000,
        source_message_id: sourceMessageId ?? null,
    };
};
