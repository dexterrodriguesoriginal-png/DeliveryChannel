// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TotemCapaScreen, splitCtaLines } from '../TotemCapaScreen';
import { DEFAULT_TOTEM_WELCOME, type TotemWelcomeSettings } from '../../../../lib/menu/totemWelcome';

const imgA = 'https://cdn.example/a.jpg';
const imgB = 'https://cdn.example/b.jpg';
const video = 'https://cdn.example/clip.mp4';

function settings(patch: Partial<TotemWelcomeSettings> = {}): TotemWelcomeSettings {
  return { ...DEFAULT_TOTEM_WELCOME, slides: [], ...patch };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TotemCapaScreen', () => {
  it('splits long CTA labels into two lines without changing the words', () => {
    expect(splitCtaLines('Toque para começar')).toEqual(['Toque para', 'começar']);
    expect(splitCtaLines('Peça agora')).toEqual(['Peça agora']);
  });

  it('shows the CTA without store name or logo over the media', () => {
    render(
      <TotemCapaScreen
        settings={settings({ slides: [{ url: imgA, kind: 'IMAGE' }], buttonText: 'Peça agora', buttonStyle: 'BAR' })}
        buttonBackground="#1D4ED8"
        buttonColor="#FFFFFF"
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByTestId('totem-capa-image').getAttribute('src')).toBe(imgA);
    expect(screen.getByTestId('totem-capa-cta').textContent).toContain('Peça agora');
    expect(screen.getByTestId('totem-capa-cta').getAttribute('data-style')).toBe('BAR');
    expect(screen.getByTestId('totem-capa').textContent).not.toMatch(/Café|Logo/);
  });

  it('advances images after the configured seconds and videos only on ended', () => {
    render(
      <TotemCapaScreen
        settings={settings({
          imageSeconds: 4,
          slides: [
            { url: imgA, kind: 'IMAGE' },
            { url: video, kind: 'VIDEO' },
            { url: imgB, kind: 'IMAGE' },
          ],
        })}
        buttonBackground="#111111"
        buttonColor="#FFFFFF"
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByTestId('totem-capa-image').getAttribute('src')).toBe(imgA);
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByTestId('totem-capa-image').getAttribute('src')).toBe(imgA);
    act(() => vi.advanceTimersByTime(1));
    const player = screen.getByTestId('totem-capa-video');
    expect(player.getAttribute('src')).toBe(video);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByTestId('totem-capa-video')).toBeTruthy();
    fireEvent.ended(player);
    expect(screen.getByTestId('totem-capa-image').getAttribute('src')).toBe(imgB);
  });

  it('renders pill and outline styles and starts the menu from the CTA', () => {
    const onStart = vi.fn();
    const view = render(
      <TotemCapaScreen
        settings={settings({ buttonStyle: 'PILL', buttonText: 'Toque para começar' })}
        buttonBackground="#FACC15"
        buttonColor="#18181B"
        onStart={onStart}
      />,
    );
    expect(screen.getByTestId('totem-capa-cta').getAttribute('data-style')).toBe('PILL');
    fireEvent.click(screen.getByTestId('totem-capa-cta'));
    expect(onStart).toHaveBeenCalledOnce();
    view.unmount();
    render(
      <TotemCapaScreen
        settings={settings({ buttonStyle: 'OUTLINE' })}
        buttonBackground="#1D4ED8"
        buttonColor="#FFFFFF"
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByTestId('totem-capa-cta').getAttribute('data-style')).toBe('OUTLINE');
  });
});
