/** Decide se a URL do logo é utilizável (vazia/esquema inválido => fallback de iniciais). */
export function isUsableLogoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const u = url.trim();
  return !!u && /^(https?:\/\/|data:image\/|blob:|\/)/i.test(u);
}
