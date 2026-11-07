// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TotemKioskLayer } from '../TotemKioskLayer';

describe('TotemKioskLayer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('has no expand/fullscreen button in kiosk mode', () => {
    render(<TotemKioskLayer enabled idleSeconds={30} onIdle={vi.fn()} />);
    expect(screen.queryByTestId('totem-fullscreen-button')).toBeNull();
  });
  it('renders nothing when disabled and never fires onIdle', () => {
    const onIdle = vi.fn();
    const { container } = render(<TotemKioskLayer enabled={false} idleSeconds={30} onIdle={onIdle} />);
    act(() => { vi.advanceTimersByTime(120000); });
    expect(container.innerHTML).toBe('');
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('asks "Ainda está aí?" after idle and resets the session after 10 s', () => {
    const onIdle = vi.fn();
    render(<TotemKioskLayer enabled idleSeconds={30} onIdle={onIdle} />);
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.getByText('Ainda está aí?')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(9000); });
    expect(onIdle).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onIdle).toHaveBeenCalledOnce();
    expect(screen.queryByText('Ainda está aí?')).toBeNull();
  });

  it('keeps the session when the customer answers', () => {
    const onIdle = vi.fn();
    render(<TotemKioskLayer enabled idleSeconds={30} onIdle={onIdle} />);
    act(() => { vi.advanceTimersByTime(35000); });
    fireEvent.click(screen.getByText('Continuar pedindo'));
    expect(screen.queryByText('Ainda está aí?')).toBeNull();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(onIdle).not.toHaveBeenCalled();
  });
});
