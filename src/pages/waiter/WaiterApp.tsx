import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, ChevronRight, LayoutGrid, LogOut, Loader2, MoreHorizontal, Search, ShieldAlert, ShoppingBag, UserCheck, Volume2, WifiOff, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { LegalCheckbox } from '../../components/legal/LegalUI';
import { legalSignupMetadata } from '../../lib/legal/documents';
import { teamRepository } from '../../repositories/teamRepository';
import { readWaiterEmailParam } from '../../lib/waiter/waiterAccess';
import type { Category, Product, TeamInvite } from '../../types';
import { useModules } from '../../hooks/useModules';
import { usePendingApprovals } from '../../hooks/usePendingApprovals';
import { newIdempotencyKey } from '../../lib/backend';
import { dineInRoundItems, type DineInCartLine } from '../../lib/customer/dineInCart';
import { deriveTableStatus, compareTables, matchesFilter, matchesSearch, statusCounts, ELAPSED_REFRESH_MS, type CallLike, type TableFilter } from '../../lib/salon/tableStatus';
import { formatTableLabel } from '../../lib/orders/labels';
import { mesasQrRepository, NO_CAPABILITIES, type MesasQrCapabilities } from '../../repositories/mesasQrRepository';
import { salonStaffRepository, type SalonAccessExtras, type SalonSnapshot, type StaffHolderCode, type WaiterCallRow, type WaiterSession } from '../../repositories/salonStaffRepository';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { ApprovalRow } from '../../components/establishment/salon/ApprovalsAlert';
import { TableCard } from '../../components/establishment/salon/TableCard';
import '../../components/establishment/salon/salon.css';
import { playShortBeep, playNewOrderSound, unlockAudio } from '../../utils/audio';
import { badgeText, callTitle, canUseWaiterApp, greeting, newRoundIds, openCalls, waiterFeatures, type WaiterTab } from './waiterLogic';
import { WaiterInstallCard } from './WaiterInstallCard';
import { WaiterOrderSheet } from './WaiterOrderSheet';
import { WaiterTableSheet } from './WaiterTableSheet';

const shell = 'min-h-[100dvh] bg-slate-950 text-white';

const Center: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
  <main className={`${shell} grid place-items-center px-6 py-10`} data-testid={testId}><div className="w-full max-w-sm">{children}</div></main>
);
const Brand: React.FC = () => (
  <div className="mb-6 flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30"><UserCheck className="h-6 w-6" /></span><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Delivery Channel</p><h1 className="text-2xl font-black">Garçom</h1></div></div>
);

const inputCls = 'mt-1 h-12 w-full rounded-2xl border-0 bg-white px-4 text-base text-slate-900 outline-none ring-1 ring-slate-300 focus:ring-2 focus:ring-emerald-500';

const LoginScreen: React.FC = () => {
  const { signInWithPassword, signUp } = useAuth();
  const invited = useMemo(() => (typeof window === 'undefined' ? null : readWaiterEmailParam(window.location.search)), []);
  const [mode, setMode] = useState<'login' | 'signup'>(invited ? 'signup' : 'login');
  const [email, setEmail] = useState(invited || ''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [legal, setLegal] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [confirmEmail, setConfirmEmail] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'login') {
        const res = await signInWithPassword(email.trim(), password);
        if (!res.success) setMessage(res.code === 'EMAIL_NOT_CONFIRMED' ? 'Confirme seu e-mail pelo link que recebeu e entre de novo.' : (res.error || 'E-mail ou senha incorretos.'));
      } else {
        if (name.trim().length < 2) { setMessage('Informe seu nome.'); return; }
        if (password.length < 6) { setMessage('A senha precisa ter pelo menos 6 caracteres.'); return; }
        const res = await signUp(email.trim(), password, name.trim(), undefined, legalSignupMetadata(legal, 'owner'));
        if (!res.success) setMessage(res.error || 'Não foi possível criar a conta.');
        else if (res.requiresEmailConfirmation) setConfirmEmail(email.trim());
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível continuar.'); }
    finally { setBusy(false); }
  };
  if (confirmEmail) {
    return <Center testId="waiter-confirm-email"><Brand /><div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10"><h2 className="text-lg font-black">Confirme seu e-mail</h2><p className="mt-1 text-sm text-slate-300">Enviamos um link para <strong>{confirmEmail}</strong>. Abra o link e você volta direto para o aplicativo do Garçom.</p></div></Center>;
  }
  return (
    <Center testId="waiter-login">
      <Brand />
      <form onSubmit={submit} className="space-y-3 rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
        <p className="text-sm text-slate-300">{mode === 'signup' ? 'Crie sua conta com o e-mail que o dono usou no convite.' : 'Entre com a conta que o dono da loja convidou para a equipe.'}</p>
        {mode === 'signup' && <label className="block text-sm font-semibold">Seu nome<input aria-label="Seu nome" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} className={inputCls} /></label>}
        <label className="block text-sm font-semibold">E-mail<input aria-label="E-mail" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} className={inputCls} /></label>
        <label className="block text-sm font-semibold">Senha<input aria-label="Senha" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={e => setPassword(e.target.value)} className={inputCls} /></label>
        {mode === 'signup' && <div className="rounded-2xl bg-white p-3 text-slate-900"><LegalCheckbox checked={legal} onChange={setLegal} audience="owner" /></div>}
        <button disabled={busy || (mode === 'signup' && !legal)} className="h-14 w-full rounded-2xl bg-emerald-500 text-base font-black text-slate-950 disabled:opacity-60">{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta e entrar'}</button>
        {message && <p role="alert" className="rounded-xl bg-rose-500/15 p-3 text-sm text-rose-200">{message}</p>}
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }} className="w-full py-1 text-center text-sm font-bold text-emerald-300">{mode === 'login' ? 'Primeiro acesso? Criar conta' : 'Já tenho conta'}</button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-400">Sem convite ainda? Peça ao dono: Equipe &amp; Permissões → Convidar Colaborador → cargo Garçom.</p>
    </Center>
  );
};

/** Conta sem equipe: se existe convite pendente de Garçom para o e-mail da conta, entra na equipe (um convite = automático). */
const JoinInvite: React.FC<{ email: string; signOutBtn: React.ReactNode }> = ({ email, signOutBtn }) => {
  const { refreshSession } = useAuth();
  const [invites, setInvites] = useState<Array<TeamInvite & { tenantName?: string }> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const tried = useRef(false);
  const accept = useCallback(async (id: string) => {
    setBusyId(id); setError('');
    try { await teamRepository.acceptInvite(id); await refreshSession(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível aceitar o convite.'); setBusyId(null); }
  }, [refreshSession]);
  useEffect(() => {
    let alive = true;
    void teamRepository.listMyReceivedInvites().then(list => {
      if (!alive) return;
      const waiter = list.filter(i => String(i.roleId) === 'WAITER' && i.status === 'PENDING');
      setInvites(waiter);
      if (waiter.length === 1 && !tried.current) { tried.current = true; void accept(waiter[0].id); }
    }).catch(() => alive && setInvites([]));
    return () => { alive = false; };
  }, [accept]);
  if (invites === null || (invites.length === 1 && busyId && !error)) {
    return <Center testId="waiter-joining"><Brand /><div className="flex items-center gap-3 rounded-3xl bg-white/5 p-5 text-slate-200 ring-1 ring-white/10"><Loader2 className="h-5 w-5 animate-spin" />Entrando na equipe…</div></Center>;
  }
  if (!invites.length) {
    return <Notice testId="waiter-no-access" title="Sem acesso a uma loja" text={`Não encontramos convite de Garçom para ${email}. Entre com o mesmo e-mail que o dono convidou (ou peça um novo convite).`}>{signOutBtn}</Notice>;
  }
  return (
    <Center testId="waiter-invites"><Brand />
      <div className="space-y-3 rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
        <h2 className="text-lg font-black">Você foi convidado(a)</h2>
        {invites.map(invite => <button key={invite.id} type="button" disabled={!!busyId} onClick={() => void accept(invite.id)} className="h-14 w-full rounded-2xl bg-emerald-500 text-base font-black text-slate-950 disabled:opacity-60">{busyId === invite.id ? 'Entrando…' : `Entrar na equipe${invite.tenantName ? ` · ${invite.tenantName}` : ''}`}</button>)}
        {error && <p role="alert" className="rounded-xl bg-rose-500/15 p-3 text-sm text-rose-200">{error}</p>}
        {signOutBtn}
      </div>
    </Center>
  );
};

const Notice: React.FC<{ title: string; text: string; testId: string; children?: React.ReactNode }> = ({ title, text, testId, children }) => (
  <Center testId={testId}><Brand /><div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10"><ShieldAlert className="mb-2 h-6 w-6 text-amber-300" /><h2 className="text-lg font-black">{title}</h2><p className="mt-1 text-sm text-slate-300">{text}</p><div className="mt-4 flex flex-col gap-2">{children}</div></div></Center>
);

export const WaiterApp: React.FC = () => {
  const { supabaseUser, isLoadingAuth, isMembershipLoading, authState, activeTenant, activeRole, availableTenants = [], switchTenant, signOut } = useAuth();
  const { available, loading: modulesLoading, isModuleEnabled } = useModules();
  const [autoSwitchingStore, setAutoSwitchingStore] = useState(false);
  // Confirma "Mesa/Comanda desligada" na mesma fonte da tela Ferramentas (tenant_modules) via RPC pública
  // (SECURITY DEFINER), que não depende de RLS de leitura do cargo do usuário.
  const [publicDineIn, setPublicDineIn] = useState<{ tenantId: string; enabled: boolean } | null>(null);
  const autoTriedRef = useRef<Set<string>>(new Set());
  const moduleOff = !!available && !isModuleEnabled('dine_in');
  useEffect(() => {
    if (!activeTenant?.id || !moduleOff) return;
    const tenantId = activeTenant.id;
    let alive = true;
    void tenantModuleRepository.getPublicEnabled(tenantId)
      .then(keys => { if (alive) setPublicDineIn({ tenantId, enabled: !!keys?.has('dine_in') }); })
      .catch(() => { if (alive) setPublicDineIn({ tenantId, enabled: false }); });
    return () => { alive = false; };
  }, [activeTenant?.id, moduleOff]);
  const dineInConfirmedByServer = publicDineIn?.tenantId === activeTenant?.id && publicDineIn?.enabled === true;
  const dineInChecking = moduleOff && publicDineIn?.tenantId !== activeTenant?.id;
  const signOutBtn = <button type="button" onClick={() => void signOut()} className="h-12 rounded-2xl border border-white/20 text-sm font-bold">Entrar com outra conta</button>;

  // Se o usuário tem vínculo em mais de uma loja e a loja ativa está com Mesa/Comanda desligada,
  // procura automaticamente outra loja vinculada que tenha Mesa/Comanda (dine_in) ligada.
  useEffect(() => {
    if (!activeTenant?.id || !available || isModuleEnabled('dine_in') || dineInChecking || dineInConfirmedByServer) return;
    if (!availableTenants || availableTenants.length <= 1 || typeof switchTenant !== 'function') return;
    if (autoTriedRef.current.has(activeTenant.id)) return;
    autoTriedRef.current.add(activeTenant.id);
    let alive = true;
    const candidates = availableTenants
      .filter(t => t.tenantId !== activeTenant.id)
      .sort((a, b) => (a.roleId === 'WAITER' ? -1 : 1) - (b.roleId === 'WAITER' ? -1 : 1));
    void (async () => {
      for (const candidate of candidates) {
        try {
          const snap = await tenantModuleRepository.getForTenant(candidate.tenantId);
          if (!alive) return;
          if (snap.modules.some(m => m.key === 'dine_in' && m.enabled)) {
            setAutoSwitchingStore(true);
            await switchTenant(candidate.tenantId);
            if (alive) setAutoSwitchingStore(false);
            return;
          }
        } catch {
          // tenta a próxima loja
        }
      }
    })();
    return () => { alive = false; };
  }, [activeTenant?.id, available, isModuleEnabled, availableTenants, switchTenant, dineInChecking, dineInConfirmedByServer]);

  if (isLoadingAuth || isMembershipLoading || autoSwitchingStore || authState === 'AUTHENTICATING' || authState === 'AUTHENTICATED_RESOLVING_MEMBERSHIP') {
    return <Center testId="waiter-loading"><div className="flex items-center gap-3 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" />Carregando…</div></Center>;
  }
  if (!supabaseUser) return <LoginScreen />;
  if (!activeTenant) return <JoinInvite email={supabaseUser.email || ''} signOutBtn={signOutBtn} />;
  if (!canUseWaiterApp(activeRole)) return <Notice testId="waiter-wrong-role" title="Acesso só para a equipe do salão" text="O aplicativo do Garçom é para Garçom, Caixa, Gerente e Dono.">{signOutBtn}</Notice>;
  if (modulesLoading && !available) return <Center testId="waiter-loading"><div className="flex items-center gap-3 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" />Carregando…</div></Center>;
  if (dineInChecking) return <Center testId="waiter-loading"><div className="flex items-center gap-3 text-slate-300"><Loader2 className="h-5 w-5 animate-spin" />Carregando…</div></Center>;
  if (moduleOff && !dineInConfirmedByServer) {
    return (
      <Notice
        testId="waiter-tool-off"
        title="Salão desligado"
        text={`A ferramenta Mesa/Comanda está desligada na loja ${activeTenant.name || 'atual'}. O dono liga em Ferramentas, no painel.`}
      >
        {availableTenants.length > 1 && typeof switchTenant === 'function' && (
          <div className="space-y-2 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10" data-testid="waiter-store-picker">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Escolher outra loja</p>
            {availableTenants.map(t => (
              <button
                key={t.tenantId}
                type="button"
                disabled={t.tenantId === activeTenant.id}
                onClick={() => void switchTenant(t.tenantId)}
                className={`flex h-12 w-full items-center justify-between rounded-xl px-3 text-sm font-black ${
                  t.tenantId === activeTenant.id
                    ? 'bg-white/10 text-slate-300 opacity-60'
                    : 'bg-emerald-500 text-slate-950'
                }`}
              >
                <span className="truncate">{t.tenantName || t.tenantSlug || 'Loja'}</span>
                <span className="text-xs font-bold">{t.tenantId === activeTenant.id ? 'Atual' : 'Abrir'}</span>
              </button>
            ))}
          </div>
        )}
        <a href="/" className="grid h-12 place-items-center rounded-2xl bg-emerald-500 text-sm font-black text-slate-950">Abrir o painel</a>
        {signOutBtn}
      </Notice>
    );
  }
  return <WaiterMain tenantId={activeTenant.id} />;
};

const FILTERS: Array<{ id: TableFilter | 'ATTN'; label: string }> = [
  { id: 'ALL', label: 'Todas' }, { id: 'ATTN', label: 'Atenção' }, { id: 'OCCUPIED', label: 'Ocupadas' }, { id: 'FREE', label: 'Livres' },
];

const WaiterMain: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { activeTenant, activeRole, currentUser, availableTenants, switchTenant, signOut, securityContext } = useAuth();
  const [tab, setTab] = useState<WaiterTab>('MESAS');
  const [snap, setSnap] = useState<SalonSnapshot | null>(null);
  const [extras, setExtras] = useState<SalonAccessExtras | null>(null);
  const [caps, setCaps] = useState<MesasQrCapabilities>(NO_CAPABILITIES);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TableFilter | 'ATTN'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [holderCode, setHolderCode] = useState<StaffHolderCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [orderTarget, setOrderTarget] = useState<{ tabId: string; label: string } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [sending, setSending] = useState(false);
  const [wake, setWake] = useState(false);
  const [orderAlert, setOrderAlert] = useState<{ id: string; tableId: string; tableLabel: string; customerName: string; orderNumber: number; roundNo: number } | null>(null);
  const seenCalls = useRef<Set<string> | null>(null);
  const seenRounds = useRef<Set<string> | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const features = waiterFeatures(caps.tableAccess);

  const approvals = usePendingApprovals(tenantId, true);

  const load = useCallback(async () => {
    try {
      const next = await salonStaffRepository.snapshot(tenantId);
      const calls = next.calls.filter(c => c.status === 'OPEN');
      if (seenCalls.current && calls.some(c => !seenCalls.current!.has(c.id))) (playShortBeep ?? playNewOrderSound)?.();
      seenCalls.current = new Set(calls.map(c => c.id));
      const freshRoundIds = newRoundIds(seenRounds.current, next.rounds);
      if (freshRoundIds.length > 0) {
        (playNewOrderSound ?? playShortBeep)?.();
        const latest = next.rounds.find(r => r.id === freshRoundIds[freshRoundIds.length - 1]) || next.rounds[next.rounds.length - 1];
        if (latest) {
          const tabRow = next.tabs.find(t => t.id === latest.tab_id);
          const tableRow = next.tables.find(t => t.id === tabRow?.table_id);
          setOrderAlert({
            id: latest.id,
            tableId: tableRow?.id || '',
            tableLabel: formatTableLabel(tableRow?.label, 'Mesa'),
            customerName: latest.customer_name || 'Cliente',
            orderNumber: latest.order_number,
            roundNo: latest.round_no,
          });
        }
      }
      seenRounds.current = new Set(next.rounds.map(r => r.id));
      setSnap(next); setOffline(false); setLoadError('');
    } catch (error) {
      setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar o salão.');
    }
  }, [tenantId]);

  useEffect(() => {
    seenCalls.current = null; seenRounds.current = null; setOrderAlert(null); setSnap(null);
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 5000);
    const onVisible = () => { if (document.visibilityState === 'visible') { void load(); void approvals.refresh(); } };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    const channel = typeof supabase?.channel === 'function'
      ? supabase
          .channel(`waiter-salon:${tenantId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tab_sessions', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); void approvals.refresh(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tabs', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); void approvals.refresh(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tab_events', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); void approvals.refresh(); })
          .subscribe()
      : null;
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      if (channel && typeof supabase?.removeChannel === 'function') void supabase.removeChannel(channel);
    };
  }, [load, tenantId, approvals.refresh]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ELAPSED_REFRESH_MS); return () => window.clearInterval(t); }, []);
  useEffect(() => { let alive = true; void mesasQrRepository.capabilities().then(c => { if (alive) setCaps(c); }); return () => { alive = false; }; }, [tenantId]);
  useEffect(() => {
    if (!caps.tableAccess || !snap?.tabs.length) { setExtras(null); return; }
    let alive = true;
    void salonStaffRepository.accessExtras(tenantId, snap.tabs.map(t => t.id)).then(e => { if (alive) setExtras(e); }).catch(() => { if (alive) setExtras(null); });
    return () => { alive = false; };
  }, [tenantId, caps.tableAccess, snap?.tabs, snap?.sessions]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(t); }, [toast]);
  useEffect(() => () => { void wakeRef.current?.release().catch(() => undefined); }, []);

  const toggleWake = async () => {
    try {
      if (wake) { await wakeRef.current?.release(); wakeRef.current = null; setWake(false); return; }
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      if (!nav.wakeLock) { setToast('Seu navegador não permite manter a tela ligada.'); return; }
      wakeRef.current = await nav.wakeLock.request('screen'); setWake(true);
    } catch { setToast('Não foi possível manter a tela ligada.'); }
  };

  const tables = snap?.tables || [];
  const tabs = snap?.tabs || [];
  const sessions = useMemo(() => {
    const base = snap?.sessions || [];
    const seen = new Set(base.map(s => s.id));
    const fromApprovals: WaiterSession[] = approvals.pending
      .filter(a => !seen.has(a.sessionId))
      .map(a => ({ id: a.sessionId, tab_id: a.tabId, display_name: a.displayName, approved_at: null, expires_at: a.expiresAt }));
    return fromApprovals.length ? [...base, ...fromApprovals] : base;
  }, [snap?.sessions, approvals.pending]);
  const calls = useMemo(() => openCalls((snap?.calls || []) as CallLike[]), [snap?.calls]);
  const rounds = snap?.rounds || [];
  const infoByTable = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveTableStatus>>();
    for (const table of tables) {
      const t = tabs.find(item => item.table_id === table.id);
      map.set(table.id, deriveTableStatus({ tab: t, calls, sessions, rounds, now }));
    }
    return map;
  }, [tables, tabs, calls, sessions, rounds, now]);
  const counts = useMemo(() => statusCounts(Array.from(infoByTable.values())), [infoByTable]);
  const visible = useMemo(() => tables.filter(t => {
    const info = infoByTable.get(t.id)!;
    return matchesSearch(t, search) && (filter === 'ATTN' ? matchesFilter(info, 'CALL') : matchesFilter(info, filter));
  }).sort(compareTables), [tables, infoByTable, search, filter]);

  const selected = tables.find(t => t.id === selectedId) || null;
  const selectedTab = selected ? tabs.find(t => t.table_id === selected.id) : undefined;
  const labelByTab = useMemo(() => { const m = new Map<string, string>(); for (const t of tabs) m.set(t.id, formatTableLabel(tables.find(x => x.id === t.table_id)?.label, 'Mesa')); return m; }, [tabs, tables]);

  const run = async (key: string, action: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setMessage('');
    try { await action(); await Promise.all([load(), approvals.refresh()]); if (ok) setToast(ok); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível concluir a ação.'); }
    finally { setBusy(null); }
  };

  const handleApproveSession = async (sessionId: string) => {
    await approvals.approve(sessionId);
    await load();
  };
  const handleRejectSession = async (sessionId: string) => {
    await approvals.reject(sessionId);
    await load();
  };

  const openOrder = async (tabId: string, label: string) => {
    setOrderTarget({ tabId, label }); setProductsError('');
    if (products.length || productsLoading) return;
    setProductsLoading(true);
    try {
      const menu = await salonStaffRepository.loadMenu(tenantId, activeTenant?.slug, securityContext);
      setProducts(menu.products.filter(p => p.isAvailable !== false));
      setCategories(menu.categories);
    } catch (error) { setProductsError(error instanceof Error ? error.message : 'Não foi possível carregar o cardápio.'); }
    finally { setProductsLoading(false); }
  };
  const sendOrder = async (cart: DineInCartLine[]) => {
    if (!orderTarget || !cart.length) return;
    setSending(true); setProductsError('');
    try {
      await salonStaffRepository.submitRound(orderTarget.tabId, dineInRoundItems(cart), newIdempotencyKey());
      setOrderTarget(null); setToast('Pedido feito!'); await load();
    } catch (error) { setProductsError(error instanceof Error ? error.message : 'Não foi possível enviar o pedido.'); }
    finally { setSending(false); }
  };
  const openTable = () => {
    if (!selected) return;
    void run('open-table', async () => {
      const res = await salonStaffRepository.openTab(selected.id);
      await openOrder(res.tabId, selected.label);
    });
  };

  const pendingCount = approvals.pending.length;
  const navItem = (id: WaiterTab, label: string, Icon: React.ComponentType<{ className?: string }>, badge = 0) => (
    <button key={id} type="button" onClick={() => { unlockAudio(); setTab(id); }} aria-current={tab === id ? 'page' : undefined}
      className={`relative flex flex-1 flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-bold transition ${tab === id ? 'bg-white/10 text-emerald-300' : 'text-slate-400'}`}>
      <span className="relative"><Icon className="h-6 w-6" />{badge > 0 && <span data-testid={`badge-${id}`} className="absolute -right-3 -top-2 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-black leading-[18px] text-white">{badgeText(badge)}</span>}</span>{label}
    </button>
  );

  return (
    <div className={`${shell} flex flex-col`} data-testid="waiter-app">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/90 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-400">{greeting(new Date(now))}{currentUser?.name ? `, ${currentUser.name.split(' ')[0]}` : ''}</p><h1 className="truncate text-lg font-black">{activeTenant?.name || 'Garçom'}</h1></div>
          <div className="flex shrink-0 items-center gap-2">
            {availableTenants.length > 1 && <select aria-label="Trocar de loja" value={tenantId} onChange={e => void switchTenant(e.target.value)} className="h-10 max-w-[9rem] rounded-xl border-0 bg-white/10 px-2 text-xs font-bold text-white">{availableTenants.map(t => <option key={t.tenantId} value={t.tenantId} className="text-slate-900">{t.tenantName}</option>)}</select>}
            <span title={offline ? 'Sem conexão' : 'Conectado'} className={`h-2.5 w-2.5 rounded-full ${offline || loadError ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          </div>
        </div>
      </header>

      {(offline || loadError) && <div role="status" className="mx-auto mt-3 flex w-full max-w-2xl items-center gap-2 px-4 text-xs font-semibold text-amber-200"><WifiOff className="h-4 w-4 shrink-0" />{offline ? 'Sem conexão. Tentando de novo…' : loadError}</div>}
      {!caps.tableAccess && snap && <p role="status" className="mx-auto mt-3 w-full max-w-2xl px-4 text-xs text-slate-400">Algumas funções (recusar, abrir mesa, pedir a conta) chegam com a próxima atualização do sistema.</p>}

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-4">
        {orderAlert && (
          <div role="alert" data-testid="waiter-order-alert" className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/50 bg-emerald-500/15 p-3.5 text-white shadow-lg">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500 text-slate-950"><ShoppingBag className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-emerald-200">Novo pedido na {orderAlert.tableLabel}</p>
                <p className="truncate text-xs text-slate-200">Rodada {orderAlert.roundNo} (#{orderAlert.orderNumber}) · {orderAlert.customerName}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {orderAlert.tableId && (
                <button
                  type="button"
                  onClick={() => { setTab('MESAS'); setSelectedId(orderAlert.tableId); setOrderAlert(null); }}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950"
                >
                  Ver mesa
                </button>
              )}
              <button type="button" aria-label="Fechar alerta de pedido" onClick={() => setOrderAlert(null)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {tab !== 'LIBERAR' && approvals.pending.length > 0 && (
          <section role="alert" aria-live="polite" data-testid="waiter-approvals-banner" className="mb-3 space-y-2 rounded-2xl border border-amber-400/50 bg-amber-500/15 p-3 text-slate-900">
            <div className="flex items-center justify-between gap-2 text-amber-200">
              <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wide">
                <UserCheck className="h-4 w-4 shrink-0" />
                {approvals.pending.length === 1 ? '1 mesa aguardando liberação' : `${approvals.pending.length} mesas aguardando liberação`}
              </span>
              <button type="button" onClick={() => setTab('LIBERAR')} className="text-xs font-bold underline">Ver todas</button>
            </div>
            <div className="space-y-2">
              {approvals.pending.map(item => (
                <ApprovalRow
                  key={item.sessionId}
                  item={item}
                  busy={approvals.busyId === item.sessionId}
                  canReject={features.reject}
                  onApprove={id => void handleApproveSession(id)}
                  onReject={id => void handleRejectSession(id)}
                  onOpenTable={id => { setTab('MESAS'); setSelectedId(id); }}
                />
              ))}
            </div>
          </section>
        )}

        {tab === 'MESAS' && (<>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10"><p className="text-2xl font-black text-emerald-300">{counts.FREE}</p>Livres</div>
            <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10"><p className="text-2xl font-black text-amber-300">{counts.OCCUPIED + counts.LONG_STAY + counts.BILL}</p>Ocupadas</div>
            <button type="button" onClick={() => setFilter('ATTN')} className="rounded-2xl bg-rose-500/10 p-3 ring-1 ring-rose-400/30"><p className="text-2xl font-black text-rose-300">{counts.CALL}</p>Atenção</button>
          </div>
          <label className="relative mb-3 block"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input aria-label="Buscar mesa" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar mesa" className="h-12 w-full rounded-2xl border-0 bg-white/10 pl-10 pr-3 text-base text-white placeholder:text-slate-400" /></label>
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar mesas">{FILTERS.map(f => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filter === f.id ? 'bg-emerald-500 text-slate-950' : 'bg-white/10 text-slate-200'}`}>{f.label}</button>)}</div>
          {!snap && <p className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Carregando o salão…</p>}
          {snap && !tables.length && <p className="rounded-2xl bg-white/5 p-5 text-sm text-slate-300">Nenhuma mesa cadastrada. O dono cadastra em Mesas e QR Code, no painel.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="waiter-tables">
            {visible.map((table, index) => <TableCard key={table.id} id={table.id} label={table.label} area={table.area} seats={table.seats} info={infoByTable.get(table.id)!} index={index} onOpen={id => { unlockAudio(); setMessage(''); setSelectedId(id); }} />)}
          </div>
          {snap && tables.length > 0 && !visible.length && <p className="py-8 text-center text-sm text-slate-400">Nenhuma mesa neste filtro.</p>}
        </>)}

        {tab === 'LIBERAR' && (
          <section aria-label="Liberações" data-testid="waiter-approvals">
            <h2 className="mb-1 text-xl font-black">Aguardando liberação</h2>
            <p className="mb-4 text-sm text-slate-400">Quem leu o QR e quer pedir. Aprove em um toque; você é avisado com som.</p>
            {approvals.pending.length === 0
              ? <div className="rounded-3xl bg-white/5 p-8 text-center ring-1 ring-white/10"><UserCheck className="mx-auto mb-2 h-8 w-8 text-emerald-300" /><p className="font-bold">Tudo liberado</p><p className="mt-1 text-sm text-slate-400">Quando alguém ler o QR de uma mesa, aparece aqui na hora.</p></div>
              : <div className="space-y-3">{approvals.pending.map(item => <ApprovalRow key={item.sessionId} large item={item} busy={approvals.busyId === item.sessionId} canReject={features.reject} onApprove={id => void handleApproveSession(id)} onReject={id => void handleRejectSession(id)} onOpenTable={id => { setTab('MESAS'); setSelectedId(id); }} />)}</div>}
            {approvals.error && <p role="alert" className="mt-3 text-sm text-rose-300">{approvals.error}</p>}
          </section>
        )}

        {tab === 'CHAMADOS' && (
          <section aria-label="Chamados" data-testid="waiter-calls">
            <h2 className="mb-1 text-xl font-black">Chamados</h2>
            <p className="mb-4 text-sm text-slate-400">Mesas pedindo o garçom, ajuda ou a conta.</p>
            {calls.length === 0
              ? <div className="rounded-3xl bg-white/5 p-8 text-center ring-1 ring-white/10"><BellRing className="mx-auto mb-2 h-8 w-8 text-emerald-300" /><p className="font-bold">Nenhum chamado</p></div>
              : <div className="space-y-3">{calls.map(c => { const label = labelByTab.get(c.tab_id) || 'Mesa'; const t = tabs.find(x => x.id === c.tab_id); return (
                <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-rose-500/10 p-4 ring-1 ring-rose-400/30">
                  <button type="button" onClick={() => t && (setTab('MESAS'), setSelectedId(t.table_id))} className="min-w-0 flex-1 text-left"><p className="font-black">{label}</p><p className="text-sm text-rose-200">{callTitle(c.type)}</p></button>
                  <button type="button" disabled={!!busy} onClick={() => void run(`call-${c.id}`, () => salonStaffRepository.handleCall(c.id))} className="h-12 shrink-0 rounded-2xl bg-white px-4 text-sm font-black text-slate-900 disabled:opacity-50">Atendido</button>
                </div>); })}</div>}
          </section>
        )}

        {tab === 'MAIS' && (
          <section aria-label="Mais" className="space-y-3" data-testid="waiter-more">
            <h2 className="text-xl font-black">Mais</h2>
            <WaiterInstallCard alwaysShow />
            <button type="button" onClick={() => { unlockAudio(); playNewOrderSound(); }} className="flex h-14 w-full items-center justify-between rounded-2xl bg-white/5 px-4 text-sm font-bold ring-1 ring-white/10"><span className="flex items-center gap-2"><Volume2 className="h-5 w-5 text-emerald-300" />Testar o som dos avisos</span><ChevronRight className="h-4 w-4 text-slate-500" /></button>
            <button type="button" onClick={() => void toggleWake()} aria-pressed={wake} className="flex h-14 w-full items-center justify-between rounded-2xl bg-white/5 px-4 text-sm font-bold ring-1 ring-white/10"><span>Manter a tela ligada</span><span className={`rounded-full px-3 py-1 text-xs ${wake ? 'bg-emerald-500 text-slate-950' : 'bg-white/10 text-slate-300'}`}>{wake ? 'Ligado' : 'Desligado'}</span></button>
            {(activeRole === 'OWNER' || activeRole === 'MANAGER') && <a href="/" className="flex h-14 w-full items-center justify-between rounded-2xl bg-white/5 px-4 text-sm font-bold ring-1 ring-white/10">Abrir o painel completo<ChevronRight className="h-4 w-4 text-slate-500" /></a>}
            {activeRole === 'WAITER' && <a href="/#/painel/est-salon" className="flex h-14 w-full items-center justify-between rounded-2xl bg-white/5 px-4 text-sm font-bold ring-1 ring-white/10">Abrir o Salão<ChevronRight className="h-4 w-4 text-slate-500" /></a>}
            <button type="button" onClick={() => void signOut()} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 text-sm font-bold text-slate-200"><LogOut className="h-4 w-4" />Sair</button>
          </section>
        )}
      </main>

      {toast && <div role="status" className="fixed inset-x-4 bottom-28 z-[95] mx-auto max-w-sm rounded-2xl bg-emerald-500 px-4 py-3 text-center text-sm font-black text-slate-950 shadow-xl">{toast}</div>}

      <nav aria-label="Navegação do Garçom" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-1">
          {navItem('MESAS', 'Mesas', LayoutGrid)}
          {navItem('LIBERAR', 'Liberar', UserCheck, pendingCount)}
          {navItem('CHAMADOS', 'Chamados', BellRing, calls.length)}
          {navItem('MAIS', 'Mais', MoreHorizontal)}
        </div>
      </nav>

      {selected && !orderTarget && (
        <WaiterTableSheet
          table={selected} tab={selectedTab} info={infoByTable.get(selected.id)!}
          sessions={selectedTab ? sessions.filter(s => s.tab_id === selectedTab.id) : []}
          calls={selectedTab ? (calls.filter(c => c.tab_id === selectedTab.id) as WaiterCallRow[]) : []}
          rounds={selectedTab ? rounds.filter(r => r.tab_id === selectedTab.id) : []}
          holderSessionId={selectedTab ? extras?.responsibleSessionByTab.get(selectedTab.id) : undefined}
          holderCode={holderCode}
          tenantSlug={activeTenant?.slug}
          features={features} busy={busy} message={message} onClose={() => { setSelectedId(null); setHolderCode(null); setMessage(''); }}
          onApprove={id => void run(`approve-${id}`, () => salonStaffRepository.approve(id), 'Liberado.')}
          onReject={id => void run(`reject-${id}`, () => salonStaffRepository.reject(id), 'Recusado.')}
          onHandleCall={id => void run(`call-${id}`, () => salonStaffRepository.handleCall(id), 'Chamado atendido.')}
          onOpenTable={openTable}
          onOrder={() => selectedTab && void openOrder(selectedTab.id, selected.label)}
          onRequestBill={() => selectedTab && void run('bill', () => salonStaffRepository.requestBill(selectedTab.id), 'Conta pedida.')}
          onResetHolder={() => selectedTab && void run('change-holder', async () => {
            const created = await salonStaffRepository.createHolderCode(selectedTab.id);
            setHolderCode(created);
          }, 'Código gerado para o novo responsável.')}
          onChangeHolder={() => selectedTab && void run('change-holder', async () => {
            const created = await salonStaffRepository.createHolderCode(selectedTab.id);
            setHolderCode(created);
          }, 'Código gerado para o novo responsável.')}
          onReleaseEmptyTab={reason => selectedTab && void run('release-empty', async () => {
            await salonStaffRepository.releaseEmptyTab(selectedTab.id, reason);
            setSelectedId(null);
            setHolderCode(null);
          }, 'Mesa liberada.')}
          onTransferHolder={id => selectedTab && void run('transfer-holder', () => salonStaffRepository.transferHolder(selectedTab.id, id, true), 'Responsável alterado.')}
        />
      )}
      {orderTarget && <WaiterOrderSheet tableLabel={orderTarget.label} products={products} categories={categories} loading={productsLoading} error={productsError} sending={sending} onClose={() => setOrderTarget(null)} onSubmit={cart => void sendOrder(cart)} />}
    </div>
  );
};
