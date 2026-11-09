/** Link, arquivo e janela de impressão do QR de acesso ao totem do salão. Sem rede. */

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function normalizeTotemSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/** Origem atual + /totem/<slug>. String vazia se o slug ou a origem forem inválidos. */
export function totemPublicUrl(origin: string, slug: string): string {
  const cleanSlug = normalizeTotemSlug(slug);
  const base = origin.trim().replace(/\/+$/, '');
  if (!cleanSlug || !SLUG.test(cleanSlug)) return '';
  if (!/^https?:\/\/[^/]+$/i.test(base) && !/^https?:\/\/[^/]+/i.test(base)) return '';
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.origin}/totem/${encodeURIComponent(cleanSlug)}`;
  } catch {
    return '';
  }
}

/** Link de instalação: a capa do totem abre com o convite nativo. */
export function totemInstallUrl(origin: string, slug: string): string {
  const base = totemPublicUrl(origin, slug);
  return base ? `${base}/?install=1` : '';
}

export function totemQrFileName(slug: string): string {
  const clean = normalizeTotemSlug(slug);
  return SLUG.test(clean) ? `totem-${clean}.png` : 'totem.png';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Abre uma janela só com o QR e o link, e dispara a impressão. Retorna false se o popup for bloqueado. */
export function printTotemQr(svg: SVGElement, opts: { url: string; storeName: string }): boolean {
  if (typeof window === 'undefined') return false;
  const popup = window.open('', '_blank', 'noopener,width=640,height=840');
  if (!popup) return false;
  const dataUrl = svg instanceof SVGElement
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString((() => {
        const clone = svg.cloneNode(true) as SVGElement;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return clone;
      })()))}`
    : '';
  const title = escapeHtml((opts.storeName || 'Totem do salão').slice(0, 80));
  const url = escapeHtml(opts.url);
  popup.document.open();
  popup.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>QR do totem — ${title}</title>
  <style>
    @page { margin: 16mm; }
    body { font-family: system-ui, sans-serif; text-align: center; color: #0f172a; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { font-size: 14px; word-break: break-all; color: #334155; }
    img { width: 360px; height: 360px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Totem do salão</p>
  <img src="${dataUrl}" alt="QR do totem" width="360" height="360" />
  <p>${url}</p>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`);
  popup.document.close();
  return true;
}
