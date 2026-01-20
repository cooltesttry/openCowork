'use client';

import dynamic from 'next/dynamic';

// Dynamically import xterm to avoid SSR issues
const TerminalComponent = dynamic(
    () => import('./terminal-component'),
    {
        ssr: false,
        loading: () => (
            <div className="h-full w-full bg-[#09090b] flex items-center justify-center text-zinc-500">
                Loading Terminal...
            </div>
        )
    }
);

export function TerminalPanel() {
    return <TerminalComponent />;
}
