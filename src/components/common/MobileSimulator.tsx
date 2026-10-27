import React from 'react';
import { TenantTheme } from '../../types';
import { LiveStorePreview } from '../establishment/theme/LiveStorePreview';

export interface MobileSimulatorProps {
  theme: TenantTheme;
  storeSlug: string;
  isOpen?: boolean;
}

/** Simulador de celular: usa a prévia única (PhonePreview via LiveStorePreview). */
export const MobileSimulator: React.FC<MobileSimulatorProps> = ({ theme, storeSlug, isOpen = true }) => (
  <LiveStorePreview theme={theme} storeSlug={storeSlug} isOpen={isOpen} defaultMode="mobile" />
);
