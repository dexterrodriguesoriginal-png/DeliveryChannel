export const WAITER_MANIFEST_PATH = '/garcom.webmanifest';
export const WAITER_START_PATH = '/garcom';
export const WAITER_APP_NAME = 'Garçom';
export function isWaiterRoute(path: string): boolean {
  return path === '/garcom' || path.startsWith('/garcom/');
}

/** O manifesto precisa estar no HTML inicial para o Chrome oferecer a instalação do app certo. */
export function injectWaiterHead(html: string): string {
  return html.replace(/<link\b[^>]*rel=["']manifest["'][^>]*>\s*/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${WAITER_APP_NAME}</title>`)
    .replace(/<\/head>/i, `<link rel="manifest" href="${WAITER_MANIFEST_PATH}" /><meta name="application-name" content="${WAITER_APP_NAME}" /><meta name="theme-color" content="#0f172a" /></head>`);
}
