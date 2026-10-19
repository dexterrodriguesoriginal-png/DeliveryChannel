import type { ProductOptionGroup, SelectedProductOption } from '../types';

export interface OptionSelectionValidation {
  valid: boolean;
  messages: string[];
}

export function validateOptionSelection(
  groups: readonly ProductOptionGroup[],
  selections: readonly SelectedProductOption[]
): OptionSelectionValidation {
  const messages: string[] = [];
  for (const group of groups.filter(item => item.active)) {
    const selected = selections.filter(item => item.groupId === group.id);
    const count = selected.reduce((sum, item) => sum + item.qty, 0);
    if (count < group.minSelect) {
      messages.push(`Escolha ${group.minSelect} em ${group.name}.`);
    }
    if (count > group.maxSelect) {
      messages.push(`Escolha até ${group.maxSelect} em ${group.name}.`);
    }
  }
  return { valid: messages.length === 0, messages };
}

export function optionPriceCents(
  groups: readonly ProductOptionGroup[],
  selections: readonly SelectedProductOption[]
): number {
  return groups.reduce((total, group) => {
    const selected = selections.filter(item => item.groupId === group.id);
    const prices = selected.flatMap(item => {
      const option = group.options.find(candidate => candidate.id === item.optionId);
      return option ? Array.from({ length: item.qty }, () => option.extraPriceCents) : [];
    });
    if (group.type === 'FLAVOR_SPLIT' && group.pricingRule === 'HIGHEST') {
      return total + (prices.length ? Math.max(...prices) : 0);
    }
    if (group.type === 'FLAVOR_SPLIT' && group.pricingRule === 'AVERAGE') {
      return total + (prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : 0);
    }
    return total + prices.reduce((sum, price) => sum + price, 0);
  }, 0);
}
