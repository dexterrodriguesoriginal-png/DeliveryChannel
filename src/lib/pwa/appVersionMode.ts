import { offerUpdatedApp } from './appBaseLogo';
import { normalizeBarColor } from './systemBars';
import type { StoreIdentityInput } from './storeManifest';
import { resolveSystemBars } from './systemBars';

/** O gate usa apenas meta gravado no Design do App, nunca updatedAt ou a versão do build. */
export function isVersionedStoreApp(store: StoreIdentityInput | null | undefined): boolean {
  if (!store) return false;
  if (offerUpdatedApp(store)) return true;
  const baseline = normalizeBarColor(store.appBaseNavColor);
  if (!baseline) return false;
  const t = store.theme || {};
  const current = resolveSystemBars({
    navBarColor: t.navBarColor, statusBarColor: t.statusBarColor,
    headerColor: t.headerColor, primaryColor: t.primaryColor, backgroundColor: t.backgroundColor,
  }).nav;
  return current !== baseline;
}

/** Persiste só a primeira barra anterior a uma alteração real; preserva o baseline para sempre. */
export function appBaseNavColorToSave(existing: unknown, before: string, after: string): string | undefined {
  const saved = normalizeBarColor(existing);
  if (saved) return saved;
  const prev = normalizeBarColor(before);
  const next = normalizeBarColor(after);
  return prev && next && prev !== next ? prev : undefined;
}
