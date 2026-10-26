import React, { memo, useMemo } from 'react';
import { StoreTemplate } from '../../../types/theme';
import { tokensToTheme } from '../../../lib/theme/themeEngine';
import { StorefrontPreview } from '../../../components/establishment/theme/LiveStorePreview';
import { sampleProducts } from '../../../lib/theme/previewProducts';

export const TemplateThumbnail = memo(function TemplateThumbnail({
  template,
}: {
  template: StoreTemplate;
}) {
  const theme = useMemo(
    () =>
      tokensToTheme(template.tokens, {
        storeName: template.segmentLabel,
        tagline: 'Uma seleção especial para você',
      }),
    [template]
  );
  const products = useMemo(
    () => sampleProducts(template.segmentId).slice(0, 2),
    [template.segmentId]
  );
  return (
    <div className="template-thumbnail" aria-hidden="true" inert>
      <div className="template-thumbnail-inner">
        <StorefrontPreview theme={theme} products={products} />
      </div>
    </div>
  );
});
