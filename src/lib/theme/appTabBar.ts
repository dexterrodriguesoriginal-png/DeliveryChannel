import type { ThemeTokens } from '../../types/theme';
import { normalizeBarColor, systemBarsFromTokens } from '../pwa/systemBars';

/** Legacy themes retain their published color; normalized themes store it independently. */
export function appTabBarColor(tokens: ThemeTokens): string {
  const color = tokens.meta?.appTabBarColor;
  if (color === undefined) return systemBarsFromTokens(tokens).nav;
  return normalizeBarColor(color) || systemBarsFromTokens({ palette: tokens.palette }).nav;
}
