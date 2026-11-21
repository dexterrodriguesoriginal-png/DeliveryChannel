import { describe, expect, it } from 'vitest';
import { canInviteInstallApp, canShareStoreLinks, installedIdentityChanged, isLegacyInviteStore, nextOwnerOnboardingState, onboardingState } from '../ownerOnboarding';
import type { TenantTheme } from '../../../types';
import { createDefaultThemeTokens } from '../../theme/themeEngine';
import { systemBarsFromTokens } from '../../pwa/systemBars';

const logo = 'https://example.com/logo.png';
const make = (state?: { step: number; skipped?: boolean; completed?: boolean; legacyInvites?: boolean; navConfirmedColor?: string }, url = logo) =>
  ({ logoUrl: url, tokens: { version: 1, meta: { logoConfirmedUrl: url, ...(state ? { ownerOnboarding: state } : {}) } } } as unknown as TenantTheme);

describe('missões do dono', () => {
  it('começa no primeiro acesso, sem registro de progresso', () => {
    expect(onboardingState(make())).toBeUndefined();
    expect(nextOwnerOnboardingState(undefined, { step: 0 })).toEqual({ step: 0 });
  });
  it('pular mantém progresso para retomar', () => {
    expect(nextOwnerOnboardingState({ step: 2 }, { skipped: true })).toEqual({ step: 2, skipped: true });
    expect(nextOwnerOnboardingState({ step: 2, skipped: true }, { skipped: false })).toEqual({ step: 2, skipped: false });
  });
  it('progresso é persistível em theme tokens por loja', () => {
    expect(onboardingState(make({ step: 3, skipped: true }))).toMatchObject({ step: 3, skipped: true });
  });
  it('bloqueia instalação até confirmar as quatro missões e a barra', () => {
    const before = make({ step: 3, navConfirmedColor: 'outra-cor' });
    expect(canInviteInstallApp(before)).toBe(false);
    const noNav = make({ step: 4, completed: true });
    expect(canInviteInstallApp(noNav)).toBe(false);
    expect(canShareStoreLinks(noNav)).toBe(false);
    expect(canShareStoreLinks(before)).toBe(false);
    expect(canShareStoreLinks(make({ step: 4, completed: true, navConfirmedColor: 'qualquer' }))).toBe(true);
  });
  it('libera após confirmação da barra e das quatro missões', () => {
    const tokens = createDefaultThemeTokens();
    const nav = systemBarsFromTokens(tokens).nav;
    const completed = { logoUrl: logo, tokens: { ...tokens, meta: { ...tokens.meta, logoConfirmedUrl: logo, ownerOnboarding: { step: 4, completed: true, navConfirmedColor: nav } } } } as TenantTheme;
    expect(canInviteInstallApp(completed)).toBe(true);
    const changed = { ...completed, tokens: { ...completed.tokens!, meta: { ...completed.tokens!.meta, systemBars: { navBarColor: tokens.palette.secondary } } } } as TenantTheme;
    expect(canInviteInstallApp(changed)).toBe(true);
    expect(installedIdentityChanged(completed, changed)).toBe(true);
  });
  it('loja antiga preserva convite, mesmo após abrir o guia', () => {
    expect(canInviteInstallApp(make())).toBe(true);
    expect(canInviteInstallApp(make({ step: 0, legacyInvites: true }))).toBe(true);
  });
  it('troca de logo exige aviso após confirmação de instalação', () => {
    expect(installedIdentityChanged(make(), make(undefined, 'https://example.com/new.png'))).toBe(true);
    expect(installedIdentityChanged(make({ step: 0 }), make(undefined, 'https://example.com/new.png'))).toBe(false);
  });
  it('componente visual não tem cores hexadecimais fixas', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const component = fs.readFileSync(path.resolve(process.cwd(), 'src/components/establishment/dashboard/OwnerOnboarding.tsx'), 'utf8');
    expect(component).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('loja que já confirmou a logo explicitamente mantém o convite, mesmo criada depois do corte', () => {
    expect(isLegacyInviteStore(make(), '2026-12-05T10:00:00Z')).toBe(true);
    expect(isLegacyInviteStore(make(), '2026-11-01T10:00:00Z')).toBe(true);
    const implicit = { logoUrl: logo, tokens: { version: 1, meta: {} } } as unknown as TenantTheme;
    expect(isLegacyInviteStore(implicit, '2026-11-01T10:00:00Z')).toBe(true);
    expect(isLegacyInviteStore(implicit, '2026-12-05T10:00:00Z')).toBe(false);
    // Loja antiga sem logo mantém link/QR no painel; o convite no app do cliente segue exigindo logo.
    const noLogo = make(undefined, '');
    expect(isLegacyInviteStore(noLogo, '2026-11-01T10:00:00Z')).toBe(true);
    expect(isLegacyInviteStore(noLogo, '2026-12-05T10:00:00Z')).toBe(false);
    expect(canShareStoreLinks(make({ step: 0, legacyInvites: true }, ''))).toBe(true);
    expect(canInviteInstallApp(make({ step: 0, legacyInvites: true }, ''))).toBe(false);
  });
});
