import React, { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ChefHat, MonitorSmartphone, Trash2, X, ExternalLink } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { kitchenRepository, type KitchenDevice, type KitchenSettings } from '../../repositories/kitchenRepository';
import { formatPairCode, pairUrl, secondsLeft, isKitchenMissing, kitchenErrorMessage } from '../../lib/kitchen/kitchenBoard';
import { BRAND_ACTION } from '../../utils/orderStatusTheme';

export const PairingQrModal: React.FC<{ code: string; expiresAt: string; onClose: () => void; origin?: string }> = ({ code, expiresAt, onClose, origin }) => {
  const [left, setLeft] = useState(() => secondsLeft(expiresAt));
  useEffect(() => { const id = window.setInterval(() => setLeft(secondsLeft(expiresAt)), 1000); return () => window.clearInterval(id); }, [expiresAt]);
  const url = pairUrl(origin || window.location.origin, code);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-label="Conectar aparelho" data-testid="kitchen-qr-modal">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center space-y-3 relative">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 text-gray-500" aria-label="Fechar"><X className="w-5 h-5" /></button>
        <h3 className="text-lg font-black text-gray-950">Conectar tablet da cozinha</h3>
        <p className="text-sm text-gray-600">Abra a câmera do tablet e leia o QR. Ou acesse <b>/cozinha/parear</b> e digite o código.</p>
        {left > 0 ? <>
          <div className="inline-block p-3 bg-white border rounded-2xl"><QRCodeSVG value={url} size={220} /></div>
          <div className="text-3xl font-black tracking-widest tabular-nums" data-testid="kitchen-pair-code">{formatPairCode(code)}</div>
          <div className="text-sm text-gray-500 tabular-nums">Vale por {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · uso único</div>
        </> : <p className="text-sm font-bold text-red-700">Código expirado. Gere outro.</p>}
      </div>
    </div>
  );
};

/** 19/10: Tela da Cozinha (opcional, desligada por padrão). Loja pequena continua só no painel. */
export const KitchenSettingsPage: React.FC = () => {
  const { activeTenant } = useAuth() as any;
  const { showToast } = useToast() as any;
  const t = activeTenant?.id as string | undefined;
  const [settings, setSettings] = useState<KitchenSettings | null | 'missing'>(null);
  const [devices, setDevices] = useState<KitchenDevice[]>([]);
  const [pin, setPin] = useState('');
  const [qr, setQr] = useState<{ code: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: any) => showToast?.({ type: 'error', title: 'Tela da Cozinha', message: kitchenErrorMessage(e) });

  const load = useCallback(async () => {
    if (!t) return;
    try { setSettings(await kitchenRepository.getSettings(t)); setDevices(await kitchenRepository.listDevices(t)); }
    catch (e) { if (isKitchenMissing(e)) setSettings('missing'); else fail(e); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (!t) return null;
  if (settings === 'missing') return (
    <div className="p-6 max-w-2xl"><h1 className="text-xl font-black">Tela da Cozinha</h1><p className="text-sm text-gray-600 mt-2">Ainda não disponível nesta loja. Continue usando a tela de Pedidos.</p></div>
  );
  if (!settings) return <div className="p-6 text-gray-500">Carregando…</div>;
  const run = async (f: () => Promise<any>) => { setBusy(true); try { await f(); await load(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const active = devices.filter(d => !d.revoked_at);

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4" data-testid="kitchen-settings">
      <div className="flex items-center gap-2"><ChefHat className="w-6 h-6" /><h1 className="text-xl font-black text-gray-950">Tela da Cozinha</h1>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">opcional</span></div>
      <p className="text-sm text-gray-600">Um tablet na cozinha mostra só os pedidos para preparar (itens e observações), sem preços nem dados de clientes. A cozinha só pode <b>Iniciar preparo</b> e marcar <b>Pronto</b>; quando fica pronto, o painel apita para você chamar o entregador ou o cliente. Loja pequena? Pode deixar desligado e seguir na tela de Pedidos.</p>

      <section className="bg-white border rounded-2xl p-4 flex items-center justify-between gap-3">
        <div><div className="font-black text-gray-950">Usar Tela da Cozinha</div><div className="text-xs text-gray-500">{settings.enabled ? `Ligada · ${settings.active_devices} aparelho(s)` : 'Desligada'}</div></div>
        <button type="button" role="switch" aria-checked={settings.enabled} disabled={busy} data-testid="kitchen-toggle"
          onClick={() => run(() => kitchenRepository.setSettings(t, !settings.enabled))}
          className={`w-14 h-8 rounded-full p-1 transition ${settings.enabled ? 'bg-green-600' : 'bg-gray-300'}`}><span className={`block w-6 h-6 bg-white rounded-full transition ${settings.enabled ? 'translate-x-6' : ''}`} /></button>
      </section>

      {settings.enabled && <>
        <section className="bg-white border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div><div className="font-black text-gray-950">Aparelhos conectados</div><div className="text-xs text-gray-500">Desconecte um tablet perdido a qualquer momento.</div></div>
            <button type="button" disabled={busy} data-testid="kitchen-connect"
              onClick={() => run(async () => setQr(await kitchenRepository.createCode(t)))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold" style={{ backgroundColor: BRAND_ACTION.bg, color: BRAND_ACTION.text }}><MonitorSmartphone className="w-4 h-4" />Conectar aparelho</button>
          </div>
          {active.length === 0 ? <p className="text-sm text-gray-500">Nenhum aparelho conectado.</p> : (
            <ul className="divide-y">{active.map(d => (
              <li key={d.id} className="py-2 flex items-center justify-between gap-2" data-testid="kitchen-device">
                <div><div className="font-bold text-gray-900">{d.name}</div><div className="text-xs text-gray-500">Conectado em {new Date(d.created_at).toLocaleString('pt-BR')}{d.last_seen_at ? ` · visto ${new Date(d.last_seen_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</div></div>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Desconectar "${d.name}"?`)) run(() => kitchenRepository.revokeDevice(d.id)); }}
                  className="flex items-center gap-1 text-sm font-bold text-red-700 px-2 py-1 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4" />Desconectar</button>
              </li>))}</ul>
          )}
          <a href="/cozinha" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-blue-700"><ExternalLink className="w-4 h-4" />Abrir a Tela da Cozinha neste aparelho</a>
        </section>

        <section className="bg-white border rounded-2xl p-4 space-y-2">
          <div className="font-black text-gray-950">PIN da cozinha <span className="text-xs font-normal text-gray-500">(opcional)</span></div>
          <p className="text-xs text-gray-500">{settings.has_pin ? 'PIN ativo: o tablet pede o PIN para destravar (vale 12 h).' : 'Sem PIN: o tablet abre direto.'}</p>
          <div className="flex gap-2 flex-wrap">
            <input inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 números" className="border rounded-xl px-3 py-2 w-32 tracking-widest" aria-label="PIN" />
            <button type="button" disabled={busy || pin.length !== 4} onClick={() => run(async () => { await kitchenRepository.setSettings(t, true, pin); setPin(''); })} className="px-3 py-2 rounded-xl border font-bold disabled:opacity-50">{settings.has_pin ? 'Trocar PIN' : 'Definir PIN'}</button>
            {settings.has_pin && <button type="button" disabled={busy} onClick={() => run(() => kitchenRepository.setSettings(t, true, null, true))} className="px-3 py-2 rounded-xl border font-bold text-red-700">Remover PIN</button>}
          </div>
        </section>
      </>}
      {qr && <PairingQrModal code={qr.code} expiresAt={qr.expires_at} onClose={() => { setQr(null); load(); }} />}
    </div>
  );
};
export default KitchenSettingsPage;
