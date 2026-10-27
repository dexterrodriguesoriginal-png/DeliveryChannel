import React, { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download, KeyRound, PauseCircle, Pencil, PlayCircle, Printer, Trash2, X } from 'lucide-react';
import { validateTableName, TABLE_NAME_MAX } from '../../../lib/salon/tableQr';
import './mesasQr.css';

export interface TableQrCardProps {
  id: string;
  label: string;
  area: string | null;
  seats: number;
  active: boolean;
  url: string;
  index: number;
  selected: boolean;
  paused: boolean;
  storePaused: boolean;
  canPause: boolean;
  canRotate: boolean;
  otherLabels: string[];
  busy: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onRename: (id: string, label: string) => Promise<void>;
  onCopy: (id: string) => void;
  onDownload: (id: string, svg: SVGElement | null) => void;
  onPrint: (id: string) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePause: (id: string) => void;
}

export const TableQrCard: React.FC<TableQrCardProps> = React.memo(props => {
  const { id, label, area, seats, active, url, index, selected, paused, storePaused, canPause, canRotate, otherLabels, busy } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const off = paused || storePaused;

  const save = async () => {
    const problem = draft.trim() === label ? null : validateTableName(draft, otherLabels);
    if (problem) { setError(problem); return; }
    if (draft.trim() === label) { setEditing(false); return; }
    setSaving(true);
    try { await props.onRename(id, draft.trim()); setEditing(false); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível renomear.'); }
    finally { setSaving(false); }
  };

  return (
    <article className="mq-card" data-selected={selected} data-paused={off} style={{ ['--i' as string]: Math.min(index, 30) } as React.CSSProperties} data-testid={`mq-card-${id}`} aria-label={`QR da ${label}`}>
      <div className="flex items-start justify-between gap-2">
        <label className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={selected} onChange={event => props.onSelect(id, event.target.checked)} aria-label={`Selecionar ${label} para impressão`} />Imprimir
        </label>
        <div className="flex flex-wrap justify-end gap-1">
          {off && <span className="mq-badge bg-amber-100 text-amber-950"><PauseCircle className="h-3 w-3" aria-hidden="true" />{storePaused && !paused ? 'Loja pausada' : 'QR pausado'}</span>}
          {!active && <span className="mq-badge bg-slate-200 text-slate-800">Inativa</span>}
        </div>
      </div>

      <div ref={qrRef} className="mq-qr" data-testid={`mq-qr-${id}`}>
        {url
          ? <QRCodeSVG value={url} size={150} level="Q" marginSize={1} title={`QR Code da ${label}`} />
          : <div className="grid h-[150px] w-[150px] place-items-center text-center text-xs font-bold text-rose-800">Link indisponível: confira o endereço (slug) da loja.</div>}
      </div>

      {editing ? (
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600" htmlFor={`mq-name-${id}`}>Nome da mesa (3 a {TABLE_NAME_MAX} caracteres)</label>
          <div className="flex gap-2">
            <input id={`mq-name-${id}`} className="mq-field" value={draft} maxLength={TABLE_NAME_MAX + 5} aria-invalid={!!error} autoFocus
              onChange={event => { setDraft(event.target.value); setError(null); }}
              onKeyDown={event => { if (event.key === 'Enter') void save(); if (event.key === 'Escape') { setEditing(false); setDraft(label); setError(null); } }} />
            <button type="button" className="mq-icon-btn !min-h-[42px] !w-11" onClick={() => void save()} disabled={saving} aria-label="Salvar nome"><Check className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" className="mq-icon-btn !min-h-[42px] !w-11" onClick={() => { setEditing(false); setDraft(label); setError(null); }} aria-label="Cancelar edição"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0"><h3 className="truncate text-lg font-black text-slate-900" title={label}>{label}</h3><p className="truncate text-xs font-semibold text-slate-600">{area || 'Salão'} · {seats} lugares</p></div>
          <button type="button" className="mq-icon-btn !min-h-[44px] !w-11 shrink-0" onClick={() => { setDraft(label); setEditing(true); }} aria-label={`Renomear ${label}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}

      <div className="mq-actions">
        <button type="button" className="mq-icon-btn" onClick={() => props.onCopy(id)} disabled={!url}><Copy className="h-4 w-4" aria-hidden="true" />Link</button>
        <button type="button" className="mq-icon-btn" onClick={() => props.onDownload(id, qrRef.current?.querySelector('svg') ?? null)} disabled={!url || busy}><Download className="h-4 w-4" aria-hidden="true" />PNG</button>
        <button type="button" className="mq-icon-btn" onClick={() => props.onPrint(id)} disabled={!url}><Printer className="h-4 w-4" aria-hidden="true" />Imprimir</button>
        <button type="button" className="mq-icon-btn mq-icon-btn--danger" onClick={() => props.onDelete(id)} disabled={busy} aria-label={`Excluir ${label}`}><Trash2 className="h-4 w-4" aria-hidden="true" />Excluir</button>
      </div>
      {(canRotate || canPause) && (
        <div className="grid grid-cols-2 gap-2">
          {canPause && <button type="button" className="mq-ghost justify-center !min-h-[40px] !text-xs" onClick={() => props.onTogglePause(id)} aria-pressed={paused} disabled={busy} data-testid={`mq-pause-${id}`}>
            {paused ? <PlayCircle className="h-4 w-4" aria-hidden="true" /> : <PauseCircle className="h-4 w-4" aria-hidden="true" />}<span aria-hidden="true">{paused ? 'Retomar' : 'Pausar'}</span><span className="sr-only">{paused ? `Retomar QR da ${label}` : `Pausar QR da ${label}`}</span></button>}
          {canRotate && <button type="button" className="mq-ghost justify-center !min-h-[40px] !text-xs" onClick={() => props.onRotate(id)} disabled={busy}><KeyRound className="h-4 w-4" aria-hidden="true" /><span aria-hidden="true">Novo QR</span><span className="sr-only">Gerar novo QR da {label}</span></button>}
        </div>
      )}
    </article>
  );
});
TableQrCard.displayName = 'TableQrCard';
