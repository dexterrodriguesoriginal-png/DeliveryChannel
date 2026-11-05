import React, { type CSSProperties } from 'react';
import {
  ArrowRight,
  BellRing,
  Bike,
  BookOpen,
  CircleUserRound,
  PackageCheck,
  ReceiptText,
  Store,
  UtensilsCrossed,
} from 'lucide-react';
import {
  getHomeTemplate,
  normalizeHomeDesign,
  safeHomeImageUrl,
  type HomeAction,
  type StoreHomeDesign,
} from '../../../lib/storeHome/storeHome.model';
import { visibleHomeActions, type HomeVisibilityContext } from '../../../lib/storeHome/storeHomeVisibility';
import './storeHome.css';

export interface StoreHomeScreenProps {
  design: StoreHomeDesign;
  storeName: string;
  logoUrl?: string | null;
  tableName?: string;
  preview?: boolean;
  /** Rótulo do bloco Cardápio (Entrega 2). */
  menuLabel?: string;
  /** Link do app da loja (PWA / vitrine). */
  storeAppHref?: string;
  onStoreAppClick?: React.MouseEventHandler<HTMLAnchorElement>;
  visibility?: HomeVisibilityContext;
  available?: Partial<Record<HomeAction, boolean>>;
  onAction?: (action: HomeAction) => void;
}

const ACTION_META: Record<HomeAction, {
  label: string;
  subtitle: string;
  accent: string;
  Icon: typeof BookOpen;
}> = {
  MENU: {
    label: 'Ver Cardápio',
    subtitle: 'Descubra os sabores da casa',
    accent: '#22c55e',
    Icon: BookOpen,
  },
  TABLE: {
    label: 'Estou na Mesa',
    subtitle: 'Informe o número da sua mesa',
    accent: '#f59e0b',
    Icon: UtensilsCrossed,
  },
  PICKUP: {
    label: 'Pedir para Retirar',
    subtitle: 'Faça seu pedido e retire no balcão',
    accent: '#ef4444',
    Icon: PackageCheck,
  },
  DELIVERY: {
    label: 'Pedir Delivery',
    subtitle: 'Receba no conforto da sua casa',
    accent: '#a855f7',
    Icon: Bike,
  },
  ACCOUNT: {
    label: 'Minha Conta',
    subtitle: 'Acompanhe pedidos, histórico e favoritos',
    accent: '#3b82f6',
    Icon: CircleUserRound,
  },
  WAITER: {
    label: 'Chamar Garçom',
    subtitle: 'Precisa de atendimento? Chame nossa equipe.',
    accent: '#06b6d4',
    Icon: BellRing,
  },
  BILL: {
    label: 'Pedir a Conta',
    subtitle: 'Solicite o fechamento da mesa',
    accent: '#84cc16',
    Icon: ReceiptText,
  },
};

function escUrl(url: string): string {
  return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function StoreHomeScreen({
  design: rawDesign,
  storeName,
  logoUrl,
  tableName,
  preview = false,
  menuLabel,
  storeAppHref,
  onStoreAppClick,
  visibility,
  available = {},
  onAction,
}: StoreHomeScreenProps) {
  const design = normalizeHomeDesign(rawDesign);
  const template = getHomeTemplate(design.templateId);
  const logo = safeHomeImageUrl(logoUrl);
  const fullBg = design.backgroundMode === 'full' ? safeHomeImageUrl(design.backgroundUrl) : '';
  const topBanner = safeHomeImageUrl(design.topBannerUrl);
  const bottomBanner = safeHomeImageUrl(design.bottomBannerUrl);

  const actions = (visibility
    ? visibleHomeActions(design, visibility)
    : design.actions
  ).filter(action => action in ACTION_META);

  const rootStyle: CSSProperties = {
    ['--dc-home-overlay' as string]: String(design.overlayOpacity),
    ['--dc-home-blur' as string]: `${design.backgroundBlur}px`,
    ['--dc-home-pos-y' as string]: `${design.backgroundPositionY}%`,
    backgroundImage: fullBg
      ? undefined
      : template.topGradient,
  };

  return (
    <section
      className={['dc-store-home', preview ? 'dc-store-home--preview' : ''].filter(Boolean).join(' ')}
      style={rootStyle}
      data-testid="dinein-home"
      data-studio="dc-store-home"
      aria-label={`Início de ${storeName}`}
    >
      {fullBg && (
        <div
          className="dc-store-home__bg"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${escUrl(fullBg)}")`,
          }}
        />
      )}
      <div className="dc-store-home__veil" aria-hidden="true" />

      <div className="dc-store-home__content">
        <header
          className="dc-store-home__hero"
          style={topBanner ? {
            backgroundImage: `linear-gradient(rgba(0,0,0,${design.overlayOpacity}), rgba(0,0,0,${design.overlayOpacity})), url("${escUrl(topBanner)}")`,
            backgroundSize: 'cover',
            backgroundPosition: `center ${design.backgroundPositionY}%`,
          } : undefined}
        >
          <div className={[
            'dc-store-home__identity',
            design.logoPosition === 'left' ? 'dc-store-home__identity--left' : '',
          ].filter(Boolean).join(' ')}>
            {logo ? (
              <img
                className="dc-store-home__logo"
                src={logo}
                alt={`Logo de ${storeName}`}
                style={{ width: design.logoSize, height: design.logoSize }}
              />
            ) : (
              <div
                className="dc-store-home__logo-placeholder"
                style={{ width: design.logoSize, height: design.logoSize }}
                aria-hidden="true"
              >
                <Store size={Math.round(design.logoSize * 0.4)} />
              </div>
            )}
            <h1 className="dc-store-home__store-name">{storeName}</h1>
            {design.tagline ? (
              <p className="dc-store-home__tagline">{design.tagline}</p>
            ) : null}
          </div>

          {tableName ? (
            <div className="dc-store-home__table" role="status">Você está na {tableName}</div>
          ) : null}

          <p className="dc-store-home__welcome">{design.headerTitle}</p>
          <h2 className="dc-store-home__title">{design.title}</h2>
          {design.subtitle ? <p className="dc-store-home__subtitle">{design.subtitle}</p> : null}
        </header>

        <section className="dc-store-home__center" aria-label="Opções disponíveis">
          <div className="dc-store-home__grid">
            {actions.map(action => {
              const meta = ACTION_META[action];
              const Icon = meta.Icon;
              const label = action === 'MENU' && menuLabel ? menuLabel : meta.label;
              const disabled = available[action] === false;
              return (
                <button
                  key={action}
                  type="button"
                  disabled={disabled}
                  className="dc-store-home__tile"
                  style={{ ['--tile-accent' as string]: meta.accent }}
                  onClick={() => { if (!preview && !disabled) onAction?.(action); }}
                  aria-label={label}
                  title={disabled ? 'Indisponível no momento' : label}
                >
                  <span className="dc-store-home__tile-icon" aria-hidden="true">
                    <Icon size={28} strokeWidth={2.1} />
                  </span>
                  <span className="dc-store-home__tile-copy">
                    <h2 className="dc-store-home__tile-title">{label}</h2>
                    <span className="dc-store-home__tile-sub">{meta.subtitle}</span>
                  </span>
                  <span className="dc-store-home__tile-arrow" aria-hidden="true">
                    <ArrowRight size={16} strokeWidth={2.5} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {design.showFooter ? (
          <footer
            className="dc-store-home__footer"
            style={bottomBanner ? {
              backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.55)), url("${escUrl(bottomBanner)}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            } : {
              backgroundImage: template.bottomGradient,
            }}
          >
            <span className="dc-store-home__footer-eyebrow">Veja nossas</span>
            <strong className="dc-store-home__footer-title">{design.footerTitle}</strong>
          </footer>
        ) : null}

        {storeAppHref ? (
          <a
            href={storeAppHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onStoreAppClick}
            aria-label="Meu app"
            className="dc-store-home__app-link"
          >
            Meu app — leve a loja com você
          </a>
        ) : null}

        <p className="dc-store-home__signature">Powered by Delivery Channel</p>
      </div>
    </section>
  );
}
