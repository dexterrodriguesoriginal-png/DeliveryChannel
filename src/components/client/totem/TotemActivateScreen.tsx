import { useState } from 'react';
import { KeyRound, MonitorSmartphone, UserRound } from 'lucide-react';
import { totemAccessRepository, type TotemActivateResult, type TotemLoginInfo } from '../../../repositories/totemAccessRepository';
import './totemActivateScreen.css';

export function TotemActivateScreen({
  slug,
  login,
  onActivated,
}: {
  slug: string;
  login: TotemLoginInfo | null;
  onActivated: (session: { token: string; deviceId: string; label: string }) => void;
}) {
  const [mode, setMode] = useState<'user' | 'staff'>('user');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('Totem');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ label: string; lastSeenAt?: string | null } | null>(null);
  const accent = login?.accent || '#176444';

  const finish = (result: Extract<TotemActivateResult, { ok: true }>) => {
    onActivated({ token: result.token, deviceId: result.deviceId, label: result.label });
  };

  const runUser = async (confirmRevoke: boolean) => {
    setBusy(true); setError('');
    try {
      const result = await totemAccessRepository.activateUser({
        slug, username, password, deviceLabel: label || 'Totem', confirmRevoke,
      });
      if (!result.ok) {
        setPending({ label: result.device.label, lastSeenAt: result.device.lastSeenAt });
        return;
      }
      finish(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível ativar o totem.');
    } finally { setBusy(false); }
  };

  const runStaff = async () => {
    setBusy(true); setError('');
    try {
      const result = await totemAccessRepository.activateAsStaff(slug, label || 'Totem', email, password);
      if (result.ok) finish(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível ativar o totem.');
    } finally { setBusy(false); }
  };

  return (
    <div className="dc-totem-activate" data-testid="totem-activate-screen" style={{ ['--dc-totem-accent' as string]: accent }}>
      <div className="dc-totem-activate-card">
        {login?.logoUrl
          ? <img className="dc-totem-activate-logo" src={login.logoUrl} alt="" />
          : <div className="dc-totem-activate-logo dc-totem-activate-logo--fallback"><MonitorSmartphone aria-hidden="true" /></div>}
        <p className="dc-totem-activate-kicker">{login?.name || 'Totem do salão'}</p>
        <h1>Totem não ativado</h1>
        <p className="dc-totem-activate-lead">Entre com o usuário do totem. O link e o QR sozinhos não liberam pedidos.</p>

        <div className="dc-totem-activate-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'user'} data-testid="totem-activate-tab-user" onClick={() => { setMode('user'); setPending(null); setError(''); }}>
            <UserRound size={16} /> Usuário do totem
          </button>
          <button type="button" role="tab" aria-selected={mode === 'staff'} data-testid="totem-activate-tab-staff" onClick={() => { setMode('staff'); setPending(null); setError(''); }}>
            <KeyRound size={16} /> Dono ou gerente
          </button>
        </div>

        {mode === 'user' ? (
          <form className="dc-totem-activate-form" onSubmit={event => { event.preventDefault(); void runUser(false); }}>
            <label>Usuário<input data-testid="totem-activate-username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label>
            <label>Senha<input data-testid="totem-activate-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
            <label>Nome deste aparelho<input data-testid="totem-activate-label" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} /></label>
            {pending && (
              <div className="dc-totem-activate-warn" data-testid="totem-activate-revoke-warn" role="alert">
                Este usuário já está ativo em <strong>{pending.label}</strong>
                {pending.lastSeenAt ? ` (visto em ${new Date(pending.lastSeenAt).toLocaleString('pt-BR')})` : ''}. Ativar aqui desativa o anterior.
                <button type="button" data-testid="totem-activate-confirm-revoke" onClick={() => void runUser(true)} disabled={busy}>Desativar o outro e continuar</button>
              </div>
            )}
            <button type="submit" className="dc-totem-activate-submit" data-testid="totem-activate-submit" disabled={busy || !username || !password}>
              {busy ? 'Ativando…' : 'Ativar totem'}
            </button>
          </form>
        ) : (
          <form className="dc-totem-activate-form" onSubmit={event => { event.preventDefault(); void runStaff(); }}>
            <p className="dc-totem-activate-hint">Entre com a conta do dono ou gerente. Depois da ativação, essa sessão é encerrada neste aparelho.</p>
            <label>E-mail<input data-testid="totem-activate-email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label>Senha<input data-testid="totem-activate-staff-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
            <label>Nome deste aparelho<input value={label} onChange={e => setLabel(e.target.value)} maxLength={40} /></label>
            <button type="submit" className="dc-totem-activate-submit" data-testid="totem-activate-staff-submit" disabled={busy || !email || !password}>
              {busy ? 'Ativando…' : 'Ativar com minha conta'}
            </button>
          </form>
        )}
        {error && <p className="dc-totem-activate-error" data-testid="totem-activate-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
