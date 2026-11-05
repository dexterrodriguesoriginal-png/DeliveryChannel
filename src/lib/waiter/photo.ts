/** Reduz a foto do garçom no navegador para caber em 200 KB (JPEG, lado maior 384 px) e devolve um data URL. */
export const WAITER_PHOTO_MAX_BYTES = 200 * 1024;

export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

export async function fileToWaiterPhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma foto JPG, PNG ou WebP.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('Não foi possível ler a foto. Use outra imagem JPG, PNG ou WebP.'); }
  const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) { bitmap.close(); throw new Error('Não foi possível preparar a foto. Tente outra imagem.'); }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(url) <= WAITER_PHOTO_MAX_BYTES) return url;
  }
  throw new Error('A foto é muito grande. Escolha outra.');
}

