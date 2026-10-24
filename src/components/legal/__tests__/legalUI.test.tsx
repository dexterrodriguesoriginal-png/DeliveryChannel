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
