import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Bike, Check, CheckCheck, CreditCard, GripVertical, LocateFixed, MessageSquare, ShoppingBag, UtensilsCrossed, Volume2, VolumeX, X, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { dispatchChatRepository as repo, OwnerNotification } from '../../repositories/dispatchChatRepository';
import { readPreferences, savePreferences, type NotificationPreferences } from '../../lib/notifications/preferences';
import { notificationDetail, notificationType, relativeTime, type NotificationType, type OrderBrief } from '../../lib/notifications/notificationView';
import { playNewOrderSound } from '../../utils/audio';
import { BOTTOM_ACTIONS_VAR, floatingAboveActionsStyle, floatingSideStyle } from '../../lib/ui/bottomActionsOffset';
import { clampPoint, loadPosition, placePanel, pointFromSaved, savePosition, snapToEdge, type Point, type SavedPosition, type Size, type Viewport } from '../../lib/ui/floatingPosition';
import './notifications.css';

const PANEL = { w: 400, h: 560 }, TOAST = { w: 340, h: 92 }, PILL_FALLBACK: Size = { w: 196, h: 52 };

const TYPE_META: Record<NotificationType, { Icon: LucideIcon; fg: string; label: string }> = {
  order: { Icon: ShoppingBag, fg: '#16a34a', label: 'Novo pedido' },
  payment: { Icon: CreditCard, fg: '#2563eb', label: 'Pagamento' },
  driver: { Icon: Bike, fg: '#7c3aed', label: 'Entregador' },
  table: { Icon: UtensilsCrossed, fg: '#d97706', label: 'Mesa / garçom' },
  chat: { Icon: MessageSquare, fg: '#9333ea', label: 'Chat' },
  default: { Icon: Bell, fg: '#64748b', label: 'Aviso' },
};

interface ListProps {
  rows: OwnerNotification[]; onRead: (n: OwnerNotification) => void; onOpen: (n: OwnerNotification) => void;
  briefs?: Record<string, OrderBrief>; now?: number; error?: string;
  onReadAll?: () => void; sound?: boolean; onToggleSound?: () => void; onRestore?: () => void; onClose?: () => void;
  style?: React.CSSProperties;
}

/** Cartão do painel: cabeçalho, filtros (Todas / Não lidas), lista de cartões com ícone por tipo e estado vazio. */
export function NotificationList({ rows, onRead, onOpen, briefs = {}, now = Date.now(), error, onReadAll, sound, onToggleSound, onRestore, onClose, style }: ListProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const unread = rows.filter(n => !n.read_at);
  const shown = filter === 'unread' ? unread : rows;
  const readAll = onReadAll || (() => unread.forEach(onRead));
  return <section aria-label="Notificações" style={style} className="flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-[20px] border border-white/70 bg-white/92 text-slate-800 shadow-[0_24px_60px_-12px_rgba(15,23,42,.35),0_4px_14px_rgba(15,23,42,.08)] ring-1 ring-slate-900/5">
    <header className="shrink-0 px-4 pb-2 pt-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Bell size={17} /></span>
        <h2 className="text-base font-semibold tracking-tight text-slate-900">Notificações</h2>
        {unread.length > 0 && <span data-testid="unread-chip" className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold leading-none text-white tabular-nums">{unread.length} {unread.length === 1 ? 'nova' : 'novas'}</span>}
        <span className="flex-1" />
        {onToggleSound && <button type="button" onClick={onToggleSound} aria-pressed={!!sound} aria-label={sound ? 'Desligar som' : 'Ligar som'} title={sound ? 'Som ligado' : 'Som desligado'}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${sound ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}>{sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>}
        {onClose && <button type="button" onClick={onClose} aria-label="Fechar notificações" title="Fechar" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"><X size={16} /></button>}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div role="tablist" aria-label="Filtro" className="flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold">
          {([['all', 'Todas', rows.length], ['unread', 'Não lidas', unread.length]] as const).map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
            className={`whitespace-nowrap rounded-[10px] px-2.5 py-1.5 transition-all ${filter === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}<span className="ml-1 text-[10px] tabular-nums opacity-60">{count}</span></button>)}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={readAll} disabled={!unread.length} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"><CheckCheck size={14} />Marcar todas como lidas</button>
      </div>
    </header>
    {error && <p role="alert" className="mx-4 mb-2 shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
    <div className="dcn-scroll min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
      {!shown.length
        ? <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="notifications-empty">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400"><BellOff size={26} strokeWidth={1.6} /></span>
          {filter === 'unread' && rows.length ? <><p className="text-sm font-semibold text-slate-700">Nenhuma notificação não lida.</p><p className="text-xs text-slate-400">Você já viu tudo por aqui.</p></>
            : <><p className="text-sm font-semibold text-slate-700">Tudo em dia! Nenhuma notificação.</p><p className="text-xs text-slate-400">Novos pedidos e avisos aparecem aqui na hora.</p></>}
        </div>
        : <ul className="divide-y divide-slate-100">{shown.map(n => {
          const type = notificationType(n), { Icon, fg, label } = TYPE_META[type];
          const detail = n.kind === 'DRIVER_JOIN_REQUEST' ? '' : notificationDetail(briefs[n.ref_id]);
          const isUnread = !n.read_at;
          return <li key={n.id} data-testid="notification-item" data-unread={isUnread} data-type={type} className="dcn-item relative">
            <button type="button" className="dcn-main flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50" onClick={() => onOpen(n)}
              style={isUnread ? { background: `color-mix(in srgb, ${fg} 7%, #ffffff)`, boxShadow: `inset 3px 0 0 ${fg}` } : undefined}>
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" title={label} style={{ background: `color-mix(in srgb, ${fg} 14%, #ffffff)`, color: fg }}><Icon size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`min-w-0 flex-1 truncate text-[13.5px] ${isUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-600'}`}>{n.title}</span>
                  <time dateTime={n.created_at} className="shrink-0 text-[11px] font-medium text-slate-400">{relativeTime(n.created_at, now)}</time>
                  {isUnread && <span aria-label="Não lida" className="h-2 w-2 shrink-0 translate-y-[-1px] self-center rounded-full bg-blue-500 ring-2 ring-blue-100" />}
                </span>
                {detail && <span className="mt-0.5 block truncate text-xs text-slate-500">{detail}</span>}
              </span>
            </button>
            {isUnread && <button type="button" className="dcn-check absolute bottom-2 right-3 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600" aria-label="Marcar como lida" title="Marcar como lida" onClick={() => onRead(n)}><Check size={14} /></button>}
          </li>;
        })}</ul>}
    </div>
    {onRestore && <footer className="shrink-0 border-t border-slate-100 px-4 py-2"><button type="button" onClick={onRestore} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 transition-colors hover:text-slate-700"><LocateFixed size={12} />Restaurar posição</button></footer>}
  </section>;
}

const readViewport = (): Viewport => {
  const raw = parseFloat(document.documentElement.style.getPropertyValue(BOTTOM_ACTIONS_VAR));
  return { w: window.innerWidth, h: window.innerHeight, bottomOffset: Number.isFinite(raw) ? raw : 0 };
};

export function OwnerNotifications({ onOpen }: { onOpen: (n: OwnerNotification) => void }) {
  const { activeTenant, supabaseUser, activeRole } = useAuth();
  const tenant = activeTenant?.id, user = supabaseUser?.id;
  const allowed = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const [rows, setRows] = useState<OwnerNotification[]>([]);
  const [balloon, setBalloon] = useState<OwnerNotification | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [briefs, setBriefs] = useState<Record<string, OrderBrief>>({});
  const [now, setNow] = useState(Date.now());
  const [ring, setRing] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>({ balloon: true, sound: false });
  const [pos, setPos] = useState<SavedPosition | null>(() => (user ? loadPosition(localStorage, user) : null));
  const [live, setLive] = useState<Point | null>(null);
  const [vp, setVp] = useState<Viewport>(readViewport);
  const [pillSize, setPillSize] = useState<Size>(PILL_FALLBACK);
  const [measured, setMeasured] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; active: boolean; last: Point } | null>(null);
  const justDragged = useRef(false);
  const requested = useRef(new Set<string>());
  const prevUnread = useRef(0);

  useEffect(() => {
    setRows([]); setBalloon(null); setOpen(false); setError(''); setLoaded(false);
    if (!tenant || !user || !allowed) return;
    let alive = true;
    const seen = new Set<string>();
    const load = () => repo.notifications(tenant).then(data => { if (alive) { setRows(data); setError(''); setLoaded(true); } }).catch(e => { if (alive) setError(e.message); });
    const channel = supabase.channel(`owner-notifications:${tenant}:${user}`).on('postgres_changes', { event: '*', schema: 'public', table: 'owner_notifications', filter: `tenant_id=eq.${tenant}` }, payload => {
      if (!alive) return;
      const n = payload.new as OwnerNotification;
      if (payload.eventType === 'INSERT' && n.tenant_id === tenant && !seen.has(n.id)) {
        seen.add(n.id);
        void repo.visibleNotifications(tenant, [n]).then(visible => {
          if (!alive || !visible.length) return;
          const prefs = readPreferences(localStorage, tenant, user);
          if (prefs.balloon) setBalloon(n);
          if (prefs.sound) playNewOrderSound();
        }).catch(() => { /* The next successful reload will recover the list. */ });
      }
      void load();
    }).subscribe(() => { void load(); });
    void load();
    const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [tenant, user, allowed]);

  // Aviso some em 5 s.
  useEffect(() => { if (!balloon) return; const t = window.setTimeout(() => setBalloon(null), 5000); return () => window.clearTimeout(t); }, [balloon]);
  // Tempo relativo atualiza sozinho.
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);
  // Preferências (som) sincronizam com a tela de Configurações.
  useEffect(() => {
    if (!tenant || !user) return;
    const sync = () => setPrefs(readPreferences(localStorage, tenant, user));
    sync(); window.addEventListener('dc:notification-preferences', sync);
    return () => window.removeEventListener('dc:notification-preferences', sync);
  }, [tenant, user]);
  // Linha de detalhe (#nº · cliente · total): só leitura, uma vez por pedido.
  useEffect(() => {
    if (!tenant || !rows.length) return;
    const ids = [...new Set(rows.filter(n => n.kind !== 'DRIVER_JOIN_REQUEST').map(n => n.ref_id))].filter(id => !requested.current.has(id));
    if (!ids.length) return;
    ids.forEach(id => requested.current.add(id));
    let alive = true;
    void Promise.resolve(repo.orderBriefs?.(tenant, ids)).then(b => { if (alive && b) setBriefs(prev => ({ ...prev, ...b })); }).catch(() => { ids.forEach(id => requested.current.delete(id)); });
    return () => { alive = false; };
  }, [tenant, rows]);

  const unreadCount = rows.filter(n => !n.read_at).length;
  useEffect(() => {
    if (loaded && unreadCount > prevUnread.current) { setRing(true); const t = window.setTimeout(() => setRing(false), 1000); prevUnread.current = unreadCount; return () => window.clearTimeout(t); }
    prevUnread.current = unreadCount;
  }, [unreadCount, loaded]);

  // Abrir/fechar com animação de saída.
  useEffect(() => { if (open) { setMounted(true); return; } const t = window.setTimeout(() => setMounted(false), 150); return () => window.clearTimeout(t); }, [open]);

  // Mantém a viewport (e a altura da barra Salvar) atualizada.
  useEffect(() => {
    const update = () => setVp(prev => { const next = readViewport(); return prev.w === next.w && prev.h === next.h && prev.bottomOffset === next.bottomOffset ? prev : next; });
    window.addEventListener('resize', update);
    const MO = (window as any).MutationObserver;
    const mo = MO ? new MO(update) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    update();
    return () => { window.removeEventListener('resize', update); mo?.disconnect(); };
  }, []);

  // Esc e clique fora fecham o painel (Esc não vaza para o painel de detalhes do pedido).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); bellRef.current?.focus(); } };
    const onDown = (e: PointerEvent | MouseEvent) => { const t = e.target as Node; if (!panelRef.current?.contains(t) && !pillRef.current?.contains(t)) setOpen(false); };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
  }, [open]);

  const custom = !!(pos || live);
  const point: Point | null = live ?? (pos ? pointFromSaved(pos, vp, pillSize) : null);

  // Mede o botão (tamanho e, no modo padrão ancorado ao canto, a posição) para posicionar painel e aviso.
  useLayoutEffect(() => {
    const el = pillRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (Math.abs(r.width - pillSize.w) > .5 || Math.abs(r.height - pillSize.h) > .5)) setPillSize({ w: r.width, h: r.height });
    if (!custom) setMeasured(prev => prev && Math.abs(prev.x - r.left) < .5 && Math.abs(prev.y - r.top) < .5 && Math.abs(prev.w - r.width) < .5 && Math.abs(prev.h - r.height) < .5 ? prev : { x: r.left, y: r.top, w: r.width, h: r.height });
  });

  if (!allowed || !tenant || !user) return null;

  const pillRect = point ? { x: point.x, y: point.y, w: pillSize.w, h: pillSize.h } : (measured || { x: vp.w - pillSize.w - 12, y: vp.h - vp.bottomOffset - pillSize.h - 12, w: pillSize.w, h: pillSize.h });
  const panelPlace = placePanel(pillRect, vp, PANEL);
  const toastPlace = placePanel(pillRect, vp, TOAST);
  const placeStyle = (p: ReturnType<typeof placePanel>): React.CSSProperties => ({ position: 'fixed', left: p.left, top: p.top, bottom: p.bottom, width: p.width, maxHeight: p.maxHeight });

  const read = async (n: OwnerNotification) => {
    try { await repo.read(tenant, n.id); setRows(rs => rs.map(r => r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)); }
    catch (e: any) { setError(e.message); }
  };
  const view = (n: OwnerNotification) => { void read(n); setBalloon(null); setOpen(false); onOpen(n); };
  const readAll = () => { void Promise.all(rows.filter(n => !n.read_at).map(read)); };
  const toggleSound = () => { const next = { ...prefs, sound: !prefs.sound }; setPrefs(next); savePreferences(localStorage, tenant, user, next); if (next.sound) playNewOrderSound(); };
  const restore = () => { savePosition(localStorage, user, null); setPos(null); setLive(null); };
  const commit = (p: Point) => { const s = snapToEdge(p, vp, pillSize); const saved = { edge: s.edge, t: s.t }; setPos(saved); savePosition(localStorage, user, saved); setLive(null); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = pillRef.current!.getBoundingClientRect();
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, active: false, last: { x: r.left, y: r.top } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.active) {
      if (Math.hypot(dx, dy) < 6) return;
      d.active = true; setOpen(false); setBalloon(null);
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    }
    d.last = clampPoint({ x: d.ox + dx, y: d.oy + dy }, vp, pillSize);
    setLive(d.last);
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    justDragged.current = true; window.setTimeout(() => { justDragged.current = false; }, 0);
    commit(d.last);
  };
  const onGripKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 96 : 32, delta: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const d = delta[e.key]; if (!d) return;
    e.preventDefault();
    const r = pillRef.current!.getBoundingClientRect();
    commit(clampPoint({ x: r.left + d.x, y: r.top + d.y }, vp, pillSize));
  };

  const asideStyle: React.CSSProperties = custom && point ? { left: point.x, top: point.y } : { ...floatingAboveActionsStyle, ...floatingSideStyle };
  const bellLabel = `Notificações, ${unreadCount} não ${unreadCount === 1 ? 'lida' : 'lidas'}`;
  const orderToast = balloon && balloon.kind !== 'DRIVER_JOIN_REQUEST';
  const toastMeta = balloon ? TYPE_META[notificationType(balloon)] : null;
  const toastDetail = balloon && balloon.kind !== 'DRIVER_JOIN_REQUEST' ? notificationDetail(briefs[balloon.ref_id]) : '';

  // Container não captura cliques (só o próprio botão); sobe acima da barra fixa de ações no modo padrão.
  return <>
    <aside data-testid="owner-notifications" data-custom-position={custom ? 'true' : undefined} className="pointer-events-none fixed z-[60] [&>*]:pointer-events-auto" style={asideStyle}>
      <div ref={pillRef} data-testid="notifications-pill" data-dragging={!!live}
        className={`dcn-pill flex h-[52px] items-center gap-1 rounded-full pl-1 pr-3.5 ${pos && !live ? 'dcn-pill-snap' : ''} transition-shadow`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onClickCapture={e => { if (justDragged.current) { e.preventDefault(); e.stopPropagation(); } }}>
        <button type="button" aria-label="Mover notificações (arraste ou use as setas)" title="Arraste para mover" data-testid="notifications-grip" onKeyDown={onGripKey}
          className="flex h-10 w-6 shrink-0 cursor-grab items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 active:cursor-grabbing"><GripVertical size={16} /></button>
        <button ref={bellRef} type="button" className="dcn-bell relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#16a34a] text-white shadow-[0_4px_12px_-2px_rgba(22,163,74,.6)] transition-transform hover:scale-105 active:scale-95"
          data-ring={ring} aria-label={bellLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <Bell size={19} />
          {unreadCount > 0 && <span key={unreadCount} data-testid="unread-badge" className="dcn-badge absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-white tabular-nums">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
        <span className="ml-1.5 text-[13px] font-semibold tracking-tight text-slate-700 max-sm:hidden">Notificações</span>
      </div>
    </aside>
    {mounted && <div ref={panelRef} data-testid="notification-panel" data-state={open ? 'open' : 'closed'} data-up={panelPlace.openUp} className="dcn-panel z-[61] flex"
      style={{ ...placeStyle(panelPlace), transformOrigin: `${panelPlace.alignRight ? 'right' : 'left'} ${panelPlace.openUp ? 'bottom' : 'top'}` }}>
      <NotificationList rows={rows} briefs={briefs} now={now} error={open ? error : ''} onRead={n => { void read(n); }} onOpen={view} onReadAll={readAll}
        sound={prefs.sound} onToggleSound={toggleSound} onClose={() => { setOpen(false); bellRef.current?.focus(); }} onRestore={pos ? restore : undefined} />
    </div>}
    {balloon && !open && toastMeta && <div role="status" data-testid="notification-toast" className="dcn-toast pointer-events-auto z-[62] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_40px_-10px_rgba(15,23,42,.35)]" style={placeStyle(toastPlace)}>
      <span className="absolute inset-y-0 left-0 w-1.5 bg-[#16a34a]" />
      <div className="flex items-start gap-3 py-3 pl-5 pr-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${toastMeta.fg} 14%, #ffffff)`, color: toastMeta.fg }}><toastMeta.Icon size={17} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{balloon.title}</p>
          {toastDetail && <p className="truncate text-xs text-slate-500">{toastDetail}</p>}
          <button type="button" onClick={() => view(balloon)} className="mt-2 rounded-lg bg-[#16a34a] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-green-700">{orderToast ? 'Ver pedido' : 'Ver solicitação'}</button>
        </div>
        <button type="button" aria-label="Fechar aviso" onClick={() => setBalloon(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"><X size={15} /></button>
      </div>
      <span className="dcn-toast-bar absolute bottom-0 left-0 h-0.5 w-full bg-[#16a34a]/50" />
    </div>}
  </>;
}
