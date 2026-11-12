import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ configured: false }));
vi.mock('../../lib/supabase', () => ({
  supabase: {},
  get isSupabaseConfigured() { return config.configured; },
}));

import { AuthProvider, useAuth } from '../AuthContext';

function Login() {
  const { authState } = useAuth();
  return <div>Tela de login: {authState}</div>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  config.configured = false;
});

describe('configuração do AuthProvider', () => {
  it('exibe um alerta em produção sem configuração e impede a tela de login', () => {
    vi.stubEnv('PROD', true);
    const html = renderToStaticMarkup(<AuthProvider><Login /></AuthProvider>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Configuração do sistema ausente — contate o suporte');
    expect(html).not.toContain('Tela de login');
  });

  it('preserva os filhos e o contexto em produção com configuração', () => {
    vi.stubEnv('PROD', true);
    config.configured = true;
    const html = renderToStaticMarkup(<AuthProvider><Login /></AuthProvider>);
    expect(html).toContain('Tela de login');
    expect(html).not.toContain('role="alert"');
  });

  it('preserva os filhos e o contexto no desenvolvimento sem configuração', () => {
    vi.stubEnv('PROD', false);
    const html = renderToStaticMarkup(<AuthProvider><Login /></AuthProvider>);
    expect(html).toContain('Tela de login');
    expect(html).not.toContain('role="alert"');
  });
});
