import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dispatchChatRepository as repo, DispatchMode } from '../../repositories/dispatchChatRepository';
import { readPreferences, savePreferences, NotificationPreferences } from '../../lib/notifications/preferences';
export function DispatchModeOptions({ mode, disabled, onChange }: { mode: DispatchMode; disabled: boolean; onChange: (m: DispatchMode) => void }) {
  return <fieldset disabled={disabled}><legend className="font-bold">Despacho de entregas</legend>
    <label className="block"><input type="radio" name="dispatch" checked={mode === 'AUTO_QUEUE'} onChange={() => onChange('AUTO_QUEUE')} /> Fila automática</label>
    <p className="text-sm text-gray-600">O sistema sugere o próximo entregador da vez. Você confirma com um toque.</p>
    <label className="block"><input type="radio" name="dispatch" checked={mode === 'OWNER_PICKS'} onChange={() => onChange('OWNER_PICKS')} /> Dono escolhe</label>
    <p className="text-sm text-gray-600">Toque no entregador para despachar.</p>
  </fieldset>;
}
export function DispatchSettings() {
  const { activeTenant, supabaseUser, activeRole } = useAuth();
  const tenant = activeTenant?.id, user = supabaseUser?.id;
  const allowed = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const [mode, setMode] = useState<DispatchMode>('OWNER_PICKS');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prefs, setPrefs] = useState<NotificationPreferences>({ balloon: true, sound: false });
  useEffect(() => {
    let alive = true; setLoaded(false); setError('');
    if (tenant && user && allowed) { setPrefs(readPreferences(localStorage, tenant, user)); void repo.queue(tenant).then(r => { if (alive) { setMode(r.mode); setLoaded(true); } }).catch(e => { if (alive) setError(e.message); }); }
    return () => { alive = false; };
  }, [tenant, user, allowed]);
  if (!tenant || !user || !allowed) return null;
  const pref = (next: NotificationPreferences) => { setPrefs(next); savePreferences(localStorage, tenant, user, next); };
  return <section className="bg-white border rounded-xl p-4 space-y-3">
    <DispatchModeOptions mode={mode} disabled={busy || !loaded} onChange={async next => { setBusy(true); setError(''); try { await repo.setMode(tenant, next); setMode(next); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }} />
    <h3 className="font-bold">Notificações</h3>
    <label className="block"><input type="checkbox" checked={prefs.balloon} onChange={e => pref({ ...prefs, balloon: e.target.checked })} /> Mostrar balão</label>
    <label className="block"><input type="checkbox" checked={prefs.sound} onChange={e => pref({ ...prefs, sound: e.target.checked })} /> Tocar som</label>
    {error && <p role="alert">{error}</p>}
  </section>;
}
