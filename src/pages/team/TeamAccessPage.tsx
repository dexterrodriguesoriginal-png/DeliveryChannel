import React, { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { roleFromTeamPath, TEAM_ROLE_LABELS } from '../../lib/teamAccess';
import { roleDestination } from '../../lib/navPermissions';

export const TEAM_INVITE_REQUIRED_MESSAGE = 'Este e-mail não foi convidado. Fale com o estabelecimento.';

export function readTeamAccessPath(path: string) {
  const match = /^\/equipe\/([a-z0-9][a-z0-9-]{0,99})\/([a-z_]+)\/?$/i.exec(path);
  const role = match && roleFromTeamPath(match[2]);
  return match && role ? { slug: match[1].toLowerCase(), role } : null;
}

/** Login and first access are scoped to a single establishment and role. */
export const TeamAccessPage: React.FC = () => {
  const auth = useAuth();
  const passwordId = useId();
  const target = readTeamAccessPath(window.location.pathname);
  const [signup, setSignup] = useState(() => new URLSearchParams(window.location.search).get('signup') === '1' && target?.role !== 'OWNER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!target || !auth.supabaseUser || auth.isLoadingAuth || auth.isMembershipLoading) return;
    const ownMembership = auth.availableTenants.find(member => member.tenantSlug === target.slug && member.status === 'ACTIVE');
    if (ownMembership) {
      if (auth.activeTenant?.id === ownMembership.tenantId) {
        window.location.replace(roleDestination(ownMembership.roleId, target.slug));
      } else {
        void auth.switchTenant(ownMembership.tenantId);
      }
      return;
    }
    const key = `${auth.supabaseUser.id}:${target.slug}:${target.role}`;
    if (attempted.current === key) return;
    attempted.current = key;
    setBusy(true); setMessage('');
    void (async () => {
      try {
        const { error } = await supabase.rpc('team_accept_invite', { p_slug: target.slug, p_role: target.role });
        if (error) { setMessage(TEAM_INVITE_REQUIRED_MESSAGE); return; }
        await auth.refreshSession();
      } catch { setMessage('Não foi possível entrar na equipe. Tente novamente.'); }
      finally { setBusy(false); }
    })();
  }, [auth.supabaseUser?.id, auth.isLoadingAuth, auth.isMembershipLoading, auth.availableTenants, auth.activeTenant?.id, target?.slug, target?.role]);

  if (!target) return <main className="min-h-screen grid place-items-center"><p>Link de acesso à equipe inválido. Peça o link ao estabelecimento.</p></main>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (signup) {
        const { data, error } = await supabase.rpc('team_invite_check', { p_slug: target.slug, p_email: email.trim(), p_role: target.role });
        if (error) { setMessage('Não foi possível verificar o convite. Tente novamente em instantes.'); return; }
        if (data?.invited !== true) { setMessage(TEAM_INVITE_REQUIRED_MESSAGE); return; }
        const result = await auth.signUp(email.trim(), password, name.trim(), undefined, {
          audience: 'team', team_signup_slug: target.slug, team_signup_role: target.role,
        });
        if (!result.success) setMessage(result.error || 'Não foi possível criar sua conta.');
        else if (result.requiresEmailConfirmation) setConfirmation(true);
      } else {
        const result = await auth.signInWithPassword(email.trim(), password);
        if (!result.success) setMessage(result.error || 'Não foi possível entrar.');
      }
    } catch { setMessage('Não foi possível concluir. Tente novamente em instantes.'); }
    finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-slate-100 grid place-items-center p-4"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm space-y-4">
    <Users className="w-9 h-9 text-emerald-700" />
    <h1 className="text-2xl font-black">{TEAM_ROLE_LABELS[target.role]} · {target.slug}</h1>
    {confirmation || auth.authState === 'EMAIL_CONFIRMATION_REQUIRED' ? <>
      <h2 className="text-lg font-bold">Confirme seu e-mail</h2><p>Abra o link enviado para confirmar sua conta e entrar na equipe.</p>
      <button className="font-bold text-emerald-700" onClick={async () => { const result = await auth.resendConfirmationEmail(email || auth.pendingConfirmationEmail || ''); setMessage(result.success ? 'E-mail enviado.' : result.error || 'Não foi possível reenviar.'); }}>Reenviar e-mail</button>
      <button className="block font-bold text-emerald-700" onClick={() => { auth.clearEmailConfirmation(); setConfirmation(false); setSignup(false); }}>Voltar para entrar</button>
    </> : auth.supabaseUser ? <>
      <p>{busy ? 'Entrando na equipe…' : 'Use a conta convidada pelo estabelecimento.'}</p>
      <button onClick={() => void auth.signOut()} className="font-bold text-emerald-700">Sair da conta</button>
    </> : <form onSubmit={submit} className="space-y-4">
      {signup && <label className="block font-semibold">Nome<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" className="mt-1 w-full border rounded-xl px-3 py-3" /></label>}
      <label className="block font-semibold">E-mail<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="mt-1 w-full border rounded-xl px-3 py-3" /></label>
      <div className="block font-semibold"><label htmlFor={passwordId}>Senha</label><div className="relative mt-1"><input id={passwordId} required minLength={signup ? 6 : undefined} type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} className="w-full border rounded-xl pl-3 pr-12 py-3" /><button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-3 top-3">{showPassword ? <EyeOff /> : <Eye />}</button></div></div>
      <button disabled={busy} className="w-full min-h-12 rounded-xl bg-emerald-700 text-white font-bold disabled:opacity-60">{busy ? 'Aguarde…' : signup ? 'Criar conta' : 'Entrar'}</button>
      {target.role !== 'OWNER' && <button type="button" onClick={() => { setSignup(value => !value); setMessage(''); }} className="w-full font-bold text-emerald-700">{signup ? 'Já tenho conta' : 'Primeiro acesso? Criar conta'}</button>}
    </form>}
    {message && <p role="alert" className="text-sm text-red-800">{message}</p>}
  </section></main>;
};

