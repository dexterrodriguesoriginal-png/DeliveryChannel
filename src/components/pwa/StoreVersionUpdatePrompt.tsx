import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { JUST_INSTALLED_TTL_MS, readJustInstalled } from '../../lib/pwa/appIdentity';
import { isEditableFocused } from '../../lib/pwa/installState';
import { readUpdateSnooze, recordUpdateSnooze, shouldShowStoreUpdatePrompt, versionedUpdateSessionUrl } from '../../lib/pwa/storeUpdatePrompt';

interface Props {
  slug: string;
  currentIdentity: string;
  runningIdentity: string | null;
  standalone: boolean;
  previewMode: boolean;
  search: string;
  reloadUnsafe: boolean;
  navTab: string;
  navigate?: (url: string) => void;
}
const navigateToVersion = (url: string) => window.location.assign(url);

export function StoreVersionUpdatePrompt({ navigate = navigateToVersion, ...props }: Props) {
  const { slug, currentIdentity, runningIdentity } = props;
  const [now, setNow] = useState(Date.now);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const [editable, setEditable] = useState(() => isEditableFocused(document));
  const [storage] = useState(() => {
    try { return window.localStorage; } catch { return null; }
  });
  const justInstalled = storage ? readJustInstalled(slug, storage) : null;
  const snoozeUntil = Math.max(dismissedUntil, storage ? readUpdateSnooze(storage, slug, currentIdentity) : 0);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const focus = () => setEditable(isEditableFocused(document));
    const blur = () => { setEditable(false); };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('storage', refresh);
    refresh();
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  useEffect(() => {
    const freshUntil = justInstalled?.identity === runningIdentity && justInstalled
      ? justInstalled.at + JUST_INSTALLED_TTL_MS : 0;
    const next = Math.max(snoozeUntil, freshUntil);
    if (next <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [now, snoozeUntil, justInstalled?.identity, justInstalled?.at, runningIdentity]);

  if (!shouldShowStoreUpdatePrompt({ ...props, reloadUnsafe: props.reloadUnsafe || editable, justInstalled, snoozeUntil, now })) return null;
  const dismiss = () => {
    const at = Date.now();
    const until = recordUpdateSnooze(storage ?? { setItem: () => {} }, slug, currentIdentity, at);
    setDismissedUntil(until);
    setNow(at);
  };
  return (
    <aside aria-label="Nova versão da loja disponível" data-testid="store-version-update-prompt"
      className="relative z-[35] mx-3 my-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 shadow-sm"
      style={{ backgroundColor: 'var(--dc-bg-card-color)', color: 'var(--dc-text-main)', borderColor: 'var(--dc-border)' }}>
      <p className="flex-1 text-xs font-medium">Nova versão da loja disponível</p>
      <button type="button" className="rounded-full px-3 py-2 text-xs font-semibold"
        style={{ backgroundColor: 'var(--dc-primary)', color: 'var(--dc-button-text)' }}
        onClick={() => navigate(versionedUpdateSessionUrl(slug, currentIdentity))}>Baixar nova versão</button>
      <button type="button" aria-label="Fechar aviso de atualização" className="rounded-lg p-2"
        style={{ color: 'var(--dc-text-main)' }} onClick={dismiss}><X className="h-4 w-4" /></button>
    </aside>
  );
}
