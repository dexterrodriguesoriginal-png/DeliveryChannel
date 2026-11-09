import React from 'react';
import { ChevronRight, Minus, Plus, ShoppingCart } from 'lucide-react';
import { formatMenuMoney } from '../../../lib/menu/premiumTotem.model';

export interface TotemOrderLine {
  key: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  detail?: string;
}

export interface TotemOrderPanelProps {
  lines: TotemOrderLine[];
  subtotalCents: number;
  onChangeQuantity(key: string, delta: number): void;
  onCheckout(): void;
  checkoutDisabled?: boolean;
}

export function TotemOrderPanel({
  lines,
  subtotalCents,
  onChangeQuantity,
  onCheckout,
  checkoutDisabled = false,
}: TotemOrderPanelProps) {
  const empty = lines.length === 0;
  return (
    <aside
      className="dc-kiosk-order-panel"
      data-testid="totem-order-panel"
      aria-label="Seu pedido"
    >
      <div className="dc-kiosk-order-left">
        <div className="dc-kiosk-order-head">
          <h2 className="dc-kiosk-order-title">
            <ShoppingCart aria-hidden={true} />
            <span>Seu pedido</span>
          </h2>
          <p className="dc-kiosk-order-chip" data-testid="totem-counter-chip">Pague e retire no balcão</p>
        </div>
        <ul className="dc-kiosk-order-lines" data-testid="totem-order-lines">
          {empty ? (
            <li className="dc-kiosk-order-empty" data-testid="totem-order-empty">Nenhum item ainda. Escolha no cardápio.</li>
          ) : lines.map(line => (
            <li key={line.key} className="dc-kiosk-order-line" data-testid={`totem-order-line-${line.key}`}>
              <div className="dc-kiosk-order-line-copy">
                <strong>{line.quantity}x {line.name}</strong>
                {line.detail ? <span className="dc-kiosk-order-line-detail">{line.detail}</span> : null}
              </div>
              <strong className="dc-kiosk-order-line-price">
                {formatMenuMoney(line.unitPriceCents * line.quantity)}
              </strong>
              <div className="dc-kiosk-order-qty">
                <button
                  type="button"
                  aria-label={`Diminuir ${line.name}`}
                  onClick={() => onChangeQuantity(line.key, -1)}
                  data-testid={`totem-qty-dec-${line.key}`}
                >
                  <Minus size={18} aria-hidden={true} />
                </button>
                <span aria-label={`Quantidade de ${line.name}`}>{line.quantity}</span>
                <button
                  type="button"
                  aria-label={`Aumentar ${line.name}`}
                  onClick={() => onChangeQuantity(line.key, 1)}
                  data-testid={`totem-qty-inc-${line.key}`}
                >
                  <Plus size={18} aria-hidden={true} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="dc-kiosk-order-right">
        <div className="dc-kiosk-order-subtotal">
          <span>Subtotal</span>
          <strong data-testid="totem-order-subtotal">{formatMenuMoney(subtotalCents)}</strong>
        </div>
        <button
          type="button"
          className="dc-kiosk-order-checkout"
          data-testid="totem-order-checkout"
          disabled={checkoutDisabled || empty}
          onClick={onCheckout}
        >
          <span>Finalizar pedido</span>
          <ChevronRight aria-hidden={true} />
        </button>
      </div>
    </aside>
  );
}

export default TotemOrderPanel;
