import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChefHat, Lock, Clock, ShoppingBag, Bike } from 'lucide-react';
import { ORDER_STATUS_THEME, BRAND_ACTION } from '../../utils/orderStatusTheme';
import { kitchenRepository } from '../../repositories/kitchenRepository';
import { kitchenColumns, kitchenNextAction, kitchenOrderLabel, kitchenErrorMessage, kitchenErrorCode, minutesInStage, lateLevel, type KitchenOrder } from '../../lib/kitchen/kitchenBoard';
import { playShortBeep } from '../../utils/audio';

/** 19/10: quadro da cozinha — 2 colunas (Confirmado → Em preparo), cores KDS, sem preço/dados pessoais. */
export const KitchenBoard: React.FC<{
  client: SupabaseClient; tenantId: string; storeName: string; deviceName?: string;
  mode: 'device' | 'staff'; canLock?: boolean; onLocked?: () => void; onFatal?: (code: string, msg: string) => void;
  initialOrders?: KitchenOrder[];
}> = ({ client, tenantId, storeName, deviceName, mode, canLock, onLocked, onFatal, initialOrders }) => {
  const [orders, setOrders] = useState<KitchenOrder[] | null>(initialOrders ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, tick] = useState(0);
  const seen = useRef<Set<string> | null>(initialOrders ? new Set(initialOrders.map(o => o.order_id)) : null);

  const load = useCallback(async () => {
    try {
      const list = await kitchenRepository.listOrders(client, mode === 'staff' ? tenantId : null);
      const ids = new Set(list.filter(o => o.status === 'CONFIRMED').map(o => o.order_id));
      if (seen.current && [...ids].some(id => !seen.current!.has(id))) playShortBeep();
      seen.current = new Set(list.map(o => o.order_id));
      setOrders(list);
    } catch (e) {
      const c = kitchenErrorCode(e);
      if (['KITCHEN_LOCKED', 'KITCHEN_DEVICE_REVOKED', 'KITCHEN_DISABLED', 'NOT_PAIRED', 'FORBIDDEN'].includes(c)) onFatal?.(c, kitchenErrorMessage(e));
    }
  }, [client, tenantId, mode, onFatal]);

  useEffect(() => {
    if (initialOrders) return;
    load();
    const off = kitchenRepository.subscribe(client, tenantId, load);
    const id = window.setInterval(() => { load(); tick(t => t + 1); }, 15000);
    return () => { off(); window.clearInterval(id); };
  }, [client, tenantId, load, initialOrders]);

  const act = async (o: KitchenOrder) => {
    const next = kitchenNextAction(o.status); if (!next) return;
    setBusy(o.order_id); setMsg(null);
    try { await kitchenRepository.setStatus(client, o.order_id, next.to); await load(); }
    catch (e) { setMsg(kitchenErrorMessage(e)); await load(); }
    finally { setBusy(null); }
  };

  const cols = kitchenColumns(orders || []);
  const Col = ({ status, title, list }: { status: 'CONFIRMED' | 'PREPARING'; title: string; list: KitchenOrder[] }) => {
    const t = ORDER_STATUS_THEME[status];
    return (
      <section className="flex-1 min-w-0 rounded-2xl p-3 space-y-3" style={{ backgroundColor: t.bg, border: `2px solid ${t.border}` }} data-testid={`kitchen-col-${status}`}>
        <h2 className="flex items-center gap-2 text-xl font-black uppercase" style={{ color: t.text }}>
          {title}<span className="text-base px-2 rounded-full tabular-nums" style={{ backgroundColor: t.badgeBg, color: t.badgeText, border: `1px solid ${t.badgeBorder}` }}>{list.length}</span>
        </h2>
        {list.length === 0 && <p className="text-sm opacity-60" style={{ color: t.text }}>Nada por aqui.</p>}
        {list.map(o => {
          const min = minutesInStage(o); const late = lateLevel(min); const next = kitchenNextAction(o.status)!;
          return (
            <article key={o.order_id} className="bg-white rounded-xl shadow-sm p-3 space-y-2" style={{ borderLeft: `6px solid ${late === 'late' ? '#DC2626' : late === 'warn' ? '#F59E0B' : t.accent}` }} data-testid="kitchen-card">
              <div className="flex items-center justify-between gap-2">
                <div className="text-2xl font-black text-gray-950 tabular-nums">#{o.order_number}</div>
                <div className={`flex items-center gap-1 text-sm font-bold tabular-nums ${late === 'late' ? 'text-red-600' : late === 'warn' ? 'text-amber-600' : 'text-gray-500'}`}><Clock className="w-4 h-4" />{min} min</div>
              </div>
              <div className="flex items-center gap-1.5 text-sm font-bold text-gray-700">
                {o.fulfillment_type === 'PICKUP' ? <ShoppingBag className="w-4 h-4" /> : <Bike className="w-4 h-4" />}{kitchenOrderLabel(o)}
              </div>
              <ul className="space-y-1">
                {o.items.map(i => (
                  <React.Fragment key={i.order_item_id}>
                    <li className="text-lg text-gray-950 leading-tight"><b className="tabular-nums">{i.quantity}×</b> {i.product_name}
                      {i.notes && <div className="text-sm text-amber-800 font-semibold">↳ {i.notes}</div>}</li>
                    {i.options?.length ? (
                      <div className="pl-5 text-sm font-semibold text-gray-700">
                        {i.options.map((option, index) => (
                          <div key={`${i.order_item_id}-${index}`}>
                            {option.fraction && option.fraction < 1 ? `${option.fraction === 0.5 ? '½' : `${Math.round(option.fraction * 100)}%`} ` : '+ '}
                            {option.option_name}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </React.Fragment>
                ))}
              </ul>
              {o.notes && <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-amber-900 font-semibold">Obs.: {o.notes}</p>}
              <button type="button" disabled={busy === o.order_id} onClick={() => act(o)} data-testid={`kitchen-act-${o.order_number}`}
                className="w-full min-h-14 rounded-xl text-lg font-black disabled:opacity-60" style={{ backgroundColor: BRAND_ACTION.bg, color: BRAND_ACTION.text }}>
                {busy === o.order_id ? 'Salvando…' : next.label}
              </button>
            </article>
          );
        })}
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-3 space-y-3" data-testid="kitchen-board">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><ChefHat className="w-7 h-7 text-gray-900" />
          <div><div className="text-xl font-black text-gray-950">Cozinha · {storeName}</div>
            <div className="text-xs text-gray-500">{mode === 'device' ? `Aparelho: ${deviceName || 'Cozinha'}` : 'Aberta pelo painel'}</div></div></div>
        {canLock && <button type="button" onClick={async () => { try { await kitchenRepository.lock(); } catch { /* ok */ } onLocked?.(); }}
          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white border border-gray-300 font-bold text-gray-800"><Lock className="w-4 h-4" />Travar</button>}
      </header>
      {msg && <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 px-3 py-2 font-semibold" role="alert">{msg}</div>}
      {orders === null ? <p className="text-gray-500">Carregando…</p> : (
        <div className="flex flex-col md:flex-row gap-3">
          <Col status="CONFIRMED" title="A fazer" list={cols.toDo} />
          <Col status="PREPARING" title="Em preparo" list={cols.doing} />
        </div>
      )}
      <p className="text-xs text-gray-500 text-center">Ao tocar em “Pronto”, o painel do dono é avisado para chamar o entregador ou o cliente.</p>
    </div>
  );
};
