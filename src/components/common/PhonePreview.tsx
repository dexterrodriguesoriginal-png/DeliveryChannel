import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Offer, TenantTheme } from '../../types';
import { themeToTokens } from '../../lib/theme/themeEngine';
import { systemBarsFromTokens } from '../../lib/pwa/systemBars';
import { isPreviewReadyMessage, previewUrl, sendPreviewCard, sendPreviewTheme } from '../../lib/theme/previewBridge';

/** Celular de referência: tela lógica 390×844 (proporção ~9:19,5). Modo computador: 1280×800. */
export const PHONE_W = 390;
export const PHONE_H = 844;
export const DESKTOP_W = 1280;
export const DESKTOP_H = 800;
export const PHONE_BEZEL = 12;
export const DESKTOP_BEZEL = 7;
const STATUS_H = 34;
/** Barra de navegação Android (◁ ○ □). */
export const NAV_H = 48;

/** Escala uniforme para o aparelho INTEIRO caber na área disponível (nunca amplia). */
export function fitScale(availW: number, availH: number, logicalW: number, logicalH: number) {
  if (!(availW > 0) || !(availH > 0)) return 1;
  return Math.max(0.1, Math.min(1, availW / logicalW, availH / logicalH));
}
export const replicaScale = (containerWidth: number, logicalWidth: number) => fitScale(containerWidth, Infinity, logicalWidth, 1);

export interface PhonePreviewProps {
  storeSlug: string;
  /** Tema em rascunho (Design do App). */
  theme?: Partial<TenantTheme>;
  /** Card promocional em rascunho (Marketing). */
  card?: Partial<Offer> | null;
  mode?: 'mobile' | 'desktop';
  /** true: ocupa 100% da altura do pai (coluna fixa do editor). false: limita pela altura da janela. */
  fill?: boolean;
  /** Reserva abaixo do aparelho em modo livre (título, botões do diálogo etc.). */
  reservedHeight?: number;
}

/**
 * Prévia única do app: o PRÓPRIO app do cliente (/app/<slug>?preview=1) dentro de um celular inteiro,
 * visível por completo, escalado para caber (1366×768, 1280×720, 1024×576…). O app rola DENTRO da tela
 * e a barra de menu inferior fica sempre visível. Rascunhos chegam por postMessage; nada é salvo.
 */
export function PhonePreview({ storeSlug, theme, card, mode = 'mobile', fill = false, reservedHeight = 260 }: PhonePreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const cardRef = useRef(card);
  cardRef.current = card;
  const [box, setBox] = useState({ w: 340, h: 600 });
  const [winH, setWinH] = useState(typeof window !== 'undefined' ? window.innerHeight || 720 : 720);
  const [ready, setReady] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const mobile = mode === 'mobile';
  const logicalW = mobile ? PHONE_W : DESKTOP_W;
  const logicalH = mobile ? PHONE_H : DESKTOP_H;
  const bezel = mobile ? PHONE_BEZEL : DESKTOP_BEZEL;
  const outerW = logicalW + bezel * 2;
  const outerH = logicalH + bezel * 2;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => { setBox({ w: el.clientWidth, h: el.clientHeight }); setWinH(window.innerHeight || 720); };
    measure();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [mode, fill]);

  const push = () => {
    const win = frameRef.current?.contentWindow ?? null;
    if (themeRef.current) sendPreviewTheme(win, themeRef.current, origin);
    if (cardRef.current !== undefined) sendPreviewCard(win, cardRef.current, origin);
  };
  useEffect(() => { push(); }, [theme, card]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (isPreviewReadyMessage(ev, frameRef.current?.contentWindow ?? null, origin)) { setReady(true); push(); }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps

  const availH = fill && box.h > 0 ? box.h : Math.max(320, winH - reservedHeight);
  const scale = fitScale(box.w, availH, outerW, outerH);
  const statusH = mobile ? STATUS_H : 0;
  const navH = mobile ? NAV_H : 0;
  // Cores das barras do sistema escolhidas no editor (ao vivo, antes de salvar).
  const bars = systemBarsFromTokens(themeToTokens(theme));
  const statusInk = bars.statusIsDark ? '#ffffff' : '#0f172a';
  const navInk = bars.navIsDark ? '#ffffff' : '#0f172a';

  return (
    <div
      ref={wrapRef}
      className="flex w-full min-w-0 justify-center"
      // fill: posicionado de forma absoluta no pai (que tem altura definida) => a medida não depende do conteúdo.
      style={fill ? { position: 'absolute', inset: 0, alignItems: 'center' } : undefined}
      data-testid="store-replica"
      data-scale={scale.toFixed(3)}
    >
      {/* Caixa já com o tamanho final (escalado): o layout não "vaza" nem corta o aparelho. */}
      <div style={{ width: outerW * scale, height: outerH * scale, flex: 'none' }}>
        <div
          className={mobile ? 'replica-phone' : 'replica-desktop'}
          data-testid="phone-frame"
          style={{ width: outerW, height: outerH, padding: bezel, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {mobile && <div className="replica-island" aria-hidden="true" />}
          <div className="replica-screen" style={{ height: logicalH }}>
            {mobile && (
              <div className="replica-statusbar" aria-hidden="true" data-testid="phone-status-bar" style={{ backgroundColor: bars.status, color: statusInk, height: STATUS_H }}>
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
                width: logicalW, height: logicalH - statusH - navH, border: 0, display: 'block',
                opacity: ready ? 1 : 0, transition: 'opacity .25s ease',
              }}
            />
            {mobile && (
              <div className="replica-navbar" aria-hidden="true" data-testid="phone-nav-bar" style={{ backgroundColor: bars.nav, color: navInk, height: NAV_H }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17 4v16L5 12z" /></svg>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><circle cx="12" cy="12" r="8" /></svg>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
