/**
 * Edge-to-edge no Android: o Chrome só pinta a barra de navegação do sistema (◁ ○ □ ou a barrinha de gestos)
 * com a cor da página quando a página declara `viewport-fit=cover`. Sem isso:
 *  - aba do Chrome: a barra fica com a cor do próprio Chrome;
 *  - app instalado (WebAPK): o Chrome usa o theme_color do manifesto gravado no app (= cor da barra de navegação,
 *    ver storeManifest.ts); só muda quando o Chrome atualiza o app instalado ou ao reinstalar.
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

/**
 * Cor do "fundo da página" (canvas) = cor da barra de navegação nos casos em que o Chrome NÃO desenha a página
 * atrás dela: navegação de 3 botões (◁ ○ □), tablets/telas grandes e aparelhos sem o edge-to-edge do Chrome 135+.
 * Desde o Chrome 129 a barra de navegação de uma aba é pintada com a cor de fundo da página (fundo do <html>,
 * ou do <body> quando o <html> não tem fundo). Sem isto ela ficava com o cinza-claro do <body> (bg-gray-50)
 * e não seguia a "Cor da barra de navegação" da loja. O conteúdo do app cobre a tela inteira, então essa cor
 * só aparece nas bordas que o próprio Chrome usa para a barra.
 */
export const NAV_CANVAS_ATTR = 'data-store-nav-canvas';

/**
 * <style> para o servidor injetar no HTML da loja: a cor vale desde a primeira pintura (antes do JS).
 * body com altura mínima da tela: enquanto o app carrega, a tela continua com o fundo do <body> (sem "piscar"
 * a cor da barra na tela toda); o Chrome usa o fundo do <html> para a barra de navegação.
 */
export function navBarCanvasStyleTag(color: string): string {
  return `<style ${NAV_CANVAS_ATTR}="1">html{background-color:${color}}body{min-height:100vh}</style>`;
}

/** Aplica a cor da barra de navegação no fundo do documento; devolve a função que desfaz (ao sair da loja). */
export function applyNavBarCanvasColor(color: string, doc: Document = document): () => void {
  const root = doc.documentElement;
  const previous = root.style.backgroundColor;
  root.style.backgroundColor = color;
  return () => {
    root.style.backgroundColor = previous;
    doc.head.querySelectorAll(`style[${NAV_CANVAS_ATTR}]`).forEach((el) => el.remove());
  };
}
