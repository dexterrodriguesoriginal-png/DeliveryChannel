import React, { useState } from 'react';
import { legalRepository } from '../../repositories/legalRepository';
import { customerKey, defaultKV } from '../../lib/customer/localStore';
import { DeleteAccountSheet } from '../client/customer/ProfilePages';
export function localCustomerData(userId: string) {
  const kv = defaultKV();
  const prefix = customerKey(userId, '');
  const names = ['addresses', 'search', 'notif_prefs'];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const name = key.slice(prefix.length);
        if (/^(fav:|notif_seen:)/.test(name)) names.push(name);
      }
    }
  } catch {
    /* Storage may be unavailable. */
  }
  // Explicit whitelist. Never include auth tokens, other customers or staff data.
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = kv.getItem(customerKey(userId, name));
      if (!value) return [];
      try {
        return [[name, JSON.parse(value)]];
      } catch {
        return [];
      }
    }),
  );
}
export function MyDataPage({
  userId,
  onBack,
  onRequestDeletion,
}: {
  userId?: string;
  onBack: () => void;
  onRequestDeletion: (
    reason: string,
  ) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  async function download() {
    if (!userId) return;
    setBusy(true);
    setError('');
    try {
      const server = await legalRepository.exportMyData();
      const blob = new Blob(
        [
          JSON.stringify(
            { ...server, local_preferences: localCustomerData(userId) },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'delivery-channel-meus-dados.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-lg mx-auto bg-white p-5 space-y-4 pb-28">
      <button onClick={onBack}>Voltar</button>
      <h1 className="font-bold text-xl">Meus dados</h1>
      <p>
        Baixe seus dados de conta, pedidos, aceites, consentimentos e
        preferências deste navegador em JSON. Dados de outras pessoas e notas
        internas da loja não são incluídos.
      </p>
      {!userId ? (
        <p>Entre na sua conta para continuar.</p>
      ) : (
        <>
          <button
            className="border rounded-lg p-3"
            disabled={busy}
            onClick={download}
          >
            {busy ? 'Preparando…' : 'Baixar meus dados (JSON)'}
          </button>
          <button
            className="block text-rose-700 underline"
            onClick={() => setDeleting(true)}
          >
            Pedir exclusão da minha conta
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <DeleteAccountSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        color="#047857"
        onConfirm={onRequestDeletion}
      />
    </div>
  );
}
