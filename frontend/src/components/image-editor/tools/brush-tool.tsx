'use client';

/* eslint-disable react-hooks/immutability */

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
    const currentCanvas = canvas;

    if (isActive) {
      currentCanvas.isDrawingMode = true;

      // Configure the brush
      if (currentCanvas.freeDrawingBrush) {
        currentCanvas.freeDrawingBrush.color = color;
        currentCanvas.freeDrawingBrush.width = width;
      }
    } else {
      currentCanvas.isDrawingMode = false;
    }

    return () => {
      currentCanvas.isDrawingMode = false;
    };
  }, [canvas, isActive, color, width]);

  useEffect(() => {
    if (!canvas || !isActive || !canvas.freeDrawingBrush) return;

    const brush = canvas.freeDrawingBrush;
    brush.color = color;
  }, [canvas, isActive, color]);

  useEffect(() => {
    if (!canvas || !isActive || !canvas.freeDrawingBrush) return;

    const brush = canvas.freeDrawingBrush;
    brush.width = width;
  }, [canvas, isActive, width]);
}
