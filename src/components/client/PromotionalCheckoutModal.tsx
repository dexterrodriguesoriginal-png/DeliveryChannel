import React, { useState, useEffect, useMemo } from 'react';
import { Offer, Order, PublicStoreData } from '../../types';
import { orderService } from '../../services/orderService';
import { promotionRepository } from '../../repositories/promotionRepository';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { 
  Flame, 
  Tag, 
  Check, 
  Minus, 
  Plus, 
  Truck, 
  Store, 
  CreditCard, 
  QrCode, 
  Banknote, 
  AlertCircle, 
  Sparkles, 
  UserCheck, 
  Loader2, 
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Ticket
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

interface PromotionalCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  offer: Offer | null;
  storeData: PublicStoreData;
  onOrderCompleted: (order: Order, celebrationMessage?: string) => void;
}

export const PromotionalCheckoutModal: React.FC<PromotionalCheckoutModalProps> = ({
  isOpen,
  onClose,
  offer,
  storeData,
  onOrderCompleted,
}) => {
  const { supabaseUser, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const { showToast } = useToast();

  // Quantidade selecionada
  const minQty = offer?.promoMinQuantity || 1;
  const maxQty = offer?.promoMaxQuantityPerCustomer || 10;
  const [quantity, setQuantity] = useState(minQty);

  // Fulfillment Types permitidos
  const allowedFulfillment = useMemo(() => {
    return offer?.promoFulfillmentTypes && offer.promoFulfillmentTypes.length > 0
      ? offer.promoFulfillmentTypes
      : ['DELIVERY', 'PICKUP'];
  }, [offer]);

  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>(() => {
    return allowedFulfillment.includes('DELIVERY') ? 'DELIVERY' : 'PICKUP';
  });

  // Atualiza fulfillment caso a oferta mude
  useEffect(() => {
    if (allowedFulfillment.length > 0 && !allowedFulfillment.includes(fulfillmentType)) {
      setFulfillmentType(allowedFulfillment[0] as 'DELIVERY' | 'PICKUP');
    }
    if (offer?.promoMinQuantity) {
      setQuantity(offer.promoMinQuantity);
    }
  }, [offer, allowedFulfillment]);

  // Payment Methods permitidos
  const allowedPaymentMethods = useMemo(() => {
    return offer?.promoPaymentMethods && offer.promoPaymentMethods.length > 0
      ? offer.promoPaymentMethods
      : ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'];
  }, [offer]);

  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH'>('PIX');

  useEffect(() => {
    if (allowedPaymentMethods.length > 0 && !allowedPaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(allowedPaymentMethods[0] as any);
    }
  }, [allowedPaymentMethods]);

  // Dados do Cliente
  const [customerName, setCustomerName] = useState(() => localStorage.getItem('adegafood_cust_name') || '');
  const [customerPhone, setCustomerPhone] = useState(() => localStorage.getItem('adegafood_cust_phone') || '');
  const [customerEmail, setCustomerEmail] = useState(() => supabaseUser?.email || '');

  // Endereço de Entrega
  const [streetAddress, setStreetAddress] = useState(() => localStorage.getItem('adegafood_cust_street') || '');
  const [addressNumber, setAddressNumber] = useState(() => localStorage.getItem('adegafood_cust_number') || '');
  const [neighborhood, setNeighborhood] = useState(() => localStorage.getItem('adegafood_cust_neighborhood') || '');
  const [complement, setComplement] = useState('');
  const [reference, setReference] = useState('');

  // Troco e Notas
  const [cashChange, setCashChange] = useState('');
  const [orderNotes, setOrderNotes] = useState('');

  // Cupom
  const [couponCodeInput, setCouponCodeInput] = useState(() => offer?.promoCouponCode || '');
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(() => offer?.promoCouponCode || null);
  const [couponDiscount, setCouponDiscount] = useState<number>(0);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Autenticação integrada
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Submissão
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sincroniza usuário autenticado
  useEffect(() => {
    if (supabaseUser?.email) {
      setCustomerEmail(supabaseUser.email);
    }
  }, [supabaseUser]);

  if (!offer) return null;

  // Preços oficiais
  const unitPrice = offer.promoPrice || offer.promotionalPrice || offer.originalPrice || 0;
  const originalPrice = offer.promoOriginalPrice || offer.originalPrice || unitPrice;
  const hasDiscount = originalPrice > unitPrice;
  const discountPct = offer.promoDiscountPercentage || (hasDiscount ? Math.round(((originalPrice - unitPrice) / originalPrice) * 100) : 0);
  const economyPerUnit = Math.max(0, originalPrice - unitPrice);
  const totalEconomy = economyPerUnit * quantity;

  const subtotal = Number((unitPrice * quantity).toFixed(2));
  
  // Taxa de Entrega
  const isFreeDelivery = Boolean(
    storeData.settings.freeDeliveryThreshold &&
    subtotal >= storeData.settings.freeDeliveryThreshold
  );
  const deliveryFee = fulfillmentType === 'DELIVERY'
    ? (isFreeDelivery ? 0 : Number(storeData.settings.deliveryFee || 0))
    : 0;

  const finalTotal = Math.max(0, Number((subtotal + deliveryFee - couponDiscount).toFixed(2)));

  // Validação de esgotado
  const isSoldOut = Boolean(
    offer.isExhausted ||
    (offer.promoUsageLimit && offer.promoUsageLimit > 0 && (offer.promoTimesUsed || 0) >= offer.promoUsageLimit)
  );

  const remainingUses = offer.promoUsageLimit && offer.promoUsageLimit > 0
    ? Math.max(0, offer.promoUsageLimit - (offer.promoTimesUsed || 0))
    : null;

  // Handlers de Quantidade
  const handleIncrease = () => {
    if (quantity < maxQty) {
      setQuantity(prev => prev + 1);
    } else {
      showToast({
        type: 'warning',
        title: 'Limite Máximo',
        message: `O limite máximo desta oferta é de ${maxQty} unidades por pedido.`,
      });
    }
  };

  const handleDecrease = () => {
    if (quantity > minQty) {
      setQuantity(prev => prev - 1);
    }
  };

  // Aplicação de Cupom
  const handleApplyCoupon = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!couponCodeInput.trim() || !storeData.tenant.id) return;

    setIsApplyingCoupon(true);
    setCouponError(null);

    try {
      const coupon = await promotionRepository.validateCoupon(
        storeData.tenant.id,
        couponCodeInput.trim(),
        subtotal,
        supabaseUser?.id
      );

      if (!coupon) {
        setCouponError('Cupom inválido ou expirado.');
        setAppliedCouponCode(null);
        setCouponDiscount(0);
        return;
      }

      let calculated = 0;
      if (coupon.discountType === 'PERCENTAGE') {
        calculated = (subtotal * coupon.discountValue) / 100;
      } else {
        calculated = coupon.discountValue;
      }

      setCouponDiscount(Number(Math.min(subtotal, calculated).toFixed(2)));
      setAppliedCouponCode(coupon.code);
      showToast({
        type: 'success',
        title: 'Cupom Aplicado!',
        message: `Desconto de R$ ${calculated.toFixed(2)} aplicado com sucesso.`,
      });
    } catch (err: any) {
      setCouponError(err.message || 'Erro ao validar cupom.');
      setAppliedCouponCode(null);
      setCouponDiscount(0);
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  // Login inline
  const handleGoogleLogin = async () => {
    setIsAuthenticating(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Falha no Login', message: err.message || 'Erro ao entrar com Google.' });
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    try {
      if (authMode === 'login') {
        await signInWithEmail(authEmail, authPassword);
      } else {
        await signUpWithEmail(authEmail, authPassword, authName);
      }
      showToast({ type: 'success', title: 'Conectado!', message: 'Login realizado com sucesso.' });
    } catch (err: any) {
      showToast({ type: 'error', title: 'Falha na Autenticação', message: err.message || 'Verifique seus dados.' });
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Submissão do Pedido Promocional Real
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSoldOut) {
      showToast({
        type: 'error',
        title: 'Promoção Esgotada',
        message: 'Esta promoção atingiu o limite máximo de compras e foi esgotada.',
      });
      return;
    }

    if (!supabaseUser) {
      showToast({
        type: 'warning',
        title: 'Identificação Obrigatória',
        message: 'Entre na sua conta para confirmar seu pedido e acompanhar a entrega.',
      });
      return;
    }

    if (!customerName.trim()) {
      showToast({ type: 'warning', title: 'Nome Obrigatório', message: 'Por favor, informe seu nome completo.' });
      return;
    }

    const cleanPhone = customerPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      showToast({ type: 'warning', title: 'WhatsApp Inválido', message: 'Informe seu WhatsApp com DDD (ex: 11 98765-4321).' });
      return;
    }

    if (fulfillmentType === 'DELIVERY') {
      if (!streetAddress.trim() || !addressNumber.trim()) {
        showToast({ type: 'warning', title: 'Endereço Incompleto', message: 'Rua e número são obrigatórios para entrega.' });
        return;
      }
    }

    // Salva no localStorage para próxima visita
    try {
      localStorage.setItem('adegafood_cust_name', customerName);
      localStorage.setItem('adegafood_cust_phone', customerPhone);
      if (streetAddress) localStorage.setItem('adegafood_cust_street', streetAddress);
      if (addressNumber) localStorage.setItem('adegafood_cust_number', addressNumber);
      if (neighborhood) localStorage.setItem('adegafood_cust_neighborhood', neighborhood);
    } catch {
      // ignore
    }

    const fullDeliveryAddress = fulfillmentType === 'DELIVERY'
      ? `${streetAddress.trim()}, ${addressNumber.trim()}${neighborhood.trim() ? ` - ${neighborhood.trim()}` : ''}${complement.trim() ? ` (${complement.trim()})` : ''}`
      : `Retirada no Balcão: ${storeData.settings.address || 'Loja Física'}`;

    const notesWithCash = paymentMethod === 'CASH' && cashChange
      ? `${orderNotes ? `${orderNotes} | ` : ''}Troco para: R$ ${cashChange}`
      : orderNotes;

    const finalNotes = appliedCouponCode
      ? `${notesWithCash ? `${notesWithCash} | ` : ''}[Oferta: ${offer.title} | Cupom: ${appliedCouponCode}]`
      : `${notesWithCash ? `${notesWithCash} | ` : ''}[Oferta: ${offer.title}]`;

    setIsSubmitting(true);
    try {
      const result = await orderService.createPromotional(storeData.tenant.slug, {
        offerId: offer.id,
        quantity,
        customerName: customerName.trim(),
        customerPhone: `+55${cleanPhone}`,
        customerEmail: supabaseUser.email || undefined,
        deliveryAddress: fullDeliveryAddress,
        addressDetails: {
          street: streetAddress,
          number: addressNumber,
          complement: complement || undefined,
          neighborhood: neighborhood || '',
          city: storeData.settings.city || 'São Paulo',
          state: 'SP',
          reference: reference || undefined,
        },
        paymentMethod,
        fulfillmentType,
        notes: finalNotes,
        couponCode: appliedCouponCode || undefined,
      });

      showToast({
        type: 'success',
        title: '🎉 Pedido Promocional Confirmado!',
        message: `Pedido #${result.order.orderNumber || result.order.id.slice(0, 6)} finalizado com sucesso!`,
      });

      onOrderCompleted(result.order, result.celebrationMessage);
      onClose();
    } catch (err: any) {
      console.error('[PromotionalCheckoutModal] Erro ao criar pedido promocional:', err);
      showToast({
        type: 'error',
        title: 'Erro ao Finalizar',
        message: err.message || 'Falha ao processar pedido promocional no servidor.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const mediaSource = offer.mediaUrl || offer.imageUrl;
  const isVideo = offer.mediaType === 'VIDEO';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="⚡ Checkout da Promoção Exclusiva"
      size="lg"
    >
      <div className="space-y-4 max-h-[85vh] overflow-y-auto pr-1">
        {/* BANNER / CRIATIVO DA OFERTA */}
        <div className="relative rounded-2xl overflow-hidden shadow-sm aspect-16/9 bg-black flex items-center justify-center border border-amber-300/40">
          {isVideo && mediaSource ? (
            <video
              src={mediaSource}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover object-center"
            />
          ) : mediaSource ? (
            <img
              src={mediaSource}
              alt={offer.promoTitle || offer.title}
              className="w-full h-full object-cover object-center"
            />
          ) : (
            <div className="text-white/40 text-xs">Mídia promocional</div>
          )}

          {/* Badge flutuante de escassez ou destaque */}
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 z-10">
            {offer.badge && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/90 backdrop-blur-md text-amber-950 border border-white shadow-xs">
                {offer.badge}
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-gray-950 flex items-center gap-1 shadow-xs">
              <Flame className="w-3 h-3 fill-current" />
              Oferta Especial
            </span>
          </div>

          {remainingUses !== null && remainingUses <= 15 && (
            <div className="absolute bottom-3 right-3 z-10 px-2.5 py-1 rounded-full bg-rose-600/90 backdrop-blur-md text-white text-[10px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1 animate-pulse">
              <AlertCircle className="w-3 h-3" />
              {remainingUses === 0 ? 'Esgotado!' : `Restam apenas ${remainingUses} un!`}
            </div>
          )}
        </div>

        {/* DETALHES DO PRODUTO & PREÇO PROMOCIONAL */}
        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-black text-gray-900 tracking-tight leading-snug">
                {offer.promoTitle || offer.title}
              </h2>
              {(offer.promoDescription || offer.description) && (
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                  {offer.promoDescription || offer.description}
                </p>
              )}
            </div>

            {/* Bloco de Preço e Economia */}
            <div className="sm:text-right shrink-0">
              <div className="flex sm:flex-col items-baseline sm:items-end gap-2 sm:gap-0">
                <span className="text-2xl font-black font-mono text-emerald-700 tracking-tight">
                  R$ {unitPrice.toFixed(2)}
                </span>
                {hasDiscount && (
                  <span className="text-xs font-mono text-gray-400 line-through">
                    R$ {originalPrice.toFixed(2)}
                  </span>
                )}
              </div>
              {hasDiscount && (
                <div className="mt-1">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-600 text-white shadow-2xs">
                    Economia de R$ {economyPerUnit.toFixed(2)} ({discountPct}% OFF)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Observações da Oferta */}
          {offer.promoNotes && (
            <div className="text-[11px] bg-white/70 p-2.5 rounded-xl border border-amber-200/60 text-amber-900 flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" />
              <span>{offer.promoNotes}</span>
            </div>
          )}

          {/* SELETOR DE QUANTIDADE */}
          <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-gray-800 block">Quantidade da Promoção:</span>
              <span className="text-[10px] text-gray-500">
                (Mín: {minQty} | Máx por cliente: {maxQty})
              </span>
            </div>

            <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-xl border border-amber-300 shadow-2xs">
              <button
                type="button"
                onClick={handleDecrease}
                disabled={quantity <= minQty || isSoldOut}
                className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 flex items-center justify-center font-bold cursor-pointer transition-all"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-8 text-center font-mono font-black text-sm text-gray-900">
                {quantity}
              </span>
              <button
                type="button"
                onClick={handleIncrease}
                disabled={quantity >= maxQty || isSoldOut}
                className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed text-gray-950 flex items-center justify-center font-bold cursor-pointer transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ALERTA DE ESGOTADO SE APLICÁVEL */}
        {isSoldOut ? (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
            <h3 className="text-sm font-black text-rose-900">Promoção Totalmente Esgotada!</h3>
            <p className="text-xs text-rose-700 max-w-sm mx-auto">
              Todos os {offer.promoUsageLimit} clientes participantes já garantiram esta oferta. Fique atento às próximas novidades do estabelecimento.
            </p>
          </div>
        ) : (
          <>
            {/* AUTENTICAÇÃO DO CLIENTE (NÃO EXISTE CHECKOUT ANÔNIMO) */}
            {!supabaseUser ? (
              <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
                      1. Identifique-se para Aproveitar a Oferta
                    </h3>
                    <p className="text-[11px] text-gray-500">
                      Para sua segurança e rastreio do pedido, conecte sua conta de cliente:
                    </p>
                  </div>
                </div>

                {/* Google Login */}
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isAuthenticating}
                  className="w-full py-2.5 px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-2xs flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  {isAuthenticating ? (
                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                  ) : (
                    <>
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                      <span>Entrar com Google</span>
                    </>
                  )}
                </button>

                <div className="relative flex items-center justify-center my-1">
                  <div className="border-t border-gray-200 w-full" />
                  <span className="bg-white px-2 text-[10px] text-gray-400 uppercase font-bold">ou e-mail</span>
                </div>

                <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl text-xs">
                  <button
                    type="button"
                    onClick={() => setAuthMode('login')}
                    className={`py-1 rounded-lg font-bold transition-all ${
                      authMode === 'login' ? 'bg-white shadow-xs text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    Já tenho conta
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('signup')}
                    className={`py-1 rounded-lg font-bold transition-all ${
                      authMode === 'signup' ? 'bg-white shadow-xs text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    Criar conta
                  </button>
                </div>

                <form onSubmit={handleEmailAuth} className="space-y-2">
                  {authMode === 'signup' && (
                    <Input
                      label="Nome Completo"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Ex: Carlos Silva"
                      required
                      className="text-xs"
                    />
                  )}
                  <Input
                    label="E-mail"
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                    className="text-xs"
                  />
                  <Input
                    label="Senha"
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Mínimo 6 dígitos"
                    required
                    className="text-xs"
                  />
                  <Button
                    type="submit"
                    disabled={isAuthenticating}
                    className="w-full text-xs font-bold py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl"
                  >
                    {isAuthenticating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : authMode === 'login' ? 'Entrar' : 'Cadastrar e Continuar'}
                  </Button>
                </form>
              </div>
            ) : (
              /* FORMULÁRIO DE ENTREGA E PAGAMENTO */
              <form onSubmit={handleSubmitOrder} className="space-y-4">
                {/* Badge de Cliente Conectado */}
                <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-emerald-700 text-white flex items-center justify-center font-bold text-[10px]">
                      ✓
                    </div>
                    <span className="font-bold text-emerald-950">Conectado como: {supabaseUser.email}</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Cliente Verificado</span>
                </div>

                {/* DADOS BÁSICOS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    label="Seu Nome Completo *"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nome e Sobrenome"
                    required
                    className="text-xs"
                  />
                  <Input
                    label="Seu WhatsApp com DDD *"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="11 98765-4321"
                    required
                    className="text-xs"
                  />
                </div>

                {/* MODALIDADE DE ENTREGA */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                    Tipo de Recebimento
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {allowedFulfillment.includes('DELIVERY') && (
                      <button
                        type="button"
                        onClick={() => setFulfillmentType('DELIVERY')}
                        className={`p-3 rounded-xl border-2 flex items-center gap-2 cursor-pointer transition-all ${
                          fulfillmentType === 'DELIVERY'
                            ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold shadow-xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Truck className="w-4 h-4 shrink-0 text-emerald-700" />
                        <div className="text-left">
                          <span className="text-xs block">Entrega</span>
                          <span className="text-[10px] text-gray-500">
                            {isFreeDelivery ? 'Grátis' : `Taxa: R$ ${Number(storeData.settings.deliveryFee || 0).toFixed(2)}`}
                          </span>
                        </div>
                      </button>
                    )}

                    {allowedFulfillment.includes('PICKUP') && (
                      <button
                        type="button"
                        onClick={() => setFulfillmentType('PICKUP')}
                        className={`p-3 rounded-xl border-2 flex items-center gap-2 cursor-pointer transition-all ${
                          fulfillmentType === 'PICKUP'
                            ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold shadow-xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Store className="w-4 h-4 shrink-0 text-emerald-700" />
                        <div className="text-left">
                          <span className="text-xs block">Retirar no Balcão</span>
                          <span className="text-[10px] text-gray-500">Sem taxa de entrega</span>
                        </div>
                      </button>
                    )}
                  </div>
                </div>

                {/* CAMPOS DE ENDEREÇO SE DELIVERY */}
                {fulfillmentType === 'DELIVERY' && (
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <Input
                          label="Rua / Logradouro *"
                          value={streetAddress}
                          onChange={(e) => setStreetAddress(e.target.value)}
                          placeholder="Av. Paulista"
                          required
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <Input
                          label="Número *"
                          value={addressNumber}
                          onChange={(e) => setAddressNumber(e.target.value)}
                          placeholder="1000"
                          required
                          className="text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Bairro"
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        placeholder="Bela Vista"
                        className="text-xs"
                      />
                      <Input
                        label="Complemento"
                        value={complement}
                        onChange={(e) => setComplement(e.target.value)}
                        placeholder="Apto 42 / Bloco B"
                        className="text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* FORMAS DE PAGAMENTO */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                    Forma de Pagamento
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {allowedPaymentMethods.includes('PIX') && (
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('PIX')}
                        className={`p-2.5 rounded-xl border-2 flex flex-col items-center gap-1.5 cursor-pointer transition-all ${
                          paymentMethod === 'PIX'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <QrCode className="w-4 h-4 text-emerald-600" />
                        <span className="text-[11px]">PIX Online</span>
                      </button>
                    )}

                    {allowedPaymentMethods.includes('CREDIT_CARD') && (
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('CREDIT_CARD')}
                        className={`p-2.5 rounded-xl border-2 flex flex-col items-center gap-1.5 cursor-pointer transition-all ${
                          paymentMethod === 'CREDIT_CARD'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <CreditCard className="w-4 h-4 text-emerald-600" />
                        <span className="text-[11px]">Crédito</span>
                      </button>
                    )}

                    {allowedPaymentMethods.includes('DEBIT_CARD') && (
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('DEBIT_CARD')}
                        className={`p-2.5 rounded-xl border-2 flex flex-col items-center gap-1.5 cursor-pointer transition-all ${
                          paymentMethod === 'DEBIT_CARD'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <CreditCard className="w-4 h-4 text-emerald-600" />
                        <span className="text-[11px]">Débito</span>
                      </button>
                    )}

                    {allowedPaymentMethods.includes('CASH') && (
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('CASH')}
                        className={`p-2.5 rounded-xl border-2 flex flex-col items-center gap-1.5 cursor-pointer transition-all ${
                          paymentMethod === 'CASH'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Banknote className="w-4 h-4 text-emerald-600" />
                        <span className="text-[11px]">Dinheiro</span>
                      </button>
                    )}
                  </div>

                  {paymentMethod === 'CASH' && (
                    <div className="pt-1">
                      <Input
                        label="Precisa de troco para quanto? (Deixe em branco se não precisar)"
                        value={cashChange}
                        onChange={(e) => setCashChange(e.target.value)}
                        placeholder="Ex: 50.00"
                        className="text-xs"
                      />
                    </div>
                  )}
                </div>

                {/* CUPOM DE DESCONTO */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                    Cupom Promocional
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={couponCodeInput}
                      onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                      placeholder="Código do cupom"
                      className="text-xs font-mono uppercase"
                    />
                    <Button
                      type="button"
                      onClick={handleApplyCoupon}
                      disabled={isApplyingCoupon || !couponCodeInput.trim()}
                      className="text-xs font-bold px-4 bg-gray-900 text-white rounded-xl"
                    >
                      {isApplyingCoupon ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Aplicar'}
                    </Button>
                  </div>
                  {couponError && <p className="text-[11px] text-rose-600">{couponError}</p>}
                  {appliedCouponCode && couponDiscount > 0 && (
                    <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Cupom {appliedCouponCode} aplicado (-R$ {couponDiscount.toFixed(2)})
                    </p>
                  )}
                </div>

                {/* OBSERVAÇÃO */}
                <div>
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-1">
                    Instrução / Observação do Pedido (Opcional)
                  </label>
                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    rows={2}
                    placeholder="Ex: Tocar a campainha, bebidas bem geladas..."
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 font-medium"
                  />
                </div>

                {/* RESUMO FINANCEIRO TRANSPARENTE */}
                <div className="p-3.5 bg-gray-900 text-white rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-300">
                    <span>Subtotal da Oferta ({quantity}x {offer.promoUnit || 'un'})</span>
                    <span className="font-mono font-bold">R$ {subtotal.toFixed(2)}</span>
                  </div>

                  {fulfillmentType === 'DELIVERY' && (
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span>Taxa de Entrega</span>
                      <span className="font-mono font-bold">
                        {isFreeDelivery ? 'Grátis' : `R$ ${deliveryFee.toFixed(2)}`}
                      </span>
                    </div>
                  )}

                  {totalEconomy > 0 && (
                    <div className="flex items-center justify-between text-xs text-emerald-400">
                      <span>Economia Total na Promoção</span>
                      <span className="font-mono font-bold">- R$ {totalEconomy.toFixed(2)}</span>
                    </div>
                  )}

                  {couponDiscount > 0 && (
                    <div className="flex items-center justify-between text-xs text-amber-300">
                      <span>Desconto Cupom ({appliedCouponCode})</span>
                      <span className="font-mono font-bold">- R$ {couponDiscount.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-gray-700 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-black uppercase tracking-wider block">Total a Pagar</span>
                      <span className="text-[10px] text-gray-400">Valores auditados pelo servidor</span>
                    </div>
                    <span className="text-xl font-black font-mono text-emerald-400">
                      R$ {finalTotal.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* BOTÃO FINALIZAR PEDIDO */}
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl shadow-md cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Processando Pedido Oficial...</span>
                    </>
                  ) : (
                    <>
                      <span>Finalizar Pedido da Promoção</span>
                      <ArrowRight className="w-4 h-4 stroke-[3]" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
