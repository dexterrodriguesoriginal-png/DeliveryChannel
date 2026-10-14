import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Sugestão OPCIONAL de instalação do app da loja (nunca obrigatória; pode ser fechada).
 * Android/Chrome: usa beforeinstallprompt. iOS Safari: instrução Compartilhar → Adicionar à Tela de Início.
 * A dispensa é lembrada por loja (tenantId).
 */
export const InstallStoreAppHint: React.FC<{ tenantId: string; storeName: string; color: string }> = ({ tenantId, storeName, color }) => {
  const dismissKey = `adegafood_install_hint_dismissed_${tenantId}`;
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dismissKey) === '1'; } catch { return false; }
  });

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isMobile = isIOS || /android|mobile/i.test(ua);
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (dismissed || standalone || (!isMobile && !deferred)) return null;
  if (!deferred && !isIOS) return null; // navegador sem suporte: não mostra nada

  const close = () => { setDismissed(true); try { localStorage.setItem(dismissKey, '1'); } catch { /* ignore */ } };

  return (
    <div data-testid="install-store-app-hint" className="mx-4 mt-3 rounded-2xl border bg-white p-3 shadow-sm flex items-start gap-3">
      <div className="flex-1 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">Tenha o app de {storeName} no seu celular</p>
        {deferred ? (
          <p>Instale para abrir a loja direto da tela inicial. É opcional — você pode continuar comprando pelo navegador.</p>
        ) : (
          <p className="flex flex-wrap items-center gap-1">No Safari, toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>. É opcional.</p>
        )}
        {deferred && (
          <button
            type="button"
            onClick={async () => { await deferred.prompt(); await deferred.userChoice.catch(() => null); setDeferred(null); }}
            className="mt-2 inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-white text-sm font-semibold"
            style={{ backgroundColor: color }}
          >
            <Download className="h-4 w-4" /> Instalar app
          </button>
        )}
      </div>
      <button type="button" aria-label="Fechar sugestão de instalação" onClick={close} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
    </div>
  );
};
