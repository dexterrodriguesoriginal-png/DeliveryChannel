import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { publicStoreRepository } from '../../repositories/publicStoreRepository';
import { totemAccessRepository } from '../../repositories/totemAccessRepository';
import type { TotemLoginInfo, TotemPaymentState } from '../../repositories/totemAccessRepository';
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
import { repeatItem, type ReorderItem } from '../../lib/customer/dineInReorder';
import { reorderRepository } from '../../repositories/reorderRepository';
import { DineInPremiumMenu } from '../../components/client/totem/DineInPremiumMenu';
import { TotemKioskLayer } from '../../components/client/totem/TotemKioskLayer';
import { TotemInstallOverlay } from '../../components/client/totem/TotemInstallOverlay';
import { TotemActivateScreen } from '../../components/client/totem/TotemActivateScreen';
import { DEFAULT_TOTEM_DESIGN, type TotemDesign } from '../../lib/menu/totemDesign';
import { pickVividAccent } from '../../lib/pwa/storeManifest';
import { newIdempotencyKey } from '../../lib/backend';
import { isSupabaseConfigured } from '../../lib/supabase';
import { requestTotemFullscreenOnce } from '../../lib/menu/fullscreen';
import { KioskProductSheet } from '../../components/client/totem/KioskProductSheet';
import {
  addDineInCartLine,
  changeDineInCartLineQuantity,
  dineInCartLineUnitPriceCents,
  dineInOptionLabels,
  dineInRoundItems,
  type DineInCartLine,
} from '../../lib/customer/dineInCart';
import { validateOptionSelection } from '../../lib/addons';
import { formatMenuMoney } from '../../lib/menu/premiumTotem.model';
import type { TotemOrderLine } from '../../components/client/totem/TotemOrderPanel';
import './totemSalao.css';

type TotemView = 'CAPA' | 'MENU' | 'PAYMENT' | 'DONE';

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
  const [reorderHistory,setReorderHistory]=useState<{slug:string;generation:number;items:ReorderItem[]}>({slug:'',generation:-1,items:[]});
  const repeatGeneration=useRef(0);
  const repeatScope=useRef(slug);
  if(repeatScope.current!==slug){repeatScope.current=slug;repeatGeneration.current+=1;}
  const reorderItems=reorderHistory.slug===slug && reorderHistory.generation===repeatGeneration.current?reorderHistory.items:[];
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payment, setPayment] = useState<TotemPaymentState | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const paymentKey = React.useRef<string | null>(null);
  const submitting = React.useRef(false);
  const printedOrders = React.useRef(new Set<string>());
  useEffect(() => {
    if (view !== 'PAYMENT' || !payment?.orderId || !deviceToken) return;
    let active = true;
    const refresh = async () => {
      try {
        const current = await totemAccessRepository.getPaymentStatus(deviceToken, payment.orderId);
        if (!active) return;
        setPayment(current);
        if (current.paymentStatus === 'PAID' && current.pickupCode) setView('DONE');
      } catch {
        if (active) setOrderError('Não foi possível atualizar o pagamento. Tente novamente.');
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; window.clearInterval(interval); };
  }, [view, payment?.orderId, deviceToken]);
  useEffect(() => {
    if (view !== 'DONE' || !payment?.pickupCode || payment.paymentStatus !== 'PAID' || !payment.autoPrint) return;
    if (printedOrders.current.has(payment.orderId)) return;
    printedOrders.current.add(payment.orderId);
    try { window.print(); } catch { setPrintFailed(true); }
  }, [view, payment]);


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

  const idleEnabled = (view === 'MENU' || view === 'DONE') && !checkoutOpen;

  const returnToCapa = useCallback(() => {
    repeatGeneration.current += 1;
    setReorderHistory({slug:'',generation:-1,items:[]});
    setOrderBusy(false);
    setCart([]);
    setOptionsProduct(null);
    setCheckoutOpen(false);
    setPayment(null);
    setOrderError('');
    setPrintFailed(false);
    paymentKey.current = null;
    setView('CAPA');
  }, []);

  const finishOrder = useCallback(async () => {
    if (submitting.current || orderBusy) return;
    if (!deviceToken) { setOrderError('Ative este totem para registrar pedidos.'); return; }
    submitting.current = true;
    setOrderBusy(true);
    setOrderError('');
    paymentKey.current ??= newIdempotencyKey();
    const generation=repeatGeneration.current;
    try {
      const result = await totemAccessRepository.createOrder(
        deviceToken,
        dineInRoundItems(cart),
        paymentKey.current,
      );
      if(generation!==repeatGeneration.current) return;
      setReorderHistory(previous => ({slug,generation,items:[...cart.map(line=>({id:`${result.orderId}:${line.key}`,productId:line.product.id,name:line.product.name,quantity:line.quantity,notes:line.notes||'',options:line.options,optionLabels:dineInOptionLabels(line.product,line.options)})),...(previous.slug===slug && previous.generation===generation?previous.items:[])]}));
      setPayment(result);
      setCheckoutOpen(false);
      setCart([]);
      if (result.paymentStatus === 'PAID' && result.pickupCode) setView('DONE');
      else setView('PAYMENT');
    } catch (reason) {
      setOrderError(reason instanceof Error ? reason.message : 'Não foi possível registrar o pedido.');
    } finally {
      submitting.current = false;
      setOrderBusy(false);
    }
  }, [cart, deviceToken, orderBusy, slug]);

  const cancelPayment = useCallback(async () => {
    if (!deviceToken || !payment?.orderId) return;
    try {
      await totemAccessRepository.cancelPayment(deviceToken, payment.orderId);
      returnToCapa();
    } catch (reason) {
      setOrderError(reason instanceof Error ? reason.message : 'Não foi possível cancelar o pedido.');
    }
  }, [deviceToken, payment?.orderId, returnToCapa]);

  const addProduct = useCallback((product: Product, options: SelectedProductOption[] = [], quantity = 1) => {
    setCart(current => addDineInCartLine(current, product, options, quantity));
  }, []);

  const openProduct = useCallback((product: Product) => {
    setOptionsProduct(product);
  }, []);

  const confirmProduct = useCallback((quantity: number, options: SelectedProductOption[]) => {
    if (!optionsProduct) return;
    const groups = optionsProduct.optionGroups?.filter(group => group.active) || [];
    if (groups.length && !validateOptionSelection(groups, options).valid) return;
    addProduct(optionsProduct, options, quantity);
    setOptionsProduct(null);
  }, [addProduct, optionsProduct]);

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
          accent={pickVividAccent([loginInfo?.accent, menuTheme.accent, totemDesign.colors.addButtonBg], '#176444')}
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
          accent={pickVividAccent([menuTheme.accent, totemDesign.colors.addButtonBg, loginInfo?.accent], '#176444')}
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
          reorderItems={reorderItems}
          onRepeat={item=>{
            const generation=repeatGeneration.current;
            if(orderBusy) return;
            setOrderBusy(true); setOrderError('');
            void reorderRepository.product(slug,tenantId,item.productId).then(product=>{
              if(generation!==repeatGeneration.current) return;
              const next=repeatItem(cart,item,product);
              setCart(next); setCheckoutOpen(true);
            }).catch(reason=>{if(generation===repeatGeneration.current)setOrderError(reason instanceof Error?reason.message:'Não foi possível repetir o item.');})
            .finally(()=>{if(generation===repeatGeneration.current)setOrderBusy(false);});
          }}
          menuTheme={menuTheme}
          cartCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
          orderingDisabled={orderBusy}
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

      {view === 'MENU' && orderError && <p role="alert" style={{position:'fixed',top:16,left:'10%',right:'10%',zIndex:80,padding:16,background:menuTheme.surface,color:menuTheme.text}}>{orderError}</p>}

      {view === 'PAYMENT' && payment && (
        <main className="dc-totem-done" data-testid="totem-payment-wait" style={{ background: menuTheme.background, color: menuTheme.text }}>
          <h1>{payment.paymentStatus === 'PENDING' ? 'Aguardando pagamento' : 'Pagamento não concluído'}</h1>
          <p style={{ fontSize: '2rem' }}>Total: {formatMenuMoney(Math.round(payment.total * 100))}</p>
          <p>{payment.paymentStatus === 'PENDING' ? payment.paymentLabel : 'Peça ajuda à equipe ou inicie um novo pedido.'}</p>
          {orderError && <p role="alert">{orderError}</p>}
          {payment.paymentStatus === 'PENDING' ? (
            <button type="button" onClick={() => void cancelPayment()} style={{ background: menuTheme.accent, color: menuTheme.accentText }}>
              Cancelar pedido
            </button>
          ) : (
            <button type="button" onClick={returnToCapa} style={{ background: menuTheme.accent, color: menuTheme.accentText }}>Novo pedido</button>
          )}
        </main>
      )}

      {view === 'DONE' && payment?.paymentStatus === 'PAID' && payment.pickupCode && (
        <main className="dc-totem-done" data-testid="totem-order-done" style={{ background: menuTheme.background, color: menuTheme.text }}>
          <h1>Senha de retirada</h1>
          <strong data-testid="totem-pickup-code" style={{ fontSize: 'clamp(5rem, 22vw, 13rem)', lineHeight: 1.1 }}>{payment.pickupCode}</strong>
          <p>Total pago: {formatMenuMoney(Math.round(payment.total * 100))}</p>
          <p>Retire seu pedido no balcão quando sua senha aparecer na TV.</p>
          <p>Não é documento fiscal</p>
          {printFailed && <p>A impressão automática não foi concluída.</p>}
          <button type="button" onClick={() => { try { window.print(); } catch { setPrintFailed(true); } }} style={{ background: menuTheme.accent, color: menuTheme.accentText }}>Imprimir comprovante</button>
          <button type="button" onClick={()=>{paymentKey.current=null;setPayment(null);setView('MENU');}} style={{background:menuTheme.accent,color:menuTheme.accentText}}>Continuar pedindo</button>
          <button type="button" data-testid="totem-new-order" style={{ background: menuTheme.accent, color: menuTheme.accentText }} onClick={returnToCapa}>Novo pedido</button>
        </main>
      )}

      {optionsProduct && (
        <KioskProductSheet
          product={optionsProduct}
          layout="modal"
          colors={{
            surface: menuTheme.surface,
            text: menuTheme.text,
            accent: menuTheme.accent,
            accentText: menuTheme.accentText,
          }}
          confirmLabel="Adicionar"
          closeLabel="Fechar"
          onClose={() => setOptionsProduct(null)}
          onConfirm={confirmProduct}
        />
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
            <p className="dc-totem-modal-desc">Após confirmar, pague na maquininha ao lado do totem. Sua senha aparece depois da aprovação.</p>
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
              {orderBusy ? 'Registrando…' : 'Confirmar e pagar'}
            </button>
          </section>
        </div>
      )}

      <TotemKioskLayer enabled={idleEnabled} idleSeconds={welcome.idleSeconds} onIdle={returnToCapa} />
    </div>
  );
}

export default TotemSalaoApp;