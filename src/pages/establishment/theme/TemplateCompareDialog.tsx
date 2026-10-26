import React from 'react';
import { StoreTemplate } from '../../../types/theme';
import { TenantTheme } from '../../../types';
import { tokensToTheme } from '../../../lib/theme/themeEngine';
import { LiveStorePreview } from '../../../components/establishment/theme/LiveStorePreview';
import { ThemedProductItem } from '../../../components/storefront/ThemedProductList';
import { ThemeDialog } from './ThemeDialog';

export interface TemplateCompareDialogProps {
  templates: StoreTemplate[];
  storeSlug?: string;
  identity: TenantTheme;
  products?: ThemedProductItem[];
  isOpen?: boolean;
  isStoreOpen?: boolean;
  onClose: () => void;
  onApply: (template: StoreTemplate) => void;
}
export function TemplateCompareDialog({
  templates,
  storeSlug,
  identity,
  products,
  isOpen = true,
  isStoreOpen,
  onClose,
  onApply,
}: TemplateCompareDialogProps) {
  if (!isOpen || templates.length !== 2) return null;
  return (
    <ThemeDialog title="Compare na sua loja" onClose={onClose}>
      <p className="mb-5 text-sm text-slate-500">
        A mesma loja, dois jeitos de encantar seus clientes.
      </p>
      <div className="theme-compare-grid">
        {templates.map((template) => (
          <section key={template.id} className="min-w-0 space-y-4">
            <div>
              <h3 className="font-bold text-slate-900">{template.name}</h3>
              <p className="text-xs text-slate-500">
                {template.mode === 'dark' ? 'Escuro' : 'Claro'} · {template.segmentLabel}
              </p>
            </div>
            <LiveStorePreview
              theme={tokensToTheme(template.tokens, identity)}
              storeSlug={storeSlug}
              products={products}
              segmentId={template.segmentId}
              isOpen={isStoreOpen}
              compact
            />
            <button
              type="button"
              aria-label={`Usar este: ${template.name}`}
              onClick={() => onApply(template)}
              className="theme-primary w-full"
            >
              Usar este<span className="sr-only">: {template.name}</span>
            </button>
          </section>
        ))}
      </div>
    </ThemeDialog>
  );
}
