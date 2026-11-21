/**
 * Registro histórico da logo base para compatibilidade com dados já gravados.
 * A troca de logo atualiza o ícone do manifesto estável via ?v=, sem criar
 * uma nova identidade ou oferecer reinstalação no cliente canônico.
 * Os helpers permanecem disponíveis para o painel e testes legados.
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
