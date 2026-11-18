import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { SAFE_TOP } from '../../lib/pwa/edgeToEdge';
import { isStandalone, subscribeInstall, wasAppInstalledEvent } from '../../lib/pwa/installState';
import {
  dismissVisualNotice, evaluateVisualNotice, fetchCurrentVisualFingerprint, recordInstalledVisual,
} from '../../lib/pwa/webApkVisual';

export const VISUAL_NOTICE_TEXT =
  'O visual da loja foi atualizado. Para atualizar a barra de navegação e a tela de abertura, remova o app e instale de novo pelo link da loja.';
export const VISUAL_NOTICE_STEPS = [
  'Toque e segure o ícone do app na tela inicial e escolha "Desinstalar" (ou "Remover").',
  'Abra o link da loja no Chrome.',
  'Toque em "Instalar app" (não use "Criar atalho").',
];

interface Props {
  slug: string;
  tenantId: string;
  /** Esconde enquanto checkout/sacola/endereço estão abertos (não some o registro). */
  hidden?: boolean;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  standalone?: boolean;
}

/**
 * Aviso no app instalado (WebAPK) quando a barra de navegação / tela de abertura gravadas na instalação
 * ficaram diferentes do visual atual da loja. Só no app da loja (/app/<slug>/), nunca no QR de mesa.
 */
export const StoreVisualUpdateNotice: React.FC<Props> = ({ slug, tenantId, hidden, fetchImpl, storage, standalone }) => {
  const [current, setCurrent] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);
  const kv = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  const isApp = standalone ?? (typeof window !== 'undefined' && isStandalone(window));

  // Instalado agora (aba do Chrome): grava o visual com que o app foi instalado.
  useEffect(() => {
    if (!slug || !tenantId) return;
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
  }, [slug, tenantId, fetchImpl, kv]);

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

  const dismiss = () => {
    dismissVisualNotice(kv, slug, current);
    setShow(false);
    setHelp(false);
  };

  return (
    <div
      data-testid="visual-update-notice"
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-[120] flex justify-center px-3 pointer-events-none"
      style={{ top: `calc(${SAFE_TOP} + 0.5rem)` }}
    >
      <div
        className="pointer-events-auto w-full max-w-md border shadow-lg p-3 text-xs"
        style={{
          backgroundColor: 'var(--dc-bg-card-color, var(--dc-bg-card))',
          color: 'var(--dc-text-main)',
          borderColor: 'var(--dc-border)',
          borderRadius: 'var(--dc-card-radius, var(--dc-radius))',
          fontFamily: 'var(--dc-font-family, inherit)',
        }}
      >
        <div className="flex items-start gap-2">
          <RefreshCw className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--dc-primary)' }} aria-hidden />
          <p className="flex-1 leading-snug">{VISUAL_NOTICE_TEXT}</p>
          <button type="button" onClick={dismiss} aria-label="Fechar aviso" data-testid="visual-update-close" className="shrink-0 p-0.5 opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
        {help && (
          <ol data-testid="visual-update-steps" className="mt-2 ml-6 list-decimal space-y-1" style={{ color: 'var(--dc-text-secondary)' }}>
            {VISUAL_NOTICE_STEPS.map((s) => <li key={s}>{s}</li>)}
          </ol>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            data-testid="visual-update-help"
            aria-expanded={help}
            onClick={() => setHelp((h) => !h)}
            className="px-3 py-1.5 font-bold border"
            style={{ borderColor: 'var(--dc-border)', borderRadius: 'var(--dc-button-radius, var(--dc-radius))', color: 'var(--dc-text-main)' }}
          >
            Como fazer
          </button>
          <button
            type="button"
            data-testid="visual-update-dismiss"
            onClick={dismiss}
            className="px-3 py-1.5 font-bold"
            style={{ backgroundColor: 'var(--dc-button-bg)', color: 'var(--dc-button-text)', borderRadius: 'var(--dc-button-radius, var(--dc-radius))' }}
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
};
