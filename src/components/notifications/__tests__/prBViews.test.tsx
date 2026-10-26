import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { NotificationList } from '../OwnerNotifications';
import { DispatchModeOptions } from '../../establishment/DispatchSettings';
import { OwnerNotification } from '../../../repositories/dispatchChatRepository';
const n: OwnerNotification = { id: 'n1', tenant_id: 'A', kind: 'ORDER_NEW', ref_id: 'o1', title: 'Novo pedido', created_at: '2026-10-26', read_at: null };
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
describe('PR B notification and dispatch UI', () => {
  it('shows unread notifications with Ver and mark-read actions', () => {
    const onOpen = vi.fn(), onRead = vi.fn();
    const view = NotificationList({ rows: [n], onOpen, onRead });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain('Notificações'); expect(markup).toContain('Novo pedido');
    const buttons = elements(view).filter(el => el.type === 'button');
    buttons.find(b => b.props.children === 'Ver').props.onClick(); expect(onOpen).toHaveBeenCalledWith(n);
    buttons.find(b => b.props.children === 'Marcar como lida').props.onClick(); expect(onRead).toHaveBeenCalledWith(n);
  });
  it('hides mark-read on read items, keeps history and handles empty lists', () => {
    expect(renderToStaticMarkup(<NotificationList rows={[{ ...n, read_at: 'now' }]} onOpen={vi.fn()} onRead={vi.fn()} />)).not.toContain('Marcar como lida');
    expect(renderToStaticMarkup(<NotificationList rows={[]} onOpen={vi.fn()} onRead={vi.fn()} />)).toContain('Nenhuma notificação.');
  });
  it('offers exactly two dispatch modes and describes owner confirmation', () => {
    const onChange = vi.fn();
    const view = DispatchModeOptions({ mode: 'AUTO_QUEUE', disabled: false, onChange });
    const inputs = elements(view).filter(el => el.type === 'input');
    expect(inputs).toHaveLength(2); expect(inputs[0].props.checked).toBe(true);
    inputs[1].props.onChange(); expect(onChange).toHaveBeenCalledWith('OWNER_PICKS');
    inputs[0].props.onChange(); expect(onChange).toHaveBeenCalledWith('AUTO_QUEUE');
    expect(renderToStaticMarkup(view)).toContain('Você confirma com um toque.');
    expect(renderToStaticMarkup(view)).not.toContain('primeiro que aceitar');
  });
  it('disables dispatch changes while loading or saving', () => {
    const html = renderToStaticMarkup(<DispatchModeOptions mode="OWNER_PICKS" disabled onChange={vi.fn()} />);
    expect(html).toContain('<fieldset disabled=""');
  });
});
