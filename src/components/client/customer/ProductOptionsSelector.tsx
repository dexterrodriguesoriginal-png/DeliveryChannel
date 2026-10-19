import React from 'react';
import { Minus, Plus } from 'lucide-react';
import type { ProductOptionGroup, SelectedProductOption } from '../../../types';
import { formatBRL } from '../../../lib/pricing/money';
import { optionPriceCents, validateOptionSelection } from '../../../lib/addons';

function updateSelection(
  group: ProductOptionGroup,
  optionId: string,
  current: SelectedProductOption[],
  increment: number
): SelectedProductOption[] {
  const existing = current.find(item => item.groupId === group.id && item.optionId === optionId);
  if (!existing && increment < 0) return current;
  if (existing && !group.allowRepeat) {
    return current.filter(item => item !== existing);
  }
  const qty = (existing?.qty || 0) + increment;
  const next = current.filter(item => item !== existing);
  if (qty > 0) next.push({ groupId: group.id, optionId, qty });
  if (group.type === 'FLAVOR_SPLIT') {
    const flavors = next.filter(item => item.groupId === group.id);
    const fraction = flavors.length ? 1 / flavors.reduce((sum, item) => sum + item.qty, 0) : 1;
    for (const flavor of flavors) flavor.fraction = fraction;
  }
  return next;
}

export const ProductOptionsSelector: React.FC<{
  groups: ProductOptionGroup[];
  selections: SelectedProductOption[];
  onChange: (selections: SelectedProductOption[]) => void;
}> = ({ groups, selections, onChange }) => {
  const validation = validateOptionSelection(groups, selections);
  return (
    <section className="space-y-3" data-testid="product-option-groups">
      {groups.filter(group => group.active).map(group => {
        const selectedCount = selections.filter(item => item.groupId === group.id).reduce((sum, item) => sum + item.qty, 0);
        const requiredLabel = group.minSelect > 0
          ? `Escolha ${group.minSelect}${group.minSelect !== group.maxSelect ? ` (até ${group.maxSelect})` : ''}`
          : `Escolha até ${group.maxSelect}`;
        return (
          <div key={group.id} className="rounded-xl border border-gray-200 p-3" data-testid={`option-group-${group.id}`}>
            <div className="flex justify-between gap-2">
              <h4 className="text-sm font-bold text-gray-900">{group.name}</h4>
              <span className={`text-xs font-semibold ${selectedCount < group.minSelect ? 'text-rose-700' : 'text-gray-500'}`}>
                {requiredLabel}{group.minSelect > 0 ? ' · obrigatório' : ''}
              </span>
            </div>
            {group.type === 'FLAVOR_SPLIT' && (
              <p className="mt-1 text-xs text-gray-500">
                {group.pricingRule === 'HIGHEST' ? 'Preço do sabor mais caro' : `Média dos sabores (arredondada ao centavo)`}
              </p>
            )}
            <div className="mt-2 divide-y divide-gray-100">
              {group.options.map(option => {
                const chosen = selections.find(item => item.groupId === group.id && item.optionId === option.id);
                const isSoldOut = !option.active || option.soldOut;
                const atLimit = !chosen && selectedCount >= group.maxSelect;
                return (
                  <div key={option.id} className={`flex items-center justify-between gap-2 py-2 ${isSoldOut ? 'opacity-50' : ''}`}>
                    <span className="min-w-0 text-sm text-gray-800">
                      {option.name}
                      {option.extraPriceCents > 0 && <span className="ml-1 text-xs text-gray-500">+ {formatBRL(option.extraPriceCents / 100)}</span>}
                      {isSoldOut && <span className="ml-2 text-xs font-bold text-rose-700">Esgotado</span>}
                    </span>
                    {!isSoldOut && group.allowRepeat && chosen ? (
                      <span className="flex items-center gap-2">
                        <button type="button" aria-label={`Diminuir ${option.name}`} onClick={() => onChange(updateSelection(group, option.id, selections, -1))}><Minus className="h-4 w-4" /></button>
                        <b className="text-sm">{chosen.qty}</b>
                        <button type="button" aria-label={`Aumentar ${option.name}`} disabled={selectedCount >= group.maxSelect} onClick={() => onChange(updateSelection(group, option.id, selections, 1))}><Plus className="h-4 w-4" /></button>
                      </span>
                    ) : (
                      <button type="button" disabled={isSoldOut || (atLimit && !chosen)}
                        aria-pressed={Boolean(chosen)}
                        onClick={() => onChange(updateSelection(group, option.id, selections, chosen ? -1 : 1))}
                        className={`h-7 min-w-16 rounded-lg px-2 text-xs font-bold ${chosen ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-700'} disabled:cursor-not-allowed disabled:opacity-50`}>
                        {chosen ? 'Selecionado' : 'Escolher'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {validation.messages.length > 0 && <p className="text-xs font-semibold text-rose-700">{validation.messages[0]}</p>}
      <p className="text-right text-sm font-bold text-gray-900" data-testid="options-running-price">
        Adicionais: {formatBRL(optionPriceCents(groups, selections) / 100)}
      </p>
    </section>
  );
};
