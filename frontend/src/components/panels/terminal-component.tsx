'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';
import { useTheme } from 'next-themes';

const LIGHT_THEME = {
    background: '#ffffff',      // white
    foreground: '#18181b',      // zinc-900
    cursor: '#3b82f6',          // blue-500
    selectionBackground: 'rgba(59, 130, 246, 0.3)',
    black: '#27272a',           // zinc-800
    red: '#dc2626',             // red-600
    green: '#16a34a',           // green-600
    yellow: '#ca8a04',          // yellow-600
    blue: '#2563eb',            // blue-600
    magenta: '#c026d3',         // fuchsia-600
    cyan: '#0891b2',            // cyan-600
    white: '#71717a',           // zinc-500
    brightBlack: '#52525b',     // zinc-600
    brightRed: '#ef4444',       // red-500
    brightGreen: '#22c55e',     // green-500
    brightYellow: '#eab308',    // yellow-500
    brightBlue: '#3b82f6',      // blue-500
    brightMagenta: '#d946ef',   // fuchsia-500
    brightCyan: '#06b6d4',      // cyan-500
    brightWhite: '#3f3f46',     // zinc-700
};

const DARK_THEME = {
    background: '#09090b',      // zinc-950 (or make it match bg-background?) usually pure black or close
    foreground: '#f4f4f5',      // zinc-100
    cursor: '#3b82f6',          // blue-500
    selectionBackground: 'rgba(59, 130, 246, 0.3)',
    black: '#27272a',           // zinc-800 - but for dark theme usually these are brighter? standard xterm defaults are okayish but lets tune
    red: '#ef4444',             // red-500
    green: '#22c55e',           // green-500
    yellow: '#eab308',          // yellow-500
    blue: '#3b82f6',            // blue-500
    magenta: '#d946ef',         // fuchsia-500
    cyan: '#06b6d4',            // cyan-500
    white: '#f4f4f5',           // zinc-100
    brightBlack: '#71717a',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#e879f9',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
};

export default function TerminalComponent() {
    const terminalRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const { resolvedTheme } = useTheme();

    // Effect to update options when theme changes
    useEffect(() => {
        if (termRef.current) {
            termRef.current.options.theme = resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME;
        }
    }, [resolvedTheme]);

    useEffect(() => {
        if (!terminalRef.current) return;

        // Initialize Terminal with current theme
        const term = new Terminal({
            theme: resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
            fontSize: 14,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: 'block',
            allowTransparency: true, // Allow background to match container
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        term.open(terminalRef.current);

        // Wait a bit before fitting to ensure container is sized
        setTimeout(() => {
            fitAddon.fit();
        }, 100);

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        // Connect to WebSocket
        const sessionId = 'terminal-' + Math.random().toString(36).substring(7);
        const wsUrl = `ws://localhost:8000/ws/terminal/${sessionId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            // Resize on connect
            fitAddon.fit();
            ws.send(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
            }));
        };

        ws.onmessage = (event) => {
            term.write(event.data);
        };

        ws.onclose = () => {
            // Only write if terminal still exists
            if (termRef.current) {
                try {
                    termRef.current.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
                } catch {
                    // Ignore if terminal already disposed
                }
            }
        };

        ws.onerror = () => {
            // Suppress error logging
        };

        // Send input to server
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Handle window resizing
        const handleResize = () => {
            if (fitAddonRef.current && termRef.current) {
                fitAddonRef.current.fit();
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: 'resize',
                        cols: termRef.current.cols,
                        rows: termRef.current.rows
                    }));
                }
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (termRef.current) {
                termRef.current.dispose();
            }
        };
    }, []); // Run once on mount. Theme updates handled by other effect.

    return (
        <div
            ref={terminalRef}
            className={`h-full w-full overflow-hidden pl-2 pt-2 ${resolvedTheme === 'dark' ? 'bg-[#09090b]' : 'bg-white'}`}
        />
    );
}
