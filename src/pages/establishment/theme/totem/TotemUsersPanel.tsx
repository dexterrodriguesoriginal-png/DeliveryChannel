import { useEffect, useState } from 'react';
import { KeyRound, MonitorSmartphone, Plus, ShieldOff, UserPlus } from 'lucide-react';
import type { SecurityContext } from '../../../../services/securityEngine';
import { totemAccessRepository, type TotemDeviceRow, type TotemUserRow } from '../../../../repositories/totemAccessRepository';

function formatSeen(value?: string | null) {
  if (!value) return 'Ainda não visto';
  try { return new Date(value).toLocaleString('pt-BR'); } catch { return value; }
}

export function TotemUsersPanel({
  securityContext,
  tenantId,
}: {
  securityContext: SecurityContext;
  tenantId: string;
}) {
  const [users, setUsers] = useState<TotemUserRow[]>([]);
  const [devices, setDevices] = useState<TotemDeviceRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const refresh = async () => {
    const [nextUsers, nextDevices] = await Promise.all([
      totemAccessRepository.listUsers(securityContext, tenantId),
      totemAccessRepository.listDevices(securityContext, tenantId),
    ]);
    setUsers(nextUsers);
    setDevices(nextDevices);
  };

  useEffect(() => {
    let alive = true;
    setError('');
    refresh().catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Falha ao carregar.'); });
    return () => { alive = false; };
  }, [tenantId, securityContext.userId, securityContext.userRole]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="menu-design-section" data-testid="totem-users-panel">
      <div className="menu-design-section-title">
        <UserPlus size={18} />
        <div>
          <h2>Usuários do totem</h2>
          <p>Cada usuário do totem pode estar ativo em só um aparelho. A senha nunca é exibida.</p>
        </div>
      </div>
      <p className="totem-users-hint" data-testid="totem-users-hint">
        Para ativar o aparelho, crie um usuário do totem abaixo.
      </p>
      {error && <p className="totem-admin-error" role="alert" data-testid="totem-users-error">{error}</p>}

      <form className="totem-user-create" data-testid="totem-user-create" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          if (password !== confirmPassword) {
            throw new Error('As senhas não coincidem.');
          }
          await totemAccessRepository.createUser(securityContext, tenantId, { label, username, password });
          setLabel(''); setUsername(''); setPassword(''); setConfirmPassword('');
          setNotice('Usuário do totem criado.');
        });
      }}>
        <label>Rótulo<input value={label} onChange={e => setLabel(e.target.value)} maxLength={40} required placeholder="Caixa 1" /></label>
        <label>Usuário<input value={username} onChange={e => setUsername(e.target.value)} required placeholder="totem01" autoComplete="off" /></label>
        <label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
        <label>Confirmar<input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" data-testid="totem-user-confirm" /></label>
        <button type="submit" className="theme-primary" disabled={busy} data-testid="totem-user-create-submit">
          <Plus size={16} /> Criar usuário
        </button>
      </form>

      <ul className="totem-user-list" data-testid="totem-user-list">
        {users.map(user => (
          <li key={user.id} data-testid={`totem-user-${user.username}`}>
            <div>
              <strong>{user.label}</strong>
              <span>@{user.username} {user.isActive ? '' : '· inativo'}</span>
              <em>{user.activeDevice ? `Ativo em ${user.activeDevice.label} · ${formatSeen(user.activeDevice.lastSeenAt)}` : 'Nenhum aparelho ativo'}</em>
            </div>
            <div className="totem-user-actions">
              {passwordFor === user.id ? (
                <form onSubmit={event => {
                  event.preventDefault();
                  void run(async () => {
                    await totemAccessRepository.setUserPassword(securityContext, tenantId, user.id, newPassword);
                    setPasswordFor(null); setNewPassword(''); setNotice('Senha atualizada.');
                  });
                }}>
                  <input type="password" data-testid="totem-user-new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} placeholder="Nova senha" />
                  <button type="submit" className="theme-secondary" disabled={busy}>Salvar senha</button>
                </form>
              ) : (
                <button type="button" className="theme-secondary" onClick={() => { setPasswordFor(user.id); setNewPassword(''); }}>
                  <KeyRound size={14} /> Trocar senha
                </button>
              )}
              <button type="button" className="theme-secondary" disabled={busy} onClick={() => void run(async () => {
                await totemAccessRepository.setUserActive(securityContext, tenantId, user.id, !user.isActive);
                setNotice(user.isActive ? 'Usuário desativado e dispositivo revogado.' : 'Usuário reativado.');
              })}>
                {user.isActive ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          </li>
        ))}
        {users.length === 0 && <li className="totem-user-empty">Nenhum usuário do totem ainda.</li>}
      </ul>

      <h3 className="totem-device-heading"><MonitorSmartphone size={16} /> Dispositivos</h3>
      <ul className="totem-device-list" data-testid="totem-device-list">
        {devices.map(device => (
          <li key={device.id} data-active={device.active ? 'true' : 'false'}>
            <div>
              <strong>{device.label}</strong>
              <span>{device.userLabel ? `${device.userLabel} (@${device.username})` : 'Ativado pelo dono ou gerente'} · visto {formatSeen(device.lastSeenAt)}</span>
            </div>
            {device.active && (
              <button type="button" className="theme-secondary" data-testid={`totem-device-revoke-${device.id}`} disabled={busy} onClick={() => void run(async () => {
                await totemAccessRepository.revokeDevice(securityContext, tenantId, device.id);
                setNotice('Dispositivo desativado. O totem pedirá login de novo.');
              })}>
                <ShieldOff size={14} /> Desativar
              </button>
            )}
            {!device.active && <span className="totem-device-revoked">Desativado</span>}
          </li>
        ))}
        {devices.length === 0 && <li className="totem-user-empty">Nenhum dispositivo ativado ainda.</li>}
      </ul>
      {notice && <p className="totem-admin-notice" role="status">{notice}</p>}
    </section>
  );
}
