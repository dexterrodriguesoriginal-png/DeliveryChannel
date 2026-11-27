// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
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
  it('guia o dono pelas quatro etapas sem bloquear o checklist', () => {
    const ui = render(<OwnerBrandChecklist {...props} />);
    const training = within(ui.getByTestId('brand-training'));
    expect(training.getByText('Como montar a marca do seu app')).toBeTruthy();
    expect(training.queryByText('Etapa 1 de 4')).toBeNull();
    fireEvent.click(training.getByRole('button', { name: 'Abrir treinamento' }));
    expect(training.getByText('Etapa 1 de 4')).toBeTruthy();
    expect((training.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(training.getByRole('button', { name: 'Próxima etapa' }));
    expect(training.getByText('2. Escolha uma logo memorável')).toBeTruthy();
    fireEvent.click(training.getByRole('button', { name: 'Próxima etapa' }));
    expect(training.getByText(/recomendamos branco, preto ou cinza neutro/)).toBeTruthy();
    expect(training.getByText(/Black Friday/)).toBeTruthy();
    fireEvent.click(training.getByRole('button', { name: 'Próxima etapa' }));
    expect(training.getByText(/Em instalações compatíveis, o ícone pode levar 24 a 72 horas/)).toBeTruthy();
    expect(training.getByText(/Cardápio, preços, banners e promoções atualizam na hora/)).toBeTruthy();
    fireEvent.click(training.getByRole('button', { name: 'Voltar' }));
    expect(training.getByText('Etapa 3 de 4')).toBeTruthy();
    fireEvent.click(training.getByRole('button', { name: 'Próxima etapa' }));
    fireEvent.click(training.getByRole('button', { name: 'Concluir treinamento' }));
    expect(training.queryByText('Etapa 4 de 4')).toBeNull();
    expect(ui.getByTestId('brand-step-identity')).toBeTruthy();
    expect(ui.queryByTestId('brand-share-highlight')).toBeNull();
  });
  it('seleciona as três áreas diretamente no celular e pelos atalhos acessíveis', () => {
    const ui = render(<OwnerBrandChecklist {...props} />);
    const phone = within(ui.getByTestId('brand-phone'));
    const explanation = ui.getByTestId('brand-phone-explanation');
    const areas = within(phone.getByRole('group', { name: 'Áreas do celular' }));
    expect(explanation.textContent).toContain('24 a 72 horas');
    fireEvent.click(phone.getAllByRole('button', { name: 'Barra de status (topo)' })[0]);
    expect(explanation.textContent).toContain('hora, sinal e bateria');
    expect(areas.getByRole('button', { name: 'Barra de status (topo)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(phone.getAllByRole('button', { name: 'Barra de navegação (inferior)' })[0]);
    expect(explanation.textContent).toContain('não muda em tempo real');
    expect(explanation.textContent).toContain('cinza neutro');
    fireEvent.click(areas.getByRole('button', { name: 'Ícone na tela inicial' }));
    expect(explanation.textContent).toContain('instalação original');
    expect(phone.getAllByRole('button', { name: 'Ícone na tela inicial' })[0].getAttribute('aria-pressed')).toBe('true');
  });

});
