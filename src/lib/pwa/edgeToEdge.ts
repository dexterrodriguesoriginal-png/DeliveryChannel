/**
 * Edge-to-edge no Android: o Chrome só pinta a barra de navegação do sistema (◁ ○ □ ou a barrinha de gestos)
 * com a cor da página quando a página declara `viewport-fit=cover`. Sem isso:
 *  - aba do Chrome: a barra fica com a cor do próprio Chrome;
 *  - app instalado (WebAPK): o Chrome usa o theme-color (a mesma cor da barra de status) nas duas barras.
 * `background_color` do manifesto só pinta a tela de abertura (splash), nunca a barra de navegação.
 * Com `viewport-fit=cover` a página desenha atrás das barras e preenchemos as áreas seguras
 * (env(safe-area-inset-*)) com a cor escolhida pela loja. Onde o Chrome não desenha atrás das barras,
 * os insets valem 0 e nada muda no layout.
 */
export const SAFE_TOP = 'env(safe-area-inset-top, 0px)';
export const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)';

/** Acrescenta `viewport-fit=cover` ao conteúdo do meta viewport, preservando o restante. */
export function withViewportFitCover(content: string | null | undefined): string {
  const parts = String(content || 'width=device-width, initial-scale=1.0')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/^viewport-fit\s*=/i.test(p));
  parts.push('viewport-fit=cover');
  return parts.join(', ');
}

/** Rotas de loja (/app/<slug>): liga o edge-to-edge no navegador (o servidor já entrega o HTML assim). */
export function enableEdgeToEdgeViewport(doc: Document = document): void {
  let el = doc.head.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
  if (!el) {
    el = doc.createElement('meta');
    el.setAttribute('name', 'viewport');
    doc.head.appendChild(el);
  }
  const next = withViewportFitCover(el.getAttribute('content'));
  if (el.getAttribute('content') !== next) el.setAttribute('content', next);
}

/** Reescreve o meta viewport de um HTML (servidor) para edge-to-edge. */
export function htmlWithViewportFitCover(html: string): string {
  const re = /<meta\b[^>]*name=["']viewport["'][^>]*>/i;
  const m = re.exec(html);
  if (!m) return html.replace(/<\/head>/i, `<meta name="viewport" content="${withViewportFitCover('')}" /></head>`);
  const content = /content=["']([^"']*)["']/i.exec(m[0])?.[1] || '';
  return html.replace(re, `<meta name="viewport" content="${withViewportFitCover(content)}" />`);
}
