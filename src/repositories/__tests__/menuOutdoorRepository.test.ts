import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), bucket: vi.fn(), publicUrl: vi.fn(), rows: [] as unknown[] }));
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: h.rpc, from: h.from, storage: { from: h.bucket },
} }));
import { menuOutdoorRepository } from '../menuOutdoorRepository';

const tenant = '10000000-0000-0000-0000-00000000000a';
const asset = 'e2080000-0000-0000-0000-000000000001';
const path = `${tenant}/published/${asset}.webp`;
const row = { id: 'slide', tenant_id: tenant, asset_id: asset, title: 'Especial da casa', product_id: 'product',
  public_path: path, media_type: 'IMAGE', sort_order: 2, active: true, starts_at: null, ends_at: null,
  customer_email: 'segredo@example.com', private_path: 'never-return' };
beforeEach(() => {
  vi.clearAllMocks(); h.rows = [];
  h.rpc.mockResolvedValue({ data: [row], error: null });
  h.publicUrl.mockImplementation((value: string) => ({ data: { publicUrl: `https://media.example/${value}` } }));
  h.bucket.mockReturnValue({ getPublicUrl: h.publicUrl });
  h.from.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve);
    return chain;
  });
});

describe('Outdoor do cardápio: repositório', () => {
  it('lê a projeção pública via RPC e preserva somente o contrato visual do totem', async () => {
    expect(await menuOutdoorRepository.getPublicSlides('minha-loja')).toEqual([{
      id: 'slide', imageUrl: `https://media.example/${path}`, title: 'Especial da casa', productId: 'product',
    }]);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('list_public_menu_outdoor', { p_slug: 'minha-loja' });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.bucket).toHaveBeenCalledWith('marketing-public');
  });
  it('respeita a duração por imagem vinda da projeção pública', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...row, image_duration_seconds: 13 }], error: null });
    const [slide] = await menuOutdoorRepository.getPublicSlides('loja');
    expect(slide.imageDurationSeconds).toBe(13);
    expect(JSON.stringify(slide)).not.toContain('segredo');
  });
  it('mapeia vídeo sem transformá-lo em imagem', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...row, public_path: path.replace('.webp', '.mp4'), media_type: 'VIDEO' }], error: null });
    const [slide] = await menuOutdoorRepository.getPublicSlides('loja');
    expect(slide.videoUrl).toContain('.mp4'); expect(slide.imageUrl).toBeUndefined();
  });
  it.each(['javascript:alert(1)', 'https://externo.example/banner.png', `${tenant}/drafts/${asset}.webp`, `${tenant}/published/../secret.png`])(
    'recusa path público não governado: %s', async publicPath => {
      h.rpc.mockResolvedValue({ data: [{ ...row, public_path: publicPath }], error: null });
      await expect(menuOutdoorRepository.getPublicSlides('loja')).rejects.toThrow('mídia do outdoor não é válida');
      expect(h.publicUrl).not.toHaveBeenCalled();
    });
  it('preserva gestão de mídia despublicada sem resolver path privado', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...row, public_path: null }], error: null });
    const [slide] = await menuOutdoorRepository.list(tenant);
    expect(slide).toMatchObject({ id: 'slide', assetId: asset, mediaAvailable: false, active: true });
    expect(slide.imageUrl).toBeUndefined(); expect(slide.videoUrl).toBeUndefined();
    expect(JSON.stringify(slide)).not.toMatch(/segredo|never-return/);
    expect(h.publicUrl).not.toHaveBeenCalled();
  });
  it('salva tenant e campos permitidos; pausar não apaga banner nem mídia', async () => {
    h.rpc.mockResolvedValue({ data: { ...row, public_path: null, active: false }, error: null });
    const result = await menuOutdoorRepository.save(tenant, {
      id: 'slide', assetId: asset, title: '  Pausado  ', productId: '', sortOrder: 4, active: false,
      startsAt: null, endsAt: null,
    });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('save_menu_outdoor_slide', {
      p_tenant_id: tenant, p_id: 'slide', p_asset_id: asset, p_youtube_id: null, p_title: 'Pausado', p_product_id: null,
      p_sort_order: 4, p_active: false, p_starts_at: null, p_ends_at: null, p_image_duration_seconds: 6,
    });
    expect(result.mediaAvailable).toBe(false); expect(result.active).toBe(false);
    expect(h.from).not.toHaveBeenCalled();
  });
  it('carrega somente ativos publicados da biblioteca do tenant e ignora paths de outra loja', async () => {
    h.rows = [{ id: asset, tenant_id: tenant, media_type: 'IMAGE', public_path: path },
      { id: 'other', tenant_id: 'other', media_type: 'IMAGE', public_path: path },
      { id: asset, tenant_id: tenant, media_type: 'IMAGE', public_path: `${tenant}/drafts/${asset}.webp` }];
    expect(await menuOutdoorRepository.listPublishedMedia(tenant)).toEqual([{
      assetId: asset, mediaType: 'IMAGE', publicPath: path, publicUrl: `https://media.example/${path}`,
    }]);
    expect(h.from).toHaveBeenCalledWith('marketing_media_assets');
    const chain = h.from.mock.results[0].value;
    expect(chain.select).toHaveBeenCalledWith('id,tenant_id,media_type,public_path');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', tenant);
    expect(chain.eq).toHaveBeenCalledWith('kind', 'CREATIVE');
    expect(chain.eq).toHaveBeenCalledWith('status', 'PUBLISHED');
  });
  it('propaga recusas do servidor sem fingir sucesso', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'FORBIDDEN' } });
    await expect(menuOutdoorRepository.save(tenant, { assetId: asset, sortOrder: 0, active: true })).rejects.toThrow('FORBIDDEN');
  });
});

describe('Outdoor do cardápio: YouTube e exclusão', () => {
  const yt = { id: 'slide-yt', tenant_id: tenant, asset_id: null, media_kind: 'YOUTUBE', youtube_id: 'dQw4w9WgXcQ',
    title: 'Promo', product_id: null, public_path: null, media_type: 'YOUTUBE', sort_order: 1, active: true, starts_at: null, ends_at: null };
  it('mapeia banner do YouTube somente pelo id, sem URL de storage', async () => {
    h.rpc.mockResolvedValue({ data: [yt], error: null });
    expect(await menuOutdoorRepository.getPublicSlides('loja')).toEqual([{ id: 'slide-yt', youtubeId: 'dQw4w9WgXcQ', title: 'Promo' }]);
    expect(h.publicUrl).not.toHaveBeenCalled();
    const [staff] = await menuOutdoorRepository.list(tenant);
    expect(staff).toMatchObject({ youtubeId: 'dQw4w9WgXcQ', assetId: '', mediaAvailable: true });
  });
  it.each(['https://evil.example/x', '<script>', 'dQw4w9WgXcQ1', null])('recusa id do YouTube inválido vindo do servidor: %s', async id => {
    h.rpc.mockResolvedValue({ data: [{ ...yt, youtube_id: id }], error: null });
    await expect(menuOutdoorRepository.getPublicSlides('loja')).rejects.toThrow('mídia do outdoor não é válida');
  });
  it('salva YouTube sem asset e recusa id malicioso antes da RPC', async () => {
    h.rpc.mockResolvedValue({ data: yt, error: null });
    await menuOutdoorRepository.save(tenant, { youtubeId: 'dQw4w9WgXcQ', sortOrder: 1, active: true });
    expect(h.rpc).toHaveBeenCalledWith('save_menu_outdoor_slide', expect.objectContaining({ p_asset_id: null, p_youtube_id: 'dQw4w9WgXcQ' }));
    h.rpc.mockClear();
    await expect(menuOutdoorRepository.save(tenant, { youtubeId: 'javascript:x', sortOrder: 1, active: true })).rejects.toThrow('YouTube inválido');
    await expect(menuOutdoorRepository.save(tenant, { sortOrder: 1, active: true })).rejects.toThrow('Escolha');
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('exclui pelo RPC com tenant e exige confirmação do servidor', async () => {
    h.rpc.mockResolvedValue({ data: { id: 'slide', deleted: true }, error: null });
    await menuOutdoorRepository.remove(tenant, 'slide');
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('delete_menu_outdoor_slide', { p_tenant_id: tenant, p_id: 'slide' });
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(menuOutdoorRepository.remove(tenant, 'slide')).rejects.toThrow('não confirmou');
    h.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', code: '42501' } });
    await expect(menuOutdoorRepository.remove(tenant, 'slide')).rejects.toThrow();
  });
});
