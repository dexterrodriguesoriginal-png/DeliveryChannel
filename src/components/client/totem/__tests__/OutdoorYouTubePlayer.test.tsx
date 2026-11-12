// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutdoorYouTubePlayer } from '../OutdoorYouTubePlayer';
import { MenuOutdoorCarousel } from '../MenuOutdoorCarousel';
import TotemMenuView, { DEFAULT_TOTEM_THEME } from '../TotemMenuView';

const slides = [{ id: 'yt', youtubeId: 'dQw4w9WgXcQ', title: 'Vídeo' },
  { id: 'img', imageUrl: 'https://cdn.example/foto.webp', title: 'Foto' }];
const player = { getDuration: vi.fn(() => 125), getCurrentTime: vi.fn(() => 0),
  mute: vi.fn(), playVideo: vi.fn(), destroy: vi.fn() };
let events: { onReady(event: { target: typeof player }): void;
  onStateChange(event: { data: number; target: typeof player }): void; onError(): void };
const host = window as Window & { YT?: unknown };
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  player.getDuration.mockReturnValue(125);
  host.YT = { Player: class { constructor(_frame: unknown, options: { events: typeof events }) { events = options.events; return player; } } };
});
afterEach(() => { cleanup(); delete host.YT; vi.useRealTimers(); });
const ready = async () => { await act(async () => {}); act(() => events.onReady({ target: player })); };

for (const kind of ['cardápio', 'totem']) describe(`YouTube no ${kind}`, () => {
  const mount = () => kind === 'cardápio'
    ? render(<MenuOutdoorCarousel slides={slides} />)
    : render(<TotemMenuView storeName="Loja" categories={[]} products={[]} outdoorSlides={slides}
      theme={DEFAULT_TOTEM_THEME} cartCount={0} onAddProduct={() => {}} onOpenCart={() => {}} />);
  it('avança no ENDED e mantém autoplay mudo', async () => {
    mount(); await ready();
    expect(player.mute).toHaveBeenCalled(); expect(player.playVideo).toHaveBeenCalled();
    act(() => events.onStateChange({ data: 0, target: player }));
    expect(screen.getByAltText('Foto')).toBeTruthy(); expect(player.destroy).toHaveBeenCalled();
  });
  it('usa a duração real acima de 60 segundos', async () => {
    mount(); await ready();
    act(() => vi.advanceTimersByTime(125000));
    expect(screen.queryByAltText('Foto')).toBeNull();
    act(() => events.onStateChange({ data: 0, target: player }));
    expect(screen.getByAltText('Foto')).toBeTruthy();
  });
  it('usa fallback de 60 segundos quando a API não fica pronta', () => {
    delete host.YT; mount();
    act(() => vi.advanceTimersByTime(59999)); expect(screen.queryByAltText('Foto')).toBeNull();
    act(() => vi.advanceTimersByTime(1)); expect(screen.getByAltText('Foto')).toBeTruthy();
  });
  it('retoma fallback de 60 segundos em erro do player', async () => {
    mount(); await ready(); act(() => events.onError());
    act(() => vi.advanceTimersByTime(59999)); expect(screen.queryByAltText('Foto')).toBeNull();
    act(() => vi.advanceTimersByTime(1)); expect(screen.getByAltText('Foto')).toBeTruthy();
  });
  it('ignora ENDED atrasado após desmontar', async () => {
    const view = mount(); await ready(); const old = events;
    view.unmount(); act(() => old.onStateChange({ data: 0, target: player }));
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('libera script e callback pendentes ao desmontar, inclusive após remontagem', () => {
  delete host.YT;
  const apiHost = window as Window & { onYouTubeIframeAPIReady?: () => void };
  const previous = vi.fn();
  apiHost.onYouTubeIframeAPIReady = previous;
  const append = vi.spyOn(document.head, 'appendChild').mockImplementation(node => node);
  for (let i = 0; i < 3; i++) {
    const view = render(<OutdoorYouTubePlayer youtubeId="dQw4w9WgXcQ" onEnded={vi.fn()} />);
    expect(apiHost.onYouTubeIframeAPIReady).not.toBe(previous);
    const script = append.mock.calls[i][0] as HTMLScriptElement;
    expect(script.src).toBe('https://www.youtube.com/iframe_api');
    view.unmount();
    expect(document.querySelector('script[src="https://www.youtube.com/iframe_api"]')).toBeNull();
    expect(apiHost.onYouTubeIframeAPIReady).toBe(previous);
    expect(script.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  }
  append.mockRestore();
  delete apiHost.onYouTubeIframeAPIReady;
});
it('mantém fallback quando duração é zero e não duplica avanço', async () => {
  player.getDuration.mockReturnValue(0);
  const advance = vi.fn();
  render(<OutdoorYouTubePlayer youtubeId="dQw4w9WgXcQ" onEnded={advance} />);
  await ready();
  act(() => vi.advanceTimersByTime(60000));
  act(() => events.onStateChange({ data: 0, target: player }));
  expect(advance).toHaveBeenCalledTimes(1);
});
it('banner único repete no ENDED e limpa o player', async () => {
  const advance = vi.fn();
  const view = render(<OutdoorYouTubePlayer youtubeId="dQw4w9WgXcQ" loop onEnded={advance} />);
  await ready();
  act(() => vi.advanceTimersByTime(180000));
  act(() => events.onStateChange({ data: 0, target: player }));
  expect(advance).not.toHaveBeenCalled();
  expect(player.playVideo).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(player.destroy).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserva o iframe de React quando destroy remove o nó em StrictMode', async () => {
  host.YT = { Player: class {
    constructor(frame: HTMLIFrameElement, options: { events: typeof events }) {
      events = options.events;
      return { ...player, destroy: () => { player.destroy(); frame.remove(); } };
    }
  } };
  const view = render(<React.StrictMode><OutdoorYouTubePlayer youtubeId="dQw4w9WgXcQ" onEnded={vi.fn()} /></React.StrictMode>);
  await ready();
  expect(view.container.querySelector('iframe')?.isConnected).toBe(true);
  view.unmount();
  expect(player.destroy).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
