import { describe, expect, it } from 'vitest';
import { canInviteInstallApp, installedIdentityChanged, nextOwnerOnboardingState, onboardingState } from '../ownerOnboarding';
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
    const done = make({ step: 4, completed: true, navConfirmedColor: 'outra-cor' });
    expect(canInviteInstallApp(done)).toBe(false);
  });
  it('libera após confirmação da barra e das quatro missões', () => {
    const tokens = createDefaultThemeTokens();
    const nav = systemBarsFromTokens(tokens).nav;
    const completed = { logoUrl: logo, tokens: { ...tokens, meta: { ...tokens.meta, logoConfirmedUrl: logo, ownerOnboarding: { step: 4, completed: true, navConfirmedColor: nav } } } } as TenantTheme;
    expect(canInviteInstallApp(completed)).toBe(true);
    const changed = { ...completed, tokens: { ...completed.tokens, meta: { ...completed.tokens.meta, systemBars: { navBarColor: tokens.palette.secondary } } } } as TenantTheme;
    expect(canInviteInstallApp(changed)).toBe(false);
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
});
