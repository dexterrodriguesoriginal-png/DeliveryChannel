// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  clampIdleTimeout,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  MAX_IDLE_TIMEOUT_SECONDS,
  MIN_IDLE_TIMEOUT_SECONDS,
  useIdleTimer,
} from '../useIdleTimer';

describe('useIdleTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('clampIdleTimeout', () => {
    it('defaults to 60 for undefined or non-number inputs', () => {
      expect(clampIdleTimeout(undefined)).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
      expect(clampIdleTimeout(null as unknown as number)).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
      expect(clampIdleTimeout(NaN)).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
    });

    it('clamps values below 30 to 30', () => {
      expect(clampIdleTimeout(0)).toBe(MIN_IDLE_TIMEOUT_SECONDS);
      expect(clampIdleTimeout(-10)).toBe(MIN_IDLE_TIMEOUT_SECONDS);
      expect(clampIdleTimeout(29)).toBe(MIN_IDLE_TIMEOUT_SECONDS);
    });

    it('clamps values above 300 to 300', () => {
      expect(clampIdleTimeout(301)).toBe(MAX_IDLE_TIMEOUT_SECONDS);
      expect(clampIdleTimeout(1000)).toBe(MAX_IDLE_TIMEOUT_SECONDS);
    });

    it('preserves valid integers within 30-300 range', () => {
      expect(clampIdleTimeout(30)).toBe(30);
      expect(clampIdleTimeout(60)).toBe(60);
      expect(clampIdleTimeout(120)).toBe(120);
      expect(clampIdleTimeout(300)).toBe(300);
    });
  });

  describe('idle timer lifecycle', () => {
    it('does not start timers when enabled is false', () => {
      const onTimeout = vi.fn();
      const onWarning = vi.fn();

      const { result } = renderHook(() =>
        useIdleTimer({
          enabled: false,
          idleTimeoutSeconds: 60,
          warningSeconds: 10,
          onTimeout,
          onWarning,
        })
      );

      act(() => {
        vi.advanceTimersByTime(70000);
      });

      expect(result.current.isWarning).toBe(false);
      expect(onWarning).not.toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('shows warning after idleTimeoutSeconds elapses', () => {
      const onTimeout = vi.fn();
      const onWarning = vi.fn();

      const { result } = renderHook(() =>
        useIdleTimer({
          enabled: true,
          idleTimeoutSeconds: 60,
          warningSeconds: 10,
          onTimeout,
          onWarning,
        })
      );

      expect(result.current.isWarning).toBe(false);

      act(() => {
        vi.advanceTimersByTime(59000);
      });
      expect(result.current.isWarning).toBe(false);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.isWarning).toBe(true);
      expect(result.current.secondsRemaining).toBe(10);
      expect(onWarning).toHaveBeenCalledOnce();
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('counts down warning and triggers onTimeout at 0 seconds', () => {
      const onTimeout = vi.fn();
      const onWarning = vi.fn();

      const { result } = renderHook(() =>
        useIdleTimer({
          enabled: true,
          idleTimeoutSeconds: 60,
          warningSeconds: 10,
          onTimeout,
          onWarning,
        })
      );

      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(result.current.isWarning).toBe(true);
      expect(result.current.secondsRemaining).toBe(10);

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.secondsRemaining).toBe(7);

      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(result.current.isWarning).toBe(false);
      expect(result.current.secondsRemaining).toBe(0);
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('resets timer when user activity occurs before warning', () => {
      const onTimeout = vi.fn();
      const onWarning = vi.fn();

      const { result } = renderHook(() =>
        useIdleTimer({
          enabled: true,
          idleTimeoutSeconds: 60,
          warningSeconds: 10,
          onTimeout,
          onWarning,
        })
      );

      act(() => {
        vi.advanceTimersByTime(40000);
      });

      // User taps screen
      act(() => {
        window.dispatchEvent(new Event('pointerdown'));
      });

      // 40s more should not trigger warning yet (total 80s, but only 40s since tap)
      act(() => {
        vi.advanceTimersByTime(40000);
      });
      expect(result.current.isWarning).toBe(false);

      // Another 20s reaches 60s since last tap -> warning triggered
      act(() => {
        vi.advanceTimersByTime(20000);
      });
      expect(result.current.isWarning).toBe(true);
    });

    it('dismisses warning and restarts timer when user activity occurs during warning', () => {
      const onTimeout = vi.fn();
      const onWarning = vi.fn();
      const onReset = vi.fn();

      const { result } = renderHook(() =>
        useIdleTimer({
          enabled: true,
          idleTimeoutSeconds: 60,
          warningSeconds: 10,
          onTimeout,
          onWarning,
          onReset,
        })
      );

      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(result.current.isWarning).toBe(true);

      // User interacts during warning
      act(() => {
        window.dispatchEvent(new Event('keydown'));
      });

      expect(result.current.isWarning).toBe(false);
      expect(result.current.secondsRemaining).toBe(10);
      expect(onReset).toHaveBeenCalledOnce();
      expect(onTimeout).not.toHaveBeenCalled();

      // Advancing 50s should not timeout
      act(() => {
        vi.advanceTimersByTime(50000);
      });
      expect(result.current.isWarning).toBe(false);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('allows manual resetTimer() to dismiss warning and restart timer', () => {
      const onTimeout = vi.fn();
      const onReset = vi.fn();

      const { result } = renderHook(() =>
        useIdleTimer({
          enabled: true,
          idleTimeoutSeconds: 60,
          warningSeconds: 10,
          onTimeout,
          onReset,
        })
      );

      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(result.current.isWarning).toBe(true);

      act(() => {
        result.current.resetTimer();
      });

      expect(result.current.isWarning).toBe(false);
      expect(onReset).toHaveBeenCalledOnce();
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('cleans up event listeners and timers on unmount', () => {
      const onTimeout = vi.fn();
      const { unmount } = renderHook(() =>
        useIdleTimer({
          enabled: true,
          idleTimeoutSeconds: 60,
          warningSeconds: 10,
          onTimeout,
        })
      );

      unmount();

      act(() => {
        vi.advanceTimersByTime(100000);
      });

      expect(onTimeout).not.toHaveBeenCalled();
    });
  });
});
