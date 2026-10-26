export const DRIVER_MANIFEST_PATH = '/driver.webmanifest';
export const DRIVER_START_PATH = '/entregador';
export const DRIVER_APP_NAME = 'Entregador';
export function isDriverRoute(path: string): boolean {
  return path === '/entregador' || path.startsWith('/entregador/') || path === '/convite-entregador';
}

/** O manifesto precisa estar no HTML inicial para o Chrome oferecer a instalação correta. */
export function injectDriverHead(html: string): string {
  return html.replace(/<link\b[^>]*rel=["']manifest["'][^>]*>\s*/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>Entregador</title>')
    .replace(/<\/head>/i, `<link rel="manifest" href="${DRIVER_MANIFEST_PATH}" /><meta name="application-name" content="Entregador" /></head>`);
}
