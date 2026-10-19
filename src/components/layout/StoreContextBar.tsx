import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Bell, Check, Store } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { orderRepository } from '../../repositories/orderRepository';
import { StoreLogo } from '../client/StoreLogo';
import { buildStoreSwitcherEntries, otherStoresWithPending, pendingLabel, isStaffMembership } from '../../lib/tenant/storeSwitcher';

const ROLE_SHORT: Record<string, string> = {
  OWNER: 'Proprietário', MANAGER: 'Gerente', OPERATOR: 'Operador', CASHIER: 'Caixa', DELIVERY_MANAGER: 'Gestão de entregas',
};
const POLL_MS = 20000;

/**
 * 19/10: faixa fixa no topo do painel com a LOJA ATUAL bem visível (logo + nome + endereço /app/slug)
 * e o seletor com todas as lojas do usuário, cada uma com a contagem de pedidos novos.
 * Ex.: vendo "Espeto do Bahia", aparece "BAR DO NEY: 2 novos pedidos".
 */
export const StoreContextBar: React.FC = () => {
  const { activeTenant, activeRole, availableTenants, switchTenant } = useAuth();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const staffIds = useMemo(
    () => availableTenants.filter(isStaffMembership).map(m => m.tenantId).sort(),
    [availableTenants]
  );
  const idsKey = staffIds.join(',');

  const refresh = useCallback(async () => {
    if (staffIds.length === 0) return;
    try {
      setCounts(await orderRepository.countPendingByTenant(staffIds));
    } catch {
      // contagem é só informativa; mantém a última
    }
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh, activeTenant?.id]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const entries = useMemo(
    () => buildStoreSwitcherEntries(availableTenants, activeTenant?.id, counts),
    [availableTenants, activeTenant?.id, counts]
  );
  const others = otherStoresWithPending(entries);
  const current = entries.find(e => e.isActive);

  if (!activeTenant || activeRole === 'CEO' || activeRole === 'SUPER_ADMIN' || activeRole === 'DRIVER' || activeRole === 'CUSTOMER') return null;

  const handleSwitch = async (tenantId: string) => {
    if (tenantId === activeTenant.id) { setOpen(false); return; }
    setSwitching(tenantId);
    const ok = await switchTenant(tenantId);
    setSwitching(null);
    setOpen(false);
    if (!ok) showToast({ type: 'error', title: 'Não foi possível trocar de loja', message: 'Tente de novo em instantes.' });
    else refresh();
  };

  const name = activeTenant.theme?.storeName || activeTenant.name;

  return (
    <div ref={ref} data-testid="store-context-bar" className="relative z-30 bg-emerald-50/80 border-b border-emerald-200/80 px-2 sm:px-3 py-1 flex items-center gap-2 flex-wrap">
      <StoreLogo logoUrl={activeTenant.theme?.logoUrl} name={name} color={activeTenant.theme?.primaryColor} className="w-7 h-7 text-[11px] shrink-0" />
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wider font-bold text-emerald-800 leading-none">Você está administrando</div>
        <div className="text-sm font-black text-slate-900 leading-tight truncate max-w-[60vw]" data-testid="current-store-name">{name}</div>
        <div className="text-[9px] text-slate-500 leading-none font-mono">
          /app/{activeTenant.slug}{activeRole ? ` · ${ROLE_SHORT[activeRole] || activeRole}` : ''}
          {current && current.pending != null ? ` · ${pendingLabel(current.pending)}` : ''}
        </div>
      </div>

      {others.length > 0 && (
        <button type="button" onClick={() => setOpen(true)} data-testid="other-stores-pending"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-extrabold cursor-pointer animate-pulse">
          <Bell className="w-3 h-3" />
          {others.map(o => o.summary).join(' · ')}
        </button>
      )}

      {entries.length > 1 && (
        <button type="button" onClick={() => setOpen(v => !v)} data-testid="store-switcher-toggle"
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-[10px] font-bold cursor-pointer hover:bg-emerald-100">
          <Store className="w-3 h-3" /> Trocar de loja ({entries.length})
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {open && entries.length > 1 && (
        <div role="listbox" data-testid="store-switcher-list" className="absolute right-2 top-full mt-1 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-1 z-50">
          <div className="px-2 py-1 text-[9px] uppercase tracking-wider font-bold text-slate-500">Suas lojas</div>
          {entries.map(e => (
            <button key={e.tenantId} type="button" role="option" aria-selected={e.isActive}
              disabled={switching !== null}
              onClick={() => handleSwitch(e.tenantId)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left cursor-pointer ${e.isActive ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-extrabold text-slate-900 truncate">{e.name}</span>
                <span className="block text-[9px] text-slate-500 font-mono truncate">/app/{e.slug} · {ROLE_SHORT[e.roleId] || e.roleId}</span>
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                (e.pending ?? 0) > 0 ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                {switching === e.tenantId ? 'abrindo…' : pendingLabel(e.pending)}
              </span>
              {e.isActive && <Check className="w-3 h-3 text-emerald-700 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
