'use client';

export function PreviewPanel() {
    return (
        <div className="h-full w-full bg-zinc-50 flex items-center justify-center text-zinc-600">
            <div className="text-center">
                <p className="text-lg font-semibold mb-2">Preview Panel</p>
                <p className="text-sm">Select a file to preview</p>
            </div>
        </div>
    );
}
