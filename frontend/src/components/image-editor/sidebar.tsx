'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Check, X } from 'lucide-react';
import type { SidebarProps, CropRatio } from './types';
import { PRESET_COLORS, FONT_OPTIONS, FILTER_PRESETS, CROP_RATIOS } from './types';

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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="w-8 h-8 rounded border border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 transition-all shadow-sm"
              style={{ backgroundColor: value }}
              title={value}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="end">
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
    </div>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs text-zinc-500">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  );
}

export function Sidebar({ state, actions }: SidebarProps) {
  const renderToolPanel = () => {
    switch (state.tool) {
      case 'brush':
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Brush Settings</h3>
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
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Text Settings</h3>
            <ColorPicker
              label="Color"
              value={state.textColor}
              onChange={actions.setTextColor}
            />
            <div className="space-y-2">
              <Label className="text-xs">Font</Label>
              <Select value={state.textFont} onValueChange={actions.setTextFont}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((font) => (
                    <SelectItem key={font.value} value={font.value}>
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
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Crop Settings</h3>
            <div className="space-y-2">
              <Label className="text-xs">Aspect Ratio</Label>
              <Select
                value={state.cropRatio}
                onValueChange={(v) => actions.setCropRatio(v as CropRatio)}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CROP_RATIOS.map((ratio) => (
                    <SelectItem key={ratio.value} value={ratio.value}>
                      {ratio.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {state.isCropping && (
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1"
                  onClick={actions.applyCrop}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Apply
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={actions.cancelCrop}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            )}
            <p className="text-xs text-zinc-500">
              Draw a rectangle on the canvas to select the crop area.
            </p>
          </div>
        );

      case 'filter':
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Filter Settings</h3>
            <div className="space-y-2">
              <Label className="text-xs">Preset</Label>
              <div className="grid grid-cols-2 gap-2">
                {FILTER_PRESETS.map((filter) => (
                  <Button
                    key={filter.value}
                    variant={state.filter === filter.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => actions.setFilter(filter.value)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>
            <SliderControl
              label="Brightness"
              value={state.brightness}
              min={-100}
              max={100}
              onChange={actions.setBrightness}
            />
            <SliderControl
              label="Contrast"
              value={state.contrast}
              min={-100}
              max={100}
              onChange={actions.setContrast}
            />
            <SliderControl
              label="Saturation"
              value={state.saturation}
              min={-100}
              max={100}
              onChange={actions.setSaturation}
            />
          </div>
        );

      default:
        return (
          <div className="text-xs text-zinc-500">
            <p>Select a tool from the toolbar to see options here.</p>
            <p className="mt-2">
              <strong>Tips:</strong>
            </p>
            <ul className="mt-1 space-y-1 list-disc list-inside">
              <li>V - Select tool</li>
              <li>C - Crop tool</li>
              <li>B - Brush tool</li>
              <li>T - Text tool</li>
              <li>Delete - Remove selected</li>
              <li>Cmd+Z - Undo</li>
              <li>Cmd+S - Save</li>
            </ul>
          </div>
        );
    }
  };

  return (
    <div className="w-56 border-l border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 overflow-y-auto">
      {renderToolPanel()}
    </div>
  );
}
