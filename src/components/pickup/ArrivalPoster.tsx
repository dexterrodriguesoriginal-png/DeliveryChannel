import React, { useRef } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { arrivalQrUrl } from '../../lib/pickup/arrival';

export const POSTER_TITLE = 'Chegou para retirar?';
export const POSTER_TEXT = 'Escaneie aqui para entrar na fila';

/** Cartaz (visual) — mesma arte do PNG/impressão. */
export const ArrivalPoster: React.FC<{ storeName: string; token: string; scale?: number }> = ({ storeName, token, scale = 1 }) => (
  <div data-testid="arrival-poster" className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden text-center mx-auto shadow-sm"
    style={{ width: 300 * scale }}>
    <div className="bg-[#15803d] text-white py-2 font-black tracking-wide" style={{ fontSize: 14 * scale }}>DELIVERY <span className="text-green-200">CHANNEL</span></div>
    <div className="px-4 py-3 space-y-2">
      <div className="font-black text-slate-900 truncate" style={{ fontSize: 18 * scale }}>{storeName}</div>
      <div className="font-black text-[#15803d]" style={{ fontSize: 22 * scale }}>{POSTER_TITLE}</div>
      <div className="flex justify-center"><QRCodeSVG value={arrivalQrUrl(undefined, token)} size={190 * scale} level="M" marginSize={1} /></div>
      <div className="font-bold text-slate-800" style={{ fontSize: 14 * scale }}>{POSTER_TEXT}</div>
      <div className="text-slate-500" style={{ fontSize: 11 * scale }}>Ou digite no app o código <b className="font-mono text-slate-900 tracking-widest">{token}</b></div>
    </div>
  </div>
);

/** Gera o cartaz em PNG (A5 a 150 dpi: 874×1240) a partir de um QR em canvas. */
export function posterCanvas(storeName: string, token: string, qr: HTMLCanvasElement): HTMLCanvasElement {
  const W = 874, H = 1240, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#15803d'; g.fillRect(0, 0, W, 130);
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '900 56px sans-serif'; g.fillText('DELIVERY CHANNEL', W / 2, 88);
  g.fillStyle = '#0f172a'; g.font = '900 54px sans-serif'; g.fillText(storeName.slice(0, 28), W / 2, 230);
  g.fillStyle = '#15803d'; g.font = '900 70px sans-serif'; g.fillText(POSTER_TITLE, W / 2, 330);
  g.drawImage(qr, (W - 600) / 2, 380, 600, 600);
  g.fillStyle = '#1e293b'; g.font = '700 44px sans-serif'; g.fillText(POSTER_TEXT, W / 2, 1060);
  g.fillStyle = '#64748b'; g.font = '400 32px sans-serif'; g.fillText(`Ou digite no app o código ${token}`, W / 2, 1130);
  return c;
}

/** Botões Imprimir cartaz / Baixar PNG (o QR em canvas fica escondido). */
export const PosterActions: React.FC<{ storeName: string; token: string }> = ({ storeName, token }) => {
  const box = useRef<HTMLDivElement>(null);
  const make = () => { const qr = box.current?.querySelector('canvas'); return qr ? posterCanvas(storeName, token, qr) : null; };
  const download = () => {
    const c = make(); if (!c) return;
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `qr-chegada-${token}.png`; a.click();
  };
  const print = () => {
    const c = make(); if (!c) return;
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<html><head><title>QR de chegada</title><style>@page{size:A5;margin:8mm}body{margin:0;display:flex;justify-content:center}img{width:100%;max-width:148mm}</style></head><body><img src="${c.toDataURL('image/png')}" onload="setTimeout(()=>{window.print()},200)"></body></html>`);
    w.document.close();
  };
  return (
    <>
      <div ref={box} className="hidden"><QRCodeCanvas value={arrivalQrUrl(undefined, token)} size={600} level="M" marginSize={2} /></div>
      <button type="button" onClick={print} data-testid="poster-print" className="flex-1 py-2 rounded-xl bg-[#15803d] hover:bg-[#166534] text-white text-sm font-bold">Imprimir cartaz</button>
      <button type="button" onClick={download} data-testid="poster-png" className="flex-1 py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">Baixar PNG</button>
    </>
  );
};
