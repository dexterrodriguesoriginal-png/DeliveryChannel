// Browser-only: turns an on-screen QR <svg> into a printable PNG poster. Never throws to the UI: callers handle the rejection.

export function svgToDataUrl(svg: SVGElement): string {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível gerar a imagem do QR.'));
    image.src = src;
  });
}

export async function qrPosterBlob(svg: SVGElement, title: string, storeName: string): Promise<Blob> {
  const image = await loadImage(svgToDataUrl(svg));
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1400;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não permite gerar a imagem.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center';
  ctx.font = '700 54px system-ui, sans-serif'; ctx.fillText(storeName.slice(0, 32), 540, 130);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 140, 200, 800, 800);
  ctx.font = '900 120px system-ui, sans-serif'; ctx.fillText(title.slice(0, 15), 540, 1160);
  ctx.fillStyle = '#475569'; ctx.font = '600 48px system-ui, sans-serif'; ctx.fillText('Aponte a câmera e peça pela mesa', 540, 1260);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao gerar o PNG.')), 'image/png'));
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
