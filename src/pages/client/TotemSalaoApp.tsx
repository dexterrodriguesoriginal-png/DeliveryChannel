import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { publicStoreRepository } from '../../repositories/publicStoreRepository';
import { totemAccessRepository } from '../../repositories/totemAccessRepository';
import type { TotemLoginInfo } from '../../repositories/totemAccessRepository';
import { totemWelcomeRepository } from '../../repositories/totemWelcomeRepository';
import { menuHeaderRepository } from '../../repositories/menuHeaderRepository';
import { menuOutdoorRepository, type PublicMenuOutdoorSlide } from '../../repositories/menuOutdoorRepository';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { isModuleEnabled } from '../../lib/modules';
import type { Category, Product, SelectedProductOption } from '../../types';
import type { MenuTheme } from '../../types/menuTheme';
import { DEFAULT_MENU_THEME } from '../../lib/theme/menuTheme';
import { DEFAULT_MENU_OPTIONS } from '../../lib/menu/menuOptions';
import type { MenuOptions } from '../../types/menuOptions';
import { DEFAULT_MENU_HEADER, type MenuHeaderSettings } from '../../lib/menu/menuHeader';
import {
  DEFAULT_TOTEM_WELCOME,
  normalizeTotemWelcome,
  resolvedTotemButtonColors,
  type TotemWelcomeSettings,
} from '../../lib/menu/totemWelcome';
import { safeHomeImageUrl } from '../../lib/storeHome/storeHome.model';
import { TotemCapaScreen } from '../../components/client/totem/TotemCapaScreen';
import { DineInPremiumMenu } from '../../components/client/totem/DineInPremiumMenu';
import { TotemKioskLayer } from '../../components/client/totem/TotemKioskLayer';
import { TotemInstallOverlay } from '../../components/client/totem/TotemInstallOverlay';
import { TotemActivateScreen } from '../../components/client/totem/TotemActivateScreen';
import { DEFAULT_TOTEM_DESIGN, type TotemDesign } from '../../lib/menu/totemDesign';
import { newIdempotencyKey } from '../../lib/backend';
import { isSupabaseConfigured } from '../../lib/supabase';
import { requestTotemFullscreenOnce } from '../../lib/menu/fullscreen';
import { ProductOptionsSelector } from '../../components/client/customer/ProductOptionsSelector';
import {
  addDineInCartLine,
  changeDineInCartLineQuantity,
  dineInCartLineUnitPriceCents,
  dineInOptionLabels,
  type DineInCartLine,
} from '../../lib/customer/dineInCart';
import { validateOptionSelection } from '../../lib/addons';
import { formatMenuMoney } from '../../lib/menu/premiumTotem.model';
import type { TotemOrderLine } from '../../components/client/totem/TotemOrderPanel';
import './totemSalao.css';

type TotemView = 'CAPA' | 'MENU' | 'DONE';

export function TotemSalaoApp({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeLogoUrl, setStoreLogoUrl] = useState<string | undefined>(undefined);
  const [tenantId, setTenantId] = useState('');
  const [needsActivation, setNeedsActivation] = useState(false);
  const [loginInfo, setLoginInfo] = useState<TotemLoginInfo | null>(null);
  const [totemDesign, setTotemDesign] = useState<TotemDesign>(DEFAULT_TOTEM_DESIGN);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [orderError, setOrderError] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [menuTheme, setMenuTheme] = useState<MenuTheme>(DEFAULT_MENU_THEME);
  const [menuOptions, setMenuOptions] = useState<MenuOptions>({ ...DEFAULT_MENU_OPTIONS });
  const [menuHeader, setMenuHeader] = useState<MenuHeaderSettings>({ ...DEFAULT_MENU_HEADER });
  const [welcome, setWelcome] = useState<TotemWelcomeSettings>({ ...DEFAULT_TOTEM_WELCOME, slides: [] });
  const [outdoorSlides, setOutdoorSlides] = useState<PublicMenuOutdoorSlide[]>([]);
  const [view, setView] = useState<TotemView>('CAPA');
  const [cart, setCart] = useState<DineInCartLine[]>([]);
  const [optionsProduct, setOptionsProduct] = useState<Product | null>(null);
  const [optionChoices, setOptionChoices] = useState<SelectedProductOption[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);


  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setNeedsActivation(false);
    (async () => {
      try {
        const login = await totemAccessRepository.loadLogin(slug).catch(() => null);
        if (!alive) return;
        if (login) {
          setLoginInfo(login);
          setStoreName(login.name);
          setStoreLogoUrl(login.logoUrl);
          if (login.tenantId) setTenantId(login.tenantId);
        }
        const session = totemAccessRepository.readSession(slug);
        if (!session) {
          if (!isSupabaseConfigured) {
            // Demonstração local, sem backend: o catálogo público permanece só para o dev/testes.
            const store = await publicStoreRepository.loadPublicStore(slug);
            if (!alive) return;
            if (store.status === 'not_found') { setError('Esta loja não está disponível.'); return; }
            if (store.status !== 'ok') { setError('Não foi possível carregar o totem. Tente novamente.'); return; }
            const data = store.data;
            const enabledModules = await tenantModuleRepository.getPublicEnabled(data.tenant.id);
            if (!alive) return;
            const optionGroups = isModuleEnabled(enabledModules, 'addons')
              ? await productOptionRepository.getPublicForProducts(data.tenant.id, data.products.map(product => product.id))
              : new Map();
            if (!alive) return;
            setTenantId(data.tenant.id);
            setStoreName(data.theme?.storeName || data.tenant.name);
            setStoreLogoUrl(data.theme?.logoUrl || undefined);
            setMenuTheme(data.menuTheme ?? DEFAULT_MENU_THEME);
            setMenuOptions(data.menuOptions ?? { ...DEFAULT_MENU_OPTIONS });
            setCategories(data.categories || []);
            setProducts(
              data.products
                .filter(product => product.isActive && product.isAvailable)
                .map(product => ({ ...product, optionGroups: optionGroups.get(product.id) || [] })),
            );
            const [header, capa, ownOutdoor] = await Promise.all([
              menuHeaderRepository.loadPublic(slug).catch(() => ({ ...DEFAULT_MENU_HEADER })),
              totemWelcomeRepository.loadPublic(slug).catch(() => ({ ...DEFAULT_TOTEM_WELCOME, slides: [] })),
              menuOutdoorRepository.getPublicSlides(slug).catch(() => [] as PublicMenuOutdoorSlide[]),
            ]);
            if (!alive) return;
            setMenuHeader(header);
            setWelcome(normalizeTotemWelcome(capa));
            const reuse = (data.menuOptions ?? DEFAULT_MENU_OPTIONS).reuseAppBanners;
            if (reuse) {
              const appBanners: PublicMenuOutdoorSlide[] = (data.offers ?? [])
                .filter(offer => offer.tenantId === data.tenant.id && offer.isActive === true)
                .flatMap(offer => {
                  const src = safeHomeImageUrl(offer.mediaUrl || offer.imageUrl);
                  if (!src) return [];
                  const duration = Number(offer.durationSeconds);
                  return [{
                    id: `app:${offer.id}`,
                    title: offer.title,
                    ...(offer.mediaType === 'VIDEO' ? { videoUrl: src } : { imageUrl: src }),
                    imageDurationSeconds: Number.isInteger(duration) && duration >= 1 && duration <= 120 ? duration : 6,
                  }];
                });
              setOutdoorSlides(appBanners);
            } else {
              setOutdoorSlides(ownOutdoor);
            }
            return;
          }
          if (!login) {
            setError('Esta loja não está disponível.');
            return;
          }
          setNeedsActivation(true);
          return;
        }
        const loaded = await totemAccessRepository.loadStore(session.token);
        if (!alive) return;
        if (loaded.status === 'invalid') {
          totemAccessRepository.clearSession(slug);
          setDeviceToken(null);
          setNeedsActivation(true);
          return;
        }
        if (loaded.status !== 'ok') {
          setError(loaded.message || 'Não foi possível carregar o totem. Tente novamente.');
          return;
        }
        setDeviceToken(session.token);
        setTotemDesign(loaded.store.design);
        setWelcome(normalizeTotemWelcome(loaded.store.welcome));
        const data = loaded.store.data;
        const enabledModules = await tenantModuleRepository.getPublicEnabled(data.tenant.id);
        if (!alive) return;
        const optionGroups = isModuleEnabled(enabledModules, 'addons')
          ? await productOptionRepository.getPublicForProducts(data.tenant.id, data.products.map(product => product.id))
          : new Map();
        if (!alive) return;
        setTenantId(data.tenant.id);
        setStoreName(data.theme?.storeName || data.tenant.name);
        setStoreLogoUrl(data.theme?.logoUrl || undefined);
        setMenuTheme(data.menuTheme ?? DEFAULT_MENU_THEME);
        setMenuOptions(data.menuOptions ?? { ...DEFAULT_MENU_OPTIONS });
        setCategories(data.categories || []);
        setProducts(
          data.products
            .filter(product => product.isActive && product.isAvailable)
            .map(product => ({ ...product, optionGroups: optionGroups.get(product.id) || [] })),
        );
        const [header, capa, ownOutdoor] = await Promise.all([
          menuHeaderRepository.loadPublic(slug).catch(() => ({ ...DEFAULT_MENU_HEADER })),
          totemWelcomeRepository.loadPublic(slug).catch(() => ({ ...DEFAULT_TOTEM_WELCOME, slides: [] })),
          menuOutdoorRepository.getPublicSlides(slug).catch(() => [] as PublicMenuOutdoorSlide[]),
        ]);
        if (!alive) return;
        setMenuHeader(header);
        setWelcome(normalizeTotemWelcome(capa));
        const reuse = (data.menuOptions ?? DEFAULT_MENU_OPTIONS).reuseAppBanners;
        if (reuse) {
          const appBanners: PublicMenuOutdoorSlide[] = (data.offers ?? [])
            .filter(offer => offer.tenantId === data.tenant.id && offer.isActive === true)
            .flatMap(offer => {
              const src = safeHomeImageUrl(offer.mediaUrl || offer.imageUrl);
              if (!src) return [];
              const duration = Number(offer.durationSeconds);
              return [{
                id: `app:${offer.id}`,
                title: offer.title,
                ...(offer.mediaType === 'VIDEO' ? { videoUrl: src } : { imageUrl: src }),
                imageDurationSeconds: Number.isInteger(duration) && duration >= 1 && duration <= 120 ? duration : 6,
              }];
            });
          setOutdoorSlides(appBanners);
        } else {
          setOutdoorSlides(ownOutdoor);
        }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o totem. Tente novamente.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug, reloadKey]);

  const buttonColors = useMemo(
    () => resolvedTotemButtonColors(welcome, menuTheme),
    [welcome, menuTheme],
  );

  const orderLines: TotemOrderLine[] = useMemo(() => cart.map(line => ({
    key: line.key,
    name: line.product.name,
    quantity: line.quantity,
    unitPriceCents: dineInCartLineUnitPriceCents(line),
    detail: dineInOptionLabels(line.product, line.options).join(', ') || undefined,
  })), [cart]);

  const subtotalCents = useMemo(
    () => orderLines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0),
    [orderLines],
  );

  const checkoutInProgress = checkoutOpen || Boolean(optionsProduct);
  const idleEnabled = view === 'MENU' && !checkoutInProgress;

  const returnToCapa = useCallback(() => {
    setCart([]);
    setOptionsProduct(null);
    setOptionChoices([]);
    setCheckoutOpen(false);
    setView('CAPA');
  }, []);

  const finishOrder = useCallback(async () => {
    if (orderBusy) return;
    setOrderError('');
    if (deviceToken) {
      setOrderBusy(true);
      try {
        await totemAccessRepository.createOrder(
          deviceToken,
          cart.map(line => ({
            productId: line.product.id,
            quantity: line.quantity,
            notes: line.notes,
          })),
          newIdempotencyKey(),
        );
      } catch (reason) {
        setOrderError(reason instanceof Error ? reason.message : 'Não foi possível registrar o pedido.');
        setOrderBusy(false);
        return;
      }
      setOrderBusy(false);
    }
    setCheckoutOpen(false);
    setCart([]);
    setView('DONE');
  }, [cart, deviceToken, orderBusy]);

  const addProduct = useCallback((product: Product, options: SelectedProductOption[] = []) => {
    setCart(current => addDineInCartLine(current, product, options));
  }, []);

  const openProduct = useCallback((product: Product) => {
    setOptionsProduct(product);
    setOptionChoices([]);
  }, []);

  const confirmOptions = useCallback(() => {
    if (!optionsProduct) return;
    const groups = optionsProduct.optionGroups?.filter(group => group.active) || [];
    if (groups.length && !validateOptionSelection(groups, optionChoices).valid) return;
    addProduct(optionsProduct, optionChoices);
    setOptionsProduct(null);
    setOptionChoices([]);
  }, [addProduct, optionChoices, optionsProduct]);

  if (loading) {
    return (
      <main className="dc-totem-app dc-totem-app--center" data-testid="totem-salao-loading">
        <Loader2 className="dc-totem-spin" aria-hidden={true} />
        <p>Carregando o totem…</p>
      </main>
    );
  }

  if (needsActivation) {
    return (
      <div className="dc-totem-app" data-testid="totem-salao-app" data-view="activate">
        <TotemInstallOverlay
          slug={slug}
          tenantId={loginInfo?.tenantId || tenantId}
          storeName={loginInfo?.name || storeName || 'Totem'}
          logoUrl={loginInfo?.logoUrl || storeLogoUrl}
          accent={loginInfo?.accent || menuTheme.accent}
        />
        <TotemActivateScreen
          slug={slug}
          login={loginInfo}
          onActivated={session => {
            totemAccessRepository.saveSession(slug, session);
            setDeviceToken(session.token);
            setNeedsActivation(false);
            setReloadKey(key => key + 1);
          }}
        />
      </div>
    );
  }

  if (error || !tenantId) {
    return (
      <main className="dc-totem-app dc-totem-app--center" data-testid="totem-salao-error" role="alert">
        <h1>Totem indisponível</h1>
        <p>{error || 'Não foi possível abrir o cardápio deste totem.'}</p>
      </main>
    );
  }

  return (
    <div className="dc-totem-app" data-testid="totem-salao-app" data-view={view}>
      {!loading && !error && (
        <TotemInstallOverlay
          slug={slug}
          tenantId={tenantId}
          storeName={storeName || 'Totem'}
          logoUrl={storeLogoUrl}
          accent={menuTheme.accent}
        />
      )}
      {view === 'CAPA' && (
        <TotemCapaScreen
          settings={welcome}
          buttonBackground={buttonColors.background}
          buttonColor={buttonColors.color}
          backdrop={menuTheme.background}
          onStart={() => { void requestTotemFullscreenOnce(); setView('MENU'); }}
        />
      )}

      {view === 'MENU' && (
        <DineInPremiumMenu
          tenantId={tenantId}
          storeName={storeName}
          categories={categories}
          products={products}
          menuTheme={menuTheme}
          cartCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
          orderingDisabled={false}
          productColumns={menuOptions.productColumns}
          outdoorSlides={outdoorSlides}
          categoryMenuMode={menuHeader.categoryMenuMode}
          variant="TOTEM"
          totemDesign={totemDesign}
          orderLines={orderLines}
          orderSubtotalCents={subtotalCents}
          onChangeOrderQuantity={(key, delta) => setCart(current => changeDineInCartLineQuantity(current, key, delta))}
          onCheckoutOrder={() => { if (cart.length) setCheckoutOpen(true); }}
          onGoHome={() => undefined}
          onOpenCart={() => undefined}
          onOpenTable={() => undefined}
          onOpenExpenses={() => undefined}
          onAddProduct={product => addProduct(product)}
          onOpenProduct={openProduct}
        />
      )}

      {view === 'DONE' && (
        <main className="dc-totem-done" data-testid="totem-order-done" style={{ background: menuTheme.background, color: menuTheme.text }}>
          <h1>Dirija-se ao balcão</h1>
          <p>Pague e retire o seu pedido no balcão. O pagamento e a senha de retirada entram na próxima etapa deste totem.</p>
          <button
            type="button"
            data-testid="totem-new-order"
            style={{ background: menuTheme.accent, color: menuTheme.accentText }}
            onClick={returnToCapa}
          >
            Novo pedido
          </button>
        </main>
      )}

      {optionsProduct && (
        <div className="dc-totem-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOptionsProduct(null); }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`${optionsProduct.optionGroups?.some(group => group.active) ? 'Personalizar' : 'Detalhes de'} ${optionsProduct.name}`}
            className="dc-totem-modal"
            style={{ background: menuTheme.surface, color: menuTheme.text }}
          >
            <header>
              <h2>{optionsProduct.optionGroups?.some(group => group.active) ? `Personalizar ${optionsProduct.name}` : optionsProduct.name}</h2>
              <button type="button" aria-label="Fechar" onClick={() => setOptionsProduct(null)}><X size={22} /></button>
            </header>
            {optionsProduct.description && <p className="dc-totem-modal-desc">{optionsProduct.description}</p>}
            <ProductOptionsSelector
              groups={optionsProduct.optionGroups || []}
              selections={optionChoices}
              onChange={setOptionChoices}
            />
            <button
              type="button"
              className="dc-totem-modal-confirm"
              style={{ background: menuTheme.accent, color: menuTheme.accentText }}
              disabled={Boolean(optionsProduct.optionGroups?.some(group => group.active)) && !validateOptionSelection(optionsProduct.optionGroups || [], optionChoices).valid}
              onClick={confirmOptions}
            >
              Adicionar
            </button>
          </section>
        </div>
      )}

      {checkoutOpen && cart.length > 0 && (
        <div className="dc-totem-modal-backdrop" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar pedido"
            className="dc-totem-modal"
            data-testid="totem-checkout-review"
            style={{ background: menuTheme.surface, color: menuTheme.text }}
          >
            <header>
              <h2>Confirmar pedido</h2>
              <button type="button" aria-label="Voltar ao cardápio" onClick={() => setCheckoutOpen(false)}><X size={22} /></button>
            </header>
            <p className="dc-totem-modal-desc">Pague e retire no balcão. O pagamento ainda não é processado neste totem.</p>
            <ul className="dc-totem-checkout-lines">
              {orderLines.map(line => (
                <li key={line.key}>
                  <span>{line.quantity}× {line.name}</span>
                  <strong>{formatMenuMoney(line.unitPriceCents * line.quantity)}</strong>
                </li>
              ))}
            </ul>
            <p className="dc-totem-checkout-total">
              <span>Subtotal</span>
              <strong>{formatMenuMoney(subtotalCents)}</strong>
            </p>
            {orderError && <p role="alert" data-testid="totem-order-error">{orderError}</p>}
            <button
              type="button"
              className="dc-totem-modal-confirm"
              data-testid="totem-checkout-confirm"
              style={{ background: menuTheme.accent, color: menuTheme.accentText }}
              onClick={() => void finishOrder()}
              disabled={orderBusy}
            >
              {orderBusy ? 'Registrando…' : 'Confirmar e ir ao balcão'}
            </button>
          </section>
        </div>
      )}

      <TotemKioskLayer enabled={idleEnabled} idleSeconds={welcome.idleSeconds} onIdle={returnToCapa} />
    </div>
  );
}

export default TotemSalaoApp;