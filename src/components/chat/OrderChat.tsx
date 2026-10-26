import { normalizeBRPhone } from '../../lib/phone/brPhone';
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { dispatchChatRepository as repo, OrderMessage } from '../../repositories/dispatchChatRepository';
export function OrderChat({ tenantId, orderId, storePhone, closed = false, initialOpen = false, audience = 'store' }: { tenantId: string; orderId: string; storePhone?: string; closed?: boolean; initialOpen?: boolean; audience?: 'driver' | 'store' }) {
  const [open, setOpen] = useState(initialOpen);
  const [rows, setRows] = useState<OrderMessage[]>([]);
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; setRows([]); setBody(''); setError('');
    if (!open) return;
    const load = () => repo.messages(tenantId, orderId).then(data => { if (alive) { setRows(data); setError(''); } }).catch(e => { if (alive) setError(e.message); });
    const ch = supabase.channel(`chat:${tenantId}:${orderId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` }, () => { void load(); }).subscribe(() => { void load(); });
    void load(); const t = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(t); void supabase.removeChannel(ch); };
  }, [tenantId, orderId, open]);
  useEffect(() => { const view = (e: Event) => { if ((e as CustomEvent).detail === orderId) setOpen(true); }; window.addEventListener('dc:open-chat', view); return () => window.removeEventListener('dc:open-chat', view); }, [orderId]);
  const digits = normalizeBRPhone(storePhone);
  return <section className="bg-white border rounded-xl p-3 space-y-2">
    <button className="font-bold underline" onClick={() => setOpen(v => !v)}>{audience === 'driver' ? 'Falar com a loja' : 'Chat com o entregador'}</button>
    {digits && <a className="block text-sm underline" href={`https://wa.me/55${digits}`} target="_blank" rel="noreferrer">WhatsApp da loja</a>}
    {open && <><div aria-live="polite" className="max-h-56 overflow-auto text-sm space-y-2">{!rows.length && <p>Nenhuma mensagem.</p>}{rows.map(m => <p key={m.id}><strong>{m.sender_role === 'DRIVER' ? 'Entregador' : 'Loja'}:</strong> {m.body}</p>)}</div>
      <form onSubmit={async e => { e.preventDefault(); if (busy || !body.trim() || closed) return; setBusy(true); setError(''); try { await repo.send(orderId, body.trim()); setBody(''); setRows(await repo.messages(tenantId, orderId)); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }} className="space-y-2">
        <textarea aria-label="Mensagem" value={body} maxLength={500} disabled={busy || closed} onChange={e => setBody(e.target.value)} className="border rounded p-2 w-full" placeholder="Escreva para a equipe" />
        <button className="rounded bg-emerald-700 text-white px-3 py-2 disabled:opacity-50" disabled={busy || closed || !body.trim()}>Enviar</button>
      </form>{closed && <p>Conversa encerrada.</p>}{error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
