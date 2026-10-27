import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));
import { openDiningTabLabels } from '../OpenDiningTabsWarning';

describe('open dining tab warning', () => {
  it('uses table labels and elapsed whole hours for open and bill-requested tabs', () => {
    const labels = openDiningTabLabels([
      { id: 't1', table_id: 'table-5', opened_at: '2026-10-19T14:00:00.000Z', status: 'OPEN' },
      { id: 't2', table_id: 'table-8', opened_at: '2026-10-19T20:30:00.000Z', status: 'BILL_REQUESTED' },
    ], [
      { id: 'table-5', label: '5' },
      { id: 'table-8', label: '8' },
    ], Date.parse('2026-10-19T23:41:00.000Z'));
    expect(labels).toEqual(['Mesa 5 aberta há 9 h', 'Mesa 8 aberta há 3 h']);
  });

  it('uses a safe label when a table was removed from the visible list', () => {
    expect(openDiningTabLabels([
      { id: 't1', table_id: 'missing', opened_at: '2026-10-19T23:00:00.000Z', status: 'OPEN' },
    ], [], Date.parse('2026-10-19T23:41:00.000Z'))).toEqual(['Mesa — aberta há 0 h']);
  });

  it('does not duplicate "Mesa" when the table label already starts with "Mesa"', () => {
    expect(openDiningTabLabels([
      { id: 't4', table_id: 'table-4', opened_at: '2026-10-19T21:00:00.000Z', status: 'OPEN' },
    ], [
      { id: 'table-4', label: 'Mesa 04' },
    ], Date.parse('2026-10-19T23:41:00.000Z'))).toEqual(['Mesa 04 aberta há 2 h']);
  });
});
