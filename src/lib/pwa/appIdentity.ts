/**
 * Compatibilidade com WebAPKs já instalados em /app/<slug>~<hash10>/.
 * O app estável permanece intacto; após mudança de logo/barra, versões novas
 * têm id e escopo próprios. Os helpers também preservam installs legados.
 */
export const APP_IDENTITY_SEP = '~';
export const APP_IDENTITY_RE = /^[0-9a-f]{10}$/;
export const APP_IDENTITY_META = 'dc-app-identity';
export const REINSTALL_PARAM = 'reinstall';
export const CHROME_PACKAGE = 'com.android.chrome';

/** "slug~0123456789" → { slug, identity }; sem versão válida → identity null (segmento inteiro como slug). */
export function splitStoreSegment(segment: string): { slug: string; identity: string | null } {
  const i = segment.lastIndexOf(APP_IDENTITY_SEP);
  if (i > 0) {
    const identity = segment.slice(i + 1);
    if (APP_IDENTITY_RE.test(identity)) return { slug: segment.slice(0, i), identity };
  }
  return { slug: segment, identity: null };
}

/** Segmento /app/<segmento>/ da URL atual (decodificado) ou null. */
export function storeSegmentFromPath(pathname: string): string | null {
  const m = /^\/app\/([^/]+)/.exec(pathname || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** Slug da loja a partir do caminho, ignorando a versão de identidade. */
export function storeSlugFromAppPath(pathname: string): string {
  const seg = storeSegmentFromPath(pathname);
  return seg ? splitStoreSegment(seg).slug : '';
}

export const versionedStoreScope = (slug: string, identity: string) => `/app/${encodeURIComponent(slug)}${APP_IDENTITY_SEP}${identity}/`;
export const versionedStartUrl = (slug: string, identity: string) => `${versionedStoreScope(slug, identity)}?source=pwa`;
export const versionedManifestPath = (slug: string, identity: string) => `${versionedStoreScope(slug, identity)}manifest.webmanifest`;
export const versionedAppId = (tenantId: string, identity: string) => `/app-id/${encodeURIComponent(tenantId)}/${identity}`;

/** Versão mais nova já aberta pelo ícone neste aparelho (armazenamento do Chrome é comum a todos os apps da origem). */
export const newestLaunchedKey = (slug: string) => `dc:app-identity:${slug}`;

export type IdentityStatus =
  /** Aberto pelo ícone da versão atual (ou no navegador comum sem pedido de reinstalação). */
  | 'current'
  /** Ícone antigo e a versão nova ainda não foi aberta neste aparelho: oferecer "Atualizar". */
  | 'update-available'
  /** Ícone antigo e a versão nova já foi aberta aqui: orientar a abrir o novo e remover este. */
  | 'old-icon'
  /** Navegador comum vindo do botão "Atualizar": mostrar a instalação. */
  | 'reinstall';

export function identityStatus(o: {
  standalone: boolean; runningIdentity: string | null; currentIdentity: string; newestLaunched: string | null; reinstallRequested: boolean;
}): IdentityStatus {
  // Página de instalação (?reinstall=1): sempre a tela de instalar, mesmo se o Chrome a abrir dentro da janela
  // do app antigo (lá ela "parece" instalada pelo display-mode, mas não é).
  if (o.reinstallRequested) return 'reinstall';
  if (!o.standalone) return 'current';
  if (o.runningIdentity === o.currentIdentity) return 'current';
  return o.newestLaunched === o.currentIdentity ? 'old-icon' : 'update-available';
}

/** URL https da versão atual (no navegador), com o pedido de reinstalação. */
export function reinstallUrl(origin: string, slug: string, identity: string): string {
  return `${origin.replace(/\/$/, '')}${versionedStoreScope(slug, identity)}?${REINSTALL_PARAM}=1`;
}

/**
 * Abre a URL no Chrome (aba comum, onde o convite de instalação aparece), não dentro do app antigo.
 * Android: intent:// com package do Chrome e fallback https. Outros: a própria URL.
 */
export function chromeIntentUrl(url: string, opts: { android: boolean; package?: string | null } = { android: true }): string {
  if (!opts.android) return url;
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.protocol !== 'https:') return url;
  const pkg = opts.package === undefined ? CHROME_PACKAGE : opts.package;
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;${pkg ? `package=${pkg};` : ''}launchFlags=0x10000000;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** Link do manifesto injetado pelo servidor pertence a esta loja (base ou versão de identidade)? */
export function isOwnManifestHref(href: string, slug: string): boolean {
  const path = (href || '').split('?')[0];
  const enc = encodeURIComponent(slug);
  if (path === `/app/${enc}/manifest.webmanifest`) return true;
  const m = new RegExp(`^/app/${enc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${APP_IDENTITY_SEP}([0-9a-f]{10})/manifest\\.webmanifest$`).exec(path);
  return !!m;
}
