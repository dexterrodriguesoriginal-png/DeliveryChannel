// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mimics supabase-js RealtimeClient: same topic returns the same (already subscribed) channel,
// and adding postgres_changes after subscribe() throws.
const h = vi.hoisted(() => ({ channels: new Map<string, { subscribed: boolean }>() }));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ activeTenant: { id: 'tenant-1' }, activeRole: 'OWNER', supabaseUser: { id: 'u1' } }),
}));
vi.mock('../../../../hooks/useModules', () => ({ useModules: () => ({ available: true, isModuleEnabled: () => true }) }));
vi.mock('../../../../utils/audio', () => ({ playShortBeep: () => {} }));
vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: () => { const b: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'in', 'neq', 'order']) b[m] = () => b; b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r); return b; },
    channel: (topic: string) => {
      const state = h.channels.get(topic) ?? { subscribed: false };
      h.channels.set(topic, state);
      const c: Record<string, unknown> = {
        on: () => { if (state.subscribed) throw new Error(`cannot add postgres_changes callbacks for ${topic} after subscribe()`); return c; },
        subscribe: () => { state.subscribed = true; return c; },
      };
      return c;
    },
    removeChannel: () => {},
  },
}));

import { OpenDiningTabsWarning, PanelBillRequestedAlert } from '../OpenDiningTabsWarning';

describe('open-tabs realtime channel', () => {
  it('global bill toast and dashboard warning mount together without crashing', () => {
    expect(() => render(<>
      <PanelBillRequestedAlert onViewBill={() => {}} onCheckoutBill={() => {}} />
      <OpenDiningTabsWarning />
    </>)).not.toThrow();
    expect(h.channels.size).toBe(2);
  });
});

