'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Canvas as FabricCanvas, FabricImage, FabricObject } from 'fabric';
import type { EditorState, EditorActions, EditorTool, FilterType, CropRatio } from './types';
import { calculateFitZoom, CANVAS_MIN_SIZE, CANVAS_MAX_SIZE } from './types';

/**
 * Clamp canvas dimensions to valid range [CANVAS_MIN_SIZE, CANVAS_MAX_SIZE]
 */
function clampCanvasSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(CANVAS_MIN_SIZE, Math.min(CANVAS_MAX_SIZE, Math.round(width))),
    height: Math.max(CANVAS_MIN_SIZE, Math.min(CANVAS_MAX_SIZE, Math.round(height))),
  };
}

const MAX_HISTORY_SIZE = 50;

interface HistoryState {
  json: string;
}

export function useEditor(canvas: FabricCanvas | null) {
  const [state, setState] = useState<EditorState>({
    tool: 'select',
    brushColor: '#FF6B35',
    brushWidth: 5,
    textColor: '#000000',
    textSize: 24,
    textFont: 'Arial',
    filter: 'none',
    filterIntensity: 50,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    zoom: 1,
    canUndo: false,
    canRedo: false,
    hasContent: false,
    cropRatio: '16:9',
    isCropping: false,
    canvasWidth: 800,
    canvasHeight: 600,
    aspectLocked: true,
    containerWidth: 0,
    containerHeight: 0,
    additionalReferenceImages: [],
    isSelectingReference: false,
    overrideAspectRatio: undefined,
  });

  const historyRef = useRef<HistoryState[]>([]);
  const historyIndexRef = useRef(-1);
  const isLoadingRef = useRef(false);
  const cropRectRef = useRef<FabricObject | null>(null);
  const stateRef = useRef(state);

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Save state to history
  const saveToHistory = useCallback(() => {
    if (!canvas || isLoadingRef.current) return;

    const json = JSON.stringify(canvas.toJSON());
    const currentIndex = historyIndexRef.current;

    // Remove any future states if we're not at the end
    historyRef.current = historyRef.current.slice(0, currentIndex + 1);

    // Add new state
    historyRef.current.push({ json });

    // Limit history size
    if (historyRef.current.length > MAX_HISTORY_SIZE) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current++;
    }

    setState(prev => ({
      ...prev,
      canUndo: historyIndexRef.current > 0,
      canRedo: false,
    }));
  }, [canvas]);

  // Update hasContent when canvas changes
  const updateHasContent = useCallback(() => {
    if (!canvas) return;
    const hasContent = canvas.getObjects().length > 0;
    setState(prev => {
      if (prev.hasContent !== hasContent) {
        return { ...prev, hasContent };
      }
      return prev;
    });
  }, [canvas]);

  // Set up canvas event listeners
  useEffect(() => {
    if (!canvas) return;

    const handleObjectAdded = () => {
      saveToHistory();
      updateHasContent();
    };

    const handleObjectRemoved = () => {
      saveToHistory();
      updateHasContent();
    };

    const handleObjectModified = () => {
      saveToHistory();
    };

    canvas.on('object:added', handleObjectAdded);
    canvas.on('object:removed', handleObjectRemoved);
    canvas.on('object:modified', handleObjectModified);

    // Initialize history with empty state
    if (historyRef.current.length === 0) {
      historyRef.current.push({ json: JSON.stringify(canvas.toJSON()) });
      historyIndexRef.current = 0;
    }

    return () => {
      canvas.off('object:added', handleObjectAdded);
      canvas.off('object:removed', handleObjectRemoved);
      canvas.off('object:modified', handleObjectModified);
    };
  }, [canvas, saveToHistory, updateHasContent]);

  // Sync canvas dimensions with state when canvas is ready
  useEffect(() => {
    if (!canvas) return;

    const width = canvas.width || 800;
    const height = canvas.height || 600;
    setState(prev => ({
      ...prev,
      canvasWidth: width,
      canvasHeight: height,
    }));
  }, [canvas]);

  const setTool = useCallback((tool: EditorTool) => {
    setState(prev => ({ ...prev, tool }));

    if (!canvas) return;

    // Configure canvas based on tool
    if (tool === 'brush' || tool === 'ai') {
      canvas.isDrawingMode = true;
      // Set custom pencil cursor
      const pencilCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Cpath d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/%3E%3Cpath d='m15 5 4 4'/%3E%3C/svg%3E") 0 24, crosshair`;
      canvas.freeDrawingCursor = pencilCursor;
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.color = state.brushColor;
        canvas.freeDrawingBrush.width = state.brushWidth;
      }
    } else if (tool === 'text') {
      canvas.isDrawingMode = false;
      // Custom cursor: thin crosshair at top-left corner with serif T nearby
      const textCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3C!-- Crosshair --%3E%3Cline x1='0' y1='3' x2='6' y2='3' stroke='%23000' stroke-width='1'/%3E%3Cline x1='3' y1='0' x2='3' y2='6' stroke='%23000' stroke-width='1'/%3E%3C!-- Serif T --%3E%3Ctext x='8' y='14' font-family='Times,serif' font-size='12' font-weight='bold' fill='%23000'%3ET%3C/text%3E%3C/svg%3E") 3 3, text`;
      canvas.defaultCursor = textCursor;
      canvas.hoverCursor = 'move'; // Keep move cursor for objects
    } else {
      canvas.isDrawingMode = false;
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
    }

    // Cancel cropping if switching tools
    if (tool !== 'crop' && state.isCropping) {
      if (cropRectRef.current) {
        canvas.remove(cropRectRef.current);
        cropRectRef.current = null;
      }
      setState(prev => ({ ...prev, isCropping: false }));
    }
  }, [canvas, state.brushColor, state.brushWidth, state.isCropping]);

  const setBrushColor = useCallback((color: string) => {
    setState(prev => ({ ...prev, brushColor: color }));
    if (canvas?.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = color;
    }
  }, [canvas]);

  const setBrushWidth = useCallback((width: number) => {
    setState(prev => ({ ...prev, brushWidth: width }));
    if (canvas?.freeDrawingBrush) {
      canvas.freeDrawingBrush.width = width;
    }
  }, [canvas]);

  const setTextColor = useCallback((color: string) => {
    setState(prev => ({ ...prev, textColor: color }));
    // Update selected text object if any
    if (canvas) {
      const active = canvas.getActiveObject();
      if (active && active.type === 'i-text') {
        (active as any).set('fill', color);
        canvas.renderAll();
      }
    }
  }, [canvas]);

  const setTextSize = useCallback((size: number) => {
    setState(prev => ({ ...prev, textSize: size }));
    if (canvas) {
      const active = canvas.getActiveObject();
      if (active && active.type === 'i-text') {
        (active as any).set('fontSize', size);
        canvas.renderAll();
      }
    }
  }, [canvas]);

  const setTextFont = useCallback((font: string) => {
    setState(prev => ({ ...prev, textFont: font }));
    if (canvas) {
      const active = canvas.getActiveObject();
      if (active && active.type === 'i-text') {
        (active as any).set('fontFamily', font);
        canvas.renderAll();
      }
    }
  }, [canvas]);

  const setFilter = useCallback((filter: FilterType) => {
    setState(prev => ({ ...prev, filter }));
  }, []);

  const setFilterIntensity = useCallback((intensity: number) => {
    setState(prev => ({ ...prev, filterIntensity: intensity }));
  }, []);

  const setBrightness = useCallback((value: number) => {
    setState(prev => ({ ...prev, brightness: value }));
  }, []);

  const setContrast = useCallback((value: number) => {
    setState(prev => ({ ...prev, contrast: value }));
  }, []);

  const setSaturation = useCallback((value: number) => {
    setState(prev => ({ ...prev, saturation: value }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    setState(prev => ({ ...prev, zoom }));
    if (canvas) {
      // Get logical dimensions from state
      const logicalWidth = stateRef.current.canvasWidth;
      const logicalHeight = stateRef.current.canvasHeight;

      // Use Fabric.js native zoom - keeps control handles at consistent size
      canvas.setZoom(zoom);

      // Also adjust canvas element's display size = logical size × zoom
      canvas.setDimensions({
        width: logicalWidth * zoom,
        height: logicalHeight * zoom
      });

      canvas.renderAll();
    }
  }, [canvas]);

  const setContainerSize = useCallback((width: number, height: number) => {
    setState(prev => ({ ...prev, containerWidth: width, containerHeight: height }));
  }, []);

  /**
   * Auto-adjust zoom to fit the canvas within the container.
   * Uses 25% increments and picks the largest zoom level where the canvas still fits.
   * Always adjusts to optimal zoom (both enlarging and shrinking).
   */
  const autoFitZoom = useCallback(() => {
    const { canvasWidth, canvasHeight, containerWidth, containerHeight, zoom } = stateRef.current;
    if (containerWidth <= 0 || containerHeight <= 0) {
      // Container size not set yet, skip auto-fit
      return;
    }

    const bestZoom = calculateFitZoom(canvasWidth, canvasHeight, containerWidth, containerHeight);

    // Always apply the best zoom to optimally fill the display area
    if (bestZoom !== zoom) {
      setState(prev => ({ ...prev, zoom: bestZoom }));

      // Apply to canvas
      if (canvas) {
        canvas.setZoom(bestZoom);
        canvas.setDimensions({
          width: canvasWidth * bestZoom,
          height: canvasHeight * bestZoom
        });
        canvas.renderAll();
      }
    }
  }, [canvas]);

  const setCropRatio = useCallback((ratio: CropRatio) => {
    if (!canvas) return;

    // Get logical dimensions from state, not from canvas.getWidth() which may include zoom
    const oldWidth = stateRef.current.canvasWidth;
    const oldHeight = stateRef.current.canvasHeight;
    const currentZoom = stateRef.current.zoom;

    // Calculate new dimensions based on ratio
    // Use current width as base and adjust height
    let calcWidth = oldWidth;
    let calcHeight = oldHeight;

    switch (ratio) {
      case '16:9':
        calcHeight = Math.round(calcWidth * 9 / 16);
        break;
      case '9:16':
        calcHeight = Math.round(calcWidth * 16 / 9);
        break;
      case '4:3':
        calcHeight = Math.round(calcWidth * 3 / 4);
        break;
      case '3:4':
        calcHeight = Math.round(calcWidth * 4 / 3);
        break;
      case '1:1':
        calcHeight = calcWidth;
        break;
      default:
        // 'free' - keep current dimensions
        break;
    }

    // Clamp to valid range
    const { width: newWidth, height: newHeight } = clampCanvasSize(calcWidth, calcHeight);

    // Calculate the offset to keep content centered (based on logical coordinates)
    const deltaX = (newWidth - oldWidth) / 2;
    const deltaY = (newHeight - oldHeight) / 2;

    // Move all objects to maintain their position relative to the center
    if (deltaX !== 0 || deltaY !== 0) {
      const objects = canvas.getObjects();
      objects.forEach(obj => {
        const left = obj.left ?? 0;
        const top = obj.top ?? 0;
        obj.set({
          left: left + deltaX,
          top: top + deltaY,
        });
        obj.setCoords();
      });
    }

    // Calculate optimal zoom to best fill the display area
    let newZoom = currentZoom;
    const { containerWidth, containerHeight } = stateRef.current;
    if (containerWidth > 0 && containerHeight > 0) {
      newZoom = calculateFitZoom(newWidth, newHeight, containerWidth, containerHeight);
    }

    // Update state
    setState(prev => ({
      ...prev,
      cropRatio: ratio,
      canvasWidth: newWidth,
      canvasHeight: newHeight,
      aspectLocked: ratio !== 'free',
      zoom: newZoom,
      overrideAspectRatio: undefined,  // Clear manual ratio override
    }));

    // Apply to canvas: use logical dimensions × zoom for display size
    canvas.setZoom(newZoom);
    canvas.setDimensions({
      width: newWidth * newZoom,
      height: newHeight * newZoom
    });
    canvas.renderAll();
  }, [canvas]);

  const setCanvasSize = useCallback((width: number, height: number) => {
    setState(prev => ({ ...prev, canvasWidth: width, canvasHeight: height }));
  }, []);

  const setAspectLocked = useCallback((locked: boolean) => {
    setState(prev => ({ ...prev, aspectLocked: locked }));
  }, []);

  const applyCanvasSize = useCallback((width?: number, height?: number, skipAutoZoom?: boolean) => {
    if (!canvas) return;

    // Get logical dimensions from state, not from canvas.getWidth() which may include zoom
    const oldWidth = stateRef.current.canvasWidth;
    const oldHeight = stateRef.current.canvasHeight;
    const currentZoom = stateRef.current.zoom;

    // Clamp to valid range
    const { width: newWidth, height: newHeight } = clampCanvasSize(
      width ?? oldWidth,
      height ?? oldHeight
    );

    // Calculate the offset to keep content centered (based on logical coordinates)
    const deltaX = (newWidth - oldWidth) / 2;
    const deltaY = (newHeight - oldHeight) / 2;

    // Move all objects to maintain their position relative to the center
    if (deltaX !== 0 || deltaY !== 0) {
      const objects = canvas.getObjects();
      objects.forEach(obj => {
        const left = obj.left ?? 0;
        const top = obj.top ?? 0;
        obj.set({
          left: left + deltaX,
          top: top + deltaY,
        });
        obj.setCoords();
      });
    }

    // Calculate optimal zoom to best fill the display area (unless skipped)
    let newZoom = currentZoom;
    if (!skipAutoZoom) {
      const { containerWidth, containerHeight } = stateRef.current;
      if (containerWidth > 0 && containerHeight > 0) {
        newZoom = calculateFitZoom(newWidth, newHeight, containerWidth, containerHeight);
      }
    }

    // Update state with new dimensions and zoom, and clear manual ratio override
    setState(prev => ({
      ...prev,
      canvasWidth: newWidth,
      canvasHeight: newHeight,
      zoom: newZoom,
      overrideAspectRatio: undefined,
    }));

    // Apply to canvas: use logical dimensions × zoom for display size
    canvas.setZoom(newZoom);
    canvas.setDimensions({
      width: newWidth * newZoom,
      height: newHeight * newZoom
    });
    canvas.renderAll();
  }, [canvas]);

  const undo = useCallback(async () => {
    if (!canvas || historyIndexRef.current <= 0) return;

    historyIndexRef.current--;
    const prevState = historyRef.current[historyIndexRef.current];

    isLoadingRef.current = true;
    await canvas.loadFromJSON(JSON.parse(prevState.json));
    canvas.renderAll();
    isLoadingRef.current = false;

    setState(prev => ({
      ...prev,
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    }));
    updateHasContent();
  }, [canvas, updateHasContent]);

  const redo = useCallback(async () => {
    if (!canvas || historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current++;
    const nextState = historyRef.current[historyIndexRef.current];

    isLoadingRef.current = true;
    await canvas.loadFromJSON(JSON.parse(nextState.json));
    canvas.renderAll();
    isLoadingRef.current = false;

    setState(prev => ({
      ...prev,
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    }));
    updateHasContent();
  }, [canvas, updateHasContent]);

  const addImage = useCallback(async (url: string) => {
    if (!canvas) return;

    const { FabricImage } = await import('fabric');

    try {
      let imageUrl = url;

      // For backend /api/files/raw URLs, use read-base64 endpoint to get data URL
      // This avoids CORS issues with fabric.js canvas operations
      if (url.includes('/api/files/raw')) {
        const urlObj = new URL(url, window.location.origin);
        const path = urlObj.searchParams.get('path');
        if (path) {
          const response = await fetch(`http://localhost:8000/api/files/read-base64?path=${encodeURIComponent(path)}`);
          if (!response.ok) {
            throw new Error(`Failed to load image: ${response.statusText}`);
          }
          const data = await response.json();
          imageUrl = data.data_url;
        }
      }

      const img = await FabricImage.fromURL(imageUrl);

      // Use logical dimensions from state, not canvas.width which includes zoom
      const logicalWidth = stateRef.current.canvasWidth;
      const logicalHeight = stateRef.current.canvasHeight;

      // Scale image to fit canvas if too large
      const maxWidth = logicalWidth * 0.8;
      const maxHeight = logicalHeight * 0.8;

      if (img.width! > maxWidth || img.height! > maxHeight) {
        const scale = Math.min(maxWidth / img.width!, maxHeight / img.height!);
        img.scale(scale);
      }

      // Center the image (using logical coordinates)
      // Set origin to center so left/top represents the center point
      img.set({
        left: logicalWidth / 2,
        top: logicalHeight / 2,
        originX: 'center',
        originY: 'center',
      });

      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();

      setState(prev => ({
        ...prev,
        hasContent: true,
      }));
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }, [canvas]);

  /**
   * Load an image as the canvas background (initialization mode).
   * Sets canvas dimensions to match image dimensions, with max size 4096px.
   */
  const loadImageAsCanvas = useCallback(async (url: string) => {
    if (!canvas) return;

    const { FabricImage } = await import('fabric');

    try {
      let imageUrl = url;

      // For backend /api/files/raw URLs, use read-base64 endpoint to get data URL
      // This avoids CORS issues with fabric.js canvas operations
      if (url.includes('/api/files/raw')) {
        const urlObj = new URL(url, window.location.origin);
        const path = urlObj.searchParams.get('path');
        if (path) {
          const response = await fetch(`http://localhost:8000/api/files/read-base64?path=${encodeURIComponent(path)}`);
          if (!response.ok) {
            throw new Error(`Failed to load image: ${response.statusText}`);
          }
          const data = await response.json();
          imageUrl = data.data_url;
        }
      }

      const img = await FabricImage.fromURL(imageUrl);

      // Get image original dimensions
      let imgWidth = img.width!;
      let imgHeight = img.height!;

      // If either side > 4096, scale down proportionally
      const MAX_SIZE = 4096;
      if (imgWidth > MAX_SIZE || imgHeight > MAX_SIZE) {
        const scale = Math.min(MAX_SIZE / imgWidth, MAX_SIZE / imgHeight);
        img.scale(scale);
        imgWidth = Math.round(imgWidth * scale);
        imgHeight = Math.round(imgHeight * scale);
      }

      // Calculate optimal zoom to fit canvas in container
      const { containerWidth, containerHeight } = stateRef.current;
      const newZoom = calculateFitZoom(imgWidth, imgHeight, containerWidth, containerHeight);

      // Update state
      setState(prev => ({
        ...prev,
        canvasWidth: imgWidth,
        canvasHeight: imgHeight,
        zoom: newZoom,
        cropRatio: 'free',  // Free ratio since we're matching image dimensions
        aspectLocked: false,
        overrideAspectRatio: undefined,  // Clear manual ratio override
      }));

      // Apply to canvas
      canvas.setZoom(newZoom);
      canvas.setDimensions({
        width: imgWidth * newZoom,
        height: imgHeight * newZoom
      });

      // Place image at canvas origin (0, 0) with top-left origin
      img.set({ left: 0, top: 0, originX: 'left', originY: 'top' });
      canvas.add(img);
      canvas.renderAll();

      setState(prev => ({ ...prev, hasContent: true }));
    } catch (error) {
      console.error('Failed to load image as canvas:', error);
    }
  }, [canvas]);

  const addImageFromFile = useCallback(async (file: File) => {
    // Check if file is HEIC format
    const isHeic = file.type === 'image/heic' ||
                   file.type === 'image/heif' ||
                   file.name.toLowerCase().endsWith('.heic') ||
                   file.name.toLowerCase().endsWith('.heif');

    let fileToProcess = file;

    if (isHeic) {
      // Check if browser natively supports HEIC (Safari/iOS does)
      const img = new Image();
      const testUrl = URL.createObjectURL(file);
      const supportsHeic = await new Promise<boolean>((resolve) => {
        img.onload = () => {
          URL.revokeObjectURL(testUrl);
          resolve(true);
        };
        img.onerror = () => {
          URL.revokeObjectURL(testUrl);
          resolve(false);
        };
        img.src = testUrl;
      });

      if (!supportsHeic) {
        // Lazy load heic2any and convert to JPEG
        try {
          const heic2any = (await import('heic2any')).default;
          const convertedBlob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.92,
          });
          // heic2any may return an array for multi-image HEIC, take the first
          const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
          fileToProcess = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
        } catch (error) {
          console.error('Failed to convert HEIC:', error);
          return;
        }
      }
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      await addImage(dataUrl);
    };
    reader.readAsDataURL(fileToProcess);
  }, [addImage]);

  const deleteSelected = useCallback(() => {
    if (!canvas) return;

    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length > 0) {
      activeObjects.forEach(obj => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  }, [canvas]);

  const applyCrop = useCallback(async () => {
    if (!canvas || !cropRectRef.current) return;

    const cropRect = cropRectRef.current;
    const left = cropRect.left!;
    const top = cropRect.top!;
    const width = cropRect.getScaledWidth();
    const height = cropRect.getScaledHeight();

    // Remove crop rect
    canvas.remove(cropRect);
    cropRectRef.current = null;

    // Export the cropped area
    const dataUrl = canvas.toDataURL({
      left,
      top,
      width,
      height,
      format: 'png',
      multiplier: 1,
    });

    // Clear canvas and add cropped image
    canvas.clear();

    const { FabricImage } = await import('fabric');
    const img = await FabricImage.fromURL(dataUrl);

    // Calculate optimal zoom to best fill the display area
    const { containerWidth, containerHeight } = stateRef.current;
    let newZoom = stateRef.current.zoom;
    if (containerWidth > 0 && containerHeight > 0) {
      newZoom = calculateFitZoom(width, height, containerWidth, containerHeight);
    }

    // Update state with new logical dimensions
    setState(prev => ({
      ...prev,
      isCropping: false,
      canvasWidth: width,
      canvasHeight: height,
      zoom: newZoom,
    }));

    // Resize canvas to match cropped image (display size = logical × zoom)
    canvas.setZoom(newZoom);
    canvas.setDimensions({
      width: width * newZoom,
      height: height * newZoom
    });

    img.set({ left: 0, top: 0 });
    canvas.add(img);
    canvas.renderAll();
  }, [canvas]);

  const cancelCrop = useCallback(() => {
    if (!canvas || !cropRectRef.current) return;

    canvas.remove(cropRectRef.current);
    cropRectRef.current = null;
    canvas.renderAll();

    setState(prev => ({ ...prev, isCropping: false }));
  }, [canvas]);

  const addText = useCallback(async (x?: number, y?: number) => {
    if (!canvas) return;

    const { IText } = await import('fabric');

    // Use logical dimensions from state, not canvas.width which includes zoom
    const logicalWidth = stateRef.current.canvasWidth;
    const logicalHeight = stateRef.current.canvasHeight;

    const text = new IText('Text', {
      left: x ?? logicalWidth / 2 - 50,
      top: y ?? logicalHeight / 2 - 20,
      fontFamily: state.textFont,
      fontSize: state.textSize,
      fill: state.textColor,
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();

    // Enter editing mode in next frame to ensure canvas is ready
    requestAnimationFrame(() => {
      text.enterEditing();
      text.setSelectionStart(text.text?.length || 0);
      text.setSelectionEnd(text.text?.length || 0);
      // Focus the hidden textarea for cursor blinking
      if (text.hiddenTextarea) {
        text.hiddenTextarea.focus();
      }
      canvas.renderAll();
    });
  }, [canvas, state.textFont, state.textSize, state.textColor]);

  // Handle canvas click for text tool - add text at click position
  useEffect(() => {
    if (!canvas) return;

    // Track if we were editing before the click
    let wasEditing = false;

    const handleMouseDownBefore = () => {
      // Check if there's an active text object being edited BEFORE fabric processes the click
      const activeObject = canvas.getActiveObject();
      wasEditing = !!(activeObject && 'isEditing' in activeObject && (activeObject as any).isEditing);
    };

    const handleMouseDown = (opt: { e: MouseEvent | TouchEvent; target?: FabricObject | null }) => {
      // Only handle clicks in text mode when not clicking on an existing object
      if (stateRef.current.tool !== 'text') return;
      if (opt.target) return; // Clicked on an existing object, let fabric handle selection

      // If we were editing, don't create new text - just let the editing exit happen
      if (wasEditing) {
        wasEditing = false;
        return;
      }

      const pointer = canvas.getScenePoint(opt.e);
      addText(pointer.x, pointer.y);
    };

    canvas.on('mouse:down:before', handleMouseDownBefore);
    canvas.on('mouse:down', handleMouseDown);

    return () => {
      canvas.off('mouse:down:before', handleMouseDownBefore);
      canvas.off('mouse:down', handleMouseDown);
    };
  }, [canvas, addText]);

  const exportImage = useCallback((format: 'png' | 'jpeg' = 'png', quality: number = 1): string | null => {
    if (!canvas) return null;

    // Export at logical resolution, not display resolution
    // multiplier = 1/zoom to counteract the zoom scaling
    const currentZoom = stateRef.current.zoom;
    const multiplier = 1 / currentZoom;

    return canvas.toDataURL({
      format,
      quality,
      multiplier,
    });
  }, [canvas]);

  /**
   * Export canvas for AI image generation.
   * Scales down to max 1024px on the longest side for optimal API input.
   */
  const exportForAI = useCallback((): string | null => {
    if (!canvas) return null;

    const { canvasWidth, canvasHeight, zoom } = stateRef.current;
    const currentZoom = zoom;

    // Calculate multiplier to get logical size, then scale to max 1024
    const baseMultiplier = 1 / currentZoom;
    const maxSize = 1024;
    const longestSide = Math.max(canvasWidth, canvasHeight);

    // If already <= 1024, use base multiplier; otherwise scale down further
    const finalMultiplier = longestSide <= maxSize
      ? baseMultiplier
      : baseMultiplier * (maxSize / longestSide);

    return canvas.toDataURL({
      format: 'jpeg',
      quality: 0.85,
      multiplier: finalMultiplier,
    });
  }, [canvas]);

  const clear = useCallback(() => {
    if (!canvas) return;

    canvas.clear();
    canvas.renderAll();

    setState(prev => ({
      ...prev,
      hasContent: false,
    }));

    // Reset history
    historyRef.current = [{ json: JSON.stringify(canvas.toJSON()) }];
    historyIndexRef.current = 0;
    setState(prev => ({
      ...prev,
      canUndo: false,
      canRedo: false,
    }));
  }, [canvas]);

  // Reference image management actions
  const addReferenceImage = useCallback((dataUrl: string) => {
    setState(prev => ({
      ...prev,
      additionalReferenceImages: [...prev.additionalReferenceImages, dataUrl],
      // Keep isSelectingReference unchanged - user can keep adding images
    }));
  }, []);

  const removeReferenceImage = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      additionalReferenceImages: prev.additionalReferenceImages.filter((_, i) => i !== index),
    }));
  }, []);

  const clearReferenceImages = useCallback(() => {
    setState(prev => ({
      ...prev,
      additionalReferenceImages: [],
    }));
  }, []);

  const setSelectingReference = useCallback((selecting: boolean) => {
    setState(prev => ({ ...prev, isSelectingReference: selecting }));
  }, []);

  const setOverrideAspectRatio = useCallback((ratio: string | undefined) => {
    setState(prev => ({ ...prev, overrideAspectRatio: ratio }));
  }, []);

  /**
   * Add an AI-generated image to canvas, scaled to cover and centered.
   * The image is scaled up to fill the entire canvas while maintaining aspect ratio.
   */
  const addAIGeneratedImage = useCallback(async (url: string) => {
    if (!canvas) return;

    const { FabricImage } = await import('fabric');

    try {
      let imageUrl = url;

      // For backend /api/files/raw URLs, use read-base64 endpoint to get data URL
      if (url.includes('/api/files/raw')) {
        const urlObj = new URL(url, window.location.origin);
        const path = urlObj.searchParams.get('path');
        if (path) {
          const response = await fetch(`http://localhost:8000/api/files/read-base64?path=${encodeURIComponent(path)}`);
          if (!response.ok) {
            throw new Error(`Failed to load image: ${response.statusText}`);
          }
          const data = await response.json();
          imageUrl = data.data_url;
        }
      }

      const img = await FabricImage.fromURL(imageUrl);

      // Use logical dimensions from state
      const logicalWidth = stateRef.current.canvasWidth;
      const logicalHeight = stateRef.current.canvasHeight;

      // Calculate scale to cover the entire canvas (fill/cover mode)
      // The image should be scaled to cover the canvas completely
      const scaleX = logicalWidth / img.width!;
      const scaleY = logicalHeight / img.height!;
      const coverScale = Math.max(scaleX, scaleY);

      img.scale(coverScale);

      // Center the image on the canvas
      img.set({
        left: logicalWidth / 2,
        top: logicalHeight / 2,
        originX: 'center',
        originY: 'center',
      });

      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();

      setState(prev => ({
        ...prev,
        hasContent: true,
      }));
    } catch (error) {
      console.error('Failed to load AI generated image:', error);
    }
  }, [canvas]);

  const actions: EditorActions = {
    setTool,
    setBrushColor,
    setBrushWidth,
    setTextColor,
    setTextSize,
    setTextFont,
    setFilter,
    setFilterIntensity,
    setBrightness,
    setContrast,
    setSaturation,
    setZoom,
    setCropRatio,
    setCanvasSize,
    setAspectLocked,
    applyCanvasSize,
    setContainerSize,
    autoFitZoom,
    undo,
    redo,
    addImage,
    addAIGeneratedImage,
    addImageFromFile,
    loadImageAsCanvas,
    deleteSelected,
    applyCrop,
    cancelCrop,
    addText,
    exportImage,
    exportForAI,
    clear,
    addReferenceImage,
    removeReferenceImage,
    clearReferenceImages,
    setSelectingReference,
    setOverrideAspectRatio,
  };

  return { state, actions };
}
