// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), from: vi.fn(), eq: vi.fn(), select: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: h.from,
    rpc: h.rpc,
  },
}));

import { TableMoveApprovalSetting } from '../waiter/TableMoveApprovalSetting';

const label = 'Garçom pode autorizar mudança de mesa';
const control = () => screen.getByRole('switch', { name: label }) as HTMLInputElement;
const props = { tenantId: 'tenant-a', userId: 'owner-a', isOwner: true };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.from.mockReturnValue({ select: h.select });
  h.select.mockReturnValue({ eq: h.eq });
  h.eq.mockReturnValue({ maybeSingle: h.read });
  h.read.mockResolvedValue({ data: null, error: null });
  h.rpc.mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe('Permissão do garçom para autorizar mudanças de mesa', () => {
  it('starts disabled by default and saves through the owner-only RPC before enabling the switch', async () => {
    const save = deferred<{ error: null }>();
    h.rpc.mockReturnValueOnce(save.promise);
    render(<TableMoveApprovalSetting {...props} />);
    expect(control().checked).toBe(false);
    expect(control().disabled).toBe(true);
    await waitFor(() => expect(control().disabled).toBe(false));
    expect(h.from).toHaveBeenCalledWith('waiter_service_settings');
    expect(h.select).toHaveBeenCalledWith('allow_waiter_table_move_approval');
    expect(h.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    fireEvent.click(control());
    expect(h.rpc).toHaveBeenCalledWith('set_waiter_table_move_approval', { p_tenant: 'tenant-a', p_enabled: true });
    expect(control().checked).toBe(false);
    expect(control().disabled).toBe(true);
    await act(async () => { save.resolve({ error: null }); });
    expect(control().checked).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Permissão salva.');
  });

  it('keeps the saved value when the server refuses a change', async () => {
    h.rpc.mockResolvedValueOnce({ error: { message: 'forbidden' } });
    render(<TableMoveApprovalSetting {...props} />);
    await waitFor(() => expect(control().disabled).toBe(false));
    fireEvent.click(control());
    await screen.findByRole('alert');
    expect(control().checked).toBe(false);
    expect(screen.queryByText('Permissão salva.')).toBeNull();
  });

  it('hides the control for managers and other non-owners without requesting settings', () => {
    render(<TableMoveApprovalSetting {...props} isOwner={false} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('discards a late response after the owner switches stores', async () => {
    const oldStore = deferred<{ data: { allow_waiter_table_move_approval: boolean }; error: null }>();
    h.read.mockReturnValueOnce(oldStore.promise).mockResolvedValueOnce({ data: null, error: null });
    const view = render(<TableMoveApprovalSetting {...props} />);
    view.rerender(<TableMoveApprovalSetting {...props} tenantId="tenant-b" />);
    await waitFor(() => expect(control().disabled).toBe(false));
    await act(async () => { oldStore.resolve({ data: { allow_waiter_table_move_approval: true }, error: null }); });
    expect(control().checked).toBe(false);
    fireEvent.click(control());
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('set_waiter_table_move_approval', { p_tenant: 'tenant-b', p_enabled: true }));
  });

  it('discards a late save after the signed-in owner changes', async () => {
    const oldSave = deferred<{ error: null }>();
    h.rpc.mockReturnValueOnce(oldSave.promise);
    const view = render(<TableMoveApprovalSetting {...props} />);
    await waitFor(() => expect(control().disabled).toBe(false));
    fireEvent.click(control());
    view.rerender(<TableMoveApprovalSetting {...props} userId="owner-b" />);
    await waitFor(() => expect(control().disabled).toBe(false));
    await act(async () => { oldSave.resolve({ error: null }); });
    expect(control().checked).toBe(false);
    expect(screen.queryByText('Permissão salva.')).toBeNull();
  });
});

