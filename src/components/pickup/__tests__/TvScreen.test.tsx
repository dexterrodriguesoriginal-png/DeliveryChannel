// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mock = vi.hoisted(() => ({
  readToken: vi.fn(), pair: vi.fn(), read: vi.fn(), clearToken: vi.fn(), subscribe: vi.fn(), activateAsStaff: vi.fn(), off: vi.fn(),
}));
vi.mock('../../../repositories/tvAccessRepository', () => ({ tvAccessRepository: mock }));
import { TvScreen } from '../TvScreen';
const feed = { ok: true, storeName: 'Loja da Maria', theme: { tokens: { version: 1, palette: {
  bgGeneral: '#123456', bgHeader: '#234567', textMain: '#abcdef', buttonBg: '#345678', buttonText: '#fedcba',
} } }, entries: [{ code: '123', name: 'Maria', kind: 'ready' }] };
beforeEach(() => {
  vi.resetAllMocks();
  mock.readToken.mockReturnValue(null);
  mock.subscribe.mockReturnValue(mock.off);
  mock.read.mockResolvedValue(feed);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('TV com token próprio', () => {
  it('pareia com seis dígitos, guarda token pelo repository e exibe apenas os dados minimizados', async () => {
    mock.pair.mockResolvedValue('device-token');
    render(<TvScreen />);
    fireEvent.change(screen.getByLabelText('Código de pareamento'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar TV' }));
    await screen.findByText('Maria');
    expect(mock.pair).toHaveBeenCalledWith('123456');
    expect(mock.read).toHaveBeenCalledWith('device-token');
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByRole('main').style.background).toBe('#123456');
    expect(screen.getByText('123').parentElement?.style.background).toBe('#345678');
  });
  it('mostra falha de pareamento em português', async () => {
    mock.pair.mockRejectedValue(new Error('Código inválido, expirado ou já utilizado.'));
    render(<TvScreen />);
    fireEvent.change(screen.getByLabelText('Código de pareamento'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar TV' }));
    expect((await screen.findByRole('alert')).textContent).toContain('expirado');
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('revalida por realtime e remove os dados quando o token é revogado', async () => {
    mock.readToken.mockReturnValue('token');
    render(<TvScreen />);
    await screen.findByText('Maria');
    mock.read.mockResolvedValue(null);
    await act(async () => mock.subscribe.mock.calls[0][1]());
    expect(screen.queryByText('Maria')).toBeNull();
    expect(screen.getByLabelText('Código de pareamento')).toBeTruthy();
    expect(mock.clearToken).toHaveBeenCalled();
    expect(mock.off).toHaveBeenCalled();
  });
  it('polling a cada 5 segundos e limpeza ao desmontar', async () => {
    vi.useFakeTimers(); mock.readToken.mockReturnValue('token');
    const view = render(<TvScreen />);
    await act(async () => {});
    expect(mock.read).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mock.read).toHaveBeenCalledTimes(2);
    view.unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(mock.off).toHaveBeenCalled();
  });
  it('oculta senhas anteriores ao perder a conexão e permite recuperar', async () => {
    mock.readToken.mockReturnValue('token');
    render(<TvScreen />); await screen.findByText('Maria');
    mock.read.mockRejectedValueOnce(new Error('Sem conexão. Tentando novamente...'));
    await act(async () => mock.subscribe.mock.calls[0][1]());
    expect(screen.queryByText('Maria')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Sem conexão');
    await act(async () => mock.subscribe.mock.calls[0][1]());
    expect(screen.getByText('Maria')).toBeTruthy();
  });
  it('faz ativação única de dono/gerente e limpa a senha do formulário', async () => {
    mock.activateAsStaff.mockResolvedValue('staff-device-token');
    render(<TvScreen />);
    fireEvent.click(screen.getByText('Ativar com conta de dono ou gerente'));
    fireEvent.change(screen.getByLabelText('Identificador da loja'), { target: { value: 'loja' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'dono@loja.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar TV' }));
    await screen.findByText('Maria');
    expect(mock.activateAsStaff).toHaveBeenCalledWith('loja', 'TV do balcão', 'dono@loja.com', 'senha1234');
    expect(screen.queryByLabelText('Senha')).toBeNull();
  });
  it('oferece botão de tela cheia', () => {
    const fullscreen = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = fullscreen;
    render(<TvScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Tela cheia' }));
    expect(fullscreen).toHaveBeenCalled();
  });
});
