import React, { useState, useRef, useEffect } from 'react';
import { isN1N6Backend } from '../../lib/backendSchema';
import { promotionRepository, normalizeCouponCode } from '../../repositories/promotionRepository';
import { newIdempotencyKey } from '../../lib/backend';
import { Barcode, Search, X, Plus, Minus, ShoppingBag, DollarSign } from 'lucide-react';
import { Product, SelectedProductOption } from '../../types';
import { formatBRL } from '../../lib/pricing/money';
import { ProductOptionsSelector } from '../client/customer/ProductOptionsSelector';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { optionPriceCents, validateOptionSelection } from '../../lib/addons';

interface PDVModalProps {
  isOpen: boolean;
  /** Loja ativa — cupom é validado no servidor (validate_coupon_pos). */
  tenantId: string;
  products: Product[];
  addonsEnabled: boolean;
  onClose: () => void;
  onSubmit: (data: {
    customerName: string;
    customerPhone: string;
    items: Array<{ productId: string; quantity: number; notes?: string; options?: SelectedProductOption[] }>;
    paymentMethod: 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX';
    notes?: string;
    couponCode?: string;
    idempotencyKey: string;
  }) => Promise<void>;
}

export const PDVModal: React.FC<PDVModalProps> = ({
  isOpen,
  tenantId,
  products,
  addonsEnabled,
  onClose,
  onSubmit,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<Array<{ key: string; product: Product; quantity: number; options?: SelectedProductOption[] }>>([]);
  const [catalogProducts, setCatalogProducts] = useState(products);
  const [optionsProduct, setOptionsProduct] = useState<Product | null>(null);
  const [optionChoices, setOptionChoices] = useState<SelectedProductOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  // Sem nome/telefone fictícios: em branco, o servidor registra "Cliente Balcão" sem telefone.
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [couponPreview, setCouponPreview] = useState<{ code: string; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const saleKey = useRef<string>(newIdempotencyKey());
  // Cupom no PDV só existe no N1–N6 (validate_coupon_pos / process_pos_sale_atomic).
  const couponsEnabled = isN1N6Backend();
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX'>('PIX');
  const [cashChange, setCashChange] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // A prévia do cupom vale para o carrinho validado; qualquer mudança exige validar de novo.
  // Todos os hooks precisam vir antes do early return (React #310).
  useEffect(() => {
    setCouponPreview(null);
  }, [cart]);

  useEffect(() => {
    let alive = true;
    async function loadOptions() {
      setCatalogProducts(products);
      if (!isOpen || !addonsEnabled) return;
      try {
        const byProduct = await productOptionRepository.getPublicForProducts(tenantId, products.map(product => product.id));
        if (alive) setCatalogProducts(products.map(product => ({ ...product, optionGroups: byProduct.get(product.id) || [] })));
        if (alive) setOptionsError(null);
      } catch (error) {
        if (alive) setOptionsError((error as Error).message);
      }
    }
    void loadOptions();
    return () => { alive = false; };
  }, [isOpen, addonsEnabled, tenantId, products]);

  if (!isOpen) return null;

  const filteredProducts = catalogProducts.filter(p => {
    const term = searchTerm.toLowerCase();
    const matchName = p.name.toLowerCase().includes(term);
    const matchSku = p.sku && p.sku.toLowerCase().includes(term);
    return matchName || matchSku;
  });

  const cartKey = (productId: string, options: SelectedProductOption[] = []) =>
    options.length ? `${productId}::${options.map(item => `${item.groupId}:${item.optionId}:${item.qty}`).sort().join('|')}` : productId;

  const handleAddToCart = (product: Product, options?: SelectedProductOption[]) => {
    if (addonsEnabled && product.optionGroups?.some(group => group.active) && !options) {
      setOptionsProduct(product);
      setOptionChoices([]);
      return;
    }
    const selections = options || [];
    if (product.optionGroups?.length && !validateOptionSelection(product.optionGroups, selections).valid) return;
    const key = cartKey(product.id, selections);
    setCart(prev => {
      const idx = prev.findIndex(item => item.key === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx].quantity += 1;
        return next;
      }
      return [...prev, { key, product, quantity: 1, options: selections }];
    });
  };

  const handleUpdateQuantity = (itemKey: string, delta: number) => {
    setCart(prev => {
      return prev
        .map(item => {
          if (item.key === itemKey) {
            const newQtd = item.quantity + delta;
            return newQtd > 0 ? { ...item, quantity: newQtd } : null;
          }
          return item;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
    });
  };

  // Prévia: o total oficial (preço efetivo, cupom) é calculado em process_pos_sale_atomic.
  const subtotalPreview = cart.reduce((sum, item) =>
    sum + (item.product.price + optionPriceCents(item.product.optionGroups || [], item.options || []) / 100) * item.quantity, 0);
  const totalAmount = Math.max(0, subtotalPreview - (couponPreview?.discount || 0));

  const handleApplyCoupon = async () => {
    const code = normalizeCouponCode(couponInput);
    if (!code || cart.length === 0) return;
    setCouponLoading(true);
    setCouponMsg(null);
    try {
      const res = await promotionRepository.validateCouponPos(
        tenantId,
        code,
        cart.map(i => ({ productId: i.product.id, quantity: i.quantity, options: i.options })),
        undefined
      );
      if (res.valid) {
        setCouponPreview({ code: res.code || code, discount: res.discount });
        setCouponMsg(res.message);
      } else {
        setCouponPreview(null);
        setCouponMsg(res.message);
      }
    } catch (err: any) {
      setCouponPreview(null);
      setCouponMsg(err.message || 'Falha ao validar cupom.');
    } finally {
      setCouponLoading(false);
    }
  };

  const handleFinishSale = async () => {
    if (cart.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const notes = paymentMethod === 'CASH' && cashChange
        ? `Venda Balcão | Troco para: R$ ${cashChange}`
        : 'Venda direta realizada pela frente de caixa (PDV).';

      await onSubmit({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        paymentMethod,
        notes,
        couponCode: couponPreview?.code,
        idempotencyKey: saleKey.current,
        items: cart.map(i => ({
          productId: i.product.id,
          quantity: i.quantity,
          options: i.options,
        })),
      });

      setCart([]);
      setCouponPreview(null);
      setCouponInput('');
      setCouponMsg(null);
      saleKey.current = newIdempotencyKey();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-gray-200 rounded-3xl w-full max-w-[95vw] 2xl:max-w-[1600px] h-[95vh] sm:h-[90vh] flex flex-col overflow-hidden shadow-2xl text-gray-900 font-sans">
        {/* Header do PDV */}
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 rounded-xl text-emerald-700">
              <Barcode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base">Frente de Caixa (PDV Balcão)</h3>
              <p className="text-xs text-gray-500">Venda rápida presencial com baixa automática em estoque</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo do PDV */}
        <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-hidden">
          {optionsError && <p role="alert" className="md:col-span-12 px-4 pt-3 text-xs font-semibold text-rose-700">{optionsError}</p>}
          {optionsProduct && (
            <div className="md:col-span-12 max-h-64 overflow-y-auto border-b border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-sm">Opções de {optionsProduct.name}</h4>
                <button type="button" onClick={() => setOptionsProduct(null)} className="text-xs text-gray-500">Cancelar</button>
              </div>
              <ProductOptionsSelector groups={optionsProduct.optionGroups || []} selections={optionChoices} onChange={setOptionChoices} />
              <div className="flex justify-end">
                <button type="button"
                  disabled={!validateOptionSelection(optionsProduct.optionGroups || [], optionChoices).valid}
                  onClick={() => { handleAddToCart(optionsProduct, optionChoices); setOptionsProduct(null); }}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  Adicionar item · {formatBRL(optionsProduct.price + optionPriceCents(optionsProduct.optionGroups || [], optionChoices) / 100)}
                </button>
              </div>
            </div>
          )}
          {/* Lado Esquerdo: Catálogo */}
          <div className="md:col-span-7 p-4 border-r border-gray-200 overflow-y-auto space-y-3.5">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Bipar código de barras ou buscar produto..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 transition-colors"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5 max-h-[64vh] overflow-y-auto pr-1">
              {filteredProducts.length === 0 ? (
                <div className="col-span-2 text-center py-12 text-gray-400 text-xs">
                  Nenhum produto cadastrado ou correspondente à busca.
                </div>
              ) : (
                filteredProducts.map(prod => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => handleAddToCart(prod)}
                    className="p-3 bg-gray-50 border border-gray-200 hover:border-emerald-500/60 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <span className="text-xs font-bold text-gray-900 group-hover:text-emerald-700 line-clamp-1">
                        {prod.name}
                      </span>
                      <span className="text-[10px] text-gray-500 mt-0.5 block">
                        Estoque: {prod.stockQuantity} {prod.unit || 'un'}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-black text-emerald-700 mt-2">
                      {formatBRL(prod.price)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Lado Direito: Carrinho e Fechamento */}
          <div className="md:col-span-5 p-4 flex flex-col justify-between bg-gray-50/60">
            <div className="space-y-4 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold text-gray-500 uppercase tracking-widest">
                  Itens no Caixa ({cart.length})
                </h4>
                {cart.length > 0 && (
                  <button
                    onClick={() => setCart([])}
                    className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                  >
                    Limpar
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-xs space-y-1">
                  <ShoppingBag className="w-8 h-8 mx-auto text-gray-300 mb-1" />
                  <p>Clique nos produtos à esquerda para adicionar.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[36vh] overflow-y-auto pr-1">
                  {cart.map(item => (
                    <div key={item.key} className="p-2.5 bg-white border border-gray-200 rounded-xl flex items-center justify-between">
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="text-xs font-bold text-gray-900 truncate block">{item.product.name}</span>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {formatBRL(item.product.price + optionPriceCents(item.product.optionGroups || [], item.options || []) / 100)} un.
                        </span>
                        {item.options?.map(option => {
                          const group = item.product.optionGroups?.find(candidate => candidate.id === option.groupId);
                          const selected = group?.options.find(candidate => candidate.id === option.optionId);
                          return <span key={option.optionId} className="block text-[9px] text-gray-500">+ {selected?.name || ''}</span>;
                        })}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button 
                          onClick={() => handleUpdateQuantity(item.key, -1)}
                          className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-900 flex items-center justify-center font-bold text-xs cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-bold text-xs w-6 text-center">{item.quantity}</span>
                        <button 
                          onClick={() => handleUpdateQuantity(item.key, 1)}
                          className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-900 flex items-center justify-center font-bold text-xs cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Forma de Pagamento */}
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider block font-bold">
                  Forma de Pagamento
                </label>
                <div className="grid grid-cols-4 gap-1.5 text-xs">
                  {(['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD'] as const).map(forma => (
                    <button
                      key={forma}
                      type="button"
                      onClick={() => setPaymentMethod(forma)}
                      className={`py-2 px-1 rounded-xl text-center font-mono font-bold text-[10px] border cursor-pointer transition-all ${
                        paymentMethod === forma 
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm' 
                          : 'bg-gray-100 text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {forma === 'CASH' ? 'Dinheiro' : forma === 'CREDIT_CARD' ? 'Crédito' : forma === 'DEBIT_CARD' ? 'Débito' : 'PIX'}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'CASH' && (
                  <input 
                    type="number"
                    placeholder="Troco para quanto? Ex: 50.00"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                  />
                )}
              </div>
            </div>

            {/* Cupom (CASHIER pode aplicar; criar/editar é só OWNER/MANAGER) */}
            {couponsEnabled && (
            <div className="space-y-1.5 pt-2 border-t border-gray-200">
              <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider block font-bold">Cupom</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={couponInput}
                  onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponPreview(null); setCouponMsg(null); }}
                  placeholder="CÓDIGO"
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={couponLoading || !couponInput.trim() || cart.length === 0}
                  className="px-3 py-2 rounded-xl text-[10px] font-bold bg-gray-100 text-gray-700 disabled:opacity-50 cursor-pointer"
                >
                  {couponLoading ? '...' : 'Aplicar'}
                </button>
              </div>
              {couponMsg && <p className={`text-[10px] ${couponPreview ? 'text-emerald-700' : 'text-rose-600'}`}>{couponMsg}</p>}
            </div>
            )}

            {/* Total e Fechar */}
            <div className="pt-3 border-t border-gray-200 space-y-3">
              {couponPreview && (
                <div className="flex justify-between items-center font-mono text-[11px] text-emerald-700">
                  <span>Desconto ({couponPreview.code})</span>
                  <span>- {formatBRL(couponPreview.discount)}</span>
                </div>
              )}
              <div className="flex justify-between items-center font-mono">
                <span className="text-gray-500 text-xs">TOTAL (prévia):</span>
                <span className="text-xl font-black text-emerald-700">
                  {formatBRL(totalAmount)}
                </span>
              </div>

              <button
                disabled={cart.length === 0 || isSubmitting}
                onClick={handleFinishSale}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-200 disabled:text-gray-400 text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-transform active:scale-98 shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
              >
                {isSubmitting ? 'Registrando...' : 'Finalizar Venda no Caixa'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
