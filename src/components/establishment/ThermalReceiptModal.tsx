import React from 'react';
import { Printer, X } from 'lucide-react';
import { Order } from '../../types';

interface ThermalReceiptModalProps {
  order: Order | null;
  storeName: string;
  onClose: () => void;
}

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  order,
  storeName,
  onClose,
}) => {
  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white text-black p-6 rounded-2xl w-full max-w-xs space-y-4 font-mono text-xs shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 p-1 rounded-lg text-gray-500 hover:text-black hover:bg-gray-100 no-print cursor-pointer"
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Cabeçalho Térmico */}
        <div className="text-center border-b border-dashed border-black pb-3">
          <h2 className="font-bold text-sm uppercase tracking-wide">{storeName || 'ADEGAFOOD DELIVERY'}</h2>
          <p className="text-[10px] text-gray-700">CONTROLE DE EXPEDIÇÃO</p>
          <p className="text-[11px] font-bold mt-1">Pedido: #{order.orderNumber || order.id.substring(0, 8).toUpperCase()}</p>
          <p className="text-[10px] text-gray-600">{new Date(order.createdAt).toLocaleString('pt-BR')}</p>
        </div>

        {/* Dados do Cliente */}
        <div className="border-b border-dashed border-black pb-3 space-y-1 text-[11px]">
          <p><strong>CLIENTE:</strong> {order.customerName}</p>
          <p><strong>FONE:</strong> {order.customerPhone}</p>
          <p><strong>TIPO:</strong> {order.fulfillmentType === 'PICKUP' ? 'RETIRADA NO BALCÃO' : 'ENTREGA EM DOMICÍLIO'}</p>
          <p><strong>ENDEREÇO:</strong> {order.deliveryAddress}</p>
          {order.addressDetails && (
            <p className="text-[10px] text-gray-700">
              {order.addressDetails.neighborhood ? `Bairro: ${order.addressDetails.neighborhood} ` : ''}
              {order.addressDetails.complement ? `Comp: ${order.addressDetails.complement} ` : ''}
              {order.addressDetails.reference ? `Ref: ${order.addressDetails.reference}` : ''}
            </p>
          )}
        </div>

        {/* Lista de Itens */}
        <div className="border-b border-dashed border-black pb-3 space-y-1.5">
          <p className="font-bold text-[10px]">ITENS:</p>
          {order.items.map((it, idx) => (
            <div key={idx} className="flex justify-between text-[11px]">
              <span className="truncate pr-1">
                {it.quantity}x {it.productName}
              </span>
              <span className="font-bold tabular-nums">
                R$ {it.totalPrice.toFixed(2)}
              </span>
            </div>
          ))}
          {order.notes && (
            <p className="text-[10px] italic pt-1 border-t border-dotted border-gray-400">
              Obs: {order.notes}
            </p>
          )}
        </div>

        {/* Totais & Pagamento */}
        <div className="border-b border-dashed border-black pb-3 space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span>R$ {order.subtotal.toFixed(2)}</span>
          </div>
          {order.deliveryFee > 0 && (
            <div className="flex justify-between">
              <span>Taxa Entrega:</span>
              <span>R$ {order.deliveryFee.toFixed(2)}</span>
            </div>
          )}
          {order.discount > 0 && (
            <div className="flex justify-between">
              <span>Desconto:</span>
              <span>- R$ {order.discount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-sm pt-1 border-t border-black">
            <span>TOTAL:</span>
            <span>R$ {order.totalAmount.toFixed(2)}</span>
          </div>
          <p className="pt-1 text-[10px]">
            <strong>PAGAMENTO:</strong> {order.paymentMethod} ({order.paymentStatus === 'PAID' ? 'PAGO' : 'PAGAMENTO NA ENTREGA'})
          </p>
        </div>

        {/* Botões de Ação */}
        <div className="flex gap-2 pt-2 no-print">
          <button 
            type="button"
            onClick={onClose}
            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-black font-semibold rounded-xl text-xs cursor-pointer font-sans transition-colors"
          >
            Fechar
          </button>
          <button 
            type="button"
            onClick={handlePrint}
            className="flex-1 py-2 bg-black hover:bg-gray-800 text-white font-bold rounded-xl text-xs cursor-pointer font-sans flex items-center justify-center gap-1.5 transition-colors shadow-md"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
};
