import React from 'react';
import { TenantTheme } from '../../types';
import { LiveStorePreview } from '../establishment/theme/LiveStorePreview';

export interface MobileSimulatorProps {
  theme: TenantTheme;
  storeSlug: string;
  isOpen?: boolean;
}

export const MobileSimulator: React.FC<MobileSimulatorProps> = ({
  theme,
  storeSlug,
  isOpen = true,
}) => {
  return (
    <LiveStorePreview
      theme={theme}
      storeSlug={storeSlug}
      isOpen={isOpen}
      defaultMode="mobile"
    />
  );
};
