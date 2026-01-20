export enum PanelType {
    TERMINAL = 'terminal',
    EDITOR = 'editor',
    PREVIEW = 'preview',
    WEBCONTAINER = 'webcontainer',
}

export interface PanelProps {
    id: string;
    title: string;
    isActive?: boolean;
}

export interface TerminalPanelProps extends PanelProps {
    sessionId?: string;
}

export interface EditorPanelProps extends PanelProps {
    file?: string;
    content?: string;
    language?: string;
    readOnly?: boolean;
}

export interface PreviewPanelProps extends PanelProps {
    url?: string;
    file?: string;
}

export interface WebContainerPanelProps extends PanelProps {
    files?: Record<string, { file: { contents: string } }>;
}
