// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyNavBarCanvasColor, enableEdgeToEdgeViewport, htmlWithViewportFitCover, navBarCanvasStyleTag, withViewportFitCover } from '../edgeToEdge';

describe('edge-to-edge (barra de navegação do Android)', () => {
  it('acrescenta viewport-fit=cover preservando o restante', () => {
    expect(withViewportFitCover('width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'))
      .toBe('width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  });
  it('é idempotente e troca um viewport-fit anterior', () => {
    const once = withViewportFitCover('width=device-width, viewport-fit=contain');
    expect(once).toBe('width=device-width, viewport-fit=cover');
    expect(withViewportFitCover(once)).toBe(once);
  });
  it('sem conteúdo usa um viewport padrão', () => {
    expect(withViewportFitCover('')).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
  });
  it('reescreve o meta viewport do HTML (servidor) uma única vez', () => {
    const html = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head></html>';
    const out = htmlWithViewportFitCover(html);
    expect(out).toContain('content="width=device-width, initial-scale=1.0, viewport-fit=cover"');
    expect((out.match(/name="viewport"/g) || []).length).toBe(1);
    expect(htmlWithViewportFitCover(out)).toBe(out);
  });
  it('cria o meta viewport quando o HTML não tem', () => {
    expect(htmlWithViewportFitCover('<html><head></head></html>')).toContain('viewport-fit=cover');
  });
  it('liga no documento do navegador', () => {
    const doc = document.implementation.createHTMLDocument('x');
    const m = doc.createElement('meta'); m.setAttribute('name', 'viewport'); m.setAttribute('content', 'width=device-width');
    doc.head.appendChild(m);
    enableEdgeToEdgeViewport(doc);
    expect(m.getAttribute('content')).toBe('width=device-width, viewport-fit=cover');
    enableEdgeToEdgeViewport(doc);
    expect(doc.head.querySelectorAll('meta[name="viewport"]').length).toBe(1);
  });

  it('pinta o fundo da página com a cor da barra de navegação e desfaz ao sair da loja', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.head.insertAdjacentHTML('beforeend', navBarCanvasStyleTag('#db0c2b'));
    expect(doc.head.querySelector('style[data-store-nav-canvas]')?.textContent).toBe('html{background-color:#db0c2b}body{min-height:100vh}');
    const undo = applyNavBarCanvasColor('#1d4ed8', doc);
    expect(doc.documentElement.style.backgroundColor).toBe('#1d4ed8');
    undo();
    expect(doc.documentElement.style.backgroundColor).toBe('');
    expect(doc.head.querySelector('style[data-store-nav-canvas]')).toBeNull();
  });
});
