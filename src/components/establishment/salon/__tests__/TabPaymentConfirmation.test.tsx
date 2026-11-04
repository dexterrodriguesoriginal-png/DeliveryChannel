// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
const receipts = vi.hoisted(() => ({ target: vi.fn(), send: vi.fn() }));
vi.mock('../../../../repositories/tabReceiptRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../repositories/tabReceiptRepository')>();
  return { ...actual, tabReceiptRepository: receipts };
});
import { TabPaymentConfirmation } from '../TabPaymentConfirmation';
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { Object.values(receipts).forEach(m => m.mockReset()); receipts.target.mockResolvedValue({ exists: true, maskedEmail: 'jo***@gm***.com' }); });
afterEach(cleanup);
describe('Comprovante de pagamento da comanda', () => {
  it('mostra dados do pagamento e e-mail mascarado; relata Envio de email não configurado quando ausente', async () => {
    receipts.send.mockResolvedValue({ sent: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
    const done = vi.fn();
    render(<TabPaymentConfirmation tabId="tab1" amountCents={12100} tableLabel="Mesa 5" paidAt="2026-11-04T01:10:00Z" onDone={done} />);
    await flush();
    expect(screen.getByText('Mesa 5')).toBeTruthy();
    expect(screen.getByText('PIX')).toBeTruthy();
    expect(screen.getByText(/121,00/)).toBeTruthy();
    expect(screen.getByText(/Destinatário: jo\*\*\*@gm\*\*\*\.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comprovante por e-mail' })); await flush();
    expect(receipts.send).toHaveBeenCalledWith('tab1');
    expect(screen.getByText('Envio de email não configurado')).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' })); expect(done).toHaveBeenCalledOnce();
  });
  it('permite enviar para outro email validado (inclusive quando o cliente não tem e-mail cadastrado)', async () => {
    receipts.target.mockResolvedValue({ exists: false, maskedEmail: null });
    receipts.send.mockResolvedValue({ sent: true });
    render(<TabPaymentConfirmation tabId="tab1" amountCents={5500} method="CASH" onDone={vi.fn()} />);
    await flush();
    const sendBtn = screen.getByRole('button', { name: 'Enviar comprovante por e-mail' }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('receipt-other-email-toggle'));
    const input = screen.getByTestId('receipt-other-email-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'invalido' } });
    expect(screen.getByText('Informe um e-mail válido.')).toBeTruthy();
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'cliente@exemplo.com.br' } });
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn); await flush();
    expect(receipts.send).toHaveBeenCalledWith('tab1', 'cliente@exemplo.com.br');
    expect(screen.getByText('Comprovante enviado por e-mail.')).toBeTruthy();
  });
  it('não oferece envio sem e-mail cadastrado nem alternativo e informa limite de envios sem expor dados', async () => {
    receipts.target.mockResolvedValue({ exists: false, maskedEmail: null });
    const { rerender } = render(<TabPaymentConfirmation tabId="tab1" amountCents={2200} onDone={vi.fn()} />);
    await flush();
    expect((screen.getByRole('button', { name: 'Enviar comprovante por e-mail' }) as HTMLButtonElement).disabled).toBe(true);
    receipts.target.mockResolvedValue({ exists: true, maskedEmail: 'an***@gm***.com' });
    receipts.send.mockRejectedValue(new Error('Limite de envios atingido. Aguarde 10 minutos para tentar novamente.'));
    rerender(<TabPaymentConfirmation tabId="tab2" amountCents={2200} onDone={vi.fn()} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comprovante por e-mail' })); await flush();
    expect(screen.getByText(/Limite de envios atingido/)).toBeTruthy();
  });
  it('ignora resposta de envio da comanda anterior após trocar de mesa', async () => {
    let resolve!: (value: { sent: true }) => void;
    receipts.send.mockReturnValue(new Promise(res => { resolve = res; }));
    const { rerender } = render(<TabPaymentConfirmation tabId="tab1" amountCents={2200} onDone={vi.fn()} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comprovante por e-mail' }));
    rerender(<TabPaymentConfirmation tabId="tab2" amountCents={3000} onDone={vi.fn()} />); await flush();
    await act(async () => { resolve({ sent: true }); });
    expect(screen.queryByText('Comprovante enviado por e-mail.')).toBeNull();
  });
  it('não habilita envio antes da consulta autorizada e permite tentar novamente após falha', async () => {
    receipts.target.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ exists: true, maskedEmail: 'jo***@gm***.com' });
    render(<TabPaymentConfirmation tabId="tab1" amountCents={2200} onDone={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Enviar comprovante por e-mail' }) as HTMLButtonElement).disabled).toBe(true);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Consultar email novamente' })); await flush();
    expect(screen.getByTestId('receipt-masked-email').textContent).toContain('jo***@gm***.com');
    expect((screen.getByRole('button', { name: 'Enviar comprovante por e-mail' }) as HTMLButtonElement).disabled).toBe(false);
  });

});
