/** Opções operacionais do cardápio da mesa (modo totem etc.). Independentes do Design do Cardápio. */
export type ServiceMode = 'TABLE' | 'COUNTER' | 'BOTH';

export interface MenuOptions {
  totemMode: boolean;
  /** Atendimento configurado pelo dono; balcão requer fluxo de checkout dedicado. */
  serviceMode: ServiceMode;
  /** Número de produtos por fileira no cardápio. */
  productColumns: 1 | 2 | 3;
  /** Exibir banners públicos do app do cliente no Outdoor do cardápio. */
  reuseAppBanners: boolean;
  /** Segundos de inatividade antes do aviso "Ainda está aí?" (30–300). */
  idleSeconds: number;
  /** Rótulo do bloco do cardápio na tela inicial do QR (máx. 24 caracteres, texto puro). */
  homeLabel: string;
}
