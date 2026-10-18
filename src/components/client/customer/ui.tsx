import { createPortal } from 'react-dom';
import React, { useId, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../utils/cn';

/** Cabeçalho de tela interna (seta voltar + título), fixo no topo como no app do iFood. */
export const ScreenHeader: React.FC<{ title: string; onBack?: () => void; right?: React.ReactNode }> = ({ title, onBack, right }) => (
  <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-100 px-2 h-14 flex items-center gap-1">
    {onBack ? (
      <button type="button" onClick={onBack} aria-label="Voltar" className="w-10 h-10 rounded-full flex items-center justify-center text-gray-800 hover:bg-gray-100 active:bg-gray-200 cursor-pointer">
        <ArrowLeft className="w-5 h-5" />
      </button>
    ) : <span className="w-2" />}
    <h2 className="flex-1 text-[15px] font-extrabold text-gray-900 truncate">{title}</h2>
    {right}
  </div>
);

/** Linha de menu (ícone + título + subtítulo + seta). */
export const MenuRow: React.FC<{
  icon?: React.ReactNode; title: string; subtitle?: string; onClick?: () => void; right?: React.ReactNode; danger?: boolean; testId?: string;
}> = ({ icon, title, subtitle, onClick, right, danger, testId }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer"
  >
    {icon && <span className={cn('w-6 h-6 flex items-center justify-center shrink-0', danger ? 'text-rose-600' : 'text-gray-700')}>{icon}</span>}
    <span className="flex-1 min-w-0">
      <span className={cn('block text-sm font-semibold', danger ? 'text-rose-600' : 'text-gray-900')}>{title}</span>
      {subtitle && <span className="block text-xs text-gray-500 truncate">{subtitle}</span>}
    </span>
    {right ?? <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
  </button>
);

/** Duração da animação do acordeão; toques nesse intervalo são ignorados (evita abrir e fechar no mesmo gesto). */
export const ACCORDION_ANIM_MS = 320;

/**
 * Decide se um toque deve alternar o acordeão. Ignora o 2º toque dentro da animação (toque duplo, clique
 * fantasma do touch ou conteúdo se deslocando sob o dedo).
 */
export function shouldAcceptToggle(lastToggleAt: number, now: number, windowMs = ACCORDION_ANIM_MS): boolean {
  return now - lastToggleAt >= windowMs;
}

/** Acordeão animado (altura via grid-rows 0fr → 1fr), um único handler de toque. */
export const Accordion: React.FC<{
  icon?: React.ReactNode; title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode; testId?: string;
  /** Controlado pelo pai (mantém aberto ao voltar de uma subpágina). */
  open?: boolean; onOpenChange?: (open: boolean) => void;
}> = ({ icon, title, subtitle, defaultOpen = false, children, testId, open: openProp, onOpenChange }) => {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const lastToggle = useRef(0);
  const panelId = useId();
  const onToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (!shouldAcceptToggle(lastToggle.current, now)) return;
    lastToggle.current = now;
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  return (
    <div data-testid={testId} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer select-none touch-manipulation"
      >
        {icon && <span className="w-6 h-6 flex items-center justify-center shrink-0 text-gray-700">{icon}</span>}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-gray-900">{title}</span>
          {subtitle && <span className="block text-xs text-gray-500 truncate">{subtitle}</span>}
        </span>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <div id={panelId} inert={!open} className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="overflow-hidden">
          <div className="pl-10 border-l-0">{children}</div>
        </div>
      </div>
    </div>
  );
};

export const SkeletonRows: React.FC<{ rows?: number; withImage?: boolean }> = ({ rows = 4, withImage = true }) => (
  <div className="space-y-3" aria-busy="true" aria-label="Carregando">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="p-3.5 bg-white rounded-2xl border border-gray-100 flex items-center gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-2/3 rounded-md bg-gray-200/80 animate-pulse" />
          <div className="h-3 w-full rounded-md bg-gray-100 animate-pulse" />
          <div className="h-3.5 w-1/4 rounded-md bg-gray-200/80 animate-pulse" />
        </div>
        {withImage && <div className="w-20 h-20 rounded-xl bg-gray-200/80 animate-pulse shrink-0" />}
      </div>
    ))}
  </div>
);

export const EmptyBlock: React.FC<{ icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode; testId?: string }> = ({ icon, title, text, action, testId }) => (
  <div data-testid={testId} className="py-12 px-6 text-center space-y-3">
    <div className="w-16 h-16 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">{icon}</div>
    <h3 className="font-extrabold text-gray-900 text-base">{title}</h3>
    {text && <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed">{text}</p>}
    {action}
  </div>
);

/** Folha inferior (bottom sheet) para menus de ação e confirmações no celular. */
export const BottomSheet: React.FC<{ open: boolean; onClose: () => void; title?: string; children: React.ReactNode }> = ({ open, onClose, title, children }) => {
  if (!open) return null;
  // Portal: telas com animação (transform) virariam o "containing block" do fixed e cortariam a folha.
  const sheet = (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-gray-900/40 dc-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dc-slide-up">
        <div className="w-10 h-1.5 rounded-full bg-gray-200 mx-auto mb-3" />
        {title && <h3 className="text-base font-extrabold text-gray-900 mb-2 px-1">{title}</h3>}
        {children}
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
};

export const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { color: string; loading?: boolean }> = ({ color, loading, className, children, disabled, ...rest }) => (
  <button
    type="button"
    {...rest}
    disabled={disabled || loading}
    className={cn('w-full h-12 rounded-xl text-white font-extrabold text-sm shadow-sm transition-opacity hover:opacity-95 active:opacity-90 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2', className)}
    style={{ backgroundColor: color }}
  >
    {loading ? <span className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" /> : children}
  </button>
);
