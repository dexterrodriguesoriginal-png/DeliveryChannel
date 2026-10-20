import type { ModuleKey } from './modules';

export type MarketingTab = 'creatives' | 'materials' | 'performance' | 'campaigns' | 'pickup-qr';

export function isMarketingTab(tab: string): tab is MarketingTab {
  return ['creatives', 'materials', 'performance', 'campaigns', 'pickup-qr'].includes(tab);
}

/** Aba 'QR Code de Retirada' só aparece com o módulo de retirada ativo. */
export function showPickupQrTab(isModuleEnabled: (key: ModuleKey) => boolean): boolean {
  return isModuleEnabled('pickup');
}
