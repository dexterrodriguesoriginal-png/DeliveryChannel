import React, { useState, useMemo } from 'react';
import { Barcode, Search, X, Plus, Minus, ShoppingBag, DollarSign } from 'lucide-react';
import { Product } from '../../types';

interface PDVModalProps {
  isOpen: boolean;
  products: Product[];
  onClose: () => void;
  onSubmit: (data: {
    customerName: string;
    customerPhone: string;
    items: Array<{ productId: string; quantity: number; notes?: string }>;
    paymentMethod: 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX';
    notes?: string;
  }) => Promise<void>;
}

export const PDVModal: React.FC<PDVModalProps> = ({
  isOpen,
  products,
  onClose,
  onSubmit,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [customerName, setCustomerName] = useState('Consumidor Balcão');
  const [customerPhone, setCustomerPhone] = useState('(00) 00000-0000');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX'>('PIX');
  const [cashChange, setCashChange] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const filteredProducts = products.filter(p => {
    const term = searchTerm.toLowerCase();
    const matchName = p.name.toLowerCase().includes(term);
    const matchSku = p.sku && p.sku.toLowerCase().includes(term);
    return matchName || matchSku;
  });

  const handleAddToCart = (product: Product) => {
    setCart(prev => {
      const idx = prev.findIndex(item => item.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx].quantity += 1;
        return next;
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (productId: string, delta: number) => {
    setCart(prev => {
      return prev
        .map(item => {
          if (item.product.id === productId) {
            const newQtd = item.quantity + delta;
            return newQtd > 0 ? { ...item, quantity: newQtd } : null;
          }
          return item;
        })
        .filter(Boolean) as Array<{ product: Product; quantity: number }>;
    });
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  const handleFinishSale = async () => {
    if (cart.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const notes = paymentMethod === 'CASH' && cashChange
        ? `Venda Balcão | Troco para: R$ ${cashChange}`
        : 'Venda direta realizada pela frente de caixa (PDV).';

      await onSubmit({
        customerName: customerName.trim() || 'Consumidor Balcão',
        customerPhone: customerPhone.trim() || '(00) 00000-0000',
        paymentMethod,
        notes,
        items: cart.map(i => ({
          productId: i.product.id,
          quantity: i.quantity,
        })),
      });

      setCart([]);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#18181b] border border-zinc-800 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl text-zinc-100 font-sans">
        {/* Header do PDV */}
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-[#121214]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400">
              <Barcode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Frente de Caixa (PDV Balcão)</h3>
              <p className="text-xs text-zinc-400">Venda rápida presencial com baixa automática em estoque</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo do PDV */}
        <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-hidden">
          {/* Lado Esquerdo: Catálogo */}
          <div className="md:col-span-7 p-4 border-r border-zinc-800 overflow-y-auto space-y-3.5">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Bipar código de barras ou buscar produto..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#121214] border border-zinc-800 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5 max-h-[52vh] overflow-y-auto pr-1">
              {filteredProducts.length === 0 ? (
                <div className="col-span-2 text-center py-12 text-zinc-500 text-xs">
                  Nenhum produto cadastrado ou correspondente à busca.
                </div>
              ) : (
                filteredProducts.map(prod => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => handleAddToCart(prod)}
                    className="p-3 bg-[#121214] border border-zinc-800 hover:border-emerald-500/60 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <span className="text-xs font-bold text-white group-hover:text-emerald-400 line-clamp-1">
                        {prod.name}
                      </span>
                      <span className="text-[10px] text-zinc-400 mt-0.5 block">
                        Estoque: {prod.stockQuantity} {prod.unit || 'un'}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-black text-emerald-400 mt-2">
                      R$ {prod.price.toFixed(2)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Lado Direito: Carrinho e Fechamento */}
          <div className="md:col-span-5 p-4 flex flex-col justify-between bg-[#141416]">
            <div className="space-y-4 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest">
                  Itens no Caixa ({cart.length})
                </h4>
                {cart.length > 0 && (
                  <button
                    onClick={() => setCart([])}
                    className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                  >
                    Limpar
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-10 text-zinc-500 text-xs space-y-1">
                  <ShoppingBag className="w-8 h-8 mx-auto text-zinc-600 mb-1" />
                  <p>Clique nos produtos à esquerda para adicionar.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[28vh] overflow-y-auto pr-1">
                  {cart.map(item => (
                    <div key={item.product.id} className="p-2.5 bg-[#18181b] border border-zinc-800 rounded-xl flex items-center justify-between">
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="text-xs font-bold text-white truncate block">{item.product.name}</span>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          R$ {item.product.price.toFixed(2)} un.
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button 
                          onClick={() => handleUpdateQuantity(item.product.id, -1)}
                          className="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center font-bold text-xs cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-bold text-xs w-6 text-center">{item.quantity}</span>
                        <button 
                          onClick={() => handleUpdateQuantity(item.product.id, 1)}
                          className="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center font-bold text-xs cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Forma de Pagamento */}
              <div className="space-y-2 pt-2 border-t border-zinc-800">
                <label className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block font-bold">
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
                          : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:border-zinc-600'
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
                    className="w-full bg-[#121214] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                )}
              </div>
            </div>

            {/* Total e Fechar */}
            <div className="pt-3 border-t border-zinc-800 space-y-3">
              <div className="flex justify-between items-center font-mono">
                <span className="text-zinc-400 text-xs">TOTAL A PAGAR:</span>
                <span className="text-xl font-black text-emerald-400">
                  R$ {totalAmount.toFixed(2)}
                </span>
              </div>

              <button
                disabled={cart.length === 0 || isSubmitting}
                onClick={handleFinishSale}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-transform active:scale-98 shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
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
