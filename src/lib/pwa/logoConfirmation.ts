/**
 * "Logo definitiva" da loja: o convite "Instalar app" só aparece para os clientes depois que a loja confirma
 * a logo que vai ficar (o ícone do app instalado nasce com ela e o Android não troca ícone muito diferente).
 *
 * Guardado em theme_tokens.meta.logoConfirmedUrl (JSON já existente, sem migração):
 *  - ausente  = loja anterior a este recurso: a logo atual conta como confirmada (lojas no ar não mudam);
 *  - string   = URL da logo confirmada ('' = ainda não confirmou).
 */
type ThemeLike = { logoUrl?: string | null; tokens?: { meta?: { logoConfirmedUrl?: string | null } | null } | null } | null | undefined;

const clean = (u: unknown) => (typeof u === 'string' ? u.trim() : '');

/** URL da logo que a loja confirmou como definitiva ('' = nenhuma). */
export function confirmedLogoUrl(theme: ThemeLike): string {
  const meta = theme?.tokens?.meta;
  if (meta && typeof meta.logoConfirmedUrl === 'string') return clean(meta.logoConfirmedUrl);
  return clean(theme?.logoUrl);
}

/** Logo atual existe e é a confirmada: libera o convite de instalar o app. */
export function isLogoConfirmed(theme: ThemeLike): boolean {
  const logo = clean(theme?.logoUrl);
  return !!logo && confirmedLogoUrl(theme) === logo;
}

/**
 * Valor a gravar ao salvar o design. Confirmar é explícito (o painel grava a URL no rascunho); sem campo ainda
 * (loja antiga), grava a logo SALVA antes desta edição, para que trocar a logo peça nova confirmação.
 */
export function logoConfirmedUrlToSave(draft: ThemeLike, saved: ThemeLike): string {
  const meta = draft?.tokens?.meta;
  if (meta && typeof meta.logoConfirmedUrl === 'string') return clean(meta.logoConfirmedUrl);
  return confirmedLogoUrl(saved);
}

/** A loja trocou uma logo que já estava confirmada (quem instalou fica com o ícone antigo). */
export function logoChangedAfterConfirmation(draft: ThemeLike, saved: ThemeLike): boolean {
  const before = confirmedLogoUrl(saved);
  const now = clean(draft?.logoUrl);
  return !!before && !!now && now !== before;
}

/** No painel (rascunho ainda não salvo): a logo do rascunho é a que ficará confirmada ao salvar? */
export function isDraftLogoConfirmed(draft: ThemeLike, saved: ThemeLike): boolean {
  const logo = clean(draft?.logoUrl);
  return !!logo && logoConfirmedUrlToSave(draft, saved) === logo;
}
