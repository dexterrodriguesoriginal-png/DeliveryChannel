import React, { useEffect, useState } from 'react';
import { Check, Copy, Crown, KeyRound, Loader2, QrCode, Share2, ShieldCheck, UserMinus, Users } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../../../context/AuthContext';
import { LegalCheckbox } from '../../legal/LegalUI';
import { legalSignupMetadata } from '../../../lib/legal/documents';
import { storeEmailData } from '../../../lib/auth/storeEmailBranding';
import { formatBRPhone, normalizeBRPhone } from '../../../lib/phone/brPhone';
import {
  formatInviteCode, inviteMinutesLeft, isInviteCodeComplete, normalizeInviteCode,
  type TabInvite, type TabMember,
} from '../../../lib/customer/tableAccess';

const inputCls = 'mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base';
const primaryBtn = 'w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50';

/** Identificação do Responsável/convidado: entrar ou criar conta de cliente (e-mail + senha, nome e celular). */
export const IdentityGate: React.FC<{
  storeName: string;
  tableLabel: string;
  intro: string;
  onGoogle: () => void;
  onSignedUp: (info: { requiresEmailConfirmation: boolean; name: string }) => void;
  onAuthenticated?: (name?: string) => void;
  initialName?: string;
  submitSignupLabel?: string;
  submitLoginLabel?: string;
}> = ({ storeName, tableLabel, intro, onGoogle, onSignedUp, onAuthenticated, initialName, submitSignupLabel, submitLoginLabel }) => {
  const { signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [name, setName] = useState(initialName || '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legal, setLegal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await signInWithPassword(email.trim(), password);
        if (!res.success) {
          setMessage(res.code === 'EMAIL_NOT_CONFIRMED' ? 'Confirme seu e-mail pelo link que enviamos e depois entre aqui.' : (res.error || 'E-mail ou senha incorretos.'));
        } else {
          onAuthenticated?.();
        }
        return;
      }
      if (name.trim().length < 2) { setMessage('Informe seu nome.'); return; }
      const digits = normalizeBRPhone(phone);
      if (!digits) { setMessage('Informe o celular com DDD (10 ou 11 dígitos).'); return; }
      if (password.length < 6) { setMessage('A senha precisa ter pelo menos 6 caracteres.'); return; }
      const res = await signUp(email.trim(), password, name.trim(), `+55${digits}`, { ...storeEmailData(storeName), user_type: 'customer', ...legalSignupMetadata(legal, 'customer') });
      if (!res.success) { setMessage(res.error || 'Não foi possível criar sua conta.'); return; }
      if (res.requiresEmailConfirmation) setConfirmEmail(email.trim());
      onSignedUp({ requiresEmailConfirmation: !!res.requiresEmailConfirmation, name: name.trim() });
      if (!res.requiresEmailConfirmation) onAuthenticated?.(name.trim());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível continuar.');
    } finally { setBusy(false); }
  };

  if (confirmEmail) {
    return (
      <section data-testid="identity-confirm-email" className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-xl">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-emerald-700" />
        <h2 className="text-lg font-black">Confirme seu e-mail</h2>
        <p className="mt-2 text-sm text-slate-600">Enviamos um link para <b>{confirmEmail}</b>. Depois de confirmar, você volta direto para a {tableLabel} e é só continuar.</p>
        <button type="button" onClick={() => { setConfirmEmail(''); setMode('login'); }} className="mt-4 w-full py-2 text-sm font-semibold text-emerald-800">Já confirmei, quero entrar</button>
      </section>
    );
  }

  return (
    <section data-testid="identity-gate" className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-xl">
      <div className="mb-4 flex items-center gap-3"><ShieldCheck className="h-8 w-8 text-emerald-700" /><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{storeName}</p><h1 className="text-xl font-black">{tableLabel}</h1></div></div>
      <h2 className="text-lg font-bold">{mode === 'signup' ? 'Crie sua conta para abrir a mesa' : 'Entre para abrir a mesa'}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">{intro}</p>
      <form onSubmit={submit} className="space-y-3">
        {mode === 'signup' && <>
          <label className="block text-sm font-semibold">Seu nome<input aria-label="Seu nome" value={name} onChange={e => setName(e.target.value)} autoComplete="name" className={inputCls} /></label>
          <label className="block text-sm font-semibold">Celular (WhatsApp)<input aria-label="Celular" inputMode="tel" value={phone} onChange={e => setPhone(formatBRPhone(e.target.value))} autoComplete="tel" placeholder="(11) 99999-0000" className={inputCls} /></label>
        </>}
        <label className="block text-sm font-semibold">E-mail<input aria-label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className={inputCls} /></label>
        <label className="block text-sm font-semibold">Senha<input aria-label="Senha" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className={inputCls} /></label>
        {mode === 'signup' && <LegalCheckbox checked={legal} onChange={setLegal} audience="customer" />}
        <button disabled={busy || (mode === 'signup' && !legal)} className={primaryBtn}>
          {busy ? 'Aguarde…' : mode === 'signup' ? (submitSignupLabel || 'Criar conta e continuar') : (submitLoginLabel || 'Entrar')}
        </button>
        <button type="button" onClick={onGoogle} disabled={busy} className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold">Continuar com Google</button>
        <button type="button" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMessage(''); }} className="w-full py-2 text-sm font-semibold text-emerald-800">{mode === 'signup' ? 'Já tenho conta' : 'Ainda não tenho conta'}</button>
      </form>
      <p className="mt-3 text-xs text-slate-500">Guardamos só nome, celular e e-mail — para a loja saber quem abriu a mesa e proteger a conta contra pedidos de estranhos.</p>
      {message && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    </section>
  );
};

/** Parte E: Quando já existe uma conta logada no aparelho, confirma a identidade antes de entrar na mesa. */
export const ConfirmLoggedUserGate: React.FC<{
  storeName: string;
  tableLabel: string;
  userName: string;
  userEmail?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  busy?: boolean;
  message?: string | null;
  onConfirm: () => void;
  onSwitchAccount: () => void;
}> = ({ storeName, tableLabel, userName, userEmail, logoUrl, primaryColor, busy, message, onConfirm, onSwitchAccount }) => {
  const accentStyle = primaryColor ? { backgroundColor: primaryColor } : undefined;
  return (
    <section data-testid="confirm-logged-user-gate" className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-xl">
      <div className="mb-4 flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt={storeName} className="h-12 w-12 rounded-2xl object-cover shadow-sm" />
        ) : (
          <ShieldCheck className="h-9 w-9 text-emerald-700" />
        )}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{storeName}</p>
          <h1 className="text-xl font-black text-slate-900">{tableLabel}</h1>
        </div>
      </div>
      <h2 className="text-lg font-black text-slate-900">Entrar como {userName}?</h2>
      {userEmail && <p className="mt-0.5 text-xs text-slate-500">{userEmail}</p>}
      <p className="mb-5 mt-2 text-sm text-slate-600">Confirme sua identificação para acessar o cardápio desta mesa.</p>
      <div className="space-y-2.5">
        <button
          type="button"
          data-testid="confirm-identity-continue"
          disabled={busy}
          onClick={onConfirm}
          style={accentStyle}
          className={primaryBtn}
        >
          {busy ? 'Entrando…' : 'Sou eu, continuar'}
        </button>
        <button
          type="button"
          data-testid="confirm-identity-switch"
          disabled={busy}
          onClick={onSwitchAccount}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
        >
          Não sou eu / trocar conta
        </button>
      </div>
      {message && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    </section>
  );
};

/**
 * Parte F: Tela de boas-vindas direta do link de convite (&convite=CODIGO).
 * Nunca mostra "Esta mesa já está em uso" para quem abriu o link de convite válido.
 */
export const InviteWelcomeScreen: React.FC<{
  storeName: string;
  tableLabel: string;
  responsibleName: string;
  inviteCode: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  identifiedUser: boolean;
  loggedUserName?: string;
  loggedUserEmail?: string;
  busy: boolean;
  message?: string | null;
  onJoinLoggedUser: () => void;
  onSwitchAccount: () => void;
  onGoogle: () => void;
  onSignedUp: (info: { requiresEmailConfirmation: boolean; name: string }) => void;
  onAuthenticated: (name?: string) => void;
}> = ({
  storeName,
  tableLabel,
  responsibleName,
  inviteCode,
  logoUrl,
  primaryColor,
  identifiedUser,
  loggedUserName,
  loggedUserEmail,
  busy,
  message,
  onJoinLoggedUser,
  onSwitchAccount,
  onGoogle,
  onSignedUp,
  onAuthenticated,
}) => {
  const accentStyle = primaryColor ? { backgroundColor: primaryColor } : undefined;
  const hostName = responsibleName?.trim() || 'Responsável';
  return (
    <div data-testid="invite-welcome-screen" className="mx-auto max-w-md space-y-4">
      <div className="rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={storeName} className="h-14 w-14 rounded-2xl object-cover shadow-sm" />
          ) : (
            <span
              style={accentStyle}
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-white shadow-sm"
            >
              <Users className="h-7 w-7" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-bold uppercase tracking-wide text-emerald-700">{storeName}</p>
            <h1 className="text-xl font-black text-slate-900">
              {hostName} convidou você para a {tableLabel} · {storeName}
            </h1>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Identifique-se para entrar na comanda da {tableLabel} e fazer seus pedidos junto com a mesa.
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-mono text-xs font-bold text-emerald-900">
          <KeyRound className="h-3.5 w-3.5" />Convite {formatInviteCode(inviteCode)}
        </p>
        {identifiedUser && (
          <div className="mt-5 space-y-2.5 border-t border-slate-100 pt-4">
            <p className="text-base font-black text-slate-900">Entrar como {loggedUserName || 'Cliente'}?</p>
            {loggedUserEmail && <p className="text-xs text-slate-500">{loggedUserEmail}</p>}
            <button
              type="button"
              data-testid="invite-enter-table-btn"
              disabled={busy}
              onClick={onJoinLoggedUser}
              style={accentStyle}
              className={primaryBtn}
            >
              {busy ? 'Entrando na mesa…' : 'Entrar na mesa'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSwitchAccount}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
            >
              Não sou eu / trocar conta
            </button>
          </div>
        )}
        {message && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
      </div>
      {!identifiedUser && (
        <IdentityGate
          storeName={storeName}
          tableLabel={tableLabel}
          intro={`Crie sua conta ou entre para aceitar o convite de ${hostName} e entrar na ${tableLabel}.`}
          onGoogle={onGoogle}
          onSignedUp={onSignedUp}
          onAuthenticated={onAuthenticated}
          submitSignupLabel="Criar conta e entrar na mesa"
          submitLoginLabel="Entrar na mesa"
        />
      )}
    </div>
  );
};

/** "Esta mesa já está em uso — chame o garçom" + "Fui convidado" (código de 6 caracteres). */
export const TableInUseScreen: React.FC<{
  storeName: string;
  tableLabel: string;
  initialCode?: string;
  busy: boolean;
  message: string;
  onSubmitCode: (code: string) => void;
}> = ({ storeName, tableLabel, initialCode, busy, message, onSubmitCode }) => {
  const [open, setOpen] = useState(!!initialCode);
  const [code, setCode] = useState(initialCode || '');
  return (
    <section data-testid="table-in-use" className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-xl">
      <div className="mb-4 flex items-center gap-3"><Users className="h-8 w-8 text-amber-600" /><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{storeName}</p><h1 className="text-xl font-black">{tableLabel}</h1></div></div>
      <h2 className="text-lg font-black">Esta mesa já está em uso — chame o garçom</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">Quem abriu a mesa pode te convidar. Se você é convidado, toque em &ldquo;Fui convidado&rdquo; e digite o código. Se a mesa é sua ou está sem responsável, chame o garçom.</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={primaryBtn}>Fui convidado</button>
      ) : (
        <form onSubmit={e => { e.preventDefault(); if (isInviteCodeComplete(code)) onSubmitCode(normalizeInviteCode(code)); }} className="space-y-3">
          <label className="block text-sm font-semibold">Código do convite
            <input aria-label="Código do convite" value={code} onChange={e => setCode(normalizeInviteCode(e.target.value))} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={7}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-4 text-center font-mono text-3xl font-black tracking-[0.3em]" placeholder="ABC123" />
          </label>
          <button disabled={busy || !isInviteCodeComplete(code)} className={primaryBtn}>{busy ? 'Verificando…' : 'Entrar na mesa'}</button>
        </form>
      )}
      {message && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    </section>
  );
};

/** "Convidar" (Minha conta): código curto que expira + QR/link. Só o Responsável vê. */
export const InvitePanel: React.FC<{
  invite: TabInvite | null;
  link: string;
  busy: boolean;
  onCreate: () => void;
  onRevoke: () => void;
}> = ({ invite, link, busy, onCreate, onRevoke }) => {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!invite) return;
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, [invite]);
  const minutes = invite ? inviteMinutesLeft(invite.expiresAt, now) : 0;
  const active = !!invite && minutes > 0;
  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? invite!.code : link);
      setCopied(what); window.setTimeout(() => setCopied(''), 1800);
    } catch { /* clipboard unavailable */ }
  };
  const share = async () => {
    try { await navigator.share({ title: 'Convite para a mesa', text: `Código ${formatInviteCode(invite!.code)}`, url: link }); } catch { /* cancelled */ }
  };
  return (
    <section data-testid="invite-panel" className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="mb-2 flex items-center gap-2"><KeyRound className="h-5 w-5 text-emerald-700" /><h3 className="font-black">Convidar para a mesa</h3></div>
      {!active ? (
        <>
          <p className="mb-3 text-sm text-slate-600">Gere um código para quem vai pedir junto com você. Ele vale por 15 minutos e você pode cancelar quando quiser.</p>
          <button type="button" onClick={onCreate} disabled={busy} className={primaryBtn}>{busy ? 'Gerando…' : 'Gerar código de convite'}</button>
        </>
      ) : (
        <>
          <p className="text-center font-mono text-4xl font-black tracking-[0.25em] text-emerald-900" aria-label={`Código ${invite!.code.split('').join(' ')}`} data-testid="invite-code">{formatInviteCode(invite!.code)}</p>
          <p className="mt-1 text-center text-xs font-semibold text-slate-500">Vale por mais {minutes} min · uso por convidados da sua mesa</p>
          {link && <div className="mx-auto my-3 w-fit rounded-2xl bg-white p-3 shadow-sm"><QRCodeSVG value={link} size={150} level="M" marginSize={1} /></div>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copy('code')} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold">{copied === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}Copiar código</button>
            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && link
              ? <button type="button" onClick={() => void share()} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold"><Share2 className="h-4 w-4" />Compartilhar</button>
              : <button type="button" onClick={() => void copy('link')} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold">{copied === 'link' ? <Check className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}Copiar link</button>}
          </div>
          <button type="button" onClick={onRevoke} disabled={busy} className="mt-2 w-full py-2 text-sm font-bold text-rose-700 disabled:opacity-50">Cancelar este código</button>
        </>
      )}
    </section>
  );
};

/** Pessoas na mesa: o Responsável remove convidados e passa a responsabilidade. */
export const MembersPanel: React.FC<{
  members: TabMember[];
  mySessionId: string;
  busy: boolean;
  onRemove: (m: TabMember) => void;
  onTransfer: (m: TabMember) => void;
}> = ({ members, mySessionId, busy, onRemove, onTransfer }) => {
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'transfer'; member: TabMember } | null>(null);
  if (!members.length) return null;
  return (
    <section data-testid="members-panel" className="rounded-2xl bg-slate-50 p-4">
      <div className="mb-2 flex items-center gap-2"><Users className="h-5 w-5 text-slate-700" /><h3 className="font-black">Pessoas na mesa</h3></div>
      <ul className="divide-y divide-slate-200">
        {members.map(member => {
          const mine = member.sessionId === mySessionId;
          return (
            <li key={member.sessionId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                {member.role === 'RESPONSIBLE' && <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-label="Responsável" />}
                <span className="truncate">{member.displayName}{mine ? ' (você)' : ''}</span>
                <span className="shrink-0 text-xs font-normal text-slate-500">{member.role === 'RESPONSIBLE' ? 'Responsável' : member.approved ? 'Convidado' : 'Aguardando liberação'}</span>
              </span>
              {!mine && member.role !== 'RESPONSIBLE' && (
                <span className="flex shrink-0 gap-1">
                  <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'transfer', member })} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold">Passar responsabilidade</button>
                  <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'remove', member })} aria-label={`Remover ${member.displayName}`} className="rounded-lg border border-rose-200 bg-white p-1.5 text-rose-700"><UserMinus className="h-4 w-4" /></button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {confirm && (
        <div role="alertdialog" aria-label="Confirmar" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">{confirm.kind === 'remove'
            ? `Remover ${confirm.member.displayName} da mesa? Ele perde o acesso e não pode mais pedir.`
            : `Passar a responsabilidade da mesa para ${confirm.member.displayName}? Você continua na mesa como convidado.`}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { const c = confirm; setConfirm(null); if (c.kind === 'remove') onRemove(c.member); else onTransfer(c.member); }} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white">Confirmar</button>
            <button type="button" onClick={() => setConfirm(null)} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold">Voltar</button>
          </div>
        </div>
      )}
    </section>
  );
};

export const Spinner: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-700"><Loader2 className="mr-2 h-5 w-5 animate-spin" />{label}</div>
);
