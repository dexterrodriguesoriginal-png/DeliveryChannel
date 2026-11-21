/** Abertura opcional, exibida somente quando o módulo da loja está ativo. */
export type PresentationMediaType = 'IMAGE' | 'VIDEO';

/** Tela publicada da loja, como vem de get_public_store (`presentation`). */
export interface StorePresentation {
  url: string;
  mediaType: PresentationMediaType;
  imageSeconds: number;
  oncePerDay: boolean;
  durationSeconds?: number;
}

export const PRESENTATION_MAX_VIDEO_SECONDS = 10;
export const PRESENTATION_MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const PRESENTATION_MAX_VIDEO_BYTES = 15 * 1024 * 1024;
export const PRESENTATION_DEFAULT_IMAGE_SECONDS = 3;
export const PRESENTATION_MIN_IMAGE_SECONDS = 1;
export const PRESENTATION_MAX_IMAGE_SECONDS = 5;
/** Sem mídia, a abertura é pulada integralmente. */
/** Se a mídia não começar a tocar/carregar nesse tempo, segue para a vitrine. */
export const PRESENTATION_START_TIMEOUT_MS = 1500;
export const PRESENTATION_FADE_MS = 200;
/** Movimento reduzido: vídeo vira o primeiro quadro parado por esse tempo. */
export const PRESENTATION_STILL_MS = 1500;
/** Prévia do painel usa somente a mídia real, sem simular marca/splash. */

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXT = ['mp4', 'webm'];

export function clampImageSeconds(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return PRESENTATION_DEFAULT_IMAGE_SECONDS;
  const clamped = Math.min(PRESENTATION_MAX_IMAGE_SECONDS, Math.max(PRESENTATION_MIN_IMAGE_SECONDS, n));
  return Math.round(clamped * 10) / 10;
}

/** Converte o JSON público (`{ media: {bucket,path,...}, imageSeconds, oncePerDay }`). Inválido → undefined. */
export function mapPresentation(
  raw: unknown,
  resolve: (bucket: 'marketing-public', path: string) => string,
): StorePresentation | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const media = r.media as Record<string, unknown> | null | undefined;
  if (!media || typeof media !== 'object' || media.bucket !== 'marketing-public') return undefined;
  if (typeof media.path !== 'string' || !media.path) return undefined;
  if (media.mediaType !== 'IMAGE' && media.mediaType !== 'VIDEO') return undefined;
  const mediaType: PresentationMediaType = media.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE';
  const duration = Number(media.durationSeconds);
  if (media.mediaType === 'VIDEO' && (!Number.isFinite(duration) || duration <= 0 || duration > PRESENTATION_MAX_VIDEO_SECONDS)) return undefined;
  return {
    url: resolve('marketing-public', media.path),
    mediaType,
    imageSeconds: clampImageSeconds(r.imageSeconds),
    oncePerDay: r.oncePerDay === true,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
  };
}

/** Validação no navegador antes do envio (o servidor confere de novo). Devolve a mensagem ou null. */
export function presentationFileError(
  file: { name: string; type: string; size: number },
  durationSeconds?: number,
): string | null {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const imageMime: Record<string,string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const videoMime: Record<string,string> = { mp4: 'video/mp4', webm: 'video/webm' };
  const isImage = IMAGE_EXT.includes(ext) && file.type === imageMime[ext];
  const isVideo = VIDEO_EXT.includes(ext) && file.type === videoMime[ext];
  if (!isImage && !isVideo) return 'Formato não suportado. Use imagem JPG, PNG ou WEBP, ou vídeo MP4 ou WEBM.';
  if (isImage && file.size > PRESENTATION_MAX_IMAGE_BYTES) return 'A imagem passa de 3 MB. Envie uma versão mais leve.';
  if (isVideo && file.size > PRESENTATION_MAX_VIDEO_BYTES) return 'O vídeo passa de 15 MB. Envie uma versão mais leve.';
  if (isVideo) {
    if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return 'Não conseguimos ler a duração deste vídeo. Tente exportá-lo novamente em MP4.';
    }
    if (durationSeconds > PRESENTATION_MAX_VIDEO_SECONDS + 0.05) {
      return `Este vídeo tem ${Math.round(durationSeconds)} segundos. O limite é de 10 segundos — corte o vídeo e envie novamente.`;
    }
  }
  return null;
}

export type PresentationPlan =
  | { kind: 'IMAGE'; url: string; durationMs: number }
  | { kind: 'VIDEO'; url: string; maxMs: number }
  | { kind: 'STILL'; url: string; durationMs: number };

/** O que mostrar. Movimento reduzido nunca toca vídeo: mostra o primeiro quadro parado. Sem tela → tema. */
export function presentationPlan(p: StorePresentation | undefined | null, opts: { reducedMotion?: boolean } = {}): PresentationPlan | null {
  if (!p) return null;
  if (p?.mediaType === 'IMAGE') return { kind: 'IMAGE', url: p.url, durationMs: clampImageSeconds(p.imageSeconds) * 1000 };
  if (p?.mediaType === 'VIDEO') {
    return opts.reducedMotion
      ? { kind: 'STILL', url: p.url, durationMs: PRESENTATION_STILL_MS }
      : { kind: 'VIDEO', url: p.url, maxMs: PRESENTATION_MAX_VIDEO_SECONDS * 1000 };
  }
  return null;
}

/** URL aceitável para mídia da prévia (vinda do painel, mesma origem): https, blob: ou caminho relativo. */
export function isSafePresentationUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'blob:';
  } catch {
    return false;
  }
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

export function presentationKeys(slug: string) {
  return { session: `dc:presentation:${slug}`, day: `dc:presentation-day:${slug}` };
}

/** Dia local (AAAA-MM-DD) para a opção "uma vez por dia". */
export function localDay(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function safeGet(s: KV | null | undefined, k: string): string | null {
  try { return s ? s.getItem(k) : null; } catch { return null; }
}
function safeSet(s: KV | null | undefined, k: string, v: string): void {
  try { s?.setItem(k, v); } catch { /* modo privado/cota: segue sem lembrar */ }
}

/** Uma vez por abertura do app (sessionStorage por loja); opcionalmente uma vez por dia (localStorage). */
export function shouldShowPresentation(args: {
  slug: string; oncePerDay: boolean; session?: KV | null; local?: KV | null; now?: Date;
}): boolean {
  if (!args.slug) return false;
  const keys = presentationKeys(args.slug);
  if (safeGet(args.session, keys.session)) return false;
  if (args.oncePerDay && safeGet(args.local, keys.day) === localDay(args.now ?? new Date())) return false;
  return true;
}

export function markPresentationShown(args: { slug: string; session?: KV | null; local?: KV | null; now?: Date }): void {
  if (!args.slug) return;
  const keys = presentationKeys(args.slug);
  safeSet(args.session, keys.session, '1');
  safeSet(args.local, keys.day, localDay(args.now ?? new Date()));
}

export function prefersReducedMotion(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): boolean {
  try { return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}
