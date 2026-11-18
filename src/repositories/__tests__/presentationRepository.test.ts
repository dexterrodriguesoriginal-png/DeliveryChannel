// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), getPublishedUrl: vi.fn(), dims: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: m.rpc, from: m.from }, isSupabaseConfigured: true }));
vi.mock('../../lib/backendSchema', () => ({ isN1N6Backend: () => true, N1N6_ONLY_MESSAGE: 'n1n6' }));
vi.mock('../../lib/backend', async (orig) => ({ ...(await orig<typeof import('../../lib/backend')>()), requireBackend: () => {} }));
vi.mock('../mediaRepository', async (orig) => {
  const real = await orig<typeof import('../mediaRepository')>();
  return { ...real, readMediaDimensions: m.dims, mediaRepository: { uploadAndPublishCreative: m.upload, getPublishedUrl: m.getPublishedUrl } };
});
import { presentationRepository, validatePresentationFile } from '../presentationRepository';

const MB = 1024 * 1024;
const file = (name: string, type: string, size: number) => { const f = new File(['x'], name, { type }); Object.defineProperty(f, 'size', { value: size }); return f; };
beforeEach(() => { vi.resetAllMocks(); });

describe('presentationRepository', () => {
  it('recusa no navegador imagem > 3 MB, vídeo > 15 MB, vídeo > 10 s e formato errado, sem enviar nada', async () => {
    m.dims.mockResolvedValue({ duration: 12.4 });
    await expect(presentationRepository.upload('t', file('a.png', 'image/png', 3 * MB + 1))).rejects.toThrow(/3 MB/);
    await expect(presentationRepository.upload('t', file('v.mp4', 'video/mp4', 16 * MB))).rejects.toThrow(/15 MB/);
    await expect(presentationRepository.upload('t', file('v.mp4', 'video/mp4', 2 * MB))).rejects.toThrow(/10 segundos/);
    await expect(presentationRepository.upload('t', file('a.svg', 'image/svg+xml', 10))).rejects.toThrow(/Formato/);
    expect(m.upload).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
    m.dims.mockResolvedValue({ duration: 9.9 });
    expect(await validatePresentationFile(file('v.webm', 'video/webm', 2 * MB))).toBeNull();
  });
  it('envia pelo fluxo governado N3 e grava só pela RPC (servidor confere papel/tenant)', async () => {
    m.dims.mockResolvedValue({ duration: 8 });
    m.upload.mockResolvedValue({ assetId: 'a1', publicUrl: 'https://cdn/x.mp4', mediaType: 'VIDEO' });
    m.rpc.mockResolvedValue({ data: { mediaType: 'VIDEO', imageSeconds: 2.5, oncePerDay: true }, error: null });
    const s = await presentationRepository.upload('t1', file('v.mp4', 'video/mp4', 5 * MB), { oncePerDay: true });
    expect(m.upload).toHaveBeenCalledWith('t1', expect.any(File));
    expect(m.rpc).toHaveBeenCalledWith('set_presentation_screen', { p_tenant_id: 't1', p_asset_id: 'a1', p_image_seconds: 2.5, p_once_per_day: true });
    expect(s).toMatchObject({ assetId: 'a1', mediaType: 'VIDEO', oncePerDay: true, url: 'https://cdn/x.mp4' });
    expect(m.from).not.toHaveBeenCalled();
  });
  it('caixa/cozinha/cliente: o servidor recusa e a mensagem chega ao painel', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN: só o dono ou gerente da loja altera a tela inicial.', code: '42501' } });
    await expect(presentationRepository.save('t1', 'a1', { imageSeconds: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(presentationRepository.clear('t1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(m.rpc).toHaveBeenCalledWith('clear_presentation_screen', { p_tenant_id: 't1' });
  });
  it('lê a configuração da própria loja com URL pública da prévia', async () => {
    const q: any = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn().mockResolvedValue({ data: { asset_id: 'a1', media_type: 'IMAGE', image_seconds: '3.5', once_per_day: false, enabled: true }, error: null }) };
    m.from.mockReturnValue(q);
    m.getPublishedUrl.mockResolvedValue('https://cdn/a.png');
    expect(await presentationRepository.get('t1')).toEqual({ assetId: 'a1', mediaType: 'IMAGE', imageSeconds: 3.5, oncePerDay: false, enabled: true, url: 'https://cdn/a.png' });
    expect(m.from).toHaveBeenCalledWith('tenant_presentation_screens');
    expect(q.eq).toHaveBeenCalledWith('tenant_id', 't1');
    q.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await presentationRepository.get('t1')).toBeNull();
  });
});
