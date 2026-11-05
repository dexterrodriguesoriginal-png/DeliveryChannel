// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../../types';
import type { MenuOutdoorSlide } from '../../../repositories/menuOutdoorRepository';

const h = vi.hoisted(() => ({ list: vi.fn(), library: vi.fn(), save: vi.fn(), upload: vi.fn() }));
vi.mock('../../../repositories/menuOutdoorRepository', () => ({ menuOutdoorRepository: { list: h.list, listPublishedMedia: h.library, save: h.save } }));
vi.mock('../../../repositories/mediaRepository', () => ({ mediaRepository: { uploadAndPublishCreative: h.upload } }));
import { MenuOutdoorPanel, menuOutdoorStatus } from '../MenuOutdoorPanel';

const media = { assetId: 'asset', publicUrl: 'https://media.example/banner.webp', publicPath: 'path', mediaType: 'IMAGE' as const };
const existing: MenuOutdoorSlide = { id: 'slide', tenantId: 'tenant', assetId: 'asset', imageUrl: media.publicUrl,
  title: 'Sabores da casa', sortOrder: 2, active: true, startsAt: null, endsAt: null, mediaAvailable: true };
const props = { tenantId: 'tenant', viewerId: 'owner', role: 'OWNER', products: [
  { id: 'product', tenantId: 'tenant', name: 'Hambúrguer da casa', isActive: true },
  { id: 'foreign', tenantId: 'other', name: 'Produto secreto', isActive: true },
] as Product[] };
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks(); h.list.mockResolvedValue([]); h.library.mockResolvedValue([media]);
  h.upload.mockResolvedValue(media);
  h.save.mockImplementation(async (tenantId, draft) => ({ ...existing, ...draft, tenantId }));
});

async function openNew() {
  render(<MenuOutdoorPanel {...props} />);
  const create = await screen.findByRole('button', { name: 'Criar primeiro banner' });
  fireEvent.click(create);
}
async function pickLibrary() {
  fireEvent.click(screen.getByRole('button', { name: 'Usar mídia da biblioteca' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Selecionar imagem 1' }));
}

describe('Outdoor do cardápio: gestão', () => {
  it.each(['OPERATOR', 'CEO', 'SUPER_ADMIN', 'CUSTOMER', null])('não renderiza nem consulta para papel %s', role => {
    const { container } = render(<MenuOutdoorPanel {...props} role={role} />);
    expect(container.textContent).toBe(''); expect(h.list).not.toHaveBeenCalled(); expect(h.library).not.toHaveBeenCalled();
  });
  it('gerente cria banner com mídia publicada, produto, ordem e agendamento próprios', async () => {
    render(<MenuOutdoorPanel {...props} role="MANAGER" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Criar primeiro banner' }));
    await pickLibrary();
    fireEvent.change(screen.getByLabelText(/Título do banner/), { target: { value: 'Lanche da tarde' } });
    fireEvent.change(screen.getByLabelText('Ao tocar no banner'), { target: { value: 'product' } });
    expect(screen.queryByRole('option', { name: 'Produto secreto' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Ordem de exibição'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2026-11-05T10:00' } });
    fireEvent.change(screen.getByLabelText('Término'), { target: { value: '2026-11-05T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar banner' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledExactlyOnceWith('tenant', {
      assetId: 'asset', title: 'Lanche da tarde', productId: 'product', sortOrder: 3, active: true,
      startsAt: '2026-11-05T13:00:00.000Z', endsAt: '2026-11-05T21:00:00.000Z',
    }));
    expect(await screen.findByText(/Outdoor atualizado/)).toBeTruthy();
  });
  it('envia arquivo pelo fluxo governado e usa apenas o asset devolvido', async () => {
    await openNew();
    const file = new File(['image'], 'banner.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('Arquivo de imagem ou vídeo'), { target: { files: [file] } });
    await waitFor(() => expect(h.upload).toHaveBeenCalledExactlyOnceWith('tenant', file));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Salvar banner' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar banner' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith('tenant', expect.objectContaining({ assetId: 'asset' })));
  });
  it('recusa intervalo invertido antes de chamar o servidor', async () => {
    await openNew(); await pickLibrary();
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2026-11-05T18:00' } });
    fireEvent.change(screen.getByLabelText('Término'), { target: { value: '2026-11-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar banner' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'O término precisa ser depois do início da exibição.');
    expect(h.save).not.toHaveBeenCalled();
  });
  it('permite pausar mídia despublicada e mantém o banner no histórico', async () => {
    h.list.mockResolvedValue([{ ...existing, imageUrl: undefined, mediaAvailable: false }]);
    h.save.mockResolvedValue({ ...existing, imageUrl: undefined, active: false, mediaAvailable: false });
    render(<MenuOutdoorPanel {...props} />);
    expect(await screen.findByText('Mídia indisponível')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith('tenant', expect.objectContaining({ id: 'slide', active: false })));
    expect(await screen.findByText('Pausado')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ativar' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('exibe recusa de autorização e conserva o formulário', async () => {
    h.save.mockRejectedValue(new Error('Sem permissão nesta loja.'));
    await openNew(); await pickLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar banner' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sem permissão nesta loja.');
    expect(screen.getByRole('button', { name: 'Salvar banner' })).toBeTruthy();
  });
  it('descarta uma resposta tardia ao trocar tenant', async () => {
    let resolveOld!: (rows: MenuOutdoorSlide[]) => void;
    h.list.mockImplementation((tenant: string) => tenant === 'tenant' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve([]));
    const { rerender } = render(<MenuOutdoorPanel {...props} />);
    rerender(<MenuOutdoorPanel {...props} tenantId="new-tenant" />);
    await screen.findByRole('button', { name: 'Criar primeiro banner' });
    await act(async () => { resolveOld([existing]); });
    expect(screen.queryByText('Sabores da casa')).toBeNull();
  });
  it('bloqueia gravações duplicadas enquanto o servidor responde', async () => {
    let finish!: (row: MenuOutdoorSlide) => void;
    h.save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openNew(); await pickLibrary();
    const submit = screen.getByRole('button', { name: 'Salvar banner' });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(h.save).toHaveBeenCalledTimes(1);
    await act(async () => { finish(existing); });
  });
  it('diferencia pausado, futuro, encerrado e no ar', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(menuOutdoorStatus({ active: false, startsAt: null, endsAt: null }, now)).toBe('Pausado');
    expect(menuOutdoorStatus({ active: true, startsAt: '2026-11-06T12:00:00Z', endsAt: null }, now)).toBe('Agendado');
    expect(menuOutdoorStatus({ active: true, startsAt: null, endsAt: '2026-11-05T12:00:00Z' }, now)).toBe('Encerrado');
    expect(menuOutdoorStatus({ active: true, startsAt: null, endsAt: null }, now)).toBe('No ar');
    expect(menuOutdoorStatus({ active: true, startsAt: null, endsAt: null, mediaAvailable: false }, now)).toBe('Sem mídia publicada');
  });
});
