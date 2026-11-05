import { ArrowRight, Plus, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import type { MenuTheme } from '../../../../types/menuTheme';
import { resolveFontFamilyCss, safeImageUrl } from '../../../../lib/theme/themeEngine';
import type { ThemedProductItem } from '../../../../components/storefront/ThemedProductList';

interface Props {
  theme: MenuTheme;
  storeName: string;
  products: ThemedProductItem[];
  categories: string[];
  device: 'phone' | 'tablet';
}

/** Prévia isolada do editor; o componente de atendimento tem seu próprio contrato. */
export function MenuThemePreview({ theme, storeName, products, categories, device }: Props) {
  return (
    <div className={`menu-design-device menu-design-device-${device}`}>
      <div className="menu-design-device-camera" aria-hidden="true" />
      <div className="menu-design-preview" data-testid="menu-design-preview" data-device={device} data-layout={theme.layout}
        style={{ background: theme.background, color: theme.text, fontFamily: resolveFontFamilyCss(theme.fontFamily), '--menu-preview-radius': `${theme.radius}px` } as React.CSSProperties}>
        <div className="menu-design-preview-heading" style={{ background: theme.surface }}>
          <span className="menu-design-preview-logo" style={{ background: theme.accent, color: theme.accentText }}><UtensilsCrossed size={18} /></span>
          <div><small>FEITO PARA VOCÊ</small><strong>{storeName}</strong></div>
          <ShoppingBag size={19} aria-hidden="true" />
        </div>
        <div className="menu-design-preview-hero" style={{ background: theme.accent, color: theme.accentText }}>
          <div><small>SEU PRÓXIMO FAVORITO</small><h3>Hoje pede<br />algo especial.</h3><span>Escolha, descubra e aproveite <ArrowRight size={13} /></span></div>
          <div className="menu-design-preview-dish" aria-hidden="true"><UtensilsCrossed size={42} strokeWidth={1.2} /></div>
        </div>
        <div className="menu-design-preview-content">
          <div className="menu-design-preview-categories" aria-hidden="true">
            {(categories.length ? categories : ['Destaques', 'Lanches', 'Bebidas']).slice(0, 4).map((name, i) => <span key={`${name}-${i}`} style={{ background: i === 0 ? theme.categoryActiveBg : theme.surface, color: i === 0 ? theme.accentText : theme.text }}>{name}</span>)}
          </div>
          <div className="menu-design-preview-catalog"><h4>Para abrir o apetite</h4>
            <div className="menu-design-preview-products">{products.slice(0, device === 'tablet' ? 4 : 2).map(product => <article key={product.id} style={{ background: theme.surface }}>
              <div className="menu-design-preview-photo">{safeImageUrl(product.imageUrl) ? <img src={safeImageUrl(product.imageUrl)!} alt="" loading="lazy" /> : <UtensilsCrossed size={32} aria-hidden="true" />}</div>
              <div className="menu-design-preview-product-copy"><h5>{product.name}</h5><p>{product.description || 'Preparado com carinho para você.'}</p><div><strong>{typeof product.price === 'number' ? product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : product.price}</strong><span style={{ background: theme.accent, color: theme.accentText }}><Plus size={15} /></span></div></div>
            </article>)}</div>
          </div>
        </div>
        <div className="menu-design-preview-bag" style={{ background: theme.accent, color: theme.accentText }}><ShoppingBag size={15} /> Sua sacola <ArrowRight size={15} /></div>
      </div>
    </div>
  );
}
