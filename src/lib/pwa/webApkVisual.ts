/**
 * "Visual atualizado" do app instalado (WebAPK do Android).
 * O Chrome grava no app, na instalação, o theme_color (barra de navegação), o background_color (tela de abertura)
 * e os ícones do manifesto; depois só troca quando atualiza o WebAPK ou o app é reinstalado.
 * A impressão digital usa o MESMO manifesto servido em /app/<slug>/manifest.webmanifest (serverManifest ->
 * buildStoreManifest + storeIconVersion), então não há como divergir do que o Chrome instala.
 * Funções puras + leitura/gravação defensiva no localStorage (por loja).
 */
import { storeAppId } from './storeManifest';
import { normalizeBarColor } from './systemBars';

type KV = Pick<Storage, 'getItem' | 'setItem'>;

export interface FrozenManifestFields {
  theme_color?: unknown;
  background_color?: unknown;
  icons?: unknown;
}

function iconPath(src: string): string {
  // Ícones servidos com URL relativa (/app/<slug>/icons/...?v=) ou absoluta: compara só caminho + ?v=.
  try { const u = new URL(src, 'https://x.invalid'); return `${u.pathname}${u.search}`; } catch { return src; }
}

/** Impressão digital do que o WebAPK congela; null se o manifesto não tiver as cores (não compara nada). */
export function webApkFingerprint(m: FrozenManifestFields | null | undefined): string | null {
  if (!m) return null;
  const theme = normalizeBarColor(m.theme_color);
  const bg = normalizeBarColor(m.background_color);
  if (!theme || !bg) return null;
  const icons = Array.isArray(m.icons)
    ? (m.icons as Array<{ src?: unknown; purpose?: unknown }>)
      .filter((i) => i && typeof i.src === 'string' && !(i.src as string).startsWith('data:'))
      .map((i) => `${String(i.purpose || 'any')}=${iconPath(i.src as string)}`)
      .sort()
    : [];
  return ['v1', theme, bg, ...icons].join('|');
}

export const webApkVisualKey = (slug: string) => `deliverychannel_webapk_visual_${slug}`;

export interface WebApkVisualRecord {
  /** Impressão digital gravada quando o app foi instalado (ou a primeira vez aberto instalado). */
  installed?: string;
  /** Impressão digital para a qual o cliente tocou "Agora não". */
  dismissed?: string;
}

export function readVisualRecord(s: KV | null | undefined, slug: string): WebApkVisualRecord {
  try {
    const raw = s?.getItem(webApkVisualKey(slug));
    if (!raw) return {};
    const v = JSON.parse(raw) as WebApkVisualRecord;
    return {
      installed: typeof v?.installed === 'string' ? v.installed : undefined,
      dismissed: typeof v?.dismissed === 'string' ? v.dismissed : undefined,
    };
  } catch {
    return {};
  }
}

function writeVisualRecord(s: KV | null | undefined, slug: string, r: WebApkVisualRecord) {
  try { s?.setItem(webApkVisualKey(slug), JSON.stringify(r)); } catch { /* storage indisponível */ }
}

/** appinstalled (aba do navegador): o app acabou de ser instalado com o visual atual. Limpa o "Agora não". */
export function recordInstalledVisual(s: KV | null | undefined, slug: string, current: string | null) {
  if (!current) return;
  writeVisualRecord(s, slug, { installed: current });
}

export function dismissVisualNotice(s: KV | null | undefined, slug: string, current: string | null) {
  if (!current) return;
  writeVisualRecord(s, slug, { ...readVisualRecord(s, slug), dismissed: current });
}

/**
 * Decide o aviso no app aberto pelo ícone (standalone). Sem registro de instalação: grava o atual como base
 * (sem aviso — não dá para saber com que visual foi instalado). Visual diferente do instalado e não dispensado
 * para este visual: mostra o aviso.
 */
export function evaluateVisualNotice(
  s: KV | null | undefined,
  slug: string,
  current: string | null,
  standalone: boolean,
): boolean {
  if (!standalone || !current) return false;
  const rec = readVisualRecord(s, slug);
  if (!rec.installed) {
    writeVisualRecord(s, slug, { installed: current });
    return false;
  }
  if (rec.installed === current) return false;
  return rec.dismissed !== current;
}

/** Lê o manifesto servido desta loja (sem cache) e devolve a impressão digital; null em qualquer falha. */
export async function fetchCurrentVisualFingerprint(
  slug: string,
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`/app/${encodeURIComponent(slug)}/manifest.webmanifest`, {
      cache: 'no-cache', headers: { Accept: 'application/manifest+json' },
    });
    if (!res.ok || !/manifest\+json/i.test(res.headers.get('content-type') || '')) return null;
    const m = await res.json();
    if (!m || typeof m.id !== 'string' || !m.id.endsWith(storeAppId(tenantId))) return null; // nunca outra loja
    return webApkFingerprint(m);
  } catch {
    return null;
  }
}
