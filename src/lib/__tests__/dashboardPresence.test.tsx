// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useIsDashboardOpen, useMarkDashboardOpen } from '../dashboardPresence';

function Probe() { return <span data-testid="p">{String(useIsDashboardOpen())}</span>; }
function Dash() { useMarkDashboardOpen(); return null; }

describe('dashboardPresence (popup verde não duplica no Dashboard)', () => {
  it('fica true só enquanto o Dashboard está montado', () => {
    const r = render(<><Probe /><Dash /></>);
    expect(r.getByTestId('p').textContent).toBe('true');
    r.rerender(<><Probe /></>);
    expect(r.getByTestId('p').textContent).toBe('false');
  });
});
