'use client';

import { useEffect, useCallback } from 'react';
import type { Canvas as FabricCanvas, FabricImage } from 'fabric';
import type { FilterType } from '../types';

interface UseFilterToolOptions {
  canvas: FabricCanvas | null;
  isActive: boolean;
  filter: FilterType;
  brightness: number;
  contrast: number;
  saturation: number;
}

export function useFilterTool({
  canvas,
  isActive,
  filter,
  brightness,
  contrast,
  saturation,
}: UseFilterToolOptions) {
  const applyFilters = useCallback(async () => {
    if (!canvas) return;

    const objects = canvas.getObjects();
    const images = objects.filter(obj => obj.type === 'image') as FabricImage[];

    if (images.length === 0) return;

    const fabric = await import('fabric');

    for (const img of images) {
      const filters: any[] = [];

      // Add preset filter
      switch (filter) {
        case 'vintage':
          filters.push(new fabric.filters.Vintage());
          break;
        case 'sepia':
          filters.push(new fabric.filters.Sepia());
          break;
        case 'grayscale':
          filters.push(new fabric.filters.Grayscale());
          break;
        case 'kodachrome':
          filters.push(new fabric.filters.Kodachrome());
          break;
        case 'polaroid':
          filters.push(new fabric.filters.Polaroid());
          break;
        case 'brownie':
          filters.push(new fabric.filters.Brownie());
          break;
        case 'technicolor':
          filters.push(new fabric.filters.Technicolor());
          break;
        case 'blur':
          filters.push(new fabric.filters.Blur({ blur: 0.2 }));
          break;
        case 'sharpen':
          filters.push(new fabric.filters.Convolute({
            matrix: [0, -1, 0, -1, 5, -1, 0, -1, 0]
          }));
          break;
        case 'emboss':
          filters.push(new fabric.filters.Convolute({
            matrix: [1, 1, 1, 1, 0.7, -1, -1, -1, -1]
          }));
          break;
        case 'invert':
          filters.push(new fabric.filters.Invert());
          break;
      }

      // Add adjustment filters
      if (brightness !== 0) {
        filters.push(new fabric.filters.Brightness({ brightness: brightness / 100 }));
      }

      if (contrast !== 0) {
        filters.push(new fabric.filters.Contrast({ contrast: contrast / 100 }));
      }

      if (saturation !== 0) {
        filters.push(new fabric.filters.Saturation({ saturation: saturation / 100 }));
      }

      img.filters = filters;
      img.applyFilters();
    }

    canvas.renderAll();
  }, [canvas, filter, brightness, contrast, saturation]);

  // Apply filters when tool is active and parameters change
  useEffect(() => {
    if (isActive) {
      applyFilters();
    }
  }, [isActive, applyFilters]);

  return { applyFilters };
}
