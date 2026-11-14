// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MobileNavigation } from '../MobileNavigation';
import { PhonePreview } from '../../common/PhonePreview';
import { createDefaultThemeTokens, tokensToTheme, contrastRatio } from '../../../lib/theme/themeEngine';

afterEach(cleanup);
it.each(['#ebc934', '#121245', '#ffffff', '#747474', '#888888'])('uses the saved nav color %s in customer navigation and preview with readable ink', color => {
  const tokens = createDefaultThemeTokens({ storeName: 'Loja' });
  tokens.meta = { ...tokens.meta, systemBars: { navBarColor: color } };
  // Same JSON round trip as persisted theme configuration.
  const theme = JSON.parse(JSON.stringify(tokensToTheme(tokens, { storeName: 'Loja' })));
  const ui = render(<><MobileNavigation type="customer" activeTab="home" onTabChange={() => {}} theme={theme} /><PhonePreview storeSlug="loja" theme={theme} /></>);
  expect(ui.getByTestId('customer-bottom-nav').style.backgroundColor).toBe(color);
  expect(ui.getByTestId('phone-nav-bar').style.backgroundColor).toBe(color);
  expect(contrastRatio(ui.getByTestId('phone-nav-bar').style.color, color)).toBeGreaterThanOrEqual(4.5);
  for (const button of ui.getByTestId('customer-bottom-nav').querySelectorAll('button')) {
    expect(contrastRatio(button.style.color, color)).toBeGreaterThanOrEqual(4.5);
  }
});
