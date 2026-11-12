import React, { useEffect, useState } from 'react';
import { themeToTokens } from '../../lib/theme/themeEngine';
import type { TenantTheme } from '../../types';
import { QRCodeSVG } from 'qrcode.react';
import { tvAccessRepository, type TvDevice } from '../../repositories/tvAccessRepository';

export function TvAdminPanel({ tenantId, theme }: { tenantId: string; theme?: Partial<TenantTheme> }) {
  const [devices, setDevices] = useState<TvDevice[]>([]);
  const [label, setLabel] = useState('TV do balcão');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setDevices([]); setPairing(null); setError('');
    const load = () => { void tvAccessRepository.list(tenantId).then(rows => { if (alive) setDevices(rows); }).catch(e => { if (alive) setError(e.message); }); };
    load(); const timer = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [tenantId]);
  const palette = themeToTokens(theme).palette;
  const inputStyle = { background: palette.bgCard, color: palette.textMain, borderColor: palette.border };
  const buttonStyle = { background: palette.buttonBg, color: palette.buttonText };
  const url = `${window.location.origin}/tv`;
  return <section className="rounded-2xl border p-4 space-y-4" style={inputStyle}>
    <h2 className="text-xl font-bold">TV de chamada</h2>
    <p>Acesso exclusivo de exibição, sem sessão de funcionário.</p>
    <a href={url} target="_blank" rel="noreferrer">{url}</a><QRCodeSVG bgColor={palette.bgCard} fgColor={palette.textMain} value={url} title="Abrir TV de chamada" />
    <form className="flex gap-3" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { setPairing(await tvAccessRepository.createCode(tenantId, label)); }
      catch (reason) { setError((reason as Error).message); }
      finally { setBusy(false); }
    }}>
      <label>Nome da TV <input style={inputStyle} required maxLength={40} value={label} onChange={e => setLabel(e.target.value)} className="border p-2 rounded" /></label>
      <button style={buttonStyle} disabled={busy}>Ativar nova TV</button>
    </form>
    {pairing && <p role="status">Código: <strong>{pairing.code}</strong> — uso único, válido até {new Date(pairing.expiresAt).toLocaleTimeString('pt-BR')} (10 minutos).</p>}
    {error && <p role="alert">{error}</p>}
    {devices.length === 0 && <p>Nenhuma TV ativa.</p>}
    <ul>{devices.map(device => <li key={device.id} className="flex gap-4 py-2">
      <span>{device.label} — Último acesso: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('pt-BR') : 'Aguardando conexão'}</span>
      <button style={buttonStyle} disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await tvAccessRepository.revoke(tenantId, device.id); setDevices(await tvAccessRepository.list(tenantId)); }
        catch (reason) { setError((reason as Error).message); }
        finally { setBusy(false); }
      }}>Desativar</button>
    </li>)}</ul>
  </section>;
}
