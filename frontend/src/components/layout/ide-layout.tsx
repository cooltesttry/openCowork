'use client';

import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { useRef } from 'react';
import { TerminalPanel } from '@/components/panels/terminal-panel';
import { EditorPanel } from '@/components/panels/editor-panel';
import { PreviewPanel } from '@/components/panels/preview-panel';
import { WebContainerPanel } from '@/components/panels/webcontainer-panel';

// Map component string names to actual React components
const components = {
    terminal: TerminalPanel,
    editor: EditorPanel,
    preview: PreviewPanel,
    webcontainer: WebContainerPanel,
};

interface IDELayoutProps {
    initialLayout?: unknown;
}

export function IDELayout({ initialLayout }: IDELayoutProps) {
    const apiRef = useRef<DockviewApi | null>(null);

    const onReady = (event: DockviewReadyEvent) => {
        apiRef.current = event.api;
        const api = event.api;

        // 4-column vertical layout
        if (!initialLayout) {
            // Column 1: Files (no header)
            const col1 = api.addPanel({
                id: 'col1-files',
                component: 'preview',
                title: 'Files',
            });

            // Column 2: Editor (with header for tabs)
            const col2 = api.addPanel({
                id: 'col2-editor',
                component: 'editor',
                title: 'App.tsx',
                position: { referencePanel: 'col1-files', direction: 'right' }
            });

            // Column 3: Preview (no header)
            const col3 = api.addPanel({
                id: 'col3-preview',
                component: 'preview',
                title: 'Preview',
                position: { referencePanel: 'col2-editor', direction: 'right' }
            });

            // Column 4: Terminal (no header)
            const col4 = api.addPanel({
                id: 'col4-terminal',
                component: 'terminal',
                title: 'Terminal',
                position: { referencePanel: 'col3-preview', direction: 'right' }
            });

            // Hide headers for columns 1, 3, 4 using official API
            if (col1?.group?.header) {
                col1.group.header.hidden = true;
            }
            if (col3?.group?.header) {
                col3.group.header.hidden = true;
            }
            if (col4?.group?.header) {
                col4.group.header.hidden = true;
            }
        }
    };

    return (
        <div className="h-full w-full dockview-theme-light relative">
            <style jsx global>{`
        .dockview-theme-light {
          --dockview-background: #ffffff;
          --dockview-drag-proxy-background: rgba(0, 0, 0, 0.1);
          --dockview-tab-active-background: #ffffff;
          --dockview-tab-inactive-background: #f4f4f5;
          --dockview-tab-hover-background: #e4e4e7;
          --dockview-border: #e4e4e7;
          --dockview-active-outline: #3b82f6;
          --dockview-tab-divider-color: #d4d4d8;
        }
      `}</style>
            <DockviewReact
                components={components}
                onReady={onReady}
                className="h-full w-full"
            />
        </div>
    );
}
