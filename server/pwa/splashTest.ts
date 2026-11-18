/**
 * EXPERIMENTO (só lojas de teste): ícone do launcher com a marca da loja e splash do Chrome (WebAPK)
 * com a logo do Delivery Channel em fundo #121212.
 *
 * Como o Chrome escolhe (Chromium, components/webapps):
 *  - Ícone do launcher (installable_icon_fetcher.cc): prefere purpose "maskable" com tamanho ideal
 *    = webapk_adaptive_icon_size (83dp); pega o MENOR ícone >= ideal (manifest_icon_selector.cc).
 *  - Splash (shortcut_info.cc, UpdateBestSplashIcon): TAMBÉM tenta "maskable" primeiro, ideal
 *    = webapp_splash_image_size_ideal (128dp); só cai para "any" se não houver maskable.
 *  Logo, "maskable = loja / any = Delivery Channel" faria a splash usar a logo da LOJA.
 *  Truque: dois maskable de tamanhos diferentes. Loja 332px (>= 83dp até densidade 4.0 e < 128dp
 *  a partir de ~2.6) e Delivery Channel 1024px. Launcher escolhe 332 (loja); splash escolhe 1024 (DC).
 *
 * Desligado por padrão (lista vazia). Ativado em produção só pela lista abaixo / env PWA_SPLASH_TEST_SLUGS.
 */
export const SPLASH_TEST_SLUGS_ENV = 'PWA_SPLASH_TEST_SLUGS';
/** Lojas de teste do experimento quando a env não está definida (nunca lojas reais). */
export const DEFAULT_SPLASH_TEST_SLUGS: readonly string[] = ['mercado-teste-dc'];
export const SPLASH_TEST_COLOR = '#121212';
/** Versão (?v=) do ícone do Delivery Channel na splash; troque se o arquivo da marca mudar. */
export const DC_SPLASH_ICON_VERSION = 'dc1';
/** Arquivo da marca Delivery Channel (o mesmo do manifesto global /manifest.json). */
export const DC_BRAND_SVG = 'icon-512.svg';

/** Env definida (mesmo vazia) substitui a lista padrão; valores separados por vírgula/espaço. */
export function resolveSplashTestSlugs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[SPLASH_TEST_SLUGS_ENV];
  if (raw === undefined) return [...DEFAULT_SPLASH_TEST_SLUGS];
  return raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}
