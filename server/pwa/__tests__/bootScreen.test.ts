// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { injectStoreHead, storeHeadOptionsForUrl } from '../storeHtml';
import { bootScreenHtml, DC_BOOT_MARK_SIZE_PX, DC_BOOT_SCREEN_ID, DC_PRESENTS_BACKGROUND, DC_PRESENTS_TEXT } from '../../../src/lib/pwa/bootScreen';
import { DC_MARK_SVG } from '../../../src/lib/brand/dcMark';
import { SPLASH_TEST_COLOR } from '../splashTest';

const html = '<html><head><title>X</title><link rel="manifest" href="/manifest.json" /></head><body class="bg-gray-50"><div id="root"></div></body></html>';
const store = { id: 't1', slug: 'mercado-teste-dc', name: 'Mercado Teste DC', theme: { storeName: 'Mercado Teste DC', primaryColor: '#15803d' } } as any;

describe('tela "Delivery Channel apresenta" (#dc-boot) no HTML do servidor', () => {
  it('vem logo depois do <body>, antes do #root, com e sem loja resolvida', () => {
    for (const s of [store, null]) {
      const out = injectStoreHead(html, 'mercado-teste-dc', s, storeHeadOptionsForUrl('/app/mercado-teste-dc/?source=pwa'));
      const body = out.indexOf('<body'); const boot = out.indexOf(`id="${DC_BOOT_SCREEN_ID}"`); const root = out.indexOf('id="root"');
      expect(boot).toBeGreaterThan(body);
      expect(boot).toBeLessThan(root);
      expect((out.match(/id="dc-boot"/g) || []).length).toBe(1);
    }
  });

  it('não aparece no cardápio da mesa (?mesa=) nem na prévia do painel (?preview=1)', () => {
    expect(storeHeadOptionsForUrl('/app/x/?source=pwa')).toEqual({ edgeToEdge: true, bootScreen: true });
    expect(storeHeadOptionsForUrl('/app/x/?preview=1').bootScreen).toBe(false);
    expect(storeHeadOptionsForUrl('/app/x/?mesa=' + 'a'.repeat(32))).toEqual({ edgeToEdge: false, bootScreen: false });
    expect(injectStoreHead(html, 'x', store, { edgeToEdge: false, bootScreen: false })).not.toContain('dc-boot');
    expect(injectStoreHead(html, 'x', store)).not.toContain('dc-boot');
  });

  it('autocontida: só data: URI, sem requisições externas; marca >= 64 px (o Chrome conta como pintura não vazia)', () => {
    const b = bootScreenHtml();
    expect(b).toContain(DC_PRESENTS_TEXT);
    expect(b).toContain('Delivery Channel apresenta');
    expect(b).toContain(`background:${DC_PRESENTS_BACKGROUND}`);
    expect(b).toMatch(/<img src="data:image\/svg\+xml,[^"]+"/);
    expect(DC_BOOT_MARK_SIZE_PX).toBeGreaterThanOrEqual(64);
    expect(b).toContain(`width="${DC_BOOT_MARK_SIZE_PX}" height="${DC_BOOT_MARK_SIZE_PX}"`);
    expect(b).not.toMatch(/https?:\/\//i);
    expect(b).not.toMatch(/(src|href)="\//);
    expect(b).not.toMatch(/url\(/);
    expect(b).not.toContain('<script');
  });

  it('cor da apresentação é uma constante só (a splash de teste usa a mesma)', () => {
    expect(DC_PRESENTS_BACKGROUND).toBe('#121212');
    expect(SPLASH_TEST_COLOR).toBe(DC_PRESENTS_BACKGROUND);
  });

  it('marca inline é o mesmo desenho de public/icon-512.svg', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../../../public/icon-512.svg'), 'utf8');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(norm(DC_MARK_SVG)).toBe(norm(file));
  });
});

import express from 'express';
import type { AddressInfo } from 'node:net';
import { createPwaRouter } from '../routes';

describe('HTML usa a última leitura da loja na hora (stale-while-revalidate); manifesto segue fresco', () => {
  it('serve o cache vencido ao HTML e atualiza em segundo plano; uma consulta por vez', async () => {
    let calls = 0; let name = 'Loja A';
    let release: () => void = () => undefined;
    const resolveStore = async (slug: string) => {
      calls++;
      if (calls > 1) await new Promise<void>((r) => { release = r; });
      return { status: 'ok' as const, store: { id: 't1', slug, name, theme: { storeName: name } } };
    };
    const router = createPwaRouter({ resolveStore, publicDir: '/nonexistent', ttlMs: 0, htmlStaleMs: 60_000 });
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja A');
    name = 'Loja B';
    // vencido (ttl 0) mas dentro do stale: devolve na hora sem esperar a consulta nova
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja A');
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja A');
    expect(calls).toBe(2);
    release();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja B');
  });

  it('sem cache ou além do stale, espera a consulta (como antes)', async () => {
    let calls = 0;
    const resolveStore = async (slug: string) => { calls++; return { status: 'ok' as const, store: { id: 't1', slug, name: `v${calls}` } }; };
    const router = createPwaRouter({ resolveStore, publicDir: '/nonexistent', ttlMs: 0, htmlStaleMs: 0 });
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('v1');
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('v2');
    expect((await router.lookupStore('loja-a'))?.name).toBe('v3');
  });

  it('slug inválido nunca consulta', async () => {
    let calls = 0;
    const router = createPwaRouter({ resolveStore: async () => { calls++; return { status: 'not_found' as const }; }, publicDir: '/nonexistent' });
    expect(await router.lookupStoreForHtml('../x')).toBeNull();
    expect(calls).toBe(0);
  });
});
