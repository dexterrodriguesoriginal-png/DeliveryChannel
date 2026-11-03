import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { auth } = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
afterEach(() => { for (const key of Object.keys(auth)) delete auth[key]; vi.unstubAllGlobals(); });
vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
import {
  CookieBanner,
  LegalBoundary,
  LegalCheckbox,
  LegalDocumentPage,
  legalDocumentFromPath,
} from '../LegalUI';
import { FeedbackForm } from '../../feedback/FeedbackForm';
import {
  ProfileScreen,
  ProfileScreenProps,
} from '../../client/customer/ProfileScreen';
import { LEGAL_VERSION } from '../../../lib/legal/documents';
const html = (element: React.ReactElement) => renderToStaticMarkup(element);
describe('legal public UI and anonymous entry points', () => {
  it.each(['terms-owner', 'terms-customer', 'privacy', 'cookies'] as const)(
    'renders the public %s document with version and date',
    (kind) => {
      expect(legalDocumentFromPath(`/legal/${kind}`)).toBe(kind);
      const h = html(<LegalDocumentPage kind={kind} />);
      expect(h).toContain(LEGAL_VERSION);
      expect(h).toContain('24/10/2026');
    },
  );
  it('ignores unknown legal paths', () => {
    expect(legalDocumentFromPath('/legal/constructor')).toBeNull();
    expect(legalDocumentFromPath('/app/privacy')).toBeNull();
  });
  it('renders a mandatory unchecked legal acceptance without a marketing permission', () => {
    const h = html(
      <LegalCheckbox checked={false} onChange={() => {}} audience="owner" />,
    );
    expect(h).toContain('required=""');
    expect(h).not.toContain('checked=""');
    expect(h).toContain('/legal/terms-owner');
    expect(h).toContain('/legal/privacy');
    expect((h.match(/type="checkbox"/g) || []).length).toBe(1);
  });
  it('offers a real essentials-only cookie choice', () => {
    const h = html(<CookieBanner />);
    expect(h).toContain('Somente essenciais');
    expect(h).toContain('Aceitar analíticos');
  });
  it('requires acceptance before exposing the customer app while keeping data rights available', () => {
    auth.supabaseUser = { id: 'customer-a' };
    auth.activeRole = 'CUSTOMER';
    vi.stubGlobal('window', { location: { pathname: '/app/store-a' } });
    const h = html(
      <LegalBoundary>
        <p>Private customer app</p>
      </LegalBoundary>,
    );
    expect(h).not.toContain('Private customer app');
    expect(h).toContain('Meus dados e exclusão');
    expect(h).toContain('Consultando aceite');
  });
  it.each(['/garcom/loja', '/equipe/loja/kitchen', '/equipe/loja/manager'])(
    'allows confirmed team signup to accept its scoped invitation at %s without owner terms', (pathname) => {
      auth.supabaseUser = { id: 'invited-team' }; auth.activeRole = null;
      auth.isMembershipLoading = false;
      vi.stubGlobal('window', { location: { pathname } });
      const h = html(<LegalBoundary><p>Aceitar convite da equipe</p></LegalBoundary>);
      expect(h).toContain('Aceitar convite da equipe');
      expect(h).not.toContain('Aceitar e continuar');
    },
  );
  it('does not require owner terms from a verified manager membership', () => {
    auth.supabaseUser = { id: 'manager' }; auth.activeRole = 'MANAGER';
    vi.stubGlobal('window', { location: { pathname: '/' } });
    expect(html(<LegalBoundary><p>Painel da operação</p></LegalBoundary>)).toContain('Painel da operação');
  });
  it.each(['/', '/equipe/loja/owner'])(
    'preserves owner acceptance before normal onboarding at %s', (pathname) => {
      auth.supabaseUser = { id: 'new-owner' }; auth.activeRole = null;
      auth.isMembershipLoading = false;
      vi.stubGlobal('window', { location: { pathname } });
      const h = html(<LegalBoundary><p>Criar estabelecimento</p></LegalBoundary>);
      expect(h).not.toContain('Criar estabelecimento');
      expect(h).toContain('Aceitar e continuar');
    },
  );
  it('an existing customer can accept a scoped staff invitation without owner acceptance', () => {
    auth.supabaseUser = { id: 'customer-joining-team' }; auth.activeRole = 'CUSTOMER';
    vi.stubGlobal('window', { location: { pathname: '/equipe/loja/cashier' } });
    const h = html(<LegalBoundary><p>Aceitar convite da equipe</p></LegalBoundary>);
    expect(h).toContain('Aceitar convite da equipe'); expect(h).not.toContain('Aceitar e continuar');
  });
  it('a store owner still accepts owner terms even on a staff invitation path', () => {
    auth.supabaseUser = { id: 'owner' }; auth.activeRole = 'OWNER';
    vi.stubGlobal('window', { location: { pathname: '/equipe/loja/manager' } });
    const h = html(<LegalBoundary><p>Painel completo</p></LegalBoundary>);
    expect(h).not.toContain('Painel completo'); expect(h).toContain('Aceitar e continuar');
  });
  it('staff using the public customer app still has the customer legal gate', () => {
    auth.supabaseUser = { id: 'manager-as-customer' }; auth.activeRole = 'MANAGER';
    vi.stubGlobal('window', { location: { pathname: '/app/loja' } });
    const h = html(<LegalBoundary><p>Área do cliente</p></LegalBoundary>);
    expect(h).not.toContain('Área do cliente'); expect(h).toContain('Aceitar e continuar');
  });
  it('offers feedback without requiring a logged-in customer', () => {
    const props = {
      page: 'menu',
      onNavigate: () => {},
      color: '#000',
      user: null,
      customerName: '',
      customerPhone: '',
      favoriteProducts: [],
      storeName: 'Loja',
      unreadCount: 0,
    } as unknown as ProfileScreenProps;
    const h = html(<ProfileScreen {...props} />);
    expect(h).toContain('menu-feedback');
    expect(h).toContain('Enviar sugestão, elogio ou reclamação');
    expect(h).toContain('Meus dados');
    const form = html(<FeedbackForm slug="store-a" />);
    expect(form).toContain('minLength="10"');
    expect(form).toContain('maxLength="1000"');
    expect(form).toContain('com ou sem login');
    expect(form).toContain('Sem nota');
  });
});
