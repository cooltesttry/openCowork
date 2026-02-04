'use client';

import dynamic from 'next/dynamic';
import { useWorkspace } from '@/lib/workspace-store';

// Dynamically import to avoid SSR issues with fabric.js
const ImageEditor = dynamic(
  () => import('@/components/image-editor').then(mod => mod.ImageEditor),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
        <div className="text-sm text-zinc-500">Loading Image Editor...</div>
      </div>
    ),
  }
);

interface ImageEditorPanelProps {
  params: {
    initialImage?: string;
    addImage?: string;
    openInAITool?: boolean;
    onSave?: (dataUrl: string, filename: string) => Promise<void>;
    onHasContentChange?: (hasContent: boolean) => void;
    onExportRequest?: (exporter: () => string | null) => void;
    autoFitToken?: number;
    modeToggle?: React.ReactNode;
    onReferenceBarToggle?: (expanded: boolean) => void;
  };
}

export function ImageEditorPanel({ params }: ImageEditorPanelProps) {
  const { currentWorkspace } = useWorkspace();

  return (
    <div className="h-full w-full">
      <ImageEditor
        initialImage={params?.initialImage}
        addImagePath={params?.addImage}
        openInAITool={params?.openInAITool}
        onSave={params?.onSave}
        onHasContentChange={params?.onHasContentChange}
        onExportRequest={params?.onExportRequest}
        autoFitToken={params?.autoFitToken}
        modeToggle={params?.modeToggle}
        workspacePath={currentWorkspace?.path}
        onReferenceBarToggle={params?.onReferenceBarToggle}
      />
    </div>
  );
}
