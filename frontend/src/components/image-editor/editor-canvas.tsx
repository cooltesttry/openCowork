'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { Upload, ImageIcon } from 'lucide-react';
import type { EditorTool } from './types';

interface EditorCanvasProps {
  onCanvasReady: (canvas: FabricCanvas) => void;
  onDrop?: (files: FileList) => void;
  onContainerResize?: (width: number, height: number) => void;
  hasContent: boolean;
  tool?: EditorTool;
  canvasWidth?: number;
  canvasHeight?: number;
  zoom?: number;
  aspectLocked?: boolean;
  onCanvasResize?: (width: number, height: number, skipAutoZoom?: boolean) => void;
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

interface ResizeState {
  corner: ResizeCorner;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

export function EditorCanvas({
  onCanvasReady,
  onDrop,
  onContainerResize,
  hasContent,
  tool = 'select',
  canvasWidth = 800,
  canvasHeight = 600,
  zoom = 1,
  aspectLocked = false,
  onCanvasResize,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const initializedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const dragCounterRef = useRef(0);
  const onContainerResizeRef = useRef(onContainerResize);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const onCanvasResizeRef = useRef(onCanvasResize);

  // Keep refs in sync with props
  useEffect(() => {
    onCanvasResizeRef.current = onCanvasResize;
  }, [onCanvasResize]);

  // Keep ref in sync with prop
  useEffect(() => {
    onContainerResizeRef.current = onContainerResize;
  }, [onContainerResize]);

  // Initialize Fabric canvas
  useEffect(() => {
    // Prevent double initialization (React StrictMode)
    if (!canvasRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const initCanvas = async () => {
      const { Canvas } = await import('fabric');

      const container = containerRef.current;
      if (!container || !canvasRef.current) return;

      // Check if canvas element already has a fabric instance
      const canvasEl = canvasRef.current;
      if ((canvasEl as any).__canvas) {
        // Canvas already initialized, just use existing
        fabricRef.current = (canvasEl as any).__canvas;
        onCanvasReady(fabricRef.current!);
        setIsLoading(false);
        return;
      }

      const rect = container.getBoundingClientRect();
      const canvas = new Canvas(canvasEl, {
        width: rect.width || 800,
        height: rect.height || 600,
        backgroundColor: '#f5f5f5',
        selection: true,
      });

      // Initialize PencilBrush for drawing mode (required in Fabric.js v6+)
      const { PencilBrush } = await import('fabric');
      const brush = new PencilBrush(canvas);
      brush.color = '#FF6B35';
      brush.width = 5;
      canvas.freeDrawingBrush = brush;

      // Store reference on the element to detect re-initialization
      (canvasEl as any).__canvas = canvas;
      fabricRef.current = canvas;
      onCanvasReady(canvas);
      setIsLoading(false);
    };

    initCanvas();

    return () => {
      if (fabricRef.current) {
        const canvasEl = canvasRef.current;
        if (canvasEl) {
          delete (canvasEl as any).__canvas;
        }
        fabricRef.current.dispose();
        fabricRef.current = null;
        initializedRef.current = false;
      }
    };
  }, [onCanvasReady]);

  // Set initial canvas size based on container (only once when canvas is ready)
  // The canvas maintains its own size and is centered; it doesn't follow container resize
  useEffect(() => {
    const container = containerRef.current;
    const canvas = fabricRef.current;
    if (!container || !canvas) return;

    // Only set initial size if not already sized properly
    if (!canvas.width || !canvas.height || canvas.width < 100 || canvas.height < 100) {
      const rect = container.getBoundingClientRect();
      const width = Math.max(rect.width * 0.9, 400);
      const height = Math.max(rect.height * 0.9, 300);
      canvas.setDimensions({ width, height });
      canvas.renderAll();
    }
  }, []);

  // Report container size changes to parent for auto-fit zoom calculation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reportSize = () => {
      const rect = container.getBoundingClientRect();
      onContainerResizeRef.current?.(rect.width, rect.height);
    };

    // Report initial size
    reportSize();

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      reportSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (e.dataTransfer.files.length > 0 && onDrop) {
      onDrop(e.dataTransfer.files);
    }
  }, [onDrop]);

  // File input handler
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onDrop) {
      onDrop(e.target.files);
      e.target.value = ''; // Reset input
    }
  }, [onDrop]);

  // Canvas resize handlers (for crop tool)
  const handleResizeStart = useCallback((e: React.MouseEvent, corner: ResizeCorner) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({
      corner,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: canvasWidth,
      startHeight: canvasHeight,
    });
  }, [canvasWidth, canvasHeight]);

  // Handle mouse move during resize
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizing.startX;
      const deltaY = e.clientY - resizing.startY;

      let newWidth = resizing.startWidth;
      let newHeight = resizing.startHeight;

      // Calculate new size based on which corner is being dragged
      if (resizing.corner === 'se') {
        newWidth = resizing.startWidth + deltaX / zoom;
        newHeight = resizing.startHeight + deltaY / zoom;
      } else if (resizing.corner === 'sw') {
        newWidth = resizing.startWidth - deltaX / zoom;
        newHeight = resizing.startHeight + deltaY / zoom;
      } else if (resizing.corner === 'ne') {
        newWidth = resizing.startWidth + deltaX / zoom;
        newHeight = resizing.startHeight - deltaY / zoom;
      } else if (resizing.corner === 'nw') {
        newWidth = resizing.startWidth - deltaX / zoom;
        newHeight = resizing.startHeight - deltaY / zoom;
      }

      // If aspect ratio is locked, maintain the ratio
      if (aspectLocked) {
        const ratio = resizing.startWidth / resizing.startHeight;
        // Use the dimension with the larger change
        if (Math.abs(deltaX / zoom) > Math.abs(deltaY / zoom)) {
          newHeight = newWidth / ratio;
        } else {
          newWidth = newHeight * ratio;
        }
      }

      // Clamp to valid range [100, 4096]
      newWidth = Math.max(100, Math.min(4096, Math.round(newWidth)));
      newHeight = Math.max(100, Math.min(4096, Math.round(newHeight)));

      // During drag, skip auto-zoom to keep the current zoom level
      onCanvasResizeRef.current?.(newWidth, newHeight, true);
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, zoom, aspectLocked]);

  // Render resize handles for crop tool
  const renderResizeHandles = () => {
    if (tool !== 'crop') return null;

    const displayWidth = canvasWidth * zoom;
    const displayHeight = canvasHeight * zoom;
    const handleSize = 10;
    const offset = -handleSize / 2 - 4; // Position slightly outside the canvas

    const corners: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

    return corners.map((corner) => {
      const style: React.CSSProperties = {
        position: 'absolute',
        width: handleSize,
        height: handleSize,
        backgroundColor: 'white',
        border: '2px solid #3b82f6',
        borderRadius: 2,
        cursor: `${corner}-resize`,
        zIndex: 10,
      };

      // Position based on corner
      if (corner === 'nw') {
        style.left = offset;
        style.top = offset;
      } else if (corner === 'ne') {
        style.left = displayWidth - handleSize / 2 + 4;
        style.top = offset;
      } else if (corner === 'sw') {
        style.left = offset;
        style.top = displayHeight - handleSize / 2 + 4;
      } else {
        style.left = displayWidth - handleSize / 2 + 4;
        style.top = displayHeight - handleSize / 2 + 4;
      }

      return (
        <div
          key={corner}
          style={style}
          onMouseDown={(e) => handleResizeStart(e, corner)}
        />
      );
    });
  };

  return (
    <div
      ref={containerRef}
      className={`flex-1 relative overflow-auto flex items-center justify-center bg-zinc-200 dark:bg-zinc-900 ${
        isDragging ? 'ring-2 ring-blue-500 ring-inset' : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Canvas wrapper for centering */}
      <div className="relative shadow-lg">
        <canvas ref={canvasRef} />
        {/* Resize handles for crop tool */}
        {renderResizeHandles()}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
          <div className="text-sm text-zinc-500">Loading editor...</div>
        </div>
      )}

      {/* Empty state overlay */}
      {!isLoading && !hasContent && !isDragging && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center p-8 pointer-events-auto">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-500 mb-4">
              Drag and drop images here, or paste from clipboard
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md cursor-pointer hover:bg-blue-600 transition-colors">
              <Upload className="w-4 h-4" />
              <span>Upload Image</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </label>
          </div>
        </div>
      )}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center">
          <div className="text-center p-8 bg-white dark:bg-zinc-800 rounded-lg shadow-lg">
            <Upload className="w-12 h-12 mx-auto mb-3 text-blue-500" />
            <p className="text-sm font-medium">Drop images here</p>
          </div>
        </div>
      )}
    </div>
  );
}
