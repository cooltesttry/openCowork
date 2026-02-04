'use client';

import React, { useState, useEffect } from 'react';
import {
  MousePointer2,
  Crop,
  Paintbrush,
  Type,
  Sliders,
  Undo2,
  Redo2,
  Save,
  Trash2,
  Lock,
  Unlock,
  Sun,
  Contrast,
  Droplets,
  Sparkles,
  Loader2,
  ImagePlus,
  FolderOpen,
  Clipboard,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ToolbarProps, EditorTool, FilterType, CropRatio } from './types';
import { PRESET_COLORS, FONT_OPTIONS, FILTER_PRESETS, CROP_RATIOS, CANVAS_MIN_SIZE, CANVAS_MAX_SIZE, getClosestAspectRatio } from './types';

function RatioIcon({ width, height }: { width: number; height: number }) {
  return (
    <div
      className="border-2 transition-all border-zinc-400 dark:border-zinc-500 hover:border-zinc-600 dark:hover:border-zinc-300"
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}

function getRatioIconSize(ratio: string): { width: number; height: number } {
  const sizes: Record<string, { width: number; height: number }> = {
    '1:1': { width: 14, height: 14 },
    '4:3': { width: 16, height: 12 },
    '3:4': { width: 12, height: 16 },
    '16:9': { width: 18, height: 10 },
    '9:16': { width: 10, height: 18 },
  };
  return sizes[ratio] || { width: 14, height: 14 };
}

interface ToolButton {
  tool: EditorTool;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

const toolButtons: ToolButton[] = [
  { tool: 'select', icon: <MousePointer2 className="h-4 w-4" />, label: 'Select', shortcut: 'V' },
  { tool: 'crop', icon: <Crop className="h-4 w-4" />, label: 'Crop', shortcut: 'C' },
  { tool: 'brush', icon: <Paintbrush className="h-4 w-4" />, label: 'Brush', shortcut: 'B' },
  { tool: 'text', icon: <Type className="h-4 w-4" />, label: 'Text', shortcut: 'T' },
  { tool: 'filter', icon: <Sliders className="h-4 w-4" />, label: 'Filter' },
  { tool: 'ai', icon: <Sparkles className="h-4 w-4" />, label: 'AI Generate' },
];

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs whitespace-nowrap">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="w-6 h-6 rounded border border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 transition-all shadow-sm"
            style={{ backgroundColor: value }}
            title={value}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="space-y-3">
            {/* Preset colors grid */}
            <div className="grid grid-cols-5 gap-1.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  className={`w-7 h-7 rounded border-2 transition-all ${
                    value === color
                      ? 'border-blue-500 ring-1 ring-blue-500'
                      : 'border-zinc-200 dark:border-zinc-600 hover:border-zinc-400'
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => onChange(color)}
                  title={color}
                />
              ))}
            </div>
            {/* Native color picker */}
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
              <Input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 w-full cursor-pointer"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SliderControl({
  label,
  icon: Icon,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {Icon ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-center w-5">
              <Icon className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {label}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Label className="text-xs whitespace-nowrap">{label}</Label>
      )}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <span className="text-xs text-zinc-500 w-6 text-right">{value}</span>
    </div>
  );
}

function ReferenceImagesPanel({
  images,
  onRemove,
  onSelectFromWorkspace,
  onAddFromClipboard,
  onAddFromFile,
}: {
  images: string[];
  onRemove: (index: number) => void;
  onSelectFromWorkspace: () => void;
  onAddFromClipboard: () => void;
  onAddFromFile: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">Extra References ({images.length})</div>

      {/* Thumbnail grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              <img src={img} className="w-full aspect-square object-cover rounded border border-zinc-200 dark:border-zinc-600" alt={`Reference ${idx + 1}`} />
              <button
                onClick={() => onRemove(idx)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full
                           opacity-0 group-hover:opacity-100 text-xs flex items-center justify-center
                           hover:bg-red-600 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add options */}
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="outline" onClick={onSelectFromWorkspace} className="justify-start">
          <FolderOpen className="h-3 w-3 mr-2" />
          From Workspace
        </Button>
        <Button size="sm" variant="outline" onClick={onAddFromClipboard} className="justify-start">
          <Clipboard className="h-3 w-3 mr-2" />
          From Clipboard
        </Button>
        <Button size="sm" variant="outline" onClick={onAddFromFile} className="justify-start">
          <Upload className="h-3 w-3 mr-2" />
          Choose File...
        </Button>
      </div>
    </div>
  );
}

function ReferenceBar({
  images,
  onRemove,
  onAddFromClipboard,
  onAddFromFile,
  onCollapse,
}: {
  images: string[];
  onRemove: (index: number) => void;
  onAddFromClipboard: () => void;
  onAddFromFile: () => void;
  onCollapse: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-blue-50 dark:bg-blue-950/30 border-t border-blue-200 dark:border-blue-800">
      {/* Hint text */}
      <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">
        Double-click images in file browser to add
      </span>

      {/* Thumbnail list */}
      <div className="flex items-center gap-2 flex-1 overflow-x-auto">
        {images.map((img, idx) => (
          <div key={idx} className="relative group shrink-0">
            <img src={img} className="h-10 w-10 object-cover rounded border" alt={`Reference ${idx + 1}`} />
            <button
              onClick={() => onRemove(idx)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full
                         opacity-0 group-hover:opacity-100 flex items-center justify-center"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={onAddFromClipboard} className="h-7">
          <Clipboard className="h-3 w-3 mr-1" />
          Paste
        </Button>
        <Button size="sm" variant="outline" onClick={onAddFromFile} className="h-7">
          <Upload className="h-3 w-3 mr-1" />
          File
        </Button>
        <Button size="sm" variant="ghost" onClick={onCollapse} className="h-7 px-2">
          <ChevronUp className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function CropToolOptions({ state, actions }: { state: ToolbarProps['state']; actions: ToolbarProps['actions'] }) {
  const [widthInput, setWidthInput] = useState(String(state.canvasWidth));
  const [heightInput, setHeightInput] = useState(String(state.canvasHeight));

  // Sync local input state with global state
  useEffect(() => {
    setWidthInput(String(state.canvasWidth));
  }, [state.canvasWidth]);

  useEffect(() => {
    setHeightInput(String(state.canvasHeight));
  }, [state.canvasHeight]);

  const clampValue = (value: number): number => {
    if (isNaN(value) || value < CANVAS_MIN_SIZE) return CANVAS_MIN_SIZE;
    if (value > CANVAS_MAX_SIZE) return CANVAS_MAX_SIZE;
    return Math.round(value);
  };

  const applyWidth = () => {
    const newWidth = parseInt(widthInput, 10);
    if (isNaN(newWidth) || newWidth < CANVAS_MIN_SIZE || newWidth > CANVAS_MAX_SIZE) {
      setWidthInput(String(state.canvasWidth));
      return;
    }

    const clampedWidth = clampValue(newWidth);
    let newHeight = state.canvasHeight;

    if (state.aspectLocked && state.canvasWidth > 0 && state.canvasHeight > 0) {
      const ratio = state.canvasHeight / state.canvasWidth;
      newHeight = clampValue(clampedWidth * ratio);
    }

    setWidthInput(String(clampedWidth));
    setHeightInput(String(newHeight));
    actions.applyCanvasSize(clampedWidth, newHeight);
  };

  const applyHeight = () => {
    const newHeight = parseInt(heightInput, 10);
    if (isNaN(newHeight) || newHeight < CANVAS_MIN_SIZE || newHeight > CANVAS_MAX_SIZE) {
      setHeightInput(String(state.canvasHeight));
      return;
    }

    const clampedHeight = clampValue(newHeight);
    let newWidth = state.canvasWidth;

    if (state.aspectLocked && state.canvasWidth > 0 && state.canvasHeight > 0) {
      const ratio = state.canvasWidth / state.canvasHeight;
      newWidth = clampValue(clampedHeight * ratio);
    }

    setWidthInput(String(newWidth));
    setHeightInput(String(clampedHeight));
    actions.applyCanvasSize(newWidth, clampedHeight);
  };

  const handleWidthKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyWidth();
    }
  };

  const handleHeightKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyHeight();
    }
  };

  return (
    <div className="flex items-center gap-4">
      {/* Ratio icons */}
      <div className="flex items-center gap-1">
        {CROP_RATIOS.map((ratio) => (
          <Tooltip key={ratio.value}>
            <TooltipTrigger asChild>
              <button
                className="flex items-center justify-center w-8 h-8 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                onClick={() => actions.setCropRatio(ratio.value)}
              >
                <RatioIcon
                  width={ratio.width}
                  height={ratio.height}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{ratio.label}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600" />

      {/* Width/Height inputs with lock */}
      <div className="flex items-center gap-2">
        <Label className="text-xs whitespace-nowrap">W</Label>
        <input
          type="number"
          value={widthInput}
          onChange={(e) => setWidthInput(e.target.value)}
          onKeyDown={handleWidthKeyDown}
          onBlur={applyWidth}
          className="h-7 w-20 text-xs px-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-transparent"
          min={CANVAS_MIN_SIZE}
          max={CANVAS_MAX_SIZE}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
              onClick={() => actions.setAspectLocked(!state.aspectLocked)}
            >
              {state.aspectLocked ? (
                <Lock className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
              ) : (
                <Unlock className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{state.aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}</p>
          </TooltipContent>
        </Tooltip>
        <Label className="text-xs whitespace-nowrap">H</Label>
        <input
          type="number"
          value={heightInput}
          onChange={(e) => setHeightInput(e.target.value)}
          onKeyDown={handleHeightKeyDown}
          onBlur={applyHeight}
          className="h-7 w-20 text-xs px-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-transparent"
          min={CANVAS_MIN_SIZE}
          max={CANVAS_MAX_SIZE}
        />
      </div>
    </div>
  );
}

export function Toolbar({ state, actions, onSave, onGenerateAI, isGenerating, onAddReferenceFromClipboard, onAddReferenceFromFile, onReferenceBarToggle, modeToggle }: ToolbarProps) {
  const [aiPrompt, setAiPrompt] = useState('');

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim() || !onGenerateAI || isGenerating) return;
    await onGenerateAI(aiPrompt.trim());
    setAiPrompt('');
  };

  const handleAiPromptKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerateAI();
    }
  };

  const renderToolOptions = () => {
    switch (state.tool) {
      case 'brush':
        return (
          <div className="flex items-center gap-6">
            <ColorPicker
              label="Color"
              value={state.brushColor}
              onChange={actions.setBrushColor}
            />
            <SliderControl
              label="Size"
              value={state.brushWidth}
              min={1}
              max={50}
              onChange={actions.setBrushWidth}
            />
          </div>
        );

      case 'text':
        return (
          <div className="flex items-center gap-6">
            <ColorPicker
              label="Color"
              value={state.textColor}
              onChange={actions.setTextColor}
            />
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Font</Label>
              <Select value={state.textFont} onValueChange={actions.setTextFont}>
                <SelectTrigger className="h-6 w-28 border-0 bg-transparent px-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((font) => (
                    <SelectItem key={font.value} value={font.value} className="text-xs py-1">
                      <span style={{ fontFamily: font.value }}>{font.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SliderControl
              label="Size"
              value={state.textSize}
              min={8}
              max={72}
              onChange={actions.setTextSize}
            />
          </div>
        );

      case 'crop':
        return (
          <CropToolOptions state={state} actions={actions} />
        );

      case 'filter':
        return (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Filter</Label>
              <Select value={state.filter} onValueChange={(v) => actions.setFilter(v as FilterType)}>
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILTER_PRESETS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value} className="text-xs">
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <SliderControl
                label="Brightness"
                icon={Sun}
                value={state.brightness}
                min={-100}
                max={100}
                onChange={actions.setBrightness}
              />
              <SliderControl
                label="Contrast"
                icon={Contrast}
                value={state.contrast}
                min={-100}
                max={100}
                onChange={actions.setContrast}
              />
              <SliderControl
                label="Saturation"
                icon={Droplets}
                value={state.saturation}
              min={-100}
              max={100}
              onChange={actions.setSaturation}
            />
            </div>
          </div>
        );

      case 'ai':
        const autoRatio = getClosestAspectRatio(state.canvasWidth, state.canvasHeight);
        const displayRatio = state.overrideAspectRatio || autoRatio.ratio;
        const refCount = state.additionalReferenceImages.length;

        return (
          <div className="flex items-center gap-3 flex-1">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              {/* Canvas ratio selector with popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center justify-center p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors">
                    <RatioIcon {...getRatioIconSize(displayRatio)} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <div className="flex items-center gap-1">
                    {CROP_RATIOS.map((r) => (
                      <Tooltip key={r.value}>
                        <TooltipTrigger asChild>
                          <button
                            className={cn(
                              "flex items-center justify-center w-8 h-8 rounded transition-colors",
                              displayRatio === r.value
                                ? "bg-blue-100 dark:bg-blue-900"
                                : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            )}
                            onClick={() => actions.setOverrideAspectRatio(r.value)}
                          >
                            <RatioIcon width={r.width} height={r.height} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{r.label}</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Canvas ref indicator dot */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      state.hasContent
                        ? "bg-emerald-500"
                        : "bg-zinc-400"
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{state.hasContent ? "Canvas will be used as reference" : "Canvas is empty"}</p>
                </TooltipContent>
              </Tooltip>

              {/* Reference images button - icon + count + dropdown only */}
              <button
                onClick={() => {
                  const newState = !state.isSelectingReference;
                  actions.setSelectingReference(newState);
                  onReferenceBarToggle?.(newState);
                }}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
                  state.isSelectingReference || refCount > 0
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-600"
                )}
              >
                <ImagePlus className="h-3 w-3" />
                {refCount > 0 && <span>{refCount}</span>}
                <ChevronDown className={cn("h-3 w-3 transition-transform", state.isSelectingReference && "rotate-180")} />
              </button>
            </div>
            <div className="flex-1 flex items-center gap-2">
              <Input
                type="text"
                placeholder="Describe what you want to generate..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={handleAiPromptKeyDown}
                disabled={isGenerating}
                className="h-7 text-xs flex-1 min-w-[200px]"
              />
              <Button
                size="sm"
                onClick={handleGenerateAI}
                disabled={!aiPrompt.trim() || isGenerating}
                className="h-7"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 mr-1" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      default:
        return (
          <div className="text-xs text-zinc-500">
            Select a tool to see options. Shortcuts: V (Select), C (Crop), B (Brush), T (Text)
          </div>
        );
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col border-b border-zinc-200 dark:border-zinc-700">
        {/* Row 1: Tool buttons and action buttons */}
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800">
          {/* Left: Tool buttons */}
          <div className="flex items-center gap-1">
            {toolButtons.map(({ tool, icon, label, shortcut }) => (
              <Tooltip key={tool}>
                <TooltipTrigger asChild>
                  <Button
                    variant={state.tool === tool ? 'default' : 'ghost'}
                    size="icon-sm"
                    onClick={() => actions.setTool(tool)}
                  >
                    {icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{label}{shortcut ? ` (${shortcut})` : ''}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={actions.undo}
                  disabled={!state.canUndo}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Undo (Cmd+Z)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={actions.redo}
                  disabled={!state.canRedo}
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Redo (Cmd+Shift+Z)</p>
              </TooltipContent>
            </Tooltip>

            <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600 mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={actions.clear}
                  disabled={!state.hasContent}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear All</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="icon-sm"
                  onClick={onSave}
                  disabled={!state.hasContent}
                >
                  <Save className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Save (Cmd+S)</p>
              </TooltipContent>
            </Tooltip>

            {modeToggle && (
              <>
                <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600 mx-1" />
                {modeToggle}
              </>
            )}
          </div>
        </div>

        {/* Row 2: Tool options */}
        <div className="flex items-center px-3 py-2 bg-zinc-100/50 dark:bg-zinc-800/50 min-h-[40px] overflow-x-auto">
          {renderToolOptions()}
        </div>

        {/* Row 3: Reference Bar (conditional) */}
        {state.tool === 'ai' && state.isSelectingReference && (
          <ReferenceBar
            images={state.additionalReferenceImages}
            onRemove={actions.removeReferenceImage}
            onAddFromClipboard={() => onAddReferenceFromClipboard?.()}
            onAddFromFile={() => onAddReferenceFromFile?.()}
            onCollapse={() => {
              actions.setSelectingReference(false);
              onReferenceBarToggle?.(false);
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
