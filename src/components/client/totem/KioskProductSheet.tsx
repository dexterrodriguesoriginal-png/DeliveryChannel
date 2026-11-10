import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, ShoppingCart, UtensilsCrossed, X } from 'lucide-react';
import type { Product, SelectedProductOption } from '../../../types';
import { optionPriceCents, validateOptionSelection } from '../../../lib/addons';
import { productToPricingLine } from '../../../lib/pricing/fulfillmentPricing';
import { formatMenuMoney, safeMenuImageUrl } from '../../../lib/menu/premiumTotem.model';
import { ProductOptionsSelector } from '../customer/ProductOptionsSelector';
import './kioskProductSheet.css';

export type KioskProductSheetLayout = 'modal' | 'sheet';

export type KioskProductSheetColors = {
  surface: string;
  text: string;
  accent: string;
  accentText: string;
};

type KioskProductSheetProps = {
  product: Product;
  layout: KioskProductSheetLayout;
  colors: KioskProductSheetColors;
  confirmLabel?: string;
  closeLabel?: string;
  disabled?: boolean;
  onClose: () => void;
  onConfirm: (quantity: number, options: SelectedProductOption[]) => void;
};

export function KioskProductSheet({
  product,
  layout,
  colors,
  confirmLabel = 'Adicionar',
  closeLabel = 'Fechar',
  disabled = false,
  onClose,
  onConfirm,
}: KioskProductSheetProps) {
  const [quantity, setQuantity] = useState(1);
  const [options, setOptions] = useState<SelectedProductOption[]>([]);

  useEffect(() => {
    setQuantity(1);
    setOptions([]);
  }, [product.id]);

  const groups = product.optionGroups?.filter(group => group.active) || [];
  const validation = validateOptionSelection(groups, options);
  const canConfirm = !disabled && (groups.length === 0 || validation.valid);

  const unitCents = useMemo(() => {
    const base = Math.round(productToPricingLine(product, 1).unitPrice * 100);
    return base + optionPriceCents(product.optionGroups || [], options);
  }, [options, product]);

  const originalUnitCents = useMemo(() => {
    const raw = Math.round(Number(product.price) * 100);
    return Number.isFinite(raw) ? raw : unitCents;
  }, [product.price, unitCents]);

  const hasPromo = originalUnitCents > unitCents;
  const photoUrl = safeMenuImageUrl(product.imageUrl);
  const title = groups.length ? `Personalizar ${product.name}` : product.name;
  const ariaLabel = groups.length ? `Personalizar ${product.name}` : `Detalhes de ${product.name}`;

  function bump(delta: number) {
    setQuantity(current => Math.min(99, Math.max(1, current + delta)));
  }

  return (
    <div
      className="dc-kiosk-product-sheet-backdrop"
      data-layout={layout}
      data-testid="kiosk-product-sheet-backdrop"
      role="presentation"
      style={{
        ['--dc-sheet-surface' as string]: colors.surface,
        ['--dc-sheet-text' as string]: colors.text,
        ['--dc-sheet-accent' as string]: colors.accent,
        ['--dc-sheet-accent-text' as string]: colors.accentText,
      }}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="dc-kiosk-product-sheet"
        data-testid="kiosk-product-sheet"
        data-layout={layout}
      >
        <header className="dc-kiosk-product-sheet-header">
          <h2 className="dc-kiosk-product-sheet-name" data-testid="kiosk-product-sheet-name">
            {title}
          </h2>
          <button
            type="button"
            className="dc-kiosk-product-sheet-close"
            data-testid="kiosk-product-sheet-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="dc-kiosk-product-sheet-photo">
          {photoUrl ? (
            <img src={photoUrl} alt={product.name} />
          ) : (
            <div className="dc-kiosk-product-sheet-photo-fallback" aria-hidden="true">
              <UtensilsCrossed />
            </div>
          )}
        </div>

        {product.description ? (
          <p className="dc-kiosk-product-sheet-description" data-testid="kiosk-product-sheet-description">
            {product.description}
          </p>
        ) : null}

        {groups.length > 0 && (
          <ProductOptionsSelector
            groups={product.optionGroups || []}
            selections={options}
            onChange={setOptions}
          />
        )}

        <div className="dc-kiosk-product-sheet-pricing">
          {hasPromo && (
            <span className="dc-kiosk-product-sheet-original" data-testid="kiosk-product-sheet-original">
              {formatMenuMoney(originalUnitCents)}
            </span>
          )}
          <strong className="dc-kiosk-product-sheet-price" data-testid="kiosk-product-sheet-price">
            {formatMenuMoney(unitCents * quantity)}
          </strong>
        </div>

        <div className="dc-kiosk-product-sheet-qty" data-testid="kiosk-product-sheet-qty">
          <button
            type="button"
            className="dc-kiosk-product-sheet-qty-btn"
            data-testid="kiosk-product-sheet-qty-dec"
            aria-label="Diminuir quantidade"
            onClick={() => bump(-1)}
            disabled={quantity <= 1}
          >
            <Minus aria-hidden="true" />
          </button>
          <span className="dc-kiosk-product-sheet-qty-value" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            className="dc-kiosk-product-sheet-qty-btn"
            data-testid="kiosk-product-sheet-qty-inc"
            aria-label="Aumentar quantidade"
            onClick={() => bump(1)}
            disabled={quantity >= 99}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          className="dc-kiosk-product-sheet-add"
          data-testid="kiosk-product-sheet-add"
          disabled={!canConfirm}
          onClick={() => {
            if (!canConfirm) return;
            onConfirm(quantity, options);
          }}
        >
          <ShoppingCart aria-hidden="true" />
          <span>{confirmLabel}</span>
        </button>
      </section>
    </div>
  );
}

export default KioskProductSheet;
