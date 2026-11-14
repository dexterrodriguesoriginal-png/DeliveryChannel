import type { TotemDesign, TotemColorKey } from '../menu/totemDesign';
import { menuThemeContrast } from './menuTheme';
export function totemContrastIssues(design: TotemDesign): string[] {
  const pairs: [TotemColorKey, TotemColorKey][] = [
    ['sidebarCardText', 'sidebarCardBg'], ['sidebarCardActiveText', 'sidebarCardActiveBg'],
    ['productCardText', 'productCardBg'], ['productPrice', 'productCardBg'],
    ['addButtonText', 'addButtonBg'], ['orderPanelText', 'orderPanelBg'], ['checkoutButtonText', 'checkoutButtonBg'],
  ];
  return pairs.filter(([fg, bg]) => menuThemeContrast(design.colors[fg], design.colors[bg]) < 4.5).map(([fg]) => fg);
}
