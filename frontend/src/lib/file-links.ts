import type { MessageBlock } from '@/lib/types';

export type FileOperationType = 'Write' | 'Edit' | 'ImageGen' | 'Reference';
export type FileKind = 'html' | 'image' | 'document' | 'code';

export interface FileOperation {
    type: FileOperationType;
    path: string;
}

const asRecord = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object') {
        return value as Record<string, unknown>;
    }
    return {};
};

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp', '.ico'];
const PREVIEWABLE_EXTENSIONS = [
    '.txt', '.md', '.json', '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
    '.yaml', '.yml', '.xml', '.sh', '.go', '.rs', '.cpp', '.c', '.h', '.java',
    '.sql', '.env', '.toml', '.ini', '.cfg', '.log', '.csv'
];
const DOCUMENT_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.csv', '.rtf', '.pdf', '.html', '.htm'
]);

const getFileExtension = (path: string): string => {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return '';
    return path.slice(lastDot).toLowerCase();
};

export const normalizePath = (input: string): string => {
    const normalized = input.replace(/\\+/g, '/').replace(/\/+/g, '/');
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
};

const trimEdgePunctuation = (value: string): string => {
    return value
        .replace(/^[\s"'`([{<]+/, '')
        .replace(/[\s"'`)\]}>.,;:!?]+$/, '');
};

const stripLineAnchors = (value: string): string => {
    let result = value;
    result = result.replace(/#L\d+(?:C\d+)?$/, '');
    result = result.replace(/:\d+(?::\d+)?$/, '');
    return result;
};

const looksLikePath = (value: string): boolean => {
    if (!value) return false;
    if (value.endsWith('/')) return false;
    const base = value.split('/').pop() || value;
    if (/\.[A-Za-z0-9]{1,10}$/.test(base)) return true;
    const specialNames = new Set(['README', 'LICENSE', 'Makefile', 'Dockerfile']);
    return specialNames.has(base);
};

const extractWorkspaceFilePaths = (text: string, workspaceRoot: string): string[] => {
    const root = normalizePath(workspaceRoot);
    if (!root || !text) return [];
    const results = new Set<string>();
    const tokens = text.split(/\s+/);

    for (const rawToken of tokens) {
        let token = trimEdgePunctuation(rawToken);
        if (!token) continue;
        token = token.replace(/\\+/g, '/');
        token = stripLineAnchors(token);
        token = trimEdgePunctuation(token);
        if (!looksLikePath(token)) continue;
        if (token.includes('://') || token.startsWith('http') || token.startsWith('www.')) {
            continue;
        }

        const normalizedToken = normalizePath(token);
        if (normalizedToken.startsWith(`${root}/`)) {
            results.add(normalizedToken);
        }
    }

    return Array.from(results);
};

export const isImageFile = (path: string) => IMAGE_EXTENSIONS.includes(getFileExtension(path));
export const isHtmlFile = (path: string) => {
    const ext = getFileExtension(path);
    return ext === '.html' || ext === '.htm';
};
export const isDocumentFile = (path: string) => DOCUMENT_EXTENSIONS.has(getFileExtension(path));
export const isCodeFile = (path: string) => {
    const ext = getFileExtension(path);
    return PREVIEWABLE_EXTENSIONS.includes(ext) && !DOCUMENT_EXTENSIONS.has(ext);
};

export const classifyFileKind = (path: string): FileKind | null => {
    if (isHtmlFile(path)) return 'html';
    if (isImageFile(path)) return 'image';
    if (isDocumentFile(path)) return 'document';
    if (isCodeFile(path)) return 'code';
    return null;
};

const parseImageGenPath = (resultData: unknown): string | null => {
    try {
        if (!resultData) return null;
        let jsonStr: string | null = null;
        if (typeof resultData === 'string') {
            jsonStr = resultData;
        } else if (Array.isArray(resultData) && resultData.length > 0) {
            const firstBlock = resultData[0] as { type?: string; text?: string };
            if (firstBlock?.type === 'text' && typeof firstBlock.text === 'string') {
                jsonStr = firstBlock.text;
            }
        }
        if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            if (parsed?.file_path && typeof parsed.file_path === 'string') {
                return parsed.file_path;
            }
        }
    } catch {
        // ignore parse errors
    }
    return null;
};

export const collectFileOperations = (options: {
    blocks?: MessageBlock[];
    workspaceRoot?: string | null;
}): FileOperation[] => {
    const { blocks, workspaceRoot } = options;

    const writeEditOperations: FileOperation[] = [];
    const seenWriteEdit = new Set<string>();
    for (const block of blocks || []) {
        if (block.type !== 'tool_use') continue;
        const content = asRecord(block.content);
        const name = content.name;
        if (name !== 'Write' && name !== 'Edit') continue;
        if (block.status === 'error') continue;
        const input = asRecord(content.input);
        const pathValue = input.file_path;
        const path = typeof pathValue === 'string' ? pathValue : undefined;
        if (!path) continue;
        const normalized = normalizePath(path);
        if (seenWriteEdit.has(normalized)) continue;
        seenWriteEdit.add(normalized);
        writeEditOperations.push({ type: name, path });
    }

    const imageGenOperations: FileOperation[] = [];
    for (const block of blocks || []) {
        if (block.type !== 'tool_use') continue;
        const content = asRecord(block.content);
        const name = content.name;
        if (name !== 'mcp__imagegen__generate_image') continue;
        if (block.status === 'error') continue;
        const path = parseImageGenPath(content.result);
        if (!path) continue;
        imageGenOperations.push({ type: 'ImageGen', path });
    }

    const textChunks: string[] = [];
    for (const block of blocks || []) {
        if (block.type !== 'text') continue;
        if (typeof block.content !== 'string') continue;
        if (!block.content.trim()) continue;
        textChunks.push(block.content);
    }

    const writeEditPathSet = new Set(writeEditOperations.map(op => normalizePath(op.path)));
    const combinedText = textChunks.join('\n');
    const inferredPaths = workspaceRoot
        ? extractWorkspaceFilePaths(combinedText, workspaceRoot).filter(path => !writeEditPathSet.has(normalizePath(path)))
        : [];
    const inferredOperations: FileOperation[] = inferredPaths.map(path => ({ type: 'Reference', path }));

    return [...writeEditOperations, ...imageGenOperations, ...inferredOperations];
};
