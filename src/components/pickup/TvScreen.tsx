import React, { useEffect, useState } from 'react';
import { tvAccessRepository, type TvData } from '../../repositories/tvAccessRepository';
import { themeToTokens } from '../../lib/theme/themeEngine';

export function TvScreen() {
  const [token, setToken] = useState(() => tvAccessRepository.readToken());
  const [data, setData] = useState<TvData | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState(false);
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('TV do balcão');
  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await tvAccessRepository.read(token);
        if (disposed) return;
        if (!next) {
          tvAccessRepository.clearToken(); setToken(null); setData(null);
          setError('Esta TV foi desativada. Solicite um novo código à loja.');
        } else { setData(next); setError(''); }
      } catch (e) { if (!disposed) { setData(null); setError((e as Error).message); } }
      finally { loading = false; }
    };
    void refresh();
    const off = tvAccessRepository.subscribe(token, () => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { disposed = true; off(); window.clearInterval(timer); };
  }, [token]);
  const palette = themeToTokens(data?.theme).palette;
  const inputStyle = { borderColor: palette.border, background: palette.bgCard, color: palette.textMain };
  return <main className="min-h-screen p-6" style={{ background: palette.bgGeneral, color: palette.textMain }}>
    <header className="flex justify-between items-center" style={{ background: palette.bgHeader, color: palette.textTitle }}>
      <h1 className="text-3xl font-black">{data?.storeName || 'TV de chamada'}</h1>
      <button style={{ background: palette.buttonBg, color: palette.buttonText }} className="rounded-xl p-3" onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => setError('Não foi possível abrir a tela cheia.')); }}>Tela cheia</button>
    </header>
    {error && <p role="alert" className="my-4">{error}</p>}
    {!token ? <form className="max-w-sm mx-auto mt-16 flex flex-col gap-4" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { setToken(staff ? await tvAccessRepository.activateAsStaff(slug, label, email, password) : await tvAccessRepository.pair(code)); setCode(''); }
      catch (reason) { setError((reason as Error).message); }
      finally { setBusy(false); setPassword(''); }
    }}>
      <button type="button" onClick={() => { setStaff(!staff); setPassword(''); }}>{staff ? 'Usar código de pareamento' : 'Ativar com conta de dono ou gerente'}</button>
      {staff ? <>
        <label>Identificador da loja <input style={inputStyle} required value={slug} onChange={e => setSlug(e.target.value)} className="border p-2" /></label>
        <label>Nome da TV <input style={inputStyle} required maxLength={40} value={label} onChange={e => setLabel(e.target.value)} className="border p-2" /></label>
        <label>E-mail <input style={inputStyle} type="email" required autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} className="border p-2" /></label>
        <label>Senha <input style={inputStyle} type="password" required autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} className="border p-2" /></label>
        <p>A conta é usada uma única vez. A TV guarda apenas seu token de exibição.</p>
      </> : <><label htmlFor="tv-code">Código de pareamento</label>
      <input id="tv-code" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className="border rounded-xl p-3 text-2xl" style={inputStyle} /></>}
      <button disabled={busy || (!staff && code.length !== 6)} className="rounded-xl p-3" style={{ background: palette.buttonBg, color: palette.buttonText }}>{busy ? 'Ativando...' : 'Ativar TV'}</button>
      <p>No painel da loja, acesse Marketing → QR Code de Retirada → TV de chamada → Ativar nova TV. O código vale por 10 minutos e só pode ser usado uma vez.</p>
    </form> : data ? <>
      {(['ready', 'called'] as const).map(kind => <section key={kind}>
        <h2 className="mt-8 text-2xl font-bold" style={{ color: palette.textTitle }}>{kind === 'ready' ? 'Prontos para retirada' : 'Chamados pelo QR'}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
          {data.entries.filter(entry => entry.kind === kind).map(entry => <div key={entry.code} className="rounded-3xl text-center p-8" style={{ background: palette.buttonBg, color: palette.buttonText }}>
            <strong className="text-7xl font-mono">{entry.code}</strong>{entry.name && <p className="text-3xl">{entry.name}</p>}
          </div>)}
        </div>
      </section>)}
      {data.entries.length === 0 && <p className="mt-8">Aguardando...</p>}
    </> : <p className="mt-8">Conectando à loja...</p>}
  </main>;
}
