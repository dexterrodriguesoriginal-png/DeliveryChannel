import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TenantTheme } from '../../../types';
import { themeToTokens } from '../../../lib/theme/themeEngine';
import { isPreviewReadyMessage, previewUrl, sendPreviewTheme } from '../../../lib/theme/previewBridge';

/** Tamanho lógico do celular de referência (iPhone 14/15) e do modo computador. */
export const PHONE_W = 390;
export const PHONE_H = 844;
export const DESKTOP_W = 1280;
export const DESKTOP_H = 800;

const STATUS_H = 34;

function isDark(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 140;
}

export function replicaScale(containerWidth: number, logicalWidth: number) {
  if (!containerWidth || containerWidth <= 0) return 1;
  return Math.min(1, containerWidth / logicalWidth);
}

/**
 * Réplica idêntica: o PRÓPRIO app do cliente (/app/<slug>?preview=1) dentro de uma moldura de celular,
 * com o tema em rascunho aplicado ao vivo por postMessage (nada é salvo).
 */
export function StoreReplicaPreview({
  theme, storeSlug, mode = 'mobile', maxHeight = 720,
}: { theme: Partial<TenantTheme>; storeSlug: string; mode?: 'mobile' | 'desktop'; maxHeight?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [width, setWidth] = useState(mode === 'mobile' ? 340 : 640);
  const [ready, setReady] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const logicalW = mode === 'mobile' ? PHONE_W : DESKTOP_W;
  const logicalH = mode === 'mobile' ? PHONE_H : DESKTOP_H;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => { const w = el.clientWidth; if (w > 0) setWidth(w); };
    measure();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [mode]);

  // Envia o rascunho sempre que muda, e de novo quando o app avisa que está pronto.
  const push = () => sendPreviewTheme(frameRef.current?.contentWindow ?? null, themeRef.current, origin);
  useEffect(() => { push(); }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (isPreviewReadyMessage(ev, frameRef.current?.contentWindow ?? null, origin)) { setReady(true); push(); }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps

  const bezel = mode === 'mobile' ? 10 : 6;
  const scale = replicaScale(width - bezel * 2, logicalW);
  // Cabe na tela do painel (barra Salvar + cabeçalho), sem rolagem dupla.
  const viewportCap = typeof window !== 'undefined' && window.innerHeight ? Math.max(420, window.innerHeight - 210) : maxHeight;
  const screenH = Math.min(logicalH * scale, maxHeight, viewportCap);
  const statusH = mode === 'mobile' ? STATUS_H : 0;
  const frameH = (screenH - statusH) / scale;
  const tokens = themeToTokens(theme);
  const header = tokens.palette.bgHeader;
  const statusInk = isDark(header) ? '#ffffff' : '#0f172a';

  return (
    <div ref={wrapRef} className="w-full min-w-0" data-testid="store-replica">
      <div
        className={mode === 'mobile' ? 'replica-phone' : 'replica-desktop'}
        style={{ padding: bezel, maxWidth: logicalW * 1 + bezel * 2 }}
      >
        {mode === 'mobile' && <div className="replica-island" aria-hidden="true" />}
        <div className="replica-screen" style={{ height: screenH }}>
          {mode === 'mobile' && (
            <div className="replica-statusbar" aria-hidden="true" style={{ backgroundColor: header, color: statusInk, height: STATUS_H }}>
              <span>9:41</span>
              <span className="replica-status-icons">
                <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>
                <svg width="25" height="12" viewBox="0 0 25 12" fill="none" stroke="currentColor"><rect x="0.5" y="0.5" width="21" height="11" rx="3" opacity=".5"/><rect x="2" y="2" width="15" height="8" rx="1.5" fill="currentColor" stroke="none"/><path d="M23.5 4v4" strokeLinecap="round"/></svg>
              </span>
            </div>
          )}
          {!ready && <div className="replica-loading" data-testid="replica-loading"><span />Abrindo sua loja…</div>}
          <iframe
            ref={frameRef}
            data-testid="store-replica-frame"
            title="Prévia do app do cliente"
            src={previewUrl(storeSlug)}
            onLoad={push}
            loading="lazy"
            style={{
              width: logicalW, height: frameH, border: 0, display: 'block',
              transform: `scale(${scale})`, transformOrigin: 'top left',
              opacity: ready ? 1 : 0, transition: 'opacity .25s ease',
            }}
          />
        </div>
        {mode === 'mobile' && <div className="replica-home" aria-hidden="true" />}
      </div>
    </div>
  );
}
