import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone } from 'lucide-react';

export function waiterEntryUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/garcom`;
}

export const WaiterPhonePairingCard: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const url = waiterEntryUrl(typeof window === 'undefined' ? 'https://deliverychannel.app' : window.location.origin);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="waiter-phone-pairing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-gray-900"><Smartphone className="h-4 w-4" />Acesso do garçom pelo celular</h3>
          <p className="mt-1 text-xs text-gray-600">Leia o QR no celular do colaborador. Depois de entrar com a conta convidada como Garçom, o painel abre direto no Salão.</p>
        </div>
        <button type="button" onClick={() => setExpanded(value => !value)} className="rounded-xl border px-3 py-2 text-sm font-bold">
          {expanded ? 'Ocultar QR' : 'Conectar celular'}
        </button>
      </div>
      {expanded && <div className="mt-4 flex flex-col items-center gap-3 rounded-xl bg-slate-50 p-4">
        <QRCodeSVG value={url} size={192} level="M" includeMargin aria-label="QR para acesso do garçom pelo celular" />
        <p className="break-all text-center text-xs text-slate-600">{url}</p>
      </div>}
    </section>
  );
};
