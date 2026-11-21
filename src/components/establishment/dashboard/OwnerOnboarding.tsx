import React, { useEffect, useState } from 'react';
import { LockKeyhole, Medal, Smartphone, Sparkles } from 'lucide-react';
import type { Tenant } from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { themeService } from '../../../services/themeService';
import { isLogoConfirmed } from '../../../lib/pwa/logoConfirmation';
import { systemBarsFromTokens } from '../../../lib/pwa/systemBars';
import { themeToTokens } from '../../../lib/theme/themeEngine';
import { isLegacyInviteStore, nextOwnerOnboardingState, onboardingState, OwnerOnboardingState } from '../../../lib/onboarding/ownerOnboarding';

interface Props { tenant: Tenant; ownerName: string; onNavigate?: (tab: string) => void }

export function OwnerOnboarding({ tenant, ownerName, onNavigate }: Props) {
  const { securityContext, setActiveTenant } = useAuth();
  const existing = onboardingState(tenant.theme);
  const [open, setOpen] = useState(() => !existing?.completed && !existing?.skipped);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const step = Math.min(4, Math.max(0, existing?.step ?? 0));
  const tokens = themeToTokens(tenant.theme);
  const nav = systemBarsFromTokens(tokens).nav;
  const logoReady = isLogoConfirmed(tenant.theme);
  const navReady = existing?.navConfirmedColor === nav;

  // Persist the first-visit marker. Shops created before rollout retain their existing invites.
  useEffect(() => {
    if (existing) return;
    const legacyInvites = isLegacyInviteStore(tenant.theme, tenant.createdAt);
    void persist({ step: 0, legacyInvites }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id]);

  async function persist(patch: Partial<OwnerOnboardingState>) {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const next = nextOwnerOnboardingState(onboardingState(tenant.theme), patch);
      const updatedTokens = {
        ...themeToTokens(tenant.theme),
        meta: { ...themeToTokens(tenant.theme).meta, ownerOnboarding: next },
      };
      // Grava só o progresso (theme_tokens) + nome obrigatório: não reescreve logo/cores com valores de exibição
      // (ex.: logo padrão usada quando a loja ainda não tem logo).
      await themeService.updateTheme(securityContext, tenant.id, { storeName: tenant.theme.storeName || tenant.name, tokens: updatedTokens });
      setActiveTenant({ ...tenant, theme: { ...tenant.theme, tokens: updatedTokens } });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o progresso. Tente novamente.');
      return false;
    } finally { setBusy(false); }
  }

  const advance = async (to: number, extra: Partial<OwnerOnboardingState> = {}) => {
    if (await persist({ step: to, skipped: false, ...extra })) setOpen(true);
  };
  const skip = async () => { if (await persist({ skipped: true })) setOpen(false); };
  const resume = async () => { if (await persist({ skipped: false })) setOpen(true); };
  const complete = async () => {
    if (!acknowledged || !logoReady || !navReady) return;
    if (await persist({ step: 4, completed: true, skipped: false })) setCelebrating(true);
  };

  if (existing?.completed && !celebrating) return null;
  if (!open && !celebrating) return (
    <section data-testid="onboarding-resume" aria-label="Missões de preparação do aplicativo" className="rounded-xl border border-[var(--onboarding-border)] p-3"
      style={{ '--onboarding-border': tokens.palette.border } as React.CSSProperties}>
      <button type="button" onClick={resume} className="font-semibold underline" disabled={busy}>Retomar as 4 missões do meu app</button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
  const primary = tokens.palette.primary;
  const background = tokens.palette.bgCard;
  const foreground = tokens.palette.textMain;
  const buttonStyle: React.CSSProperties = { backgroundColor: primary, color: tokens.palette.buttonText };
  return (
    <section data-testid="owner-onboarding" aria-label="Guia de preparação do aplicativo" className="rounded-2xl border p-4 sm:p-6 space-y-4"
      style={{ backgroundColor: background, color: foreground, borderColor: tokens.palette.border }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide">Sua jornada começa aqui</p>
          <h2 className="text-xl font-bold">{celebrating ? 'App pronto!' : step === 0 ? `Bem-vindo, ${ownerName}!` : ['','Missão Logo','Missão Cores','Missão Cardápio','Missão final'][step]}</h2>
          {!celebrating && <p className="text-sm">Vamos deixar o app da {tenant.name} pronto em 4 missões antes de você divulgar.</p>}
        </div>
        {!celebrating && <button type="button" className="text-sm underline" onClick={skip} disabled={busy}>Pular, já sei usar</button>}
      </header>
      {!celebrating && <>
        <div aria-label={`${step} de 4 missões`} role="progressbar" aria-valuenow={step} aria-valuemin={0} aria-valuemax={4}
          className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: tokens.palette.bgGeneral }}>
          <div className="h-full motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${step * 25}%`, backgroundColor: primary }} />
        </div>
        <p className="text-xs font-semibold" aria-live="polite">{step} de 4 missões</p>
      </>}
      {celebrating ? (
        <div className="flex flex-col items-center gap-3 py-4" role="status">
          <Medal className="h-20 w-20 motion-safe:animate-bounce" aria-hidden />
          <p className="text-lg font-bold">App pronto! Agora você pode convidar seus clientes.</p>
          <button type="button" onClick={() => { setCelebrating(false); setOpen(false); }} style={buttonStyle} className="rounded-xl px-5 py-2 font-bold">Concluir</button>
        </div>
      ) : step === 0 ? (
        <button type="button" style={buttonStyle} className="rounded-xl px-5 py-3 font-bold" disabled={busy} onClick={() => advance(1)}>Começar</button>
      ) : step === 1 ? (
        <div className="space-y-4">
          <p>Envie sua logo e confirme a logo definitiva no Design do App. Ela será o ícone do aplicativo instalado.</p>
          <div className="mx-auto flex h-36 w-24 items-center justify-center rounded-2xl border-4" style={{ borderColor: nav, backgroundColor: tokens.palette.bgGeneral }}>
            {tenant.theme.logoUrl ? <img alt="Prévia do ícone na tela inicial do celular" src={tenant.theme.logoUrl} className="h-14 w-14 rounded-xl object-cover" /> : <Smartphone aria-label="Prévia do celular" />}
          </div>
          <p className="flex items-start gap-2 text-sm"><LockKeyhole className="h-4 w-4 shrink-0" aria-hidden /> Esta logo fica gravada no celular dos seus clientes quando eles instalarem. Escolha com calma.</p>
          <button type="button" className="underline" onClick={() => onNavigate?.('est-theme')}>Abrir Design do App — Identidade</button>
          <div><button type="button" style={buttonStyle} className="rounded-xl px-5 py-2 font-bold disabled:opacity-50" disabled={!logoReady || busy} onClick={() => advance(2)}>Logo confirmada — próxima missão</button></div>
          {!logoReady && <p role="status" className="text-xs">Confirme e salve a logo definitiva no Design do App para avançar.</p>}
        </div>
      ) : step === 2 ? (
        <div className="space-y-4">
          <p>Escolha o tema e a cor da barra de navegação em Design do App. Veja como fica no celular:</p>
          <div className="mx-auto w-36 overflow-hidden rounded-2xl border-4" style={{ borderColor: nav, backgroundColor: tokens.palette.bgGeneral }}>
            <div className="h-8" style={{ backgroundColor: tokens.palette.bgHeader }} />
            <div className="flex h-32 items-center justify-center"><Smartphone aria-hidden /></div>
            <div className="h-4" style={{ backgroundColor: nav }} />
          </div>
          <p className="flex items-start gap-2 text-sm"><LockKeyhole className="h-4 w-4 shrink-0" aria-hidden /> A cor desta barra também fica gravada no celular do cliente.</p>
          <button type="button" className="underline" onClick={() => onNavigate?.('est-theme')}>Abrir Design do App — Cores e barras</button>
          <div><button type="button" style={buttonStyle} className="rounded-xl px-5 py-2 font-bold" disabled={busy} onClick={() => advance(3, { navConfirmedColor: nav })}>Confirmar tema e barra</button></div>
        </div>
      ) : step === 3 ? (
        <div className="space-y-4">
          <p>Cadastre os primeiros produtos do seu cardápio.</p>
          <p className="flex items-center gap-2"><Sparkles aria-hidden className="h-4 w-4" /> Isso muda na hora para os clientes, sempre que você quiser.</p>
          <button type="button" className="underline" onClick={() => onNavigate?.('est-products')}>Cadastrar produtos</button>
          <div><button type="button" style={buttonStyle} className="rounded-xl px-5 py-2 font-bold" disabled={busy} onClick={() => advance(4)}>Próxima missão</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-xl border p-4" style={{ borderColor: tokens.palette.border }}>
              <h3 className="font-bold"><Sparkles className="inline h-4 w-4" /> Muda na hora, sempre</h3>
              <p className="text-sm">Cardápio, preços, fotos, promoções, horários e cores das telas.</p>
            </article>
            <article className="rounded-xl border p-4" style={{ borderColor: tokens.palette.border }}>
              <h3 className="font-bold"><LockKeyhole className="inline h-4 w-4" /> Fica gravado no celular do cliente</h3>
              <p className="text-sm">A logo do ícone e a barra de navegação. Se trocar depois, seus clientes verão Atualizar app e precisarão baixar a versão nova. Isso é regra do Android/Google e pode variar conforme o celular.</p>
            </article>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> Entendi</label>
          {(!logoReady || !navReady) && <p role="alert" className="text-sm">Confirme a logo e a cor da barra antes de concluir as missões.</p>}
          <button type="button" style={buttonStyle} className="rounded-xl px-5 py-2 font-bold disabled:opacity-50" disabled={busy || !acknowledged || !logoReady || !navReady} onClick={complete}>Meu app está pronto</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
