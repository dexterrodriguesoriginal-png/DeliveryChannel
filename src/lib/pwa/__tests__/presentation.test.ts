import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clampImageSeconds, isSafePresentationUrl, localDay, mapPresentation, markPresentationShown, presentationFileError,
  presentationKeys, presentationPlan, shouldShowPresentation, PRESENTATION_MAX_VIDEO_SECONDS, PRESENTATION_STILL_MS,
} from '../presentation';
import { mapN6PublicStore } from '../../../repositories/publicStoreN6';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
const resolve = (b: string, p: string) => `https://cdn.test/${b}/${p}`;
const MB = 1024 * 1024;

describe('tela inicial personalizada: regras', () => {
  it('1× por abertura do app (sessionStorage por loja)', () => {
    const session = mem(), local = mem();
    expect(shouldShowPresentation({ slug: 'loja', oncePerDay: false, session, local })).toBe(true);
    markPresentationShown({ slug: 'loja', session, local });
    expect(shouldShowPresentation({ slug: 'loja', oncePerDay: false, session, local })).toBe(false);
    // Outra loja no mesmo navegador não é afetada; nova abertura (sessão nova) mostra de novo.
    expect(shouldShowPresentation({ slug: 'outra', oncePerDay: false, session, local })).toBe(true);
    expect(shouldShowPresentation({ slug: 'loja', oncePerDay: false, session: mem(), local })).toBe(true);
  });
  it('opção 1× por dia usa localStorage e volta no dia seguinte', () => {
    const local = mem();
    const day1 = new Date(2026, 10, 18, 9), later = new Date(2026, 10, 18, 22), day2 = new Date(2026, 10, 19, 8);
    markPresentationShown({ slug: 'loja', session: mem(), local, now: day1 });
    expect(local.m.get(presentationKeys('loja').day)).toBe(localDay(day1));
    expect(shouldShowPresentation({ slug: 'loja', oncePerDay: true, session: mem(), local, now: later })).toBe(false);
    expect(shouldShowPresentation({ slug: 'loja', oncePerDay: true, session: mem(), local, now: day2 })).toBe(true);
    expect(shouldShowPresentation({ slug: 'loja', oncePerDay: false, session: mem(), local, now: later })).toBe(true);
  });
  it('storage bloqueado (modo privado) não quebra: mostra e segue', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(shouldShowPresentation({ slug: 'loja', oncePerDay: true, session: broken, local: broken })).toBe(true);
    expect(() => markPresentationShown({ slug: 'loja', session: broken, local: broken })).not.toThrow();
    expect(shouldShowPresentation({ slug: '', oncePerDay: false })).toBe(false);
  });
  it('plano: imagem pelo tempo da loja, vídeo cortado em 10 s, movimento reduzido sem vídeo, sem tela → nada', () => {
    expect(presentationPlan({ url: 'u', mediaType: 'IMAGE', imageSeconds: 3, oncePerDay: false })).toEqual({ kind: 'IMAGE', url: 'u', durationMs: 3000 });
    expect(presentationPlan({ url: 'u', mediaType: 'VIDEO', imageSeconds: 3, oncePerDay: false })).toEqual({ kind: 'VIDEO', url: 'u', maxMs: PRESENTATION_MAX_VIDEO_SECONDS * 1000 });
    expect(PRESENTATION_MAX_VIDEO_SECONDS).toBe(10);
    expect(presentationPlan({ url: 'u', mediaType: 'VIDEO', imageSeconds: 3, oncePerDay: false }, { reducedMotion: true })).toEqual({ kind: 'STILL', url: 'u', durationMs: PRESENTATION_STILL_MS });
    expect(presentationPlan(undefined)).toBeNull();
  });
  it('tempo da imagem fica entre 1 e 5 s', () => {
    expect(clampImageSeconds(0)).toBe(1); expect(clampImageSeconds(9)).toBe(5); expect(clampImageSeconds('x')).toBe(3); expect(clampImageSeconds(2.25)).toBe(2.3);
  });
  it('valida formato, tamanho e duração antes do envio', () => {
    expect(presentationFileError({ name: 'a.webp', type: 'image/webp', size: 2 * MB })).toBeNull();
    expect(presentationFileError({ name: 'a.png', type: 'image/png', size: 3 * MB + 1 })).toMatch(/3 MB/);
    expect(presentationFileError({ name: 'a.gif', type: 'image/gif', size: 1 })).toMatch(/Formato/);
    expect(presentationFileError({ name: 'a.png', type: 'text/html', size: 1 })).toMatch(/Formato/);
    expect(presentationFileError({ name: 'v.mp4', type: 'video/mp4', size: 16 * MB }, 5)).toMatch(/15 MB/);
    expect(presentationFileError({ name: 'v.mp4', type: 'video/mp4', size: MB }, 10)).toBeNull();
    expect(presentationFileError({ name: 'v.webm', type: 'video/webm', size: MB }, 10.6)).toMatch(/10 segundos/);
    expect(presentationFileError({ name: 'v.mp4', type: 'video/mp4', size: MB })).toMatch(/duração/);
  });
  it('URL da prévia: só https, blob: ou caminho da mesma origem', () => {
    expect(isSafePresentationUrl('https://x.supabase.co/a.png')).toBe(true);
    expect(isSafePresentationUrl('/storage/a.png')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.com/a', 'http://x/a', '', 3]) expect(isSafePresentationUrl(bad)).toBe(false);
  });
});

describe('get_public_store N6 → presentation', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../repositories/__tests__/fixtures/n6/get_public_store.adega-a.json'), 'utf8'));
  it('mapeia a tela publicada e ignora formatos inválidos', () => {
    const s = mapN6PublicStore({ ...raw, presentation: { media: { bucket: 'marketing-public', path: 't/v.mp4', mediaType: 'VIDEO', durationSeconds: 9.5 }, imageSeconds: 2.5, oncePerDay: true } }, resolve as any, 0);
    expect(s.presentation).toEqual({ url: 'https://cdn.test/marketing-public/t/v.mp4', mediaType: 'VIDEO', imageSeconds: 2.5, oncePerDay: true, durationSeconds: 9.5 });
    expect(mapN6PublicStore({ ...raw, presentation: null }, resolve as any, 0).presentation).toBeUndefined();
    expect(mapN6PublicStore(raw, resolve as any, 0).presentation).toBeUndefined();
    expect(mapPresentation({ media: { bucket: 'marketing', path: 'privado/x.png' } }, resolve as any)).toBeUndefined();
  });
});
