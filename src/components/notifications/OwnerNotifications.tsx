import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { dispatchChatRepository as repo, OwnerNotification } from '../../repositories/dispatchChatRepository';
import { readPreferences } from '../../lib/notifications/preferences';
import { playNewOrderSound } from '../../utils/audio';
import { floatingAboveActionsStyle, floatingSideStyle, floatingButtonAlignStyle } from '../../lib/ui/bottomActionsOffset';

export function NotificationList({ rows, onRead, onOpen }: { rows: OwnerNotification[]; onRead: (n: OwnerNotification) => void; onOpen: (n: OwnerNotification) => void }) {
  return <section aria-label="Notificações" className="max-h-80 overflow-auto bg-white border rounded-xl p-3 shadow-lg">
    <h2 className="font-bold">Notificações</h2>
    {!rows.length && <p>Nenhuma notificação.</p>}
    {rows.map(n => <article key={n.id} className="border-b py-2 text-sm">
      <p className={n.read_at ? 'text-gray-500' : 'font-semibold'}>{n.title}</p>
      <button className="mr-3 underline" onClick={() => onOpen(n)}>Ver</button>
      {!n.read_at && <button className="underline" onClick={() => onRead(n)}>Marcar como lida</button>}
    </article>)}
  </section>;
}
export function OwnerNotifications({ onOpen }: { onOpen: (n: OwnerNotification) => void }) {
  const { activeTenant, supabaseUser, activeRole } = useAuth();
  const tenant = activeTenant?.id, user = supabaseUser?.id;
  const allowed = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const [rows, setRows] = useState<OwnerNotification[]>([]);
  const [balloon, setBalloon] = useState<OwnerNotification | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows([]); setBalloon(null); setOpen(false); setError('');
    if (!tenant || !user || !allowed) return;
    let alive = true;
    const seen = new Set<string>();
    const load = () => repo.notifications(tenant).then(data => { if (alive) { setRows(data); setError(''); } }).catch(e => { if (alive) setError(e.message); });
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
  useEffect(() => { if (!balloon) return; const t = window.setTimeout(() => setBalloon(null), 3000); return () => window.clearTimeout(t); }, [balloon]);
  if (!allowed || !tenant || !user) return null;
  const read = async (n: OwnerNotification) => {
    try { await repo.read(tenant, n.id); setRows(rs => rs.map(r => r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)); }
    catch (e: any) { setError(e.message); }
  };
  const view = (n: OwnerNotification) => { void read(n); setBalloon(null); setOpen(false); onOpen(n); };
  // Container não captura cliques (só os próprios controles) e sobe acima de barras fixas de ação.
  return <aside data-testid="owner-notifications" className="pointer-events-none fixed z-[60] flex w-80 max-w-[calc(100vw-24px)] flex-col gap-2 [&>*]:pointer-events-auto" style={{ ...floatingAboveActionsStyle, ...floatingSideStyle }}>
    {balloon && <div role="status" className="bg-slate-900 text-white p-3 rounded-xl shadow-lg"><button aria-label="Fechar aviso" className="float-right" onClick={() => setBalloon(null)}>×</button><p>{balloon.title}</p><button className="underline" onClick={() => view(balloon)}>Ver</button></div>}
    {open && <NotificationList rows={rows} onRead={n => { void read(n); }} onOpen={view} />}
    {error && open && <p role="alert" className="bg-white p-2 text-red-700">{error}</p>}
    <button className="bg-white border rounded-full shadow px-4 py-2 text-sm" style={floatingButtonAlignStyle} onClick={() => setOpen(v => !v)}>Notificações ({rows.filter(n => !n.read_at).length})</button>
  </aside>;
}
