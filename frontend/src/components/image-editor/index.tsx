'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { Toolbar } from './toolbar';
import { EditorCanvas } from './editor-canvas';
import { useEditor } from './use-editor';
import { useFilterTool } from './tools';
import { FilePickerDialog } from '@/components/ui/file-picker';
import type { ImageEditorProps } from './types';
import { getClosestAspectRatio } from './types';
import { optimizeImageForReference } from './image-utils';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { writeBase64File, generateImage } from '@/lib/api';
import { toast } from 'sonner';

function getAspectPrompt(ratio: string): string {
  const prompts: Record<string, string> = {
    '1:1': 'square format',
    '4:3': '4:3 landscape format',
    '3:4': '3:4 portrait format',
    '16:9': '16:9 widescreen format',
    '9:16': '9:16 vertical portrait format',
  };
  return prompts[ratio] || 'square format';
}

export function ImageEditor({ initialImage, addImagePath, openInAITool, onSave, onHasContentChange, workspacePath, onReferenceBarToggle }: ImageEditorProps) {
  const [canvas, setCanvas] = useState<FabricCanvas | null>(null);
  const { state, actions } = useEditor(canvas);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const initialImageLoadedRef = useRef(false);
  const addImagePathRef = useRef<string | null>(null);

  // Apply filter tool
  useFilterTool({
    canvas,
    isActive: state.tool === 'filter',
    filter: state.filter,
    brightness: state.brightness,
    contrast: state.contrast,
    saturation: state.saturation,
  });

  // Notify parent of content changes
  useEffect(() => {
    onHasContentChange?.(state.hasContent);
  }, [state.hasContent, onHasContentChange]);

  // Handle initial image load - initialization mode
  useEffect(() => {
    if (canvas && initialImage && !initialImageLoadedRef.current) {
      initialImageLoadedRef.current = true;
      // Convert file path to URL if needed
      const imageUrl = initialImage.startsWith('http') || initialImage.startsWith('data:')
        ? initialImage
        : `http://localhost:8000/api/files/raw?path=${encodeURIComponent(initialImage)}`;
      actions.loadImageAsCanvas(imageUrl);  // Use initialization mode
      actions.setTool('ai');  // Auto-select AI tool
    }
  }, [canvas, initialImage, actions]);

  // Handle adding image from file explorer
  useEffect(() => {
    if (canvas && addImagePath && addImagePath !== addImagePathRef.current) {
      addImagePathRef.current = addImagePath;
      const imageUrl = addImagePath.startsWith('http') || addImagePath.startsWith('data:')
        ? addImagePath
        : `http://localhost:8000/api/files/raw?path=${encodeURIComponent(addImagePath)}`;

      // Check if in reference selection mode
      if (state.isSelectingReference) {
        // Load image and add as reference (not to canvas)
        loadImageAsDataUrl(imageUrl).then(async dataUrl => {
          if (dataUrl) {
            const optimized = await optimizeImageForReference(dataUrl);
            actions.addReferenceImage(optimized);
          }
        });
      } else if (state.hasContent) {
        // Normal mode + has content: add as layer
        actions.addImage(imageUrl);
      } else {
        // Normal mode + no content: initialization mode
        actions.loadImageAsCanvas(imageUrl);
        actions.setTool('ai');
      }

      if (openInAITool) {
        actions.setTool('ai');
      }
    }
  }, [canvas, addImagePath, openInAITool, actions, state.hasContent, state.isSelectingReference]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Cmd/Ctrl + Z: Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
        return;
      }

      // Cmd/Ctrl + Shift + Z: Redo
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        actions.redo();
        return;
      }

      // Cmd/Ctrl + S: Save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (state.hasContent) {
          setShowSaveDialog(true);
        }
        return;
      }

      // Delete/Backspace: Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          actions.deleteSelected();
        }
        return;
      }

      // Escape: Cancel/deselect
      if (e.key === 'Escape') {
        if (state.isCropping) {
          actions.cancelCrop();
        } else {
          actions.setTool('select');
          canvas?.discardActiveObject();
          canvas?.renderAll();
        }
        return;
      }

      // Tool shortcuts (only when no modifier)
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
            actions.setTool('select');
            break;
          case 'c':
            actions.setTool('crop');
            break;
          case 'b':
            actions.setTool('brush');
            break;
          case 't':
            actions.setTool('text');
            break;
          case '[':
            actions.setBrushWidth(Math.max(1, state.brushWidth - 2));
            break;
          case ']':
            actions.setBrushWidth(Math.min(50, state.brushWidth + 2));
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvas, state, actions]);

  // Handle paste
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            await actions.addImageFromFile(file);
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [actions]);

  // Helper function to load an image URL as a data URL
  const loadImageAsDataUrl = useCallback(async (url: string): Promise<string | null> => {
    try {
      // For backend /api/files/raw URLs, use read-base64 endpoint
      if (url.includes('/api/files/raw')) {
        const urlObj = new URL(url, window.location.origin);
        const path = urlObj.searchParams.get('path');
        if (path) {
          const response = await fetch(`http://localhost:8000/api/files/read-base64?path=${encodeURIComponent(path)}`);
          if (!response.ok) return null;
          const data = await response.json();
          return data.data_url;
        }
      }
      // Already a data URL
      if (url.startsWith('data:')) {
        return url;
      }
      // For other URLs, fetch and convert to data URL
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Failed to load image as data URL:', error);
      return null;
    }
  }, []);

  // Handle adding reference from clipboard
  const handleAddReferenceFromClipboard = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageTypes = item.types.filter(t => t.startsWith('image/'));
        if (imageTypes.length > 0) {
          const blob = await item.getType(imageTypes[0]);
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            const optimized = await optimizeImageForReference(dataUrl);
            actions.addReferenceImage(optimized);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      toast.error('No image found in clipboard');
    } catch (error) {
      toast.error('Failed to read clipboard');
    }
  }, [actions]);

  // Handle adding reference from file input
  const handleAddReferenceFromFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          const optimized = await optimizeImageForReference(dataUrl);
          actions.addReferenceImage(optimized);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [actions]);

  const handleCanvasReady = useCallback((fabricCanvas: FabricCanvas) => {
    setCanvas(fabricCanvas);
  }, []);

  const handleContainerResize = useCallback((width: number, height: number) => {
    actions.setContainerSize(width, height);
  }, [actions]);

  const handleDrop = useCallback(async (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        await actions.addImageFromFile(file);
      }
    }
  }, [actions]);

  const handleSave = useCallback(() => {
    setShowSaveDialog(true);
  }, []);

  // Handle AI image generation
  const handleGenerateAI = useCallback(async (prompt: string) => {
    if (isGenerating) return;

    setIsGenerating(true);
    try {
      // Build final prompt with aspect ratio hint
      // Prefer user's manual selection over auto-detected ratio
      const effectiveRatio = state.overrideAspectRatio
        ? { ratio: state.overrideAspectRatio, prompt: getAspectPrompt(state.overrideAspectRatio) }
        : getClosestAspectRatio(state.canvasWidth, state.canvasHeight);
      const finalPrompt = `Generate an image in ${effectiveRatio.prompt}. ${prompt}`;

      // Collect all reference images
      const referenceImages: string[] = [];

      // Canvas content as first reference (if has content)
      if (state.hasContent) {
        const canvasRef = actions.exportForAI();
        if (canvasRef) {
          // Optimize canvas export to ensure size limit
          const optimizedCanvas = await optimizeImageForReference(canvasRef);
          referenceImages.push(optimizedCanvas);
        }
      }

      // Additional reference images (already optimized when added)
      referenceImages.push(...state.additionalReferenceImages);

      // Call the API
      const result = await generateImage({
        prompt: finalPrompt,
        reference_images: referenceImages.length > 0 ? referenceImages : undefined,
      });

      // Add the generated image to canvas (centered and covering the canvas)
      if (result.file_path) {
        const imageUrl = `http://localhost:8000/api/files/raw?path=${encodeURIComponent(result.file_path)}`;
        await actions.addAIGeneratedImage(imageUrl);
        toast.success('Image generated successfully');
      }
    } catch (error) {
      console.error('AI generation failed:', error);
      toast.error(`Failed to generate image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, state.canvasWidth, state.canvasHeight, state.hasContent, state.additionalReferenceImages, state.overrideAspectRatio, actions]);

  // Image format options for save dialog
  const imageFormatOptions = [
    { label: 'PNG', value: 'png', extension: 'png' },
    { label: 'JPG', value: 'jpeg', extension: 'jpg' },
  ];

  const handleSaveConfirm = useCallback(async (path: string, format?: string) => {
    // Determine format and quality
    const imageFormat = (format === 'jpeg' ? 'jpeg' : 'png') as 'png' | 'jpeg';
    const quality = imageFormat === 'jpeg' ? 0.92 : 1; // High quality for JPEG

    const dataUrl = actions.exportImage(imageFormat, quality);
    if (!dataUrl) {
      toast.error('No image to save');
      return;
    }

    if (onSave) {
      await onSave(dataUrl, path);
    } else {
      // Default save via API
      try {
        const base64 = dataUrl.split(',')[1];
        await writeBase64File(path, base64);
        toast.success('Image saved successfully');
      } catch (error) {
        console.error('Failed to save:', error);
        toast.error('Failed to save image');
      }
    }

    setShowSaveDialog(false);
  }, [actions, onSave]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-900">
      {/* Toolbar */}
      <Toolbar
        state={state}
        actions={actions}
        onSave={handleSave}
        onGenerateAI={handleGenerateAI}
        isGenerating={isGenerating}
        onAddReferenceFromClipboard={handleAddReferenceFromClipboard}
        onAddReferenceFromFile={handleAddReferenceFromFile}
        onReferenceBarToggle={onReferenceBarToggle}
      />

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <EditorCanvas
          onCanvasReady={handleCanvasReady}
          onDrop={handleDrop}
          onContainerResize={handleContainerResize}
          hasContent={state.hasContent}
          tool={state.tool}
          canvasWidth={state.canvasWidth}
          canvasHeight={state.canvasHeight}
          zoom={state.zoom}
          aspectLocked={state.aspectLocked}
          onCanvasResize={actions.applyCanvasSize}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span>
            Size: {Math.round(state.canvasWidth)} × {Math.round(state.canvasHeight)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => actions.setZoom(Math.max(0.1, state.zoom - 0.1))}
            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
            disabled={state.zoom <= 0.1}
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="w-12 text-center">{Math.round(state.zoom * 100)}%</span>
          <button
            onClick={() => actions.setZoom(Math.min(3, state.zoom + 0.1))}
            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
            disabled={state.zoom >= 3}
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Save dialog */}
      <FilePickerDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        mode="create"
        type="file"
        title="Save Image"
        onSelect={handleSaveConfirm}
        formatOptions={imageFormatOptions}
        defaultFormat="png"
        customShortcut={workspacePath ? { name: 'Workspace', path: workspacePath, icon: 'folder' } : undefined}
      />
    </div>
  );
}

export default ImageEditor;
