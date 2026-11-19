/**
 * "Baixar versão atualizada" para TODAS as lojas, sem mexer em quem já instalou.
 *
 * theme_tokens.meta.appBaseLogoUrl (JSON existente, sem migração) = logo com que o app SEM versão
 * (/app/<slug>/, o que já está instalado hoje) foi instalado. O painel grava isso só na PRIMEIRA troca de logo.
 *  - ausente: a loja nunca trocou a logo depois deste recurso → nada muda (manifesto, HTML e /api/pwa/version
 *    idênticos aos de antes);
 *  - igual à logo atual: idem (voltou para a logo original);
 *  - diferente: a loja passa a ter app versionado (/app/<slug>~<versão>/) e quem tem o app antigo vê o botão.
 */
const clean = (u: unknown) => (typeof u === 'string' ? u.trim() : '');

export interface AppBaseLogoInput { appBaseLogoUrl?: string; logoConfirmedUrl?: string; theme?: { logoUrl?: string } }

/** A loja já entrou no fluxo (aceita endereços /app/<slug>~<versão>/). */
export function hasAppBaseLogo(store: AppBaseLogoInput | null | undefined): boolean {
  return typeof store?.appBaseLogoUrl === 'string';
}

/** A logo atual é diferente da do app sem versão: oferecer a versão atualizada. */
export function logoChangedSinceBaseApp(store: AppBaseLogoInput | null | undefined): boolean {
  return hasAppBaseLogo(store) && clean(store!.appBaseLogoUrl) !== clean(store!.theme?.logoUrl);
}

/**
 * Oferecer "Baixar versão atualizada": logo trocada E confirmada como definitiva (mesma regra do "Instalar app";
 * logoConfirmedUrl ausente = loja antiga, a logo atual vale).
 */
export function offerUpdatedApp(store: AppBaseLogoInput | null | undefined): boolean {
  if (!logoChangedSinceBaseApp(store)) return false;
  const logo = clean(store!.theme?.logoUrl);
  if (!logo) return false;
  return typeof store!.logoConfirmedUrl === 'string' ? clean(store!.logoConfirmedUrl) === logo : true;
}

/**
 * Valor a gravar ao salvar o design: mantém o que já existe; na primeira troca de logo grava a logo SALVA
 * antes (a do app instalado); sem troca, continua ausente (undefined).
 */
export function appBaseLogoUrlToSave(existing: unknown, savedLogo: unknown, newLogo: unknown): string | undefined {
  if (typeof existing === 'string') return existing;
  return clean(newLogo) !== clean(savedLogo) ? clean(savedLogo) : undefined;
}
