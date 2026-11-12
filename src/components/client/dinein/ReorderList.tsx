import React from 'react';
import type { ReorderItem } from '../../../lib/customer/dineInReorder';

export function ReorderList({ items, onRepeat, disabled = false }: {
  items: ReorderItem[];
  onRepeat: (item: ReorderItem) => void;
  disabled?: boolean;
}) {
  if (!items.length) return null;
  return <section aria-label="Seus pedidos" className="dc-kiosk-reorder-list">
    <h2>Seus pedidos</h2>
    {items.map(item => <div key={item.id}>
      <span>
        {item.quantity}× {item.name}
        {!!item.optionLabels?.length && <small className="block">{item.optionLabels.join(', ')}</small>}
        {item.notes && <small className="block">{item.notes}</small>}
      </span>
      <button type="button" disabled={disabled} onClick={() => onRepeat(item)} aria-label={`Pedir de novo ${item.name}`}>
        Pedir de novo
      </button>
    </div>)}
  </section>;
}
