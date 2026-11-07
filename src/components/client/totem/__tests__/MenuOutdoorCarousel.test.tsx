// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MenuOutdoorCarousel, outdoorImageDurationSeconds } from '../MenuOutdoorCarousel';

const img = { id: 'img', imageUrl: 'https://cdn.example/img.webp', imageDurationSeconds: 9, title: 'Foto' };
const video = { id: 'vid', videoUrl: 'https://cdn.example/video.mp4', title: 'Vídeo' };
const second = { id: 'other', imageUrl: 'https://cdn.example/other.webp', title: 'Outra foto' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Outdoor - timing and privacy', () => {
  it('accepts only 1..120 whole seconds from tenant configuration', () => {
    expect(outdoorImageDurationSeconds(1)).toBe(1);
    expect(outdoorImageDurationSeconds(120)).toBe(120);
    expect(outdoorImageDurationSeconds(-2)).toBe(6);
    expect(outdoorImageDurationSeconds(3.5)).toBe(6);
    expect(outdoorImageDurationSeconds('3')).toBe(6);
  });

  it('waits the configured image duration instead of a fixed three seconds', () => {
    render(<MenuOutdoorCarousel slides={[img, video]} />);
    expect(screen.getByRole('img', { name: 'Foto' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(8999));
    expect(screen.getByRole('img', { name: 'Foto' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('cardapio-outdoor-video')).toBeTruthy();
  });

  it('never advances an uploaded video by image timer; only on ended', () => {
    render(<MenuOutdoorCarousel slides={[video, second]} />);
    act(() => vi.advanceTimersByTime(60000));
    const current = screen.getByTestId('cardapio-outdoor-video');
    expect(current).toBeTruthy();
    fireEvent.ended(current);
    expect(screen.getByRole('img', { name: 'Outra foto' })).toBeTruthy();
  });

  it('prevents unsafe media URLs from becoming rendered sources', () => {
    render(<MenuOutdoorCarousel slides={[{ id: 'x', imageUrl: 'javascript:alert(1)', title: 'Inválida' }]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Banner indisponível')).toBeTruthy();
  });
});