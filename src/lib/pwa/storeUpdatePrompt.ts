import { JUST_INSTALLED_TTL_MS, versionedStoreScope, type JustInstalled } from './appIdentity';

export const UPDATE_PROMPT_SNOOZE_MS = 240_000;
type KV = Pick<Storage, 'getItem' | 'setItem'>;
export const updatePromptKey = (slug: string, identity: string) => `dc:update-prompt-snooze:${slug}:${identity}`;
export function readUpdateSnooze(storage: Pick<KV, 'getItem'>, slug: string, identity: string): number {
  try {
    const value = Number(storage.getItem(updatePromptKey(slug, identity)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}
export function recordUpdateSnooze(storage: Pick<KV, 'setItem'>, slug: string, identity: string, now: number): number {
  const until = now + UPDATE_PROMPT_SNOOZE_MS;
  try { storage.setItem(updatePromptKey(slug, identity), String(until)); } catch { /* armazenamento indisponível */ }
  return until;
}
export const isSnoozed = (until: number, now: number) => until > now;
export function versionedUpdateSessionUrl(slug: string, identity: string): string {
  return versionedStoreScope(slug, identity) + '?atualizar=1';
}
export interface UpdatePromptContext {
  standalone: boolean;
  currentIdentity: string | null;
  runningIdentity: string | null;
  previewMode: boolean;
  search: string;
  reloadUnsafe: boolean;
  navTab: string;
  justInstalled: JustInstalled | null;
  snoozeUntil: number;
  now: number;
}
export function shouldShowStoreUpdatePrompt(o: UpdatePromptContext): boolean {
  const params = new URLSearchParams(o.search);
  if (!o.standalone || !o.currentIdentity || o.runningIdentity === o.currentIdentity ||
      o.previewMode || o.reloadUnsafe || o.navTab !== 'home' || params.has('mesa') ||
      params.get('preview') === '1' || params.get('atualizar') === '1' ||
      params.get('instalar') === '1' || params.get('reinstall') === '1' ||
      isSnoozed(o.snoozeUntil, o.now)) return false;
  const age = o.now - (o.justInstalled?.at ?? 0);
  return !(o.justInstalled && o.justInstalled.identity === o.runningIdentity &&
    age >= 0 && age < JUST_INSTALLED_TTL_MS);
}
