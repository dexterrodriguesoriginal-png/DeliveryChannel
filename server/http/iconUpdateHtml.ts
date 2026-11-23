/**
 * HTML da página de atualização de ícone fora dos escopos PWA.
 * Nunca remova tags destas categorias em outras rotas.
 */
export const isIconUpdateGuidePath = (pathname: string): boolean =>
  /^\/atualizar-icone\/[^/]+\/?$/.test(pathname);

/** Remove somente os sinais de instalação global do HTML de entrada. */
export function stripGlobalPwaInstallHead(html: string): string {
  return html
    .replace(/<link\b(?=[^>]*\brel\s*=\s*(?:"[^"]*\bmanifest\b[^"]*"|'[^']*\bmanifest\b[^']*'))[^>]*>/gi, '')
    .replace(/<link\b(?=[^>]*\brel\s*=\s*(?:"[^"]*\bapple-touch-icon(?:-precomposed)?\b[^"]*"|'[^']*\bapple-touch-icon(?:-precomposed)?\b[^']*'))[^>]*>/gi, '')
    .replace(/<meta\b(?=[^>]*\bname\s*=\s*(?:"apple-mobile-web-app-[^"]*"|'apple-mobile-web-app-[^']*'))[^>]*>/gi, '');
}
