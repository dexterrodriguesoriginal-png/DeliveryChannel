import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product } from '../types';
import type { UpsellCartItem, UpsellChannel, UpsellOffer } from '../types/upsell';
import { normalizeUpsellCart, upsellRepository } from '../repositories/upsellRepository';

export interface SmartUpsellOptions {
  slug: string;
  /** Used only to discard work after identity changes; never sent to the RPC. */
  identityKey?: string | null;
  /** A table QR token can isolate bags independently from guest → login. */
  cartScopeKey?: string;
  products: Product[];
  channel: UpsellChannel;
  hidden: boolean;
  onAcceptProduct(product: Product): void | Promise<void>;
}
type Phase = 'ADD' | 'BEFORE_CHECKOUT';
type RequestResult = 'OPENED' | 'NONE' | 'CANCELLED';
type Display = { scope: string; offer: UpsellOffer; phase: Phase };

/** Ranking stays on the server. This hook only enforces presentation and cart safety. */
export function useSmartUpsell(options: SmartUpsellOptions) {
  const identity = options.identityKey && !['guest', 'anonymous'].includes(options.identityKey) ? options.identityKey : '';
  const cartScope = options.cartScopeKey || options.slug;
  const scope = `${options.slug}:${cartScope}:${identity || 'guest'}:${options.channel}`;
  const latest = useRef({ ...options, scope });
  latest.current = { ...options, scope };
  const [display, setDisplay] = useState<Display | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestJob = useRef(0);
  const deferredAddJob = useRef(0);
  const acceptJob = useRef(0);
  const accepting = useRef(false);
  const lastSource = useRef('');
  const previousSuggestions = useRef(new Set<string>());
  const acceptedOffers = useRef(new Set<string>());
  const impressionJobs = useRef(new Map<string, Promise<void>>());
  const checkoutShown = useRef(false);
  const checkoutPending = useRef(false);
  const continuation = useRef<{ scope: string; action: () => void } | null>(null);
  const previousScope = useRef({ slug: options.slug, cartScope, identity, channel: options.channel });

  const closeWithoutContinuing = useCallback(() => {
    requestJob.current += 1; acceptJob.current += 1;
    accepting.current = false; checkoutPending.current = false;
    continuation.current = null;
    setDisplay(null); setBusy(false); setError('');
  }, []);

  useEffect(() => {
    const previous = previousScope.current;
    const finishingGuestBag = previous.slug === options.slug && previous.cartScope === cartScope
      && previous.channel === options.channel && !previous.identity && Boolean(identity);
    previousScope.current = { slug: options.slug, cartScope, identity, channel: options.channel };
    closeWithoutContinuing();
    lastSource.current = ''; previousSuggestions.current = new Set();
    if (!finishingGuestBag) acceptedOffers.current.clear();
    impressionJobs.current.clear(); checkoutShown.current = false;
    return () => { requestJob.current += 1; acceptJob.current += 1; continuation.current = null; };
  }, [scope, closeWithoutContinuing, options.slug, options.channel, cartScope, identity]);
  useEffect(() => { if (options.hidden) closeWithoutContinuing(); }, [options.hidden, closeWithoutContinuing]);

  const ensureImpression = useCallback((token: string) => {
    const existing = impressionJobs.current.get(token);
    if (existing) return existing;
    const promise = upsellRepository.impression(token).catch(reason => {
      impressionJobs.current.delete(token); throw reason;
    });
    impressionJobs.current.set(token, promise);
    return promise;
  }, []);
  useEffect(() => {
    if (!options.hidden && display?.scope === scope) void ensureImpression(display.offer.offerToken).catch(() => { /* analytics never blocks browsing */ });
  }, [display, options.hidden, scope, ensureImpression]);

  const request = useCallback(async (source: Product, items: UpsellCartItem[], phase: Phase, next?: () => void): Promise<RequestResult> => {
    const current = latest.current, sourceProduct = current.products.find(product => product.id === source.id);
    if (current.hidden || !current.slug || !sourceProduct || sourceProduct.isActive === false || sourceProduct.isAvailable === false) return 'NONE';
    const cart = normalizeUpsellCart(items);
    if (!cart.length) return 'NONE';
    const currentScope = current.scope, job = ++requestJob.current;
    setDisplay(null); setError(''); continuation.current = null;
    const stillCurrent = () => latest.current.scope === currentScope && !latest.current.hidden && requestJob.current === job;
    try {
      const reply = await upsellRepository.recommend(current.slug, sourceProduct.id, cart, current.channel);
      if (!stillCurrent()) return 'CANCELLED';
      if (!reply.offerToken) return 'NONE';
      const cartIds = new Set(cart.map(item => item.productId));
      const seen = new Set<string>();
      const suggestions = reply.suggestions.flatMap(candidate => {
        const product = latest.current.products.find(item => item.id === candidate.productId);
        if (!product || product.isActive === false || product.isAvailable === false || cartIds.has(product.id)
          || product.id === sourceProduct.id || seen.has(product.id) || previousSuggestions.current.has(product.id)) return [];
        seen.add(product.id); return [{ product, reason: candidate.reason }];
      }).slice(0, 3);
      if (!suggestions.length) return 'NONE';
      previousSuggestions.current = new Set(suggestions.map(suggestion => suggestion.product.id));
      continuation.current = next ? { scope: currentScope, action: next } : null;
      setDisplay({ scope: currentScope, offer: { offerToken: reply.offerToken, suggestions }, phase });
      return 'OPENED';
    } catch { return stillCurrent() ? 'NONE' : 'CANCELLED'; }
  }, []);

  const notifyAdded = useCallback(async (product: Product, nextCart: UpsellCartItem[]) => {
    const requestAtAdd = requestJob.current, scopeAtAdd = latest.current.scope;
    const addJob = ++deferredAddJob.current;
    // Product detail/options dialogs close in the same event as adding. Observe
    // the committed visibility state without queuing an offer across checkout.
    await Promise.resolve();
    if (requestJob.current !== requestAtAdd || deferredAddJob.current !== addJob || latest.current.scope !== scopeAtAdd) return;
    if (latest.current.hidden || lastSource.current === product.id) return;
    lastSource.current = product.id;
    await request(product, nextCart, 'ADD');
  }, [request]);

  const dismiss = useCallback(() => {
    const next = continuation.current;
    closeWithoutContinuing();
    if (next && next.scope === latest.current.scope && !latest.current.hidden) next.action();
  }, [closeWithoutContinuing]);

  const accept = useCallback(async (candidate: Product) => {
    if (!display || display.scope !== latest.current.scope || latest.current.hidden || accepting.current) return;
    if (!display.offer.suggestions.some(suggestion => suggestion.product.id === candidate.id)) return;
    const product = latest.current.products.find(item => item.id === candidate.id);
    if (!product || product.isActive === false || product.isAvailable === false) return;
    const currentScope = latest.current.scope, job = ++acceptJob.current;
    accepting.current = true; setBusy(true); setError('');
    const stillCurrent = () => latest.current.scope === currentScope && !latest.current.hidden && acceptJob.current === job;
    try {
      await ensureImpression(display.offer.offerToken);
      await upsellRepository.accept(display.offer.offerToken, product.id);
      if (!stillCurrent()) return;
      acceptedOffers.current.add(display.offer.offerToken);
      continuation.current = null; checkoutPending.current = false;
      requestJob.current += 1; setDisplay(null);
      await latest.current.onAcceptProduct(product);
    } catch {
      if (stillCurrent()) setError('Esta sugestão não está disponível agora. Tente novamente ou continue seu pedido.');
    } finally {
      if (acceptJob.current === job) { accepting.current = false; setBusy(false); }
    }
  }, [display, ensureImpression]);

  const beforeCheckout = useCallback(async (cartItems: UpsellCartItem[], continueCheckout: () => void) => {
    const current = latest.current;
    if (checkoutPending.current) return;
    if (current.channel !== 'TOTEM' || current.hidden || checkoutShown.current) { continueCheckout(); return; }
    const cart = normalizeUpsellCart(cartItems);
    const source = [...cart].reverse().map(item => current.products.find(product => product.id === item.productId)).find(Boolean);
    if (!source) { continueCheckout(); return; }
    checkoutShown.current = true; checkoutPending.current = true;
    const result = await request(source, cart, 'BEFORE_CHECKOUT', continueCheckout);
    if (result !== 'OPENED') {
      checkoutPending.current = false;
      if (result === 'NONE' && latest.current.scope === current.scope && !latest.current.hidden) continueCheckout();
    }
  }, [request]);

  const trackOrder = useCallback(async (orderId: string) => {
    if (latest.current.scope !== scope || !orderId) return;
    const tokens = [...acceptedOffers.current];
    // A failed telemetry call must not attribute this bag to a later order.
    acceptedOffers.current.clear(); checkoutShown.current = false;
    lastSource.current = ''; previousSuggestions.current = new Set();
    await Promise.allSettled(tokens.map(token => upsellRepository.recordConversion(token, orderId)));
  }, [scope]);
  const clear = useCallback(() => {
    closeWithoutContinuing(); acceptedOffers.current.clear(); impressionJobs.current.clear();
    lastSource.current = ''; previousSuggestions.current = new Set(); checkoutShown.current = false;
  }, [closeWithoutContinuing]);

  return {
    offer: !options.hidden && display?.scope === scope ? display.offer : null,
    title: display?.phase === 'BEFORE_CHECKOUT' ? 'Que tal completar?' : 'Leve também',
    busy, error, notifyAdded, accept, dismiss, beforeCheckout, trackOrder, clear,
  };
}
