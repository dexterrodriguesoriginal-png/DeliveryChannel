// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIconUpdateGuidePath, stripGlobalPwaInstallHead } from '../iconUpdateHtml';

describe('HTML de /atualizar-icone/:slug sem vínculo ao app global', () => {
  it('reconhece somente a rota do guia fora dos escopos', () => {
    expect(isIconUpdateGuidePath('/atualizar-icone/adega-show')).toBe(true);
    expect(isIconUpdateGuidePath('/atualizar-icone/adega-show/')).toBe(true);
    expect(isIconUpdateGuidePath('/atualizar-icone/')).toBe(false);
    expect(isIconUpdateGuidePath('/app/adega-show/')).toBe(false);
    expect(isIconUpdateGuidePath('/entregador')).toBe(false);
  });
  it('remove manifesto, apple touch icon e metas standalone do index.html real', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const result = stripGlobalPwaInstallHead(html);
    expect(result).not.toMatch(/<link[^>]+rel="manifest"/i);
    expect(result).not.toMatch(/<link[^>]+rel="apple-touch-icon"/i);
    expect(result).not.toMatch(/<meta[^>]+name="apple-mobile-web-app-/i);
    expect(result).toContain('<div id="root"></div>');
    expect(result).toContain('src="/src/main.tsx"');
    expect(result).toContain('<meta name="viewport"');
    // O código que faz a transformação não injeta um manifesto novo.
    expect((result.match(/<link[^>]+rel=["']manifest["']/gi) || []).length).toBe(0);
  });
  it('funciona com atributos em outra ordem e não remove metadados de outras categorias', () => {
    const html = `<head><link href="/manifest.json" rel="manifest">
      <meta content="yes" name="apple-mobile-web-app-capable">
      <link href="/icon.png" rel="apple-touch-icon">
      <meta name="theme-color" content="var(--brand-color)">
      <link rel="stylesheet" href="/assets/app.css"></head>`;
    const result = stripGlobalPwaInstallHead(html);
    expect(result).not.toContain('/manifest.json');
    expect(result).not.toContain('apple-mobile-web-app-capable');
    expect(result).not.toContain('apple-touch-icon');
    expect(result).toContain('name="theme-color"');
    expect(result).toContain('rel="stylesheet"');
  });
  it('GET do guia passa pela transformação tanto em dev quanto em produção sem mudar outras rotas', () => {
    const server = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    expect(server).toContain('app.get(/^\\/atualizar-icone');
    expect(server).toContain('if (isIconUpdateGuidePath(req.path))');
    expect(server).toContain("res.setHeader('Cache-Control', 'no-cache')");
    expect(server).toContain("res.set('Cache-Control', 'no-cache')");
    expect(server.match(/stripGlobalPwaInstallHead\(raw\)/g)).toHaveLength(2);
  });
});
