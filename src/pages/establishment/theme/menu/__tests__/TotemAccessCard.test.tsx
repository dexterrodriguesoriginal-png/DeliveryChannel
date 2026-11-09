// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TotemAccessCard } from '../TotemAccessCard';

const downloadBlob = vi.fn();
const qrPngBlob = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
const printTotemQr = vi.fn(() => true);

vi.mock('../../../../../lib/salon/qrImage', () => ({
  downloadBlob: (...args: unknown[]) => downloadBlob(...(args as [])),
  qrPngBlob: (...args: unknown[]) => qrPngBlob(...(args as [])),
}));

vi.mock('../../../../../lib/menu/totemAccess', async () => {
  const actual = await vi.importActual<typeof import('../../../../../lib/menu/totemAccess')>(
    '../../../../../lib/menu/totemAccess',
  );
  return {
    ...actual,
    printTotemQr: (...args: unknown[]) => printTotemQr(...(args as [])),
  };
});

beforeEach(() => {
  downloadBlob.mockClear();
  qrPngBlob.mockClear();
  printTotemQr.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => cleanup());

const origin = 'https://deliverychannel.example';
const slug = 'adegasshow';
const url = `${origin}/totem/${slug}`;

describe('TotemAccessCard', () => {
  it('shows the totem link, QR, copy, download, print, open and install guide', () => {
    render(<TotemAccessCard slug={slug} storeName="Adegas Show" origin={origin} />);

    const input = screen.getByTestId('totem-access-url') as HTMLInputElement;
    expect(input.value).toBe(url);

    const qr = screen.getByTestId('totem-access-qr');
    expect(qr.querySelector('svg')).toBeTruthy();

    expect(screen.getByTestId('totem-access-copy').textContent).toContain('Copiar');
    expect(screen.getByTestId('totem-access-download').textContent).toContain('Baixar QR');
    expect(screen.getByTestId('totem-access-print').textContent).toContain('Imprimir');

    const open = screen.getByTestId('totem-access-open');
    expect(open.getAttribute('href')).toBe(url);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.textContent).toContain('Abrir totem neste aparelho');

    const guide = screen.getByTestId('totem-access-guide');
    expect(guide.textContent).toMatch(/Recomendado/);
    expect(guide.textContent).toMatch(/Instalar como app \(tela cheia\)/);
    expect(guide.textContent).toMatch(/sem o aviso do Chrome/);
    expect(guide.textContent).toMatch(/Android \(Chrome\)/);
    expect(guide.textContent).toMatch(/iPhone e iPad \(Safari\)/);
    expect(guide.textContent).toMatch(/Fixar app/);
    expect(guide.textContent).toMatch(/Screen pinning/);
    expect(guide.textContent).toMatch(/Configurações/);
    expect(guide.textContent).toMatch(/chrome --kiosk/);
    expect(guide.textContent).toMatch(/volta sozinho para a capa/);
  });

  it('copies the link and shows a toast', async () => {
    render(<TotemAccessCard slug={slug} origin={origin} />);
    fireEvent.click(screen.getByTestId('totem-access-copy'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url));
    expect(screen.getByTestId('totem-access-toast').textContent).toContain('Link copiado.');
  });

  it('downloads a PNG of the on-screen QR', async () => {
    render(<TotemAccessCard slug={slug} origin={origin} />);
    fireEvent.click(screen.getByTestId('totem-access-download'));
    await waitFor(() => expect(qrPngBlob).toHaveBeenCalled());
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'totem-adegasshow.png');
    expect(screen.getByTestId('totem-access-toast').textContent).toContain('Imagem do QR baixada.');
  });

  it('prints the QR through the print helper', () => {
    render(<TotemAccessCard slug={slug} storeName="Adegas Show" origin={origin} />);
    fireEvent.click(screen.getByTestId('totem-access-print'));
    expect(printTotemQr).toHaveBeenCalledTimes(1);
    const call = printTotemQr.mock.calls[0] as unknown as [SVGElement, { url: string; storeName: string }];
    expect(call[0]).toBeInstanceOf(SVGElement);
    expect(call[1]).toEqual({ url, storeName: 'Adegas Show' });
  });

  it('hides the link and QR when the slug is invalid', () => {
    render(<TotemAccessCard slug="" origin={origin} />);
    expect(screen.getByTestId('totem-access-card').getAttribute('data-ready')).toBe('false');
    expect(screen.queryByTestId('totem-access-url')).toBeNull();
    expect(screen.getByText(/endereço \(slug\) válido/)).toBeTruthy();
  });
});
