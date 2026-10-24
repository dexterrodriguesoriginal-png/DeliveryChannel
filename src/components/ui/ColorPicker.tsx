import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Check, Palette, AlertTriangle, Pipette } from 'lucide-react';
import { Button } from './Button';

export interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onApply?: (color: string) => void;
  onResetDefault?: () => void;
  defaultColor?: string;
  label?: string;
  testIdPrefix?: string;
  showOpacity?: boolean;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
}

const VALID_HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHexInput(val: string): boolean {
  if (!val || typeof val !== 'string') return false;
  const normalized = val.trim().startsWith('#') ? val.trim() : `#${val.trim()}`;
  return VALID_HEX_REGEX.test(normalized);
}

export function normalizeHexInput(val: string, fallback = '#15803d'): string {
  if (!val || typeof val !== 'string') return fallback;
  const clean = (val.trim().startsWith('#') ? val.trim() : `#${val.trim()}`).toLowerCase();
  if (!VALID_HEX_REGEX.test(clean)) return fallback;
  if (clean.length === 4) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  }
  return clean;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHexInput(hex, '#15803d');
  const num = parseInt(norm.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Converte RGB (0-255) para HSV (h: 0-360, s: 0-100, v: 0-100) com precisão para o seletor 2D
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  if (max !== min) {
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }

  return {
    h: Number(h.toFixed(2)),
    s: Number(s.toFixed(2)),
    v: Number(v.toFixed(2)),
  };
}

/**
 * Converte HSV (h: 0-360, s: 0-100, v: 0-100) para RGB (0-255)
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const vn = Math.max(0, Math.min(100, v)) / 100;

  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hn >= 0 && hn < 60) {
    rPrime = c;
    gPrime = x;
    bPrime = 0;
  } else if (hn >= 60 && hn < 120) {
    rPrime = x;
    gPrime = c;
    bPrime = 0;
  } else if (hn >= 120 && hn < 180) {
    rPrime = 0;
    gPrime = c;
    bPrime = x;
  } else if (hn >= 180 && hn < 240) {
    rPrime = 0;
    gPrime = x;
    bPrime = c;
  } else if (hn >= 240 && hn < 300) {
    rPrime = x;
    gPrime = 0;
    bPrime = c;
  } else {
    rPrime = c;
    gPrime = 0;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
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

/**
 * Calcula coordenadas normalizadas (s: 0-100, v: 0-100, leftPercent: 0-100, topPercent: 0-100)
 * a partir da posição do ponteiro e dos limites (DOMRect) do seletor 2D.
 */
export function computePointerSaturationValue(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): { s: number; v: number; leftPercent: number; topPercent: number } {
  const width = rect.width > 0 ? rect.width : 200;
  const height = rect.height > 0 ? rect.height : 128;

  const clampedX = Math.max(0, Math.min(width, clientX - rect.left));
  const clampedY = Math.max(0, Math.min(height, clientY - rect.top));

  const leftPercent = Number(((clampedX / width) * 100).toFixed(2));
  const topPercent = Number(((clampedY / height) * 100).toFixed(2));
  const s = leftPercent;
  const v = Number((100 - topPercent).toFixed(2));

  return { s, v, leftPercent, topPercent };
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  color,
  onChange,
  onApply,
  onResetDefault,
  defaultColor = '#15803d',
  label = 'Seletor de Cor Profissional',
  testIdPrefix = 'color-picker',
  showOpacity = false,
  opacity = 100,
  onOpacityChange,
}) => {
  const initialHex = normalizeHexInput(color, defaultColor);
  const [currentColor, setCurrentColor] = useState<string>(initialHex);
  const [hsv, setHsv] = useState<{ h: number; s: number; v: number }>(() => hexToHsv(initialHex));
  const [hexDraft, setHexDraft] = useState<string>(initialHex.replace('#', '').toUpperCase());
  const [hexError, setHexError] = useState<string | null>(null);
  const [format, setFormat] = useState<'HEX' | 'RGB' | 'HSL'>('HEX');

  const satValRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const lastEmittedHexRef = useRef<string>(initialHex.toLowerCase());
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;

  // Sincroniza quando a cor externa muda (ex: usuário trocou de alvo de cor no editor)
  useEffect(() => {
    if (!isValidHexInput(color)) return;
    const norm = normalizeHexInput(color, defaultColor);
    setCurrentColor(norm);
    setHexDraft(norm.replace('#', '').toUpperCase());
    setHexError(null);

    if (norm.toLowerCase() !== lastEmittedHexRef.current.toLowerCase()) {
      const nextHsv = hexToHsv(norm);
      setHsv(nextHsv);
      lastEmittedHexRef.current = norm.toLowerCase();
    }
  }, [color, defaultColor]);

  // Recalcula limites caso o container mude de tamanho (ResizeObserver)
  useEffect(() => {
    const el = satValRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // As coordenadas percentuais (hsv.s% e 100-hsv.v%) se adaptam automaticamente
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const emitValidHexAndSync = useCallback(
    (newHex: string, nextHsv?: { h: number; s: number; v: number }) => {
      const norm = normalizeHexInput(newHex, currentColor);
      lastEmittedHexRef.current = norm.toLowerCase();
      setCurrentColor(norm);
      setHexDraft(norm.replace('#', '').toUpperCase());
      setHexError(null);
      if (nextHsv) {
        setHsv(nextHsv);
      } else {
        setHsv(hexToHsv(norm));
      }
      onChange(norm);
    },
    [currentColor, onChange]
  );

  // Atualiza a posição do cursor 2D e calcula o HEX correspondente
  const updateFromPointerCoordinates = useCallback(
    (clientX: number, clientY: number) => {
      const el = satValRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { s, v } = computePointerSaturationValue(clientX, clientY, rect);
      const currentH = hsvRef.current.h;
      const nextHsv = { h: currentH, s, v };
      const nextHex = hsvToHex(currentH, s, v);
      emitValidHexAndSync(nextHex, nextHsv);
    },
    [emitValidHexAndSync]
  );

  // Manipuladores de Pointer Events com Pointer Capture contínuo
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    isDraggingRef.current = true;
    updateFromPointerCoordinates(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    updateFromPointerCoordinates(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Suporte à Eyedropper API (conta-gotas nativo do navegador)
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const handleEyeDropper = async () => {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          emitValidHexAndSync(result.sRGBHex);
        }
      } catch {
        // Usuário cancelou a seleção com conta-gotas
      }
    }
  };

  // Listeners globais como fallback para mouse e toque
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      updateFromPointerCoordinates(e.clientX, e.clientY);
    };

    const handleWindowMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
      }
    };

    const handleWindowTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || !e.touches[0]) return;
      updateFromPointerCoordinates(e.touches[0].clientX, e.touches[0].clientY);
    };

    const handleWindowTouchEnd = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('touchmove', handleWindowTouchMove, { passive: true });
    window.addEventListener('touchend', handleWindowTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowTouchEnd);
    };
  }, [updateFromPointerCoordinates]);

  const rgb = hexToRgb(currentColor);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const handleRgbChange = (channel: 'r' | 'g' | 'b', val: number) => {
    const clamped = Math.max(0, Math.min(255, Number.isNaN(val) ? 0 : val));
    const newRgb = { ...rgb, [channel]: clamped };
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    emitValidHexAndSync(newHex);
  };

  const handleHslChange = (channel: 'h' | 's' | 'l', val: number) => {
    const maxVal = channel === 'h' ? 360 : 100;
    const clamped = Math.max(0, Math.min(maxVal, Number.isNaN(val) ? 0 : val));
    const newHsl = { ...hsl, [channel]: clamped };
    const newRgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    emitValidHexAndSync(newHex);
  };

  const handleHueSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHue = Number(e.target.value);
    const nextHsv = { h: newHue, s: hsv.s, v: hsv.v };
    const newHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
    emitValidHexAndSync(newHex, nextHsv);
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/^#/, '');
    setHexDraft(raw.toUpperCase());

    const candidate = `#${raw.trim()}`;
    if (/^#[0-9a-fA-F]{6}$/.test(candidate)) {
      const norm = candidate.toLowerCase();
      const nextHsv = hexToHsv(norm);
      emitValidHexAndSync(norm, nextHsv);
    } else if (raw.trim().length === 0) {
      setHexError('Informe um código hexadecimal válido');
    } else if (!/^[0-9a-fA-F]{0,6}$/.test(raw.trim())) {
      setHexError('Caracteres inválidos (use 0-9 e A-F)');
    } else {
      setHexError(null);
    }
  };

  const handleHexInputBlur = () => {
    const candidate = `#${hexDraft.trim()}`;
    if (VALID_HEX_REGEX.test(candidate)) {
      const norm = normalizeHexInput(candidate, currentColor);
      emitValidHexAndSync(norm, hexToHsv(norm));
    } else {
      // Não apaga silenciosamente a cor válida anterior; restaura o texto válido e limpa erro
      setHexDraft(currentColor.replace('#', '').toUpperCase());
      setHexError(null);
    }
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

  const cursorLeftPercent = Number(hsv.s.toFixed(2));
  const cursorTopPercent = Number((100 - hsv.v).toFixed(2));

  return (
    <div
      className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4 max-w-sm"
      data-testid={`${testIdPrefix}-root`}
    >
      <div className="flex items-center justify-between pb-1 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-emerald-700" />
          <span className="font-bold text-xs text-gray-900">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            data-testid={`${testIdPrefix}-swatch`}
            className="w-5 h-5 rounded-full border border-gray-300 shadow-2xs"
            style={{ backgroundColor: currentColor }}
          />
          <span
            data-testid={`${testIdPrefix}-display-hex`}
            className="font-mono text-xs font-bold text-gray-700"
          >
            {currentColor.toUpperCase()}
          </span>
        </div>
      </div>

      {/* 2D HSV Saturation / Value Visual Picker com Pointer Capture contínuo */}
      <div
        ref={satValRef}
        data-testid={`${testIdPrefix}-surface`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseDown={(e) => {
          isDraggingRef.current = true;
          updateFromPointerCoordinates(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          if (!e.touches[0]) return;
          isDraggingRef.current = true;
          updateFromPointerCoordinates(e.touches[0].clientX, e.touches[0].clientY);
        }}
        className="relative h-32 w-full rounded-xl cursor-crosshair overflow-hidden select-none touch-none"
        style={{
          backgroundColor: `hsl(${Math.round(hsv.h)}, 100%, 50%)`,
          backgroundImage:
            'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
        }}
      >
        {/* Circular Pointer Indicator Synchronized with Exact HSV Coordinates */}
        <div
          data-testid={`${testIdPrefix}-cursor`}
          data-left={cursorLeftPercent}
          data-top={cursorTopPercent}
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2 ring-1 ring-black/30"
          style={{
            left: `${cursorLeftPercent}%`,
            top: `${cursorTopPercent}%`,
            backgroundColor: currentColor,
          }}
        />
      </div>

      {/* Hue Rainbow Slider */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-gray-500 font-medium">
          <span>Tonalidade (Hue)</span>
          <span className="font-mono">{Math.round(hsv.h)}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          value={Math.round(hsv.h)}
          onChange={handleHueSlider}
          data-testid={`${testIdPrefix}-hue-slider`}
          className="w-full h-3 rounded-lg appearance-none cursor-pointer"
          style={{
            background:
              'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          }}
        />
      </div>

      {/* Opacidade Slider (quando habilitado, ex: Overlay) */}
      {showOpacity && onOpacityChange && (
        <div className="space-y-1 pt-1 border-t border-gray-100">
          <div className="flex justify-between text-[11px] text-gray-500 font-medium">
            <span>Opacidade / Transparência</span>
            <span className="font-mono">{opacity ?? 100}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={opacity ?? 100}
            onChange={(e) => onOpacityChange(Number(e.target.value))}
            data-testid={`${testIdPrefix}-opacity-slider`}
            className="w-full h-2.5 rounded-lg appearance-none cursor-pointer accent-emerald-700 bg-gray-200"
          />
        </div>
      )}

      {/* Format Selector: HEX | RGB | HSL */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg text-[10px] font-bold">
          {(['HEX', 'RGB', 'HSL'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setFormat(fmt)}
              className={`px-2 py-0.5 rounded-md cursor-pointer transition-all ${
                format === fmt
                  ? 'bg-white text-gray-900 shadow-2xs'
                  : 'text-gray-500 hover:text-gray-900'
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
              data-testid={`${testIdPrefix}-hex-input`}
              value={hexDraft}
              onChange={handleHexInputChange}
              onBlur={handleHexInputBlur}
              maxLength={7}
              aria-label={label}
              className={`w-20 px-2 py-1 bg-gray-50 border rounded-lg text-xs font-mono uppercase text-center font-bold outline-none ${
                hexError
                  ? 'border-rose-400 text-rose-700'
                  : 'border-gray-200 focus:border-emerald-600 text-gray-900'
              }`}
            />
            {hasEyeDropper && (
              <button
                type="button"
                data-testid={`${testIdPrefix}-eyedropper`}
                title="Conta-gotas (capturar cor da tela)"
                onClick={handleEyeDropper}
                className="p-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
              >
                <Pipette className="w-3.5 h-3.5" />
              </button>
            )}
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

      {hexError && (
        <p
          data-testid={`${testIdPrefix}-hex-error`}
          className="text-[11px] text-rose-600 font-medium flex items-center gap-1"
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{hexError}</span>
        </p>
      )}

      {/* Preset Swatches */}
      <div className="space-y-1.5 pt-1">
        <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">
          Paleta Gastronomia & Bebidas
        </span>
        <div className="grid grid-cols-8 gap-1.5">
          {PRESET_COLORS.map((p) => (
            <button
              key={p.hex}
              type="button"
              title={p.label}
              onClick={() => emitValidHexAndSync(p.hex, hexToHsv(p.hex))}
              className={`w-6 h-6 rounded-lg border transition-transform hover:scale-110 cursor-pointer ${
                currentColor.toLowerCase() === p.hex.toLowerCase()
                  ? 'ring-2 ring-emerald-500 scale-105 border-white'
                  : 'border-gray-200'
              }`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
      </div>

      {/* Action Buttons: APLICAR & RESTAURAR PADRÃO */}
      {(onResetDefault || onApply) && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 gap-2">
          {onResetDefault && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                emitValidHexAndSync(defaultColor, hexToHsv(defaultColor));
                onResetDefault();
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
      )}
    </div>
  );
};
