import type { TenantTheme } from '../../types';
import { isLogoConfirmed } from '../pwa/logoConfirmation';
import { systemBarsFromTokens } from '../pwa/systemBars';
import { themeToTokens } from '../theme/themeEngine';

export interface OwnerOnboardingState {
  step: number;
  skipped?: boolean;
  completed?: boolean;
  navConfirmedColor?: string;
}

export function onboardingState(theme: Partial<TenantTheme> | null | undefined): OwnerOnboardingState | undefined {
  return theme?.tokens?.meta?.ownerOnboarding;
}

/** Legacy shops already invited their customers and must not lose access. */
export function canInviteInstallApp(theme: Partial<TenantTheme> | null | undefined): boolean {
  if (!isLogoConfirmed(theme)) return false;
  const state = onboardingState(theme);
  if (!state) return true; // Store existed before the onboarding was initialized.
  return state.completed === true && state.navConfirmedColor === systemBarsFromTokens(themeToTokens(theme)).nav;
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
