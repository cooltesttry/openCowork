'use client';

import { useEffect, useCallback } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { Canvas as FabricCanvas, IText } from 'fabric';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IEvent<T = any> = any;

interface UseTextToolOptions {
  canvas: FabricCanvas | null;
  isActive: boolean;
  color: string;
  fontSize: number;
  fontFamily: string;
}

export function useTextTool({ canvas, isActive, color, fontSize, fontFamily }: UseTextToolOptions) {
  const addText = useCallback(async () => {
    if (!canvas) return;

    const { IText } = await import('fabric');

    const text = new IText('Double-click to edit', {
      left: canvas.width! / 2 - 100,
      top: canvas.height! / 2 - 20,
      fontFamily,
      fontSize,
      fill: color,
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();

    // Enter edit mode immediately
    text.enterEditing();
    text.selectAll();
  }, [canvas, color, fontSize, fontFamily]);

  // Add text on canvas click when text tool is active
  useEffect(() => {
    if (!canvas || !isActive) return;

    const handleMouseDown = async (opt: IEvent<MouseEvent>) => {
      // Only add text if clicking on empty space
      if (opt.target) return;

      const { IText } = await import('fabric');
      const pointer = opt.pointer || { x: 0, y: 0 };

      const text = new IText('Click to edit', {
        left: pointer.x,
        top: pointer.y,
        fontFamily,
        fontSize,
        fill: color,
      });

      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.renderAll();

      // Enter edit mode
      text.enterEditing();
      text.selectAll();
    };

    canvas.on('mouse:down', handleMouseDown);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
    };
  }, [canvas, isActive, color, fontSize, fontFamily]);

  // Update selected text properties
  useEffect(() => {
    if (!canvas || !isActive) return;

    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.type === 'i-text') {
      const textObj = activeObject as IText;
      textObj.set({
        fill: color,
        fontSize,
        fontFamily,
      });
      canvas.renderAll();
    }
  }, [canvas, isActive, color, fontSize, fontFamily]);

  return { addText };
}
