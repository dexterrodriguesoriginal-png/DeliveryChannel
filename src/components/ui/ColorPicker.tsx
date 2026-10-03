import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Check, Palette } from 'lucide-react';
import { Button } from './Button';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onApply?: (color: string) => void;
  onResetDefault?: () => void;
  defaultColor?: string;
  label?: string;
}

// Helper conversions
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360;
  s /= 100;
  l /= 100;

  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return { r, g, b };
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  color,
  onChange,
  onApply,
  onResetDefault,
  defaultColor = '#15803d',
  label = 'Seletor de Cor Profissional',
}) => {
  const [currentColor, setCurrentColor] = useState(color);
  const [format, setFormat] = useState<'HEX' | 'RGB' | 'HSL'>('HEX');
  const satValRef = useRef<HTMLDivElement>(null);
  const isDraggingSatVal = useRef(false);

  // Compute RGB and HSL representations
  const rgb = hexToRgb(currentColor);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  useEffect(() => {
    setCurrentColor(color);
  }, [color]);

  const updateColorHex = (newHex: string) => {
    setCurrentColor(newHex);
    onChange(newHex);
  };

  // Handlers for inputs
  const handleRgbChange = (channel: 'r' | 'g' | 'b', val: number) => {
    const newRgb = { ...rgb, [channel]: Math.max(0, Math.min(255, val || 0)) };
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    updateColorHex(newHex);
  };

  const handleHslChange = (channel: 'h' | 's' | 'l', val: number) => {
    const newHsl = { ...hsl, [channel]: val };
    const newRgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    updateColorHex(newHex);
  };

  const handleHueSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hue = parseInt(e.target.value, 10);
    handleHslChange('h', hue);
  };

  // Interactive 2D Saturation / Lightness canvas click & drag
  const handleSatValPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!satValRef.current) return;
    const rect = satValRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const s = Math.round((x / rect.width) * 100);
    const v = Math.round((1 - y / rect.height) * 100);
    // Approximate HSV to HSL
    const l = (v / 100) * (1 - s / 200) * 100;
    const finalS = l === 0 || l === 100 ? 0 : ((v - l) / Math.min(l, 100 - l)) * 100;

    const newRgb = hslToRgb(hsl.h, Math.round(finalS || 0), Math.round(l));
    updateColorHex(rgbToHex(newRgb.r, newRgb.g, newRgb.b));
  };

  const PRESET_COLORS = [
    { label: 'Verde Adega', hex: '#15803d' },
    { label: 'Esmeralda', hex: '#059669' },
    { label: 'Craft Amber', hex: '#d97706' },
    { label: 'San Marzano', hex: '#dc2626' },
    { label: 'Vinho Tinto', hex: '#831843' },
    { label: 'Ouro Real', hex: '#eab308' },
    { label: 'Azul Nobre', hex: '#1e40af' },
    { label: 'Slate Dark', hex: '#1e293b' },
  ];

  return (
    <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4 max-w-sm">
      <div className="flex items-center justify-between pb-1 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-emerald-700" />
          <span className="font-bold text-xs text-gray-900">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-5 h-5 rounded-full border border-gray-300 shadow-2xs"
            style={{ backgroundColor: currentColor }}
          />
          <span className="font-mono text-xs font-bold text-gray-700">{currentColor.toUpperCase()}</span>
        </div>
      </div>

      {/* 2D Saturation/Lightness Visual Picker */}
      <div
        ref={satValRef}
        onMouseDown={(e) => {
          isDraggingSatVal.current = true;
          handleSatValPointer(e);
        }}
        onMouseMove={(e) => {
          if (isDraggingSatVal.current) handleSatValPointer(e);
        }}
        onMouseUp={() => {
          isDraggingSatVal.current = false;
        }}
        className="relative h-32 w-full rounded-xl cursor-crosshair overflow-hidden select-none"
        style={{
          backgroundColor: `hsl(${hsl.h}, 100%, 50%)`,
          backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
        }}
      >
        {/* Circular Pointer Indicator */}
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${hsl.s}%`,
            top: `${100 - hsl.l}%`,
            backgroundColor: currentColor,
          }}
        />
      </div>

      {/* Hue Rainbow Slider */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-gray-500 font-medium">
          <span>Tonalidade (Hue)</span>
          <span className="font-mono">{hsl.h}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          value={hsl.h}
          onChange={handleHueSlider}
          className="w-full h-3 rounded-lg appearance-none cursor-pointer"
          style={{
            background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          }}
        />
      </div>

      {/* Format Selector: HEX | RGB | HSL */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg text-[10px] font-bold">
          {(['HEX', 'RGB', 'HSL'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setFormat(fmt)}
              className={`px-2 py-0.5 rounded-md cursor-pointer transition-all ${
                format === fmt ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>

        {/* Inputs based on format */}
        {format === 'HEX' && (
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-xs font-mono">#</span>
            <input
              type="text"
              value={currentColor.replace('#', '')}
              onChange={(e) => {
                const val = `#${e.target.value}`;
                if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                  setCurrentColor(val);
                  if (val.length === 7) onChange(val);
                }
              }}
              maxLength={6}
              className="w-20 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono uppercase text-center font-bold outline-none focus:border-emerald-600"
            />
          </div>
        )}

        {format === 'RGB' && (
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <input
              type="number"
              min="0"
              max="255"
              value={rgb.r}
              onChange={(e) => handleRgbChange('r', parseInt(e.target.value, 10))}
              className="w-12 px-1 py-1 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold"
              placeholder="R"
            />
            <input
              type="number"
              min="0"
              max="255"
              value={rgb.g}
              onChange={(e) => handleRgbChange('g', parseInt(e.target.value, 10))}
              className="w-12 px-1 py-1 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold"
              placeholder="G"
            />
            <input
              type="number"
              min="0"
              max="255"
              value={rgb.b}
              onChange={(e) => handleRgbChange('b', parseInt(e.target.value, 10))}
              className="w-12 px-1 py-1 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold"
              placeholder="B"
            />
          </div>
        )}

        {format === 'HSL' && (
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <input
              type="number"
              min="0"
              max="360"
              value={hsl.h}
              onChange={(e) => handleHslChange('h', parseInt(e.target.value, 10))}
              className="w-11 px-1 py-1 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold"
              placeholder="H"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={hsl.s}
              onChange={(e) => handleHslChange('s', parseInt(e.target.value, 10))}
              className="w-11 px-1 py-1 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold"
              placeholder="S%"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={hsl.l}
              onChange={(e) => handleHslChange('l', parseInt(e.target.value, 10))}
              className="w-11 px-1 py-1 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold"
              placeholder="L%"
            />
          </div>
        )}
      </div>

      {/* Preset Swatches */}
      <div className="space-y-1.5 pt-1">
        <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Paleta Gastronomia & Bebidas</span>
        <div className="grid grid-cols-8 gap-1.5">
          {PRESET_COLORS.map((p) => (
            <button
              key={p.hex}
              type="button"
              title={p.label}
              onClick={() => updateColorHex(p.hex)}
              className={`w-6 h-6 rounded-lg border transition-transform hover:scale-110 cursor-pointer ${
                currentColor.toLowerCase() === p.hex.toLowerCase() ? 'ring-2 ring-emerald-500 scale-105 border-white' : 'border-gray-200'
              }`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
      </div>

      {/* Action Buttons: APLICAR & RESTAURAR PADRÃO */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 gap-2">
        {onResetDefault && (
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => {
              updateColorHex(defaultColor);
              if (onResetDefault) onResetDefault();
            }}
            leftIcon={<RefreshCw className="w-3.5 h-3.5 text-gray-500" />}
            className="text-xs py-1.5 h-8 flex-1"
          >
            Restaurar Padrão
          </Button>
        )}

        {onApply && (
          <Button
            size="sm"
            variant="primary"
            type="button"
            onClick={() => onApply(currentColor)}
            leftIcon={<Check className="w-3.5 h-3.5" />}
            className="text-xs py-1.5 h-8 flex-1 bg-emerald-700 hover:bg-emerald-800"
          >
            Aplicar
          </Button>
        )}
      </div>
    </div>
  );
};
