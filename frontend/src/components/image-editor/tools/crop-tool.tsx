'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Canvas as FabricCanvas, Rect, IEvent } from 'fabric';
import type { CropRatio } from '../types';

interface UseCropToolOptions {
  canvas: FabricCanvas | null;
  isActive: boolean;
  ratio: CropRatio;
  onCropStart: () => void;
  onCropEnd: () => void;
}

export function useCropTool({
  canvas,
  isActive,
  ratio,
  onCropStart,
  onCropEnd,
}: UseCropToolOptions) {
  const cropRectRef = useRef<Rect | null>(null);
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  const createCropRect = useCallback(async (left: number, top: number, width: number, height: number) => {
    if (!canvas) return null;

    const { Rect } = await import('fabric');

    // Apply ratio constraint if needed
    let finalWidth = width;
    let finalHeight = height;

    if (ratio !== 'free') {
      const [w, h] = ratio.split(':').map(Number);
      const aspectRatio = w / h;

      if (width / height > aspectRatio) {
        finalWidth = height * aspectRatio;
      } else {
        finalHeight = width / aspectRatio;
      }
    }

    const rect = new Rect({
      left,
      top,
      width: Math.abs(finalWidth),
      height: Math.abs(finalHeight),
      fill: 'transparent',
      stroke: '#0066ff',
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      selectable: true,
      hasControls: true,
      hasBorders: true,
      lockRotation: true,
      cornerColor: '#0066ff',
      cornerSize: 10,
      transparentCorners: false,
    });

    return rect;
  }, [canvas, ratio]);

  useEffect(() => {
    if (!canvas || !isActive) return;

    const handleMouseDown = async (opt: IEvent<MouseEvent>) => {
      if (cropRectRef.current) return; // Already cropping

      const pointer = opt.pointer;
      startPointRef.current = { x: pointer.x, y: pointer.y };
      isDrawingRef.current = true;

      const rect = await createCropRect(pointer.x, pointer.y, 0, 0);
      if (rect) {
        cropRectRef.current = rect;
        canvas.add(rect);
        onCropStart();
      }
    };

    const handleMouseMove = (opt: IEvent<MouseEvent>) => {
      if (!isDrawingRef.current || !cropRectRef.current || !startPointRef.current) return;

      const pointer = opt.pointer;
      const width = pointer.x - startPointRef.current.x;
      const height = pointer.y - startPointRef.current.y;

      // Apply ratio constraint
      let finalWidth = Math.abs(width);
      let finalHeight = Math.abs(height);

      if (ratio !== 'free') {
        const [w, h] = ratio.split(':').map(Number);
        const aspectRatio = w / h;

        if (finalWidth / finalHeight > aspectRatio) {
          finalWidth = finalHeight * aspectRatio;
        } else {
          finalHeight = finalWidth / aspectRatio;
        }
      }

      cropRectRef.current.set({
        left: width < 0 ? startPointRef.current.x - finalWidth : startPointRef.current.x,
        top: height < 0 ? startPointRef.current.y - finalHeight : startPointRef.current.y,
        width: finalWidth,
        height: finalHeight,
      });

      canvas.renderAll();
    };

    const handleMouseUp = () => {
      if (!isDrawingRef.current) return;

      isDrawingRef.current = false;

      if (cropRectRef.current) {
        // Make the crop rect selectable after drawing
        canvas.setActiveObject(cropRectRef.current);
        canvas.renderAll();
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
    };
  }, [canvas, isActive, ratio, createCropRect, onCropStart]);

  const applyCrop = useCallback(async () => {
    if (!canvas || !cropRectRef.current) return;

    const rect = cropRectRef.current;
    const left = rect.left || 0;
    const top = rect.top || 0;
    const width = rect.getScaledWidth();
    const height = rect.getScaledHeight();

    // Remove crop rect first
    canvas.remove(rect);
    cropRectRef.current = null;

    // Get canvas data URL for the crop area
    const dataUrl = canvas.toDataURL({
      left,
      top,
      width,
      height,
      format: 'png',
      multiplier: 1,
    });

    // Clear and reload with cropped image
    canvas.clear();

    const { FabricImage } = await import('fabric');
    const img = await FabricImage.fromURL(dataUrl);

    canvas.setDimensions({ width, height });
    img.set({ left: 0, top: 0 });
    canvas.add(img);
    canvas.renderAll();

    onCropEnd();
  }, [canvas, onCropEnd]);

  const cancelCrop = useCallback(() => {
    if (!canvas || !cropRectRef.current) return;

    canvas.remove(cropRectRef.current);
    cropRectRef.current = null;
    canvas.renderAll();
    onCropEnd();
  }, [canvas, onCropEnd]);

  return {
    applyCrop,
    cancelCrop,
    hasCropRect: cropRectRef.current !== null,
  };
}
