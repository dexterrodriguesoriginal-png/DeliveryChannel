// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SystemBarFills } from '../SystemBarFills';
import { resolveSystemBars } from '../../../lib/pwa/systemBars';

describe('SystemBarFills', () => {
  it('pinta a barra de navegação com a cor de navegação e a de status com a de status, separadas', () => {
    const bars = resolveSystemBars({ headerColor: '#111827', statusBarColor: '#d4a017', navBarColor: '#1d4ed8' });
    render(<SystemBarFills statusColor={bars.status} navColor={bars.nav} />);
    const nav = screen.getByTestId('system-nav-fill');
    const status = screen.getByTestId('system-status-fill');
    expect(nav.style.backgroundColor).toBe('#1d4ed8');
    expect(status.style.backgroundColor).toBe('#d4a017');
    expect(nav.className).toContain('bottom-0');
    expect(nav.className).toContain('pointer-events-none');
    expect(nav.getAttribute('aria-hidden')).toBe('true');
  });
});
