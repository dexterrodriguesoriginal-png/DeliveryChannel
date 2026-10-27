// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  role: { value: 'OWNER' },
  tenant: { id: 'tenant-1', slug: 'minha-loja', name: 'Minha Loja' },
  repo: { list: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), remove: vi.fn(), regenerateQr: vi.fn() },
  qr: { capabilities: vi.fn(), pauses: vi.fn(), setPause: vi.fn() },
  modules: { enabled: true },
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: h.tenant, activeRole: h.role.value }) }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, isModuleEnabled: () => h.modules.enabled }) }));
vi.mock('../../../repositories/diningTableRepository', () => ({ diningTableRepository: h.repo }));
vi.mock('../../../repositories/mesasQrRepository', async () => {
  const actual = await vi.importActual<typeof import('../../../repositories/mesasQrRepository')>('../../../repositories/mesasQrRepository');
  return { ...actual, mesasQrRepository: h.qr };
});

import { MesasQrPage } from '../MesasQrPage';

const TOKEN_A = 'a'.repeat(48);
const TOKEN_B = 'b'.repeat(48);
const table = (id: string, label: string, token: string) => ({ id, label, area: null, seats: 4, qrToken: token, active: true });

beforeEach(() => {
  Object.values(h.repo).forEach(m => m.mockReset()); Object.values(h.qr).forEach(m => m.mockReset());
  h.role.value = 'OWNER'; h.modules.enabled = true;
  h.repo.list.mockResolvedValue([table('t1', 'Mesa 01', TOKEN_A), table('t2', 'Mesa 02', TOKEN_B)]);
  h.qr.capabilities.mockResolvedValue({ available: true, qrPause: true, tabPix: true });
  h.qr.pauses.mockResolvedValue({ storeWide: false, tableIds: [] });
});
afterEach(cleanup);

describe('MesasQrPage', () => {
  it('cada mesa tem um QR com /app/<slug>?mesa=<token> opaco; nenhum QR repete token', async () => {
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    expect(screen.getByTestId('mq-qr-t1').querySelector('svg')).toBeTruthy();
    // the link is the QR payload: copy it and inspect
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getAllByRole('button', { name: /^Link$/ })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.pathname).toBe('/app/minha-loja');
    expect(url.searchParams.get('mesa')).toBe(TOKEN_A);
    expect(writeText.mock.calls[0][0]).not.toMatch(/Mesa|tenant|t1/);
  });
  it('nome da mesa: 3 a 15 caracteres, sem duplicar, validado antes de chamar o banco', async () => {
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    const input = screen.getByLabelText('Nome da mesa');
    for (const [value, msg] of [['ab', /pelo menos 3/], ['x'.repeat(16), /no máximo 15/], ['Mesa 01', /Já existe/], ['<b>Mesa', /apenas letras/]] as const) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar mesa' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(msg);
    }
    expect(h.repo.create).not.toHaveBeenCalled();
    h.repo.create.mockResolvedValue(table('t3', 'Varanda 1', 'c'.repeat(48)));
    fireEvent.change(input, { target: { value: 'Varanda 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar mesa' }));
    await screen.findByTestId('mq-card-t3');
    expect(h.repo.create).toHaveBeenCalledWith('tenant-1', { label: 'Varanda 1', area: '', seats: 4 });
  });
  it('renomear valida e salva; erro do banco aparece no cartão', async () => {
    h.repo.update.mockRejectedValueOnce(new Error('O nome da mesa deve ter de 3 a 15 caracteres.'));
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    fireEvent.click(screen.getByRole('button', { name: 'Renomear Mesa 01' }));
    const field = screen.getByLabelText(/Nome da mesa \(3 a 15/);
    fireEvent.change(field, { target: { value: 'Mesa 02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Já existe/);
    fireEvent.change(field, { target: { value: 'Salão Azul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/3 a 15/));
    h.repo.update.mockResolvedValueOnce(table('t1', 'Salão Azul', TOKEN_A));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    await screen.findByRole('heading', { name: 'Salão Azul' });
    expect(h.repo.update).toHaveBeenLastCalledWith('tenant-1', 't1', { label: 'Salão Azul', area: '', seats: 4 }, 'Mesa 01');
  });
  it('excluir e gerar novo QR pedem confirmação; novo QR só para o proprietário', async () => {
    h.repo.regenerateQr.mockResolvedValue('d'.repeat(48));
    h.repo.remove.mockResolvedValue(undefined);
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    fireEvent.click(screen.getAllByRole('button', { name: /Gerar novo QR da/ })[0]);
    expect(h.repo.regenerateQr).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar novo QR' }));
    await waitFor(() => expect(h.repo.regenerateQr).toHaveBeenCalledWith('tenant-1', 't1'));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Mesa 02' }));
    expect(h.repo.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir mesa' }));
    await waitFor(() => expect(screen.queryByTestId('mq-card-t2')).toBeNull());
    cleanup();
    h.role.value = 'MANAGER';
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    expect(screen.queryAllByRole('button', { name: /Gerar novo QR da/ })).toHaveLength(0);
  });
  it('pausa por mesa e geral só aparece quando o banco tem a migração', async () => {
    h.qr.setPause.mockResolvedValue(undefined);
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    fireEvent.click(screen.getAllByTestId(/^mq-pause-/)[0]);
    await waitFor(() => expect(h.qr.setPause).toHaveBeenCalledWith('tenant-1', 't1', true));
    fireEvent.click(screen.getByRole('button', { name: /Pausar todos os QR/ }));
    await waitFor(() => expect(h.qr.setPause).toHaveBeenCalledWith('tenant-1', null, true));
    cleanup();
    h.qr.capabilities.mockResolvedValue({ available: false, qrPause: false, tabPix: false });
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    expect(screen.queryByText(/Pausar todos os QR/)).toBeNull();
    expect(screen.queryAllByTestId(/^mq-pause-/)).toHaveLength(0);
    expect(h.qr.pauses).toHaveBeenCalledTimes(1);
  });
  it('imprimir lote renderiza um cartaz A6 por mesa selecionada', async () => {
    const print = vi.fn(); Object.defineProperty(window, 'print', { value: print, configurable: true });
    render(<MesasQrPage />);
    await screen.findByTestId('mq-card-t1');
    fireEvent.click(screen.getByLabelText('Selecionar Mesa 02 para impressão'));
    fireEvent.click(screen.getByRole('button', { name: /Imprimir 1 selecionada/ }));
    const sheet = await screen.findByTestId('mq-print-sheet');
    expect(sheet.querySelectorAll('.mq-poster')).toHaveLength(1);
    expect(sheet.textContent).toContain('Mesa 02');
    await waitFor(() => expect(print).toHaveBeenCalled(), { timeout: 1500 });
  });
  it('equipe sem permissão e ferramenta desligada não veem a ferramenta nem tokens', async () => {
    h.role.value = 'WAITER';
    const { container } = render(<MesasQrPage />);
    expect(container.textContent).toContain('Somente o proprietário ou o gerente');
    expect(h.repo.list).not.toHaveBeenCalled();
    cleanup();
    h.role.value = 'OWNER'; h.modules.enabled = false;
    const second = render(<MesasQrPage />);
    expect(second.container.textContent).toContain('desativada');
    expect(h.repo.list).not.toHaveBeenCalled();
  });
});
