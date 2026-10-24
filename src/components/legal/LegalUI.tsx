import { MyDataPage } from './MyDataPage';
import { customerAppRepository } from '../../repositories/customerAppRepository';
import {
  COOKIE_KEY,
  CookieChoice,
  readCookieChoice,
} from '../../lib/legal/cookies';
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  LEGAL_DATE,
  LEGAL_VERSION,
  LegalAudience,
  LegalDocument,
  legalDocuments,
} from '../../lib/legal/documents';
import { legalRepository } from '../../repositories/legalRepository';
import { defaultKV } from '../../lib/customer/localStore';

export function LegalLinks({
  audience = 'customer',
}: {
  audience?: LegalAudience;
}) {
  return (
    <span>
      <a
        className="underline"
        href={`/legal/terms-${audience}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Termos de Uso
      </a>
      {' e '}
      <a
        className="underline"
        href="/legal/privacy"
        target="_blank"
        rel="noopener noreferrer"
      >
        Política de Privacidade
      </a>
    </span>
  );
}
export function LegalCheckbox({
  checked,
  onChange,
  audience,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  audience: LegalAudience;
}) {
  return (
    <div className="text-sm text-gray-700 space-y-1">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1"
        />
        <span>
          Li e aceito os <LegalLinks audience={audience} /> (versão{' '}
          {LEGAL_VERSION}).
        </span>
      </label>
      <p className="text-xs text-gray-500">
        Este aceite não autoriza mensagens de marketing.
      </p>
    </div>
  );
}
export function LegalDocumentPage({ kind }: { kind: LegalDocument }) {
  const doc = legalDocuments[kind];
  return (
    <article className="max-w-3xl mx-auto p-6 bg-white text-gray-900 space-y-5">
      <a href="/" className="underline">
        Início
      </a>
      <h1 className="text-2xl font-bold">{doc.title}</h1>
      <p>
        Versão {LEGAL_VERSION} · Publicação: {LEGAL_DATE}
      </p>
      {doc.sections.map((s) => (
        <section key={s.h}>
          <h2 className="text-lg font-semibold">{s.h}</h2>
          <p className="leading-relaxed">{s.p}</p>
        </section>
      ))}
      <nav className="flex flex-wrap gap-4">
        {Object.entries(legalDocuments).map(([id, d]) => (
          <a key={id} href={`/legal/${id}`} className="underline">
            {d.title}
          </a>
        ))}
      </nav>
    </article>
  );
}
export function legalDocumentFromPath(path: string): LegalDocument | null {
  const id = path.replace(/^\/legal\//, '').replace(/\/$/, '');
  return path.startsWith('/legal/') && Object.hasOwn(legalDocuments, id)
    ? (id as LegalDocument)
    : null;
}

export function CookieBanner() {
  const [open, setOpen] = useState(() => !readCookieChoice());
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('dc-cookie-preferences', show);
    return () => window.removeEventListener('dc-cookie-preferences', show);
  }, []);
  function choose(analytics: boolean) {
    const choice: CookieChoice = { version: 1, analytics };
    try {
      defaultKV().setItem(COOKIE_KEY, JSON.stringify(choice));
    } catch {
      /* Keep analytics disabled when storage is blocked. */
    }
    if (!analytics) {
      try {
        sessionStorage.removeItem('dc_campaign_session');
      } catch {
        /* Storage may be blocked. */
      }
    }
    window.dispatchEvent(
      new CustomEvent('dc-cookie-choice', { detail: choice }),
    );
    setOpen(false);
  }
  if (!open) return null;
  return (
    <aside
      aria-label="Preferências de cookies"
      className="fixed bottom-3 left-3 right-3 z-[300] mx-auto max-w-xl bg-white text-gray-900 border border-gray-300 rounded-xl p-4 shadow-xl space-y-2"
    >
      <p className="font-bold">Sua escolha de cookies</p>
      <p className="text-sm">
        Usamos armazenamento essencial para acesso, sacola e preferências.
        Analíticos são opcionais.{' '}
        <a
          className="underline"
          href="/legal/cookies"
          target="_blank"
          rel="noopener noreferrer"
        >
          Política de Cookies
        </a>
      </p>
      <div className="flex gap-3 flex-wrap">
        <button
          type="button"
          className="border rounded-lg p-2"
          onClick={() => choose(false)}
        >
          Somente essenciais
        </button>
        <button
          type="button"
          className="bg-emerald-800 text-white rounded-lg p-2"
          onClick={() => choose(true)}
        >
          Aceitar analíticos
        </button>
      </div>
    </aside>
  );
}

export function LegalBoundary({ children }: { children: React.ReactNode }) {
  const { supabaseUser, activeRole, isLoadingAuth, signOut } = useAuth();
  const audience: LegalAudience = /^\/(app\/|mesa\/)/.test(
    window.location.pathname,
  )
    ? 'customer'
    : 'owner';
  const publicDoc = legalDocumentFromPath(window.location.pathname);
  const needsGate =
    !!supabaseUser &&
    !supabaseUser.is_anonymous &&
    (audience === 'customer' ||
      !activeRole ||
      ['OWNER', 'MANAGER', 'CUSTOMER'].includes(activeRole));
  const key = needsGate ? `${supabaseUser.id}:${audience}` : '';
  const [result, setResult] = useState<{
    key: string;
    accepted: boolean;
    version: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showMyData, setShowMyData] = useState(false);
  useEffect(() => {
    let alive = true;
    setChecked(false);
    setError('');
    if (key && !publicDoc)
      legalRepository
        .status(audience)
        .then((s) => {
          if (alive) setResult({ key, ...s });
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [key, publicDoc, retry]);
  // Refresh on foreground entry so a server-side version bump also prompts existing sessions.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        setResult(null);
        setRetry((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  if (publicDoc) return <LegalDocumentPage kind={publicDoc} />;
  if (!needsGate || isLoadingAuth) return <>{children}</>;
  if (
    result?.key === key &&
    result.accepted &&
    result.version === LEGAL_VERSION
  )
    return <>{children}</>;
  if (showMyData)
    return (
      <MyDataPage
        key={supabaseUser.id}
        userId={supabaseUser.id}
        onBack={() => setShowMyData(false)}
        onRequestDeletion={customerAppRepository.requestAccountDeletion}
      />
    );
  async function accept() {
    setBusy(true);
    setError('');
    try {
      await legalRepository.accept(audience);
      const s = await legalRepository.status(audience);
      setResult({ key, ...s });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="max-w-lg mx-auto p-6 space-y-4 bg-white text-gray-900">
      <h1 className="text-xl font-bold">Termos e privacidade</h1>
      <p>
        Para continuar, leia e aceite os documentos atuais. Seu aceite será
        registrado com versão e data/hora.
      </p>
      {result?.key === key && result.version !== LEGAL_VERSION ? (
        <p>
          Há uma nova versão disponível. Atualize o aplicativo para ler e
          aceitar.
        </p>
      ) : result?.key === key ? (
        <LegalCheckbox
          checked={checked}
          onChange={setChecked}
          audience={audience}
        />
      ) : (
        <p>Consultando aceite…</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="flex gap-3">
        <button
          className="bg-emerald-800 text-white p-2 rounded-lg"
          disabled={!checked || busy || result?.version !== LEGAL_VERSION}
          onClick={accept}
        >
          Aceitar e continuar
        </button>
        <button
          onClick={() => {
            setResult(null);
            setRetry((n) => n + 1);
          }}
        >
          Tentar novamente
        </button>
        <button onClick={() => setShowMyData(true)}>
          Meus dados e exclusão
        </button>
        <button onClick={() => signOut()}>Sair</button>
      </div>
    </main>
  );
}
