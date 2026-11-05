/**
 * YouTube no outdoor: só o id de 11 caracteres é extraído e guardado.
 * Nunca armazenamos nem renderizamos a URL colada pelo lojista.
 */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

export function isYouTubeId(value: unknown): value is string {
  return typeof value === 'string' && YOUTUBE_ID.test(value);
}

/** Aceita youtube.com/watch?v=, youtu.be/<id> e youtube.com/shorts/<id>. Devolve null para o resto. */
export function parseYouTubeId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 500 || /[\s<>"'`\\]/.test(raw)) return null;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host.endsWith('youtu.be')) {
    if (segments.length === 1) id = segments[0];
  } else if (segments.length === 1 && segments[0] === 'watch') {
    id = url.searchParams.get('v');
  } else if (segments.length === 2 && segments[0] === 'shorts') {
    id = segments[1];
  }
  return isYouTubeId(id) ? id : null;
}

/** Embed sem cookies, mudo e em loop; o id é revalidado aqui para nunca montar uma URL arbitrária. */
export function youTubeEmbedUrl(id: string): string {
  if (!isYouTubeId(id)) throw new Error('YOUTUBE_ID_INVALID');
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&playsinline=1`;
}

export function youTubeThumbnailUrl(id: string): string {
  if (!isYouTubeId(id)) throw new Error('YOUTUBE_ID_INVALID');
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
