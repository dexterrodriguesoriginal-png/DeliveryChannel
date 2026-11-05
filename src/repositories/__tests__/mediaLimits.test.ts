import { describe, expect, it, vi } from "vitest";
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
import { MAX_VIDEO_BYTES, mediaSizeError, videoDurationError } from '../mediaRepository';

describe('Limites de vídeo do outdoor', () => {
  it.each([1, 30, 299.9, 300, 300.4])('aceita vídeo de %s s', d => expect(videoDurationError(d)).toBeNull());
  it('recusa vídeo acima de 5 minutos com mensagem amigável', () => {
    expect(videoDurationError(301)).toMatch(/5min01s.*limite é de 5 minutos/);
    expect(videoDurationError(600)).toMatch(/10min00s/);
  });
  it.each([undefined, NaN, Infinity, 0, -1])('recusa duração ilegível (%s)', d => expect(videoDurationError(d)).toMatch(/duração/));
  it('vídeo de 200 MB passa; acima disso e imagem acima de 5 MB não', () => {
    expect(MAX_VIDEO_BYTES).toBe(209715200);
    expect(mediaSizeError('VIDEO', 150 * 1024 * 1024)).toBeNull();
    expect(mediaSizeError('VIDEO', MAX_VIDEO_BYTES)).toBeNull();
    expect(mediaSizeError('VIDEO', MAX_VIDEO_BYTES + 1)).toMatch(/200 MB/);
    expect(mediaSizeError('IMAGE', 6 * 1024 * 1024)).toMatch(/5 MB/);
  });
});
