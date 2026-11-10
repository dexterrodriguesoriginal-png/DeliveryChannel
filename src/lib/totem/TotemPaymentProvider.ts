/**
 * Contract for a server-mediated terminal payment. Never call providers from the browser.
 * Until signed webhook, encrypted account and official terminal activation are implemented,
 * the integrated adapters must fail closed. No VITE flag can activate money movement.
 */
export type TotemProviderId = 'manual' | 'mercadopago_point' | 'pagbank' | 'infinitepay'
  | 'stone_tef' | 'cielo_tef' | 'rede_tef' | 'getnet_tef';

export interface TotemPaymentRequest {
  orderId: string;
  /** Server-calculated cents. The browser is never a source of truth. */
  amountCents: number;
}
export interface TotemPaymentProvider {
  id: TotemProviderId;
  label: string;
  isAvailable(): boolean;
  startPayment(request: TotemPaymentRequest): Promise<never>;
  cancelPayment?(orderId: string): Promise<void>;
  getStatus?(orderId: string): Promise<'PENDING' | 'PAID' | 'DECLINED' | 'CANCELLED'>;
}
const unsupported = async (): Promise<never> => {
  throw new Error('Integração de terminal indisponível. Use pagamento manual com confirmação no PDV.');
};
export const terminalProviders: TotemPaymentProvider[] = [
  { id: 'mercadopago_point', label: 'Mercado Pago Point', isAvailable: () => false, startPayment: unsupported },
  { id: 'pagbank', label: 'PagBank', isAvailable: () => false, startPayment: unsupported },
  { id: 'infinitepay', label: 'InfinitePay', isAvailable: () => false, startPayment: unsupported },
  { id: 'stone_tef', label: 'Stone (TEF futuro)', isAvailable: () => false, startPayment: unsupported },
  { id: 'cielo_tef', label: 'Cielo (TEF futuro)', isAvailable: () => false, startPayment: unsupported },
  { id: 'rede_tef', label: 'Rede (TEF futuro)', isAvailable: () => false, startPayment: unsupported },
  { id: 'getnet_tef', label: 'Getnet (TEF futuro)', isAvailable: () => false, startPayment: unsupported },
];
