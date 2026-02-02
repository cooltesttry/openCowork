'use client';

import { useEffect } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';

interface UseBrushToolOptions {
  canvas: FabricCanvas | null;
  isActive: boolean;
  color: string;
  width: number;
}

export function useBrushTool({ canvas, isActive, color, width }: UseBrushToolOptions) {
  useEffect(() => {
    if (!canvas) return;

    if (isActive) {
      canvas.isDrawingMode = true;

      // Configure the brush
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = width;
      }
    } else {
      canvas.isDrawingMode = false;
    }

    return () => {
      if (canvas) {
        canvas.isDrawingMode = false;
      }
    };
  }, [canvas, isActive, color, width]);

  useEffect(() => {
    if (!canvas || !isActive || !canvas.freeDrawingBrush) return;

    canvas.freeDrawingBrush.color = color;
  }, [canvas, isActive, color]);

  useEffect(() => {
    if (!canvas || !isActive || !canvas.freeDrawingBrush) return;

    canvas.freeDrawingBrush.width = width;
  }, [canvas, isActive, width]);
}
