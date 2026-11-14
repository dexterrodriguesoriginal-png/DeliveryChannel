import type { ThemePalette, ThemeTokens } from '../../types/theme';
import { contrastRatio } from './themeEngine';
import { ensureContrast } from './templates/palettes';
export interface ContrastGuidance { foreground: keyof ThemePalette; background: keyof ThemePalette; label: string; ratio: number; minimum: number; suggestion: string }
export function themeContrastGuidance(tokens: ThemeTokens): ContrastGuidance[] {
  const p = tokens.palette;
  const pairs: [keyof ThemePalette, keyof ThemePalette, string, number][] = [
    ['textTitle', 'bgHeader', 'Nome da loja / cabeçalho', 4.5],
    ['textTitle', 'bgGeneral', 'Títulos / fundo geral', 4.5],
    ['textTitle', 'bgCard', 'Títulos / cartões', 4.5],
    ['textMain', 'bgCard', 'Descrições / cartões', 4.5],
    ['textMain', 'bgGeneral', 'Texto / fundo geral', 4.5],
    ['textSecondary', 'bgGeneral', 'Texto auxiliar / fundo geral', 4.5],
    ['textSecondary', 'bgHeader', 'Texto auxiliar / cabeçalho', 4.5],
    ['textSecondary', 'bgCard', 'Texto auxiliar / cartões', 4.5],
    ['textSecondary', 'bgMenu', 'Legendas / menu', 4.5],
    ['buttonText', 'buttonBg', 'Texto / botão', 4.5],
    ['textTitle', 'categoryBg', 'Texto / categoria selecionada', 4.5],
    ['price', 'bgCard', 'Preço / cartão', 4.5],
    ['promoPrice', 'bgCard', 'Preço promocional / cartão', 4.5],
    ['iconColor', 'bgMenu', 'Ícones / menu', 3],
  ];
  const issues: ContrastGuidance[] = pairs.map(([foreground, background, label, minimum]) => ({ foreground, background, label, minimum,
    ratio: contrastRatio(p[foreground], p[background]), suggestion: (['lighter', 'darker'] as const).map(direction => ensureContrast(p[foreground], p[background], minimum, direction)).find(color => contrastRatio(color, p[background]) >= minimum) || p[foreground],
  })).filter(issue => issue.ratio < issue.minimum);
  for (const surface of ['general', 'header', 'card'] as const) {
    const config = tokens.backgrounds[surface];
    if (!config.type.startsWith('gradient')) continue;
    const background = surface === 'general' ? 'bgGeneral' : surface === 'header' ? 'bgHeader' : 'bgCard';
    for (const [index, color] of (config.gradientColors || []).entries()) {
      for (const foreground of ['textTitle', 'textMain', 'textSecondary'] as const) {
        const ratio = contrastRatio(p[foreground], color);
        if (ratio >= 4.5) continue;
        const suggestion = (['lighter', 'darker'] as const).map(direction => ensureContrast(p[foreground], color, 4.5, direction)).find(ink => contrastRatio(ink, color) >= 4.5) || p[foreground];
        issues.push({ foreground, background, label: `${foreground === 'textTitle' ? 'Título' : foreground === 'textMain' ? 'Texto' : 'Texto auxiliar'} / gradiente ${surface === 'general' ? 'geral' : surface === 'header' ? 'do cabeçalho' : 'dos cartões'} (cor ${index + 1})`, ratio, minimum: 4.5, suggestion });
      }
    }
  }
  return issues;
}

/** Selects ink from the owner's existing palette, without injecting a fixed color. */
export function paletteInkFor(tokens: ThemeTokens, background: string): string {
  return [tokens.palette.buttonText, tokens.palette.textTitle, tokens.palette.textMain, tokens.palette.bgGeneral]
    .reduce((best, color) => contrastRatio(color, background) > contrastRatio(best, background) ? color : best);
}

/** Keep the owner's ink when readable; otherwise derive an accessible shade from their palette. */
export function readablePaletteInkFor(tokens: ThemeTokens, background: string, preferred: string): string {
  if (contrastRatio(preferred, background) >= 4.5) return preferred;
  const ink = paletteInkFor(tokens, background);
  return (['lighter', 'darker'] as const)
    .map(direction => ensureContrast(ink, background, 4.5, direction))
    .find(candidate => contrastRatio(candidate, background) >= 4.5) || ink;
}
