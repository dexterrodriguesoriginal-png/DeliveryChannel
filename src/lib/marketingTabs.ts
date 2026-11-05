import type { ModuleKey } from './modules';

export type MarketingTab = 'creatives' | 'materials' | 'performance' | 'campaigns' | 'pickup-qr' | 'menu-outdoor' | 'upsell';

export function isMarketingTab(tab: string): tab is MarketingTab {
  return ['creatives', 'materials', 'performance', 'campaigns', 'pickup-qr', 'menu-outdoor', 'upsell'].includes(tab);
}

/** Aba 'QR Code de Retirada' só aparece com o módulo de retirada ativo. */
export function showPickupQrTab(isModuleEnabled: (key: ModuleKey) => boolean): boolean {
  return isModuleEnabled('pickup');
}

/** Gestão do outdoor exige vínculo de dono ou gerente; o servidor confirma o tenant. */
export function canManageMenuOutdoor(role?: string | null): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}
