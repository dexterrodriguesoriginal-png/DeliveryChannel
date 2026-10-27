// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({ createTabPix: vi.fn(), tabPixStatus: vi.fn(), cancelTabPix: vi.fn() }));
vi.mock('../../../../repositories/paymentRepository', () => ({ paymentRepository: api }));

import { mmss, PIX_POLL_MS, pixSecondsLeft, TabPixPanel } from '../TabPixPanel';

const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
const pix = (over: Record<string, unknown> = {}) => ({ id: 'p1', tabId: 'tab1', amountCents: 11000, status: 'pending', brcode: '00020126PIXCODE', expiresAt: future(), needsReview: false, reviewReason: null, tabClosed: false, ...over });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { vi.useFakeTimers(); Object.values(api).forEach(m => m.mockReset()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TabPixPanel', () => {
  it('sem PIX existente mostra o botão com o valor; gera o QR, bloqueia o fechamento manual e copia o código', async () => {
    api.tabPixStatus.mockResolvedValue({ pix: null });
    api.createTabPix.mockResolvedValue({ pix: pix() });
    const onLive = vi.fn(); const onSettled = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TabPixPanel tabId="tab1" totalCents={11000} onLiveChange={onLive} onSettled={onSettled} />);
    await flush();
    const button = screen.getByRole('button', { name: /Gerar QR PIX de/ });
    expect(button.textContent).toMatch(/110,00/);
    fireEvent.click(button); await flush();
    expect(api.createTabPix).toHaveBeenCalledWith('tab1');
    expect(screen.getByTestId('tab-pix-qr')).toBeTruthy();
    expect(onLive).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Copiar PIX/ })); await flush();
    expect(writeText).toHaveBeenCalledWith('00020126PIXCODE');
    expect(onSettled).not.toHaveBeenCalled();
  });
  it('consulta o status a cada ~4 s e, ao pagar, mostra "Mesa liberada" e avisa o pai', async () => {
    api.tabPixStatus.mockResolvedValueOnce({ pix: pix() }).mockResolvedValue({ pix: pix({ status: 'paid', tabClosed: true }) });
    const onLive = vi.fn(); const onSettled = vi.fn();
    render(<TabPixPanel tabId="tab1" totalCents={11000} onLiveChange={onLive} onSettled={onSettled} />);
    await flush();
    expect(screen.getByTestId('tab-pix-qr')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(PIX_POLL_MS + 50); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('Pagamento confirmado!')).toBeTruthy();
    expect(onLive).toHaveBeenLastCalledWith(false);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
  it('PIX pago mas conta ainda aberta (total mudou) exige conferência e não fecha a mesa', async () => {
    api.tabPixStatus.mockResolvedValue({ pix: pix({ status: 'paid', tabClosed: false, needsReview: true, reviewReason: 'Total mudou após o PIX' }) });
    const onSettled = vi.fn();
    render(<TabPixPanel tabId="tab1" totalCents={15000} onLiveChange={() => {}} onSettled={onSettled} />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Total mudou após o PIX');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(onSettled).not.toHaveBeenCalled();
  });
  it('PIX expirado oferece gerar um novo; erro do servidor aparece sem derrubar o fechamento manual', async () => {
    api.tabPixStatus.mockResolvedValue({ pix: null });
    api.createTabPix.mockRejectedValueOnce(new Error('Conecte o Mercado Pago em Pagamentos.'));
    const onLive = vi.fn();
    render(<TabPixPanel tabId="tab1" totalCents={5000} onLiveChange={onLive} onSettled={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Gerar QR PIX/ })); await flush();
    expect(screen.getByRole('alert').textContent).toContain('Conecte o Mercado Pago');
    expect(onLive).toHaveBeenLastCalledWith(false);
  });
  it('cancelar o PIX libera o fechamento manual', async () => {
    api.tabPixStatus.mockResolvedValue({ pix: pix() });
    api.cancelTabPix.mockResolvedValue({});
    const onLive = vi.fn();
    render(<TabPixPanel tabId="tab1" totalCents={11000} onLiveChange={onLive} onSettled={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar este PIX/ })); await flush();
    expect(api.cancelTabPix).toHaveBeenCalledWith('tab1');
    expect(onLive).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId('tab-pix-qr')).toBeNull();
  });
  it('helpers de contagem regressiva', () => {
    expect(mmss(125)).toBe('02:05');
    expect(pixSecondsLeft(null, 0)).toBeNull();
    expect(pixSecondsLeft(new Date(10_000).toISOString(), 4_000)).toBe(6);
    expect(pixSecondsLeft(new Date(1_000).toISOString(), 4_000)).toBe(0);
  });
});
