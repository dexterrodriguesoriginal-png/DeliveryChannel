import type { ThemeTokens } from '../../types/theme';
import { normalizeBarColor, systemBarsFromTokens } from '../pwa/systemBars';

/**
 * Cor da barra de ícones (abas do app). Sem cor própria salva (null/undefined/inválida), segue a cor da
 * barra de navegação da loja (que por padrão é a do cabeçalho). Cor escolhida pela loja é sempre respeitada.
 */
export function appTabBarColor(tokens: ThemeTokens): string {
  return normalizeBarColor(tokens.meta?.appTabBarColor) || systemBarsFromTokens(tokens).nav;
}

/** true quando a loja escolheu uma cor própria para a barra de ícones. */
export function hasCustomAppTabBarColor(tokens: ThemeTokens): boolean {
  return !!normalizeBarColor(tokens.meta?.appTabBarColor);
}
