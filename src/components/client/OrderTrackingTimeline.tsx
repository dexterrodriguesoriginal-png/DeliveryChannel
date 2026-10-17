import React from 'react';
import { Check } from 'lucide-react';
import type { CustomerTimeline } from '../../lib/orders/customerTracking';

function hhmm(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Linha do tempo vertical do pedido (cliente). Atualiza a cada recarga da lista (polling da aba Pedidos). */
export const OrderTrackingTimeline: React.FC<{ timeline: CustomerTimeline; accentColor?: string }> = ({ timeline, accentColor }) => {
  const accent = accentColor || '#059669';
  return (
    <ol className="bg-slate-50 border border-slate-200/70 rounded-2xl p-3.5 space-y-0" aria-label="Etapas do pedido">
      {timeline.steps.map((step, i) => {
        const last = i === timeline.steps.length - 1;
        const done = step.state === 'done';
        const current = step.state === 'current';
        return (
          <li key={step.key} className="relative flex gap-3 pb-3 last:pb-0" data-step={step.key} data-state={step.state}>
            {!last && (
              <span
                className="absolute left-[11px] top-6 bottom-0 w-0.5 rounded-full"
                style={{ backgroundColor: done ? accent : '#e2e8f0' }}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                done ? 'text-white' : current ? 'text-white ring-4 ring-emerald-100 animate-pulse' : 'bg-white border border-slate-300 text-slate-400'
              }`}
              style={done || current ? { backgroundColor: accent } : undefined}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </span>
            <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
              <span
                className={`text-xs leading-6 ${
                  current ? 'font-black text-gray-900' : done ? 'font-bold text-gray-800' : 'font-medium text-slate-400'
                }`}
              >
                {step.label}
                {current && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">agora</span>}
              </span>
              {step.at && (done || current) && (
                <span className="text-[10px] font-mono text-slate-500 shrink-0">{hhmm(step.at)}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
