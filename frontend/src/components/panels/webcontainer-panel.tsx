'use client';

export function WebContainerPanel() {
    return (
        <div className="h-full w-full bg-purple-50 dark:bg-zinc-900 flex items-center justify-center text-purple-600 dark:text-purple-400">
            <div className="text-center">
                <p className="text-lg font-semibold mb-2">WebContainer</p>
                <p className="text-sm">Browser Runtime Environment</p>
            </div>
        </div>
    );
}
