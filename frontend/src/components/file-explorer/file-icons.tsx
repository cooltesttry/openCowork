"use client";

import React from "react";
import {
    File,
    FileCode,
    FileJson,
    FileText,
    FileImage,
    FileVideo,
    FileAudio,
    FileArchive,
    FileSpreadsheet,
    FileType,
    FileCog,
    FileTerminal,
    Database,
    FileKey,
    FileCheck,
    Globe,
    Palette,
    Box,
    Braces,
    Hash,
    Gem,
    Coffee,
    Leaf,
    Hexagon,
    CircleDot,
    Binary,
    BookOpen,
    Layers,
    Settings,
    Lock,
    Shield,
    FileWarning,
} from "lucide-react";

interface FileIconProps {
    filename: string;
    size?: number;
    className?: string;
}

// Map file extensions to icons and colors
const FILE_ICON_MAP: Record<string, { icon: React.ElementType; color: string }> = {
    // JavaScript / TypeScript
    js: { icon: Braces, color: "text-yellow-500" },
    jsx: { icon: Braces, color: "text-yellow-400" },
    ts: { icon: Braces, color: "text-blue-500" },
    tsx: { icon: Braces, color: "text-blue-400" },
    mjs: { icon: Braces, color: "text-yellow-500" },
    cjs: { icon: Braces, color: "text-yellow-600" },

    // Web
    html: { icon: Globe, color: "text-orange-500" },
    htm: { icon: Globe, color: "text-orange-500" },
    css: { icon: Palette, color: "text-blue-400" },
    scss: { icon: Palette, color: "text-pink-400" },
    sass: { icon: Palette, color: "text-pink-400" },
    less: { icon: Palette, color: "text-indigo-400" },
    vue: { icon: Leaf, color: "text-green-500" },
    svelte: { icon: Hexagon, color: "text-orange-400" },

    // Data formats
    json: { icon: FileJson, color: "text-yellow-400" },
    yaml: { icon: FileCode, color: "text-red-400" },
    yml: { icon: FileCode, color: "text-red-400" },
    xml: { icon: FileCode, color: "text-orange-400" },
    toml: { icon: FileCode, color: "text-gray-500" },
    csv: { icon: FileSpreadsheet, color: "text-green-500" },

    // Python
    py: { icon: Hash, color: "text-blue-400" },
    pyw: { icon: Hash, color: "text-blue-400" },
    pyx: { icon: Hash, color: "text-blue-500" },
    pyi: { icon: Hash, color: "text-blue-300" },
    ipynb: { icon: BookOpen, color: "text-orange-400" },

    // Ruby
    rb: { icon: Gem, color: "text-red-500" },
    erb: { icon: Gem, color: "text-red-400" },
    rake: { icon: Gem, color: "text-red-500" },

    // Java / Kotlin
    java: { icon: Coffee, color: "text-red-500" },
    kt: { icon: Hexagon, color: "text-purple-500" },
    kts: { icon: Hexagon, color: "text-purple-400" },
    jar: { icon: Box, color: "text-red-400" },

    // C / C++ / C#
    c: { icon: FileCode, color: "text-blue-500" },
    h: { icon: FileCode, color: "text-purple-400" },
    cpp: { icon: FileCode, color: "text-blue-600" },
    hpp: { icon: FileCode, color: "text-purple-500" },
    cc: { icon: FileCode, color: "text-blue-600" },
    cs: { icon: FileCode, color: "text-green-600" },

    // Go
    go: { icon: CircleDot, color: "text-cyan-500" },
    mod: { icon: FileCog, color: "text-cyan-400" },
    sum: { icon: FileCheck, color: "text-cyan-300" },

    // Rust
    rs: { icon: Settings, color: "text-orange-600" },

    // PHP
    php: { icon: FileCode, color: "text-indigo-500" },

    // Swift
    swift: { icon: FileCode, color: "text-orange-500" },

    // Shell / Scripts
    sh: { icon: FileTerminal, color: "text-green-500" },
    bash: { icon: FileTerminal, color: "text-green-500" },
    zsh: { icon: FileTerminal, color: "text-green-400" },
    fish: { icon: FileTerminal, color: "text-green-400" },
    ps1: { icon: FileTerminal, color: "text-blue-500" },
    bat: { icon: FileTerminal, color: "text-green-600" },
    cmd: { icon: FileTerminal, color: "text-green-600" },

    // Database
    sql: { icon: Database, color: "text-blue-400" },
    sqlite: { icon: Database, color: "text-blue-500" },
    db: { icon: Database, color: "text-blue-500" },

    // Markdown / Documentation
    md: { icon: BookOpen, color: "text-blue-400" },
    mdx: { icon: BookOpen, color: "text-yellow-500" },
    txt: { icon: FileText, color: "text-gray-500" },
    rst: { icon: FileText, color: "text-gray-400" },

    // Config files
    env: { icon: Lock, color: "text-yellow-500" },
    ini: { icon: FileCog, color: "text-gray-500" },
    cfg: { icon: FileCog, color: "text-gray-500" },
    conf: { icon: FileCog, color: "text-gray-500" },
    config: { icon: FileCog, color: "text-gray-500" },

    // Images
    png: { icon: FileImage, color: "text-purple-400" },
    jpg: { icon: FileImage, color: "text-purple-400" },
    jpeg: { icon: FileImage, color: "text-purple-400" },
    gif: { icon: FileImage, color: "text-purple-400" },
    svg: { icon: FileImage, color: "text-orange-400" },
    webp: { icon: FileImage, color: "text-purple-400" },
    ico: { icon: FileImage, color: "text-purple-400" },
    bmp: { icon: FileImage, color: "text-purple-400" },

    // Video
    mp4: { icon: FileVideo, color: "text-pink-500" },
    webm: { icon: FileVideo, color: "text-pink-500" },
    mov: { icon: FileVideo, color: "text-pink-500" },
    avi: { icon: FileVideo, color: "text-pink-500" },
    mkv: { icon: FileVideo, color: "text-pink-500" },

    // Audio
    mp3: { icon: FileAudio, color: "text-pink-400" },
    wav: { icon: FileAudio, color: "text-pink-400" },
    ogg: { icon: FileAudio, color: "text-pink-400" },
    flac: { icon: FileAudio, color: "text-pink-400" },
    m4a: { icon: FileAudio, color: "text-pink-400" },

    // Archives
    zip: { icon: FileArchive, color: "text-yellow-600" },
    tar: { icon: FileArchive, color: "text-yellow-600" },
    gz: { icon: FileArchive, color: "text-yellow-600" },
    rar: { icon: FileArchive, color: "text-yellow-600" },
    "7z": { icon: FileArchive, color: "text-yellow-600" },
    bz2: { icon: FileArchive, color: "text-yellow-600" },

    // Fonts
    ttf: { icon: FileType, color: "text-red-400" },
    otf: { icon: FileType, color: "text-red-400" },
    woff: { icon: FileType, color: "text-red-400" },
    woff2: { icon: FileType, color: "text-red-400" },
    eot: { icon: FileType, color: "text-red-400" },

    // Documents
    pdf: { icon: FileText, color: "text-red-500" },
    doc: { icon: FileText, color: "text-blue-600" },
    docx: { icon: FileText, color: "text-blue-600" },
    xls: { icon: FileSpreadsheet, color: "text-green-600" },
    xlsx: { icon: FileSpreadsheet, color: "text-green-600" },
    ppt: { icon: Layers, color: "text-orange-500" },
    pptx: { icon: Layers, color: "text-orange-500" },

    // Security
    pem: { icon: FileKey, color: "text-yellow-500" },
    key: { icon: FileKey, color: "text-yellow-500" },
    crt: { icon: Shield, color: "text-green-500" },
    cer: { icon: Shield, color: "text-green-500" },

    // Binary
    exe: { icon: Binary, color: "text-gray-500" },
    dll: { icon: Binary, color: "text-gray-500" },
    so: { icon: Binary, color: "text-gray-500" },
    dylib: { icon: Binary, color: "text-gray-500" },
    bin: { icon: Binary, color: "text-gray-500" },

    // Logs
    log: { icon: FileWarning, color: "text-yellow-400" },
};

// Special filename mappings (exact match)
const SPECIAL_FILES: Record<string, { icon: React.ElementType; color: string }> = {
    // Git
    ".gitignore": { icon: FileCog, color: "text-orange-400" },
    ".gitattributes": { icon: FileCog, color: "text-orange-400" },
    ".gitmodules": { icon: FileCog, color: "text-orange-400" },

    // Package managers
    "package.json": { icon: Box, color: "text-green-500" },
    "package-lock.json": { icon: Lock, color: "text-yellow-500" },
    "yarn.lock": { icon: Lock, color: "text-blue-400" },
    "pnpm-lock.yaml": { icon: Lock, color: "text-orange-400" },
    "bun.lockb": { icon: Lock, color: "text-pink-400" },

    // TypeScript
    "tsconfig.json": { icon: Braces, color: "text-blue-500" },
    "jsconfig.json": { icon: Braces, color: "text-yellow-500" },

    // Build tools
    "webpack.config.js": { icon: Box, color: "text-blue-400" },
    "vite.config.ts": { icon: Hexagon, color: "text-purple-500" },
    "vite.config.js": { icon: Hexagon, color: "text-purple-500" },
    "rollup.config.js": { icon: Box, color: "text-red-400" },
    "next.config.js": { icon: CircleDot, color: "text-white" },
    "next.config.mjs": { icon: CircleDot, color: "text-white" },
    "next.config.ts": { icon: CircleDot, color: "text-white" },

    // Linting / Formatting
    ".eslintrc": { icon: FileCheck, color: "text-purple-500" },
    ".eslintrc.js": { icon: FileCheck, color: "text-purple-500" },
    ".eslintrc.json": { icon: FileCheck, color: "text-purple-500" },
    ".eslintrc.cjs": { icon: FileCheck, color: "text-purple-500" },
    "eslint.config.js": { icon: FileCheck, color: "text-purple-500" },
    "eslint.config.mjs": { icon: FileCheck, color: "text-purple-500" },
    ".prettierrc": { icon: Palette, color: "text-pink-400" },
    ".prettierrc.json": { icon: Palette, color: "text-pink-400" },
    "prettier.config.js": { icon: Palette, color: "text-pink-400" },

    // Docker
    "Dockerfile": { icon: Box, color: "text-blue-500" },
    "docker-compose.yml": { icon: Layers, color: "text-blue-400" },
    "docker-compose.yaml": { icon: Layers, color: "text-blue-400" },
    ".dockerignore": { icon: FileCog, color: "text-blue-400" },

    // CI/CD
    ".travis.yml": { icon: Settings, color: "text-red-400" },

    // Environment
    ".env": { icon: Lock, color: "text-yellow-500" },
    ".env.local": { icon: Lock, color: "text-yellow-500" },
    ".env.development": { icon: Lock, color: "text-yellow-500" },
    ".env.production": { icon: Lock, color: "text-yellow-500" },
    ".env.example": { icon: FileKey, color: "text-yellow-400" },

    // Python
    "requirements.txt": { icon: FileText, color: "text-blue-400" },
    "Pipfile": { icon: Hash, color: "text-blue-500" },
    "Pipfile.lock": { icon: Lock, color: "text-blue-400" },
    "pyproject.toml": { icon: Hash, color: "text-blue-500" },
    "setup.py": { icon: Hash, color: "text-blue-400" },

    // License / README
    "LICENSE": { icon: Shield, color: "text-yellow-500" },
    "LICENSE.md": { icon: Shield, color: "text-yellow-500" },
    "LICENSE.txt": { icon: Shield, color: "text-yellow-500" },
    "README.md": { icon: BookOpen, color: "text-blue-400" },
    "README": { icon: BookOpen, color: "text-blue-400" },
    "CHANGELOG.md": { icon: FileText, color: "text-green-400" },
    "CONTRIBUTING.md": { icon: FileText, color: "text-purple-400" },

    // Makefile
    "Makefile": { icon: FileCog, color: "text-orange-500" },
    "makefile": { icon: FileCog, color: "text-orange-500" },

    // EditorConfig
    ".editorconfig": { icon: FileCog, color: "text-gray-400" },

    // NPM
    ".npmrc": { icon: FileCog, color: "text-red-500" },
    ".npmignore": { icon: FileCog, color: "text-red-400" },
};

/**
 * Get the appropriate icon and color for a file based on its name/extension
 */
export function getFileIconInfo(filename: string): { icon: React.ElementType; color: string } {
    // Check special files first (exact match)
    const lowerFilename = filename.toLowerCase();

    // Check special files (case-insensitive for some, case-sensitive for others)
    if (SPECIAL_FILES[filename]) {
        return SPECIAL_FILES[filename];
    }
    if (SPECIAL_FILES[lowerFilename]) {
        return SPECIAL_FILES[lowerFilename];
    }

    // Get extension
    const lastDot = filename.lastIndexOf(".");
    if (lastDot > 0) {
        const ext = filename.slice(lastDot + 1).toLowerCase();
        if (FILE_ICON_MAP[ext]) {
            return FILE_ICON_MAP[ext];
        }
    }

    // Default file icon
    return { icon: File, color: "text-zinc-500 dark:text-zinc-400" };
}

/**
 * FileIcon component that renders the appropriate icon for a file
 */
export function FileIcon({ filename, size = 16, className = "" }: FileIconProps) {
    const { icon: IconComponent, color } = getFileIconInfo(filename);

    return (
        <IconComponent
            size={size}
            className={`${color} ${className}`}
        />
    );
}
