import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { SAFE_TOP } from '../../lib/pwa/edgeToEdge';
import { detectPlatform, isStandalone, subscribeInstall, wasAppInstalledEvent } from '../../lib/pwa/installState';
import { refreshInstalledApp } from '../../lib/pwa/registerSw';
import {
  dismissVisualNotice, evaluateVisualNotice, fetchCurrentVisualFingerprint, recordInstalledVisual,
} from '../../lib/pwa/webApkVisual';

export const VISUAL_UPDATE_BUTTON = 'Atualizar app';
export const VISUAL_BAR_HELP_LINK = 'barra não mudou?';
export const VISUAL_BAR_HELP_TEXT = 'A barra de baixo só muda quando o Chrome atualiza o app. Para mudar já, remova o app e instale de novo pelo link da loja.';

interface Props {
  slug: string;
  tenantId: string;
  /** Esconde enquanto checkout/sacola/endereço estão abertos (não some o registro). */
  hidden?: boolean;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  standalone?: boolean;
  /** Só Android (WebAPK); padrão: navigator.userAgent. */
  android?: boolean;
  /** Ação do botão (padrão: ativa o SW novo, limpa o Cache Storage e recarrega). */
  onRefresh?: () => void | Promise<void>;
}

/**
 * Botão compacto "Atualizar app" no app instalado (WebAPK) quando o visual congelado na instalação
 * (barra de navegação / tela de abertura / ícone) ficou diferente do atual. Tocar em "Atualizar app" ou no X
 * marca este visual como resolvido (não volta depois da recarga). Só Android, só /app/<slug>/, só tokens do tema.
 */
export const StoreVisualUpdateNotice: React.FC<Props> = ({ slug, tenantId, hidden, fetchImpl, storage, standalone, android, onRefresh }) => {
  const [current, setCurrent] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const kv = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  const isAndroid = android ?? (typeof navigator !== 'undefined' && detectPlatform(navigator.userAgent || '').startsWith('android'));
  const isApp = isAndroid && (standalone ?? (typeof window !== 'undefined' && isStandalone(window)));

  // Instalado agora (aba do Chrome): grava o visual com que o app foi instalado.
  useEffect(() => {
    if (!slug || !tenantId || !isAndroid) return;
    let done = false;
    let cancelled = false;
    const record = () => {
      if (done || !wasAppInstalledEvent()) return;
      done = true;
      void fetchCurrentVisualFingerprint(slug, tenantId, fetchImpl).then((fp) => {
        if (!cancelled) recordInstalledVisual(kv, slug, fp);
      });
    };
    record();
    const unsub = subscribeInstall(record);
    return () => { cancelled = true; unsub(); };
  }, [slug, tenantId, isAndroid, fetchImpl, kv]);

  // Aberto pelo ícone: compara com o visual instalado.
  useEffect(() => {
    if (!slug || !tenantId || !isApp) return;
    let cancelled = false;
    void fetchCurrentVisualFingerprint(slug, tenantId, fetchImpl).then((fp) => {
      if (cancelled) return;
      setCurrent(fp);
      setShow(evaluateVisualNotice(kv, slug, fp, true));
    });
    return () => { cancelled = true; };
  }, [slug, tenantId, isApp, fetchImpl, kv]);

  if (!show || hidden) return null;

  const close = () => {
    dismissVisualNotice(kv, slug, current);
    setShow(false);
  };
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    // Resolvido para este visual: depois da recarga não aparece de novo (mesmo se a barra ainda não mudou).
    dismissVisualNotice(kv, slug, current);
    try { await (onRefresh ? onRefresh() : refreshInstalledApp()); } finally { setBusy(false); }
  };

  return (
    <div
      data-testid="visual-update-notice"
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-[120] flex flex-col items-center gap-1 px-3 pointer-events-none"
      style={{ top: `calc(${SAFE_TOP} + 0.5rem)` }}
    >
      <div
        className="pointer-events-auto inline-flex items-center gap-1 rounded-full border shadow-lg p-1"
        style={{ backgroundColor: 'var(--dc-bg-card-color, var(--dc-bg-card))', borderColor: 'var(--dc-border)', fontFamily: 'var(--dc-font-family, inherit)' }}
      >
        <button
          type="button"
          data-testid="visual-update-refresh"
          onClick={refresh}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold disabled:opacity-70"
          style={{ backgroundColor: 'var(--dc-button-bg)', color: 'var(--dc-button-text)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
          {VISUAL_UPDATE_BUTTON}
        </button>
        <button
          type="button"
          data-testid="visual-update-help"
          aria-expanded={help}
          onClick={() => setHelp((h) => !h)}
          className="px-1.5 text-[10px] underline"
          style={{ color: 'var(--dc-text-secondary)' }}
        >
          {VISUAL_BAR_HELP_LINK}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Fechar"
          data-testid="visual-update-close"
          className="p-1 rounded-full"
          style={{ color: 'var(--dc-text-secondary)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {help && (
        <p
          data-testid="visual-update-help-text"
          className="pointer-events-auto max-w-xs rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug shadow"
          style={{ backgroundColor: 'var(--dc-bg-card-color, var(--dc-bg-card))', borderColor: 'var(--dc-border)', color: 'var(--dc-text-main)' }}
        >
          {VISUAL_BAR_HELP_TEXT}
        </p>
      )}
    </div>
  );
};
