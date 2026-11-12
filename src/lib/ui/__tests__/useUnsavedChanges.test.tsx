// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { confirmPendingDesignNavigation, useUnsavedChanges } from '../useUnsavedChanges';
function Panel({ dirty }: { dirty: boolean }) { useUnsavedChanges(dirty); return null; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('protects navigation and closing until every independent panel is saved or unmounted', () => {
  const confirm = vi.fn().mockReturnValue(false);
  Object.defineProperty(window, 'confirm', { value: confirm, configurable: true, writable: true });
  const first = render(<Panel dirty />), second = render(<Panel dirty />);
  expect(confirmPendingDesignNavigation()).toBe(false);
  first.rerender(<Panel dirty={false} />);
  expect(confirmPendingDesignNavigation()).toBe(false);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  confirm.mockReturnValue(true);
  expect(confirmPendingDesignNavigation()).toBe(true);
  second.unmount();
  const calls = confirm.mock.calls.length;
  expect(confirmPendingDesignNavigation()).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(calls);
});
