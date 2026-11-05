import React from 'react';
import { ArrowDownToLine, ArrowUpRight, BellRing, ChevronRight, ReceiptText, Smartphone, UtensilsCrossed } from 'lucide-react';

export interface DineInHomeTilesProps {
  storeName: string;
  tableName: string;
  logoUrl?: string | null;
  menuImageUrl?: string;
  /** Rótulo do bloco do cardápio (configurado pelo dono). */
  menuLabel?: string;
  storeAppHref?: string;
  onStoreAppClick?: React.MouseEventHandler<HTMLAnchorElement>;
  onOpenMenu: () => void;
  onCallWaiter: () => void;
  onRequestBill: () => void;
  waiterDisabled: boolean;
  billDisabled: boolean;
  billLabel?: string;
  actionHint?: string;
}

/** Navigation only: session authority and every table action stay with DineInClientApp. */
export const DineInHomeTiles: React.FC<DineInHomeTilesProps> = ({
  storeName, tableName, logoUrl, menuImageUrl, menuLabel = 'Cardápio', storeAppHref, onStoreAppClick,
  onOpenMenu, onCallWaiter, onRequestBill, waiterDisabled, billDisabled,
  billLabel = 'Pedir minha conta', actionHint,
}) => (
  <section aria-label="Início da mesa" className="space-y-5" data-testid="dinein-home">
    <div className="flex items-center gap-3 pt-1">
      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {logoUrl ? <img src={logoUrl} alt={storeName} className="h-full w-full object-cover" /> : <UtensilsCrossed aria-hidden="true" className="h-6 w-6 text-emerald-800" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-600">Boas-vindas a {storeName}</p>
        <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">O que vai ser hoje?</h1>
      </div>
    </div>

    <button type="button" aria-label={menuLabel} onClick={onOpenMenu} className="group relative isolate flex min-h-52 w-full overflow-hidden rounded-[1.75rem] bg-emerald-950 p-6 text-left text-white shadow-lg shadow-emerald-950/10 outline-none transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-4 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:min-h-60 sm:p-8">
      {menuImageUrl && <img src={menuImageUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-emerald-950 via-emerald-950/90 to-emerald-950/25" />
      <div className="flex w-full flex-col justify-between gap-7">
        <span className="self-start rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold">{tableName} · No seu tempo</span>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{menuLabel}</h2>
            <p className="mt-2 max-w-60 text-sm leading-relaxed text-emerald-50">Descubra os sabores da casa e escolha seus favoritos.</p>
          </div>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-emerald-950 transition group-hover:translate-x-1"><ArrowUpRight aria-hidden="true" className="h-6 w-6" /></span>
        </div>
      </div>
    </button>

    {storeAppHref && <a href={storeAppHref} target="_blank" rel="noopener noreferrer" onClick={onStoreAppClick} aria-label="Meu app" className="group flex min-h-28 items-center gap-4 rounded-3xl border border-violet-100 bg-violet-50 p-5 text-slate-950 outline-none transition hover:border-violet-300 hover:bg-violet-100 focus-visible:ring-4 focus-visible:ring-violet-500 focus-visible:ring-offset-2">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-violet-800 shadow-sm"><Smartphone aria-hidden="true" className="h-7 w-7" /></span>
      <div className="min-w-0 flex-1"><h2 className="text-lg font-black">Meu app</h2><p className="mt-1 text-sm leading-relaxed text-slate-600">Leve a loja com você. Peça também de casa.</p></div>
      <ArrowDownToLine aria-hidden="true" className="h-5 w-5 shrink-0 text-violet-800" />
    </a>}

    <div>
      <p className="mb-3 text-xs font-extrabold uppercase tracking-widest text-slate-500">À sua disposição</p>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" aria-label="Chamar garçom" disabled={waiterDisabled} title={waiterDisabled ? actionHint : undefined} onClick={onCallWaiter} className="flex min-h-36 flex-col items-start justify-between rounded-3xl border border-slate-200 bg-white p-5 text-left text-slate-900 shadow-sm outline-none transition enabled:hover:border-emerald-500 enabled:hover:shadow-md focus-visible:ring-4 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          <BellRing aria-hidden="true" className="h-6 w-6 text-emerald-800" />
          <span className="mt-4 flex w-full items-center justify-between gap-2 text-sm font-extrabold">Chamar garçom<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /></span>
        </button>
        <button type="button" aria-label={billLabel} disabled={billDisabled} title={billDisabled ? actionHint : undefined} onClick={onRequestBill} className="flex min-h-36 flex-col items-start justify-between rounded-3xl border border-slate-200 bg-white p-5 text-left text-slate-900 shadow-sm outline-none transition enabled:hover:border-emerald-500 enabled:hover:shadow-md focus-visible:ring-4 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          <ReceiptText aria-hidden="true" className="h-6 w-6 text-emerald-800" />
          <span className="mt-4 flex w-full items-center justify-between gap-2 text-sm font-extrabold">{billLabel}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /></span>
        </button>
      </div>
      {actionHint && <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">{actionHint}</p>}
    </div>
  </section>
);
