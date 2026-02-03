import type { Canvas as FabricCanvas } from 'fabric';

export type EditorTool = 'select' | 'crop' | 'brush' | 'text' | 'filter' | 'ai';

export interface OpenImageOptions {
  tool?: EditorTool;
}

export type FilterType =
  | 'none'
  | 'vintage'
  | 'sepia'
  | 'grayscale'
  | 'kodachrome'
  | 'polaroid'
  | 'brownie'
  | 'technicolor'
  | 'blur'
  | 'sharpen'
  | 'emboss'
  | 'invert';

export type CropRatio = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export interface EditorState {
  tool: EditorTool;
  brushColor: string;
  brushWidth: number;
  textColor: string;
  textSize: number;
  textFont: string;
  filter: FilterType;
  filterIntensity: number;
  brightness: number;
  contrast: number;
  saturation: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  hasContent: boolean;
  cropRatio: CropRatio;
  isCropping: boolean;
  canvasWidth: number;
  canvasHeight: number;
  aspectLocked: boolean;
  containerWidth: number;
  containerHeight: number;
  additionalReferenceImages: string[];  // data URL array for extra reference images
  isSelectingReference: boolean;        // whether in reference selection mode
  overrideAspectRatio?: string;         // user manually selected ratio, undefined = use auto-detected
}

export interface EditorActions {
  setTool: (tool: EditorTool) => void;
  setBrushColor: (color: string) => void;
  setBrushWidth: (width: number) => void;
  setTextColor: (color: string) => void;
  setTextSize: (size: number) => void;
  setTextFont: (font: string) => void;
  setFilter: (filter: FilterType) => void;
  setFilterIntensity: (intensity: number) => void;
  setBrightness: (value: number) => void;
  setContrast: (value: number) => void;
  setSaturation: (value: number) => void;
  setZoom: (zoom: number) => void;
  setCropRatio: (ratio: CropRatio) => void;
  setCanvasSize: (width: number, height: number) => void;
  setAspectLocked: (locked: boolean) => void;
  applyCanvasSize: (width?: number, height?: number, skipAutoZoom?: boolean) => void;
  setContainerSize: (width: number, height: number) => void;
  autoFitZoom: () => void;
  undo: () => void;
  redo: () => void;
  addImage: (url: string) => Promise<void>;
  addAIGeneratedImage: (url: string) => Promise<void>;
  addImageFromFile: (file: File) => Promise<void>;
  loadImageAsCanvas: (url: string) => Promise<void>;
  deleteSelected: () => void;
  applyCrop: () => void;
  cancelCrop: () => void;
  addText: (x?: number, y?: number) => void;
  exportImage: (format?: 'png' | 'jpeg', quality?: number) => string | null;
  exportForAI: () => string | null;
  clear: () => void;
  addReferenceImage: (dataUrl: string) => void;
  removeReferenceImage: (index: number) => void;
  clearReferenceImages: () => void;
  setSelectingReference: (selecting: boolean) => void;
  setOverrideAspectRatio: (ratio: string | undefined) => void;
}

export interface ImageEditorProps {
  initialImage?: string;
  addImagePath?: string;
  openInAITool?: boolean;
  onSave?: (dataUrl: string, filename: string) => Promise<void>;
  onHasContentChange?: (hasContent: boolean) => void;
  /** Register an export function for preview without persisting to disk */
  onExportRequest?: (exporter: () => string | null) => void;
  /** Trigger a one-off auto-fit zoom when the editor becomes visible */
  autoFitToken?: number;
  /** Optional workspace path for save dialog shortcut */
  workspacePath?: string;
  /** Callback when reference bar is expanded/collapsed */
  onReferenceBarToggle?: (expanded: boolean) => void;
}

export interface ToolbarProps {
  state: EditorState;
  actions: EditorActions;
  onSave: () => void;
  onGenerateAI?: (prompt: string) => Promise<void>;
  isGenerating?: boolean;
  onAddReferenceFromClipboard?: () => void;
  onAddReferenceFromFile?: () => void;
  /** Callback when reference bar is expanded/collapsed */
  onReferenceBarToggle?: (expanded: boolean) => void;
}

export interface SidebarProps {
  state: EditorState;
  actions: EditorActions;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export const PRESET_COLORS = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
  '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
  '#008800', '#880000', '#888888', '#cccccc', '#444444',
];

export const FONT_OPTIONS = [
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Courier New', value: 'Courier New' },
];

export const FILTER_PRESETS = [
  { label: 'None', value: 'none' as FilterType },
  // Popular - Instagram style
  { label: 'Vintage', value: 'vintage' as FilterType },
  { label: 'Sepia', value: 'sepia' as FilterType },
  { label: 'Kodachrome', value: 'kodachrome' as FilterType },
  { label: 'Polaroid', value: 'polaroid' as FilterType },
  // Classic
  { label: 'Grayscale', value: 'grayscale' as FilterType },
  { label: 'Brownie', value: 'brownie' as FilterType },
  { label: 'Technicolor', value: 'technicolor' as FilterType },
  // Effects
  { label: 'Blur', value: 'blur' as FilterType },
  { label: 'Sharpen', value: 'sharpen' as FilterType },
  { label: 'Emboss', value: 'emboss' as FilterType },
  { label: 'Invert', value: 'invert' as FilterType },
];

export const CROP_RATIOS: { label: string; value: CropRatio; width: number; height: number }[] = [
  { label: '16:9', value: '16:9', width: 24, height: 14 },
  { label: '9:16', value: '9:16', width: 14, height: 24 },
  { label: '4:3', value: '4:3', width: 20, height: 15 },
  { label: '3:4', value: '3:4', width: 15, height: 20 },
  { label: '1:1', value: '1:1', width: 18, height: 18 },
];

export const CANVAS_MIN_SIZE = 100;
export const CANVAS_MAX_SIZE = 4096;

/**
 * Calculate the best zoom level (in 25% increments) to fit the canvas within the container.
 * Returns the largest zoom level where the scaled canvas fits completely in the container.
 *
 * @param canvasWidth - The actual canvas width in pixels
 * @param canvasHeight - The actual canvas height in pixels
 * @param containerWidth - The available container width in pixels
 * @param containerHeight - The available container height in pixels
 * @param padding - Optional padding to leave around the canvas (default: 40px)
 * @returns The best zoom level (0.1, 0.2, 0.3, ..., 3.0)
 */
export function calculateFitZoom(
  canvasWidth: number,
  canvasHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding: number = 40
): number {
  if (containerWidth <= 0 || containerHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return 1;
  }

  // Available space after padding
  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;

  // Calculate the maximum zoom that would fit both dimensions
  const maxZoomWidth = availableWidth / canvasWidth;
  const maxZoomHeight = availableHeight / canvasHeight;
  const maxZoom = Math.min(maxZoomWidth, maxZoomHeight);

  // Zoom levels in 10% increments (0.1 to 3.0)
  const ZOOM_LEVELS = Array.from({ length: 30 }, (_, i) => (i + 1) * 0.1);

  // Find the largest zoom level that fits
  let bestZoom = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (level <= maxZoom) {
      bestZoom = level;
    } else {
      break;
    }
  }

  return bestZoom;
}

/**
 * Get the closest standard aspect ratio for a given canvas size.
 * Used to add aspect ratio hints to AI image generation prompts.
 */
export function getClosestAspectRatio(width: number, height: number): { ratio: string; prompt: string } {
  const aspectRatio = width / height;

  const ratios = [
    { ratio: '1:1', value: 1, prompt: 'square format' },
    { ratio: '4:3', value: 4 / 3, prompt: '4:3 landscape format' },
    { ratio: '3:4', value: 3 / 4, prompt: '3:4 portrait format' },
    { ratio: '16:9', value: 16 / 9, prompt: '16:9 widescreen format' },
    { ratio: '9:16', value: 9 / 16, prompt: '9:16 vertical portrait format' },
  ];

  // Find the closest ratio
  let closest = ratios[0];
  let minDiff = Math.abs(aspectRatio - ratios[0].value);

  for (const r of ratios) {
    const diff = Math.abs(aspectRatio - r.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = r;
    }
  }

  return { ratio: closest.ratio, prompt: closest.prompt };
}
