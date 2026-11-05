// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../../types';
const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), setEnabled: vi.fn(), getStats: vi.fn(), getPins: vi.fn(), setPins: vi.fn() }));
vi.mock('../../../repositories/upsellRepository', () => ({ upsellRepository: mocks }));
import { UpsellMarketingPanel } from '../UpsellMarketingPanel';
import { ProductUpsellPinsEditor } from '../../establishment/ProductUpsellPinsEditor';

const source = { id: 'burger', tenantId: 'a', name: 'Hambúrguer', price: 30, isActive: true, isAvailable: true } as Product;
const complement = (id: string, tenantId = 'a') => ({ id, tenantId, name: `Suco ${id}`, price: 8, isActive: true, isAvailable: true } as Product);
const products = [source, ...['1', '2', '3', '4'].map(id => complement(id)), complement('outra-loja', 'b')];
const marketing = { tenantId: 'a', viewerId: 'owner', role: 'OWNER', products };
const pins = { ...marketing, source, onClose: vi.fn() };
const stats = { itemsSold: 7, revenue: 56, impressions: 20, accepts: 5, acceptanceRate: 0.25, topPairs: [{ sourceProductId: 'burger', suggestedProductId: '1', itemsSold: 7, revenue: 56 }] };
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset()); pins.onClose.mockReset();
  mocks.getSettings.mockResolvedValue({ enabled: false }); mocks.setEnabled.mockResolvedValue({ enabled: true }); mocks.getStats.mockResolvedValue(stats);
  mocks.getPins.mockResolvedValue([]); mocks.setPins.mockImplementation(async (_tenant, _source, ids) => ids);
});
afterEach(cleanup);

describe('gestão das sugestões', () => {
  it('mostra vendas reais, receita, aceitação e combinações; salva a chave no servidor', async () => {
    render(<UpsellMarketingPanel {...marketing} />);
    const toggle = await screen.findByRole('switch', { name: 'Ativar sugestões Leve também' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getAllByText('R$ 56,00')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Combinações mais vendidas' }).textContent).toContain('Hambúrguer');
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith('a', true));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
  it('mantém configuração operável se só a estatística falha', async () => {
    mocks.getStats.mockRejectedValue(new Error('offline'));
    render(<UpsellMarketingPanel {...marketing} />);
    expect(await screen.findByText(/As estatísticas estão indisponíveis/)).toBeTruthy();
    const toggle = screen.getByRole('switch'); await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle); await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledOnce());
  });
  it('não finge ativação quando o servidor recusa e permite tentar novamente', async () => {
    mocks.setEnabled.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ enabled: true });
    render(<UpsellMarketingPanel {...marketing} />);
    const toggle = screen.getByRole('switch'); await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    fireEvent.click(toggle); expect(await screen.findByRole('alert')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle); await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('não sobrescreve configuração desconhecida após falha de leitura', async () => {
    mocks.getSettings.mockRejectedValue(new Error('offline'));
    render(<UpsellMarketingPanel {...marketing} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('switch')); expect(mocks.setEnabled).not.toHaveBeenCalled();
  });
  it('não carrega nem renderiza a gestão para atendente', () => {
    render(<><UpsellMarketingPanel {...marketing} role="WAITER" /><ProductUpsellPinsEditor {...pins} role="WAITER" /></>);
    expect(screen.queryByRole('switch')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.getSettings).not.toHaveBeenCalled(); expect(mocks.getPins).not.toHaveBeenCalled();
  });
  it('ordena até três combinações e não oferece produtos de outra loja ou o produto de origem', async () => {
    render(<ProductUpsellPinsEditor {...pins} />);
    const list = await screen.findByLabelText('Produtos para sugerir');
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(4));
    expect(within(list).queryByText('Hambúrguer')).toBeNull(); expect(within(list).queryByText('Suco outra-loja')).toBeNull();
    for (const id of ['3', '1', '2']) fireEvent.click(within(list).getByRole('button', { name: new RegExp(`Suco ${id}`) }));
    expect(within(list).getByRole('button', { name: /Suco 4/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar combinações' }));
    await waitFor(() => expect(mocks.setPins).toHaveBeenCalledExactlyOnceWith('a', 'burger', ['3', '1', '2']));
    expect(pins.onClose).toHaveBeenCalledOnce();
  });
  it('conserva seleção em erro de salvar e permite nova tentativa', async () => {
    mocks.setPins.mockRejectedValue(new Error('offline'));
    render(<ProductUpsellPinsEditor {...pins} />);
    fireEvent.click(await screen.findByRole('button', { name: /Suco 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar combinações' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Suco 1/ }).getAttribute('aria-pressed')).toBe('true');
    expect(pins.onClose).not.toHaveBeenCalled();
  });
  it('ignora resposta de configuração de uma loja anterior', async () => {
    let finish!: (value: { enabled: boolean }) => void;
    mocks.getSettings.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ enabled: false });
    const view = render(<UpsellMarketingPanel {...marketing} />);
    view.rerender(<UpsellMarketingPanel {...marketing} tenantId="b" />);
    await waitFor(() => expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false));
    await act(async () => finish({ enabled: true }));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });
});
