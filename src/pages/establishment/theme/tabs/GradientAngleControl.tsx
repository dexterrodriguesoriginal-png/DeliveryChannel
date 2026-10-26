import React from 'react';

export const ANGLE_PRESETS = [0, 45, 90, 135, 180] as const;

/** Normaliza qualquer entrada para um ângulo inteiro entre 0 e 360. */
export function normalizeAngle(v: unknown, fallback = 135): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(360, Math.max(0, n));
}

/** Ângulo do gradiente linear: slider 0–360°, atalhos e campo numérico (mesmo valor nos três). */
export function GradientAngleControl({ angle, onChange }: { angle: number | undefined; onChange: (angle: number) => void }) {
  const value = normalizeAngle(angle);
  return (
    <div className="space-y-2" data-testid="gradient-angle-control">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="gradient-angle-range" className="text-[11px] font-bold text-gray-600">Direção do gradiente</label>
        <div className="flex items-center gap-1">
          <input
            data-testid="gradient-angle-input"
            type="number" min={0} max={360} step={1} inputMode="numeric"
            aria-label="Ângulo em graus"
            value={value}
            onChange={(e) => onChange(normalizeAngle(e.target.value, value))}
            className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-right text-xs font-semibold tabular-nums"
          />
          <span className="text-xs text-gray-500">°</span>
        </div>
      </div>
      <input
        id="gradient-angle-range"
        data-testid="gradient-angle-range"
        type="range" min={0} max={360} step={1}
        value={value}
        onChange={(e) => onChange(normalizeAngle(e.target.value, value))}
        className="w-full accent-emerald-700"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de ângulo">
        {ANGLE_PRESETS.map((a) => (
          <button
            key={a} type="button" data-testid={`gradient-angle-preset-${a}`}
            aria-pressed={value === a}
            onClick={() => onChange(a)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${value === a ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}
          >
            <span aria-hidden="true" className="inline-block" style={{ transform: `rotate(${a}deg)` }}>↑</span>{a}°
          </button>
        ))}
      </div>
    </div>
  );
}
