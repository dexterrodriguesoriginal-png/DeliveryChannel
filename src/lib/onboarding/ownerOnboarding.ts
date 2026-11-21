import type { TenantTheme } from '../../types';
import { isLogoConfirmed } from '../pwa/logoConfirmation';
import { systemBarsFromTokens } from '../pwa/systemBars';
import { themeToTokens } from '../theme/themeEngine';

export interface OwnerOnboardingState {
  step: number;
  skipped?: boolean;
  completed?: boolean;
  legacyInvites?: boolean;
  navConfirmedColor?: string;
}

export function onboardingState(theme: Partial<TenantTheme> | null | undefined): OwnerOnboardingState | undefined {
  return theme?.tokens?.meta?.ownerOnboarding;
}

/** Legacy shops already invited their customers and must not lose access. */
export function canInviteInstallApp(theme: Partial<TenantTheme> | null | undefined): boolean {
  if (!isLogoConfirmed(theme)) return false;
  const state = onboardingState(theme);
  if (!state || state.legacyInvites) return true; // Legacy shops preserve their existing invitations.
  return state.completed === true && !!state.navConfirmedColor;
}

/** Data de corte do guia: lojas criadas antes já podiam convidar clientes para instalar o app. */
export const OWNER_ONBOARDING_ROLLOUT = '2026-11-21';

/**
 * Loja que já divulgava antes do guia: criada antes do corte OU já confirmou a logo explicitamente no painel.
 * Lojas novas nascem sem confirmação explícita, então passam pelas missões. (O convite "Instalar app" no app
 * do cliente continua exigindo a logo confirmada, como antes.)
 */
export function isLegacyInviteStore(theme: Partial<TenantTheme> | null | undefined, createdAt?: string): boolean {
  if (createdAt && createdAt < OWNER_ONBOARDING_ROLLOUT) return true;
  const confirmed = theme?.tokens?.meta?.logoConfirmedUrl;
  return isLogoConfirmed(theme) && typeof confirmed === 'string' && confirmed.trim() !== '';
}

/** Link público, "Copiar link" e QR no painel: travados só para loja nova que ainda não concluiu as missões. */
export function canShareStoreLinks(theme: Partial<TenantTheme> | null | undefined): boolean {
  const state = onboardingState(theme);
  if (!state || state.legacyInvites) return true;
  return state.completed === true && !!state.navConfirmedColor;
}

export function installedIdentityChanged(before: Partial<TenantTheme>, after: Partial<TenantTheme>): boolean {
  if (!canInviteInstallApp(before)) return false;
  return (before.logoUrl || '').trim() !== (after.logoUrl || '').trim()
    || systemBarsFromTokens(themeToTokens(before)).nav !== systemBarsFromTokens(themeToTokens(after)).nav;
}

export function nextOwnerOnboardingState(
  previous: OwnerOnboardingState | undefined,
  patch: Partial<OwnerOnboardingState>,
): OwnerOnboardingState {
  return { step: 0, ...previous, ...patch };
}
