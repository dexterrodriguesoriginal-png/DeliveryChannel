// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { OwnerBrandChecklist } from '../OwnerBrandChecklist';
import { DEFAULT_DELIVERY_CHANNEL_THEME } from '../../../../lib/theme/themeEngine';
import type { TenantTheme } from '../../../../types';

vi.mock('../../../../components/common/QRCodeCard', () => ({
  QRCodeCard: ({ slug }: { slug: string }) => <div data-testid="existing-qr">{slug}</div>,
}));
afterEach(cleanup);

const logo = 'https://example.com/logo.png';
const theme = (confirmed: string, url = logo): TenantTheme => ({
  ...DEFAULT_DELIVERY_CHANNEL_THEME,
  logoUrl: url,
  tokens: { ...DEFAULT_DELIVERY_CHANNEL_THEME.tokens, meta: { ...DEFAULT_DELIVERY_CHANNEL_THEME.tokens?.meta, logoConfirmedUrl: confirmed } },
} as TenantTheme);

describe('orientação de marca do dono', () => {
  const props = { draftTheme: theme(logo), savedTheme: theme(logo), barsReviewed: false, previewViewed: false, slug: 'loja', storeName: 'Loja', onNavigate: vi.fn() };
  it('orienta sem bloquear a divulgação e encaminha à confirmação existente', () => {
    const navigate = vi.fn();
    const ui = render(<OwnerBrandChecklist {...props} draftTheme={theme('')} savedTheme={theme('')} onNavigate={navigate} />);
    expect(ui.getByText('Sua marca merece ser reconhecida')).toBeTruthy();
    expect(ui.getByText(/WhatsApp/)).toBeTruthy();
    expect(ui.getByTestId('brand-step-identity').textContent).toContain('pendente');
    expect(ui.queryByTestId('brand-share-highlight')).toBeNull();
    fireEvent.click(ui.getByText('Revisar logo'));
    expect(navigate).toHaveBeenCalledWith('identity');
  });
  it('não conclui logo confirmada somente no rascunho ou trocada sem salvar', () => {
    const ui = render(<OwnerBrandChecklist {...props} savedTheme={theme('')} barsReviewed previewViewed />);
    expect(ui.queryByTestId('brand-share-highlight')).toBeNull();
    ui.rerender(<OwnerBrandChecklist {...props} draftTheme={theme('https://example.com/new.png', 'https://example.com/new.png')} barsReviewed previewViewed />);
    expect(ui.queryByTestId('brand-share-highlight')).toBeNull();
  });
  it('destaca divulgação apenas com os três passos e reutiliza QRCodeCard', () => {
    const ui = render(<OwnerBrandChecklist {...props} barsReviewed />);
    expect(ui.queryByTestId('brand-share-highlight')).toBeNull();
    ui.rerender(<OwnerBrandChecklist {...props} previewViewed />);
    expect(ui.queryByTestId('brand-share-highlight')).toBeNull();
    ui.rerender(<OwnerBrandChecklist {...props} barsReviewed previewViewed />);
    expect(ui.getByTestId('brand-share-highlight')).toBeTruthy();
    fireEvent.click(ui.getByText('Divulgar meu aplicativo'));
    expect(ui.getByTestId('existing-qr').textContent).toBe('loja');
  });
});
