/** Detecção de PWA já instalado (Chrome/Android), sem depender só do display-mode. */

export interface InstalledRelatedApp {
  platform?: string;
  url?: string;
  id?: string;
}

export interface DetectInstalledWebAppOptions {
  getInstalledRelatedApps?: () => Promise<InstalledRelatedApp[]>;
  /** URL absoluta ou caminho do manifesto do totem. */
  manifestUrl?: string;
  /** id do manifesto (ex.: /totem-id/<tenant>). */
  manifestId?: string;
  standalone?: boolean;
}

function pathOf(url: string, base?: string): string {
  try {
    return new URL(url, base || 'https://deliverychannel.local').pathname;
  } catch {
    return url.split('?')[0];
  }
}

function sameApp(app: InstalledRelatedApp, opts: DetectInstalledWebAppOptions): boolean {
  if (opts.manifestId && app.id) {
    const want = opts.manifestId.replace(/\/$/, '');
    if (app.id === want || app.id.endsWith(want) || app.id.includes(want)) return true;
  }
  if (opts.manifestUrl && app.url) {
    const want = pathOf(opts.manifestUrl);
    const got = pathOf(app.url, opts.manifestUrl);
    if (want && (got === want || got.endsWith(want) || app.url.includes(want))) return true;
  }
  return false;
}

/**
 * True se o totem já está instalado neste aparelho.
 * display-mode standalone/fullscreen, ou getInstalledRelatedApps() com o manifesto do totem.
 * Se a API não listar apps, devolve false (não confundir com "ainda dá para instalar").
 */
export async function detectInstalledWebApp(opts: DetectInstalledWebAppOptions): Promise<boolean> {
  if (opts.standalone) return true;
  if (typeof opts.getInstalledRelatedApps !== 'function') return false;
  try {
    const apps = await opts.getInstalledRelatedApps();
    if (!Array.isArray(apps) || apps.length === 0) return false;
    if (opts.manifestUrl || opts.manifestId) return apps.some(app => sameApp(app, opts));
    return apps.some(app => app.platform === 'webapp' && typeof app.url === 'string' && /\/totem\//.test(app.url));
  } catch {
    return false;
  }
}
