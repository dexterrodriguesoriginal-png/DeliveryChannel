// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataUrlBytes, fileToWaiterPhoto, WAITER_PHOTO_MAX_BYTES } from '../waiter/photo';
const photo = (bytes: number) => `data:image/jpeg;base64,${btoa('x'.repeat(bytes))}`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('foto da equipe', () => {
  it('compresses photos below 200 KB before sending them to the server', async () => {
    const close = vi.fn(); const drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as any);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValueOnce(photo(220 * 1024)).mockReturnValueOnce(photo(190 * 1024));
    const result = await fileToWaiterPhoto(new File(['photo'], 'photo.png', { type: 'image/png' }));
    expect(WAITER_PHOTO_MAX_BYTES).toBe(200 * 1024);
    expect(dataUrlBytes(result)).toBe(190 * 1024);
    expect(encode).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 384, 288);
    expect(close).toHaveBeenCalledOnce();
  });
  it('refuses a photo that remains above the frontend size limit', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 300, height: 300, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(photo(201 * 1024));
    await expect(fileToWaiterPhoto(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow('A foto é muito grande. Escolha outra.');
  });
});

