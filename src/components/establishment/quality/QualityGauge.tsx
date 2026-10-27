import React from 'react';
import { qualityColor } from '../../../lib/menu/menuQuality';
import { useAnimatedNumber } from '../../../lib/menu/useAnimatedNumber';
import './quality.css';

const R = 95;
const LEN = Math.PI * R;

/** Semicírculo animado com a nota (vermelho → âmbar → verde). `compact` reduz para o card do Dashboard. */
export const QualityGauge: React.FC<{ score: number; size?: number; label?: string; empty?: boolean }> = ({ score, size = 280, label = 'do cardápio otimizado', empty }) => {
  const shown = useAnimatedNumber(empty ? 0 : score);
  const color = empty ? '#cbd5e1' : qualityColor(shown);
  const small = size < 200;
  return (
    <div data-testid="quality-gauge" data-score={score} role="img" aria-label={empty ? 'Sem produtos para avaliar' : `${score}% ${label}`} style={{ width: size }} className="relative mx-auto select-none">
      <svg viewBox="0 0 240 140" width="100%" aria-hidden="true">
        <path d="M 25 120 A 95 95 0 0 1 215 120" fill="none" stroke="#e8ecef" strokeWidth="18" strokeLinecap="round" />
        <path className="mq-gauge-arc" d="M 25 120 A 95 95 0 0 1 215 120" fill="none" stroke={color} strokeWidth="18" strokeLinecap="round"
          strokeDasharray={LEN} strokeDashoffset={LEN * (1 - Math.max(0, Math.min(100, shown)) / 100)} />
        {[0, 50, 80, 100].map(t => {
          const a = Math.PI * (1 - t / 100);
          const x1 = 120 + Math.cos(a) * (R - 15), y1 = 120 - Math.sin(a) * (R - 15), x2 = 120 + Math.cos(a) * (R - 22), y2 = 120 - Math.sin(a) * (R - 22);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 text-center" style={{ bottom: small ? 0 : 6 }}>
        <div data-testid="quality-gauge-value" className="font-black tabular-nums leading-none tracking-tight text-slate-900" style={{ fontSize: small ? 22 : 54 }}>
          {empty ? '—' : `${Math.round(shown)}%`}
        </div>
        <div className="mt-1 font-semibold text-slate-500" style={{ fontSize: small ? 9 : 13 }}>{empty ? 'sem produtos' : label}</div>
      </div>
    </div>
  );
};
