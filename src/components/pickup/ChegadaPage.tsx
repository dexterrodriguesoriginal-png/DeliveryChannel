import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LoginCard } from '../auth/LoginCard';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { arrivalErrorMessage } from '../../lib/pickup/arrival';
import { PickupArrivalCard } from './PickupArrivalCard';

type Store = { tenantId: string; storeName: string; slug: string; orders: { id: string; orderNumber: number; status: string; createdAt: string }[] };

/** /chegada/<código>: QR do balcão lido pela câmera comum. Login -> pedidos de retirada abertos do cliente -> check-in. */
export const ChegadaPage: React.FC<{ code: string }> = ({ code }) => {
  const { supabaseUser, isLoadingAuth } = useAuth() as any;
  const [store, setStore] = useState<Store | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkIn = async (orderId: string) => {
    setBusy(true); setErr(null);
    try { await arrivalRepository.checkIn(code, orderId); setChecked(orderId); } catch (e) { setErr(arrivalErrorMessage(e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!supabaseUser || !code) return;
    arrivalRepository.resolve(code).then(s => {
      setStore(s);
      if (s.orders.length === 1) checkIn(s.orders[0].id);
    }).catch(e => setErr(arrivalErrorMessage(e)));
  }, [supabaseUser?.id, code]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4" data-testid="chegada-page">
      <div className="w-full max-w-md">
        <div className="text-center font-black text-emerald-800 tracking-wide py-3">DELIVERY <span className="text-emerald-500">CHANNEL</span></div>
        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-4 space-y-3">{body}</div>
      </div>
    </div>
  );

  if (!code) return shell(<p className="text-sm font-bold text-red-700" data-testid="chegada-error">Este QR Code não é válido. Peça o QR atualizado no balcão.</p>);
  if (isLoadingAuth) return shell(<p className="text-sm text-gray-500">Carregando...</p>);
  if (!supabaseUser) return shell(
    <>
      <h1 className="text-lg font-black text-gray-900">Chegou para retirar?</h1>
      <p className="text-sm text-gray-600">Entre na sua conta para entrar na fila de retirada.</p>
      <LoginCard intent="customer" returnTo={`/chegada/${code}`} />
    </>,
  );
  if (err && !store) return shell(<p className="text-sm font-bold text-red-700" data-testid="chegada-error">{err}</p>);
  if (!store) return shell(<p className="text-sm text-gray-500">Procurando seu pedido...</p>);
  const link = <a href={`/app/${store.slug}`} className="block text-center py-2 rounded-xl border border-gray-300 text-sm font-bold text-gray-700">Ir para a loja {store.storeName}</a>;
  if (store.orders.length === 0) return shell(
    <>
      <h1 className="text-lg font-black text-gray-900">{store.storeName}</h1>
      <p className="text-sm text-gray-700" data-testid="chegada-none">Você não tem pedido de retirada aberto nesta loja.</p>
      {link}
    </>,
  );
  if (checked) {
    const o = store.orders.find(x => x.id === checked)!;
    return shell(
      <>
        <h1 className="text-lg font-black text-gray-900">{store.storeName} · Pedido #{o.orderNumber}</h1>
        <PickupArrivalCard orderId={checked} status={o.status} fulfillmentType="PICKUP" />
        {link}
      </>,
    );
  }
  return shell(
    <>
      <h1 className="text-lg font-black text-gray-900">{store.storeName}</h1>
      <p className="text-sm text-gray-700">{store.orders.length > 1 ? 'Qual pedido você veio retirar?' : 'Fazendo seu check-in...'}</p>
      {store.orders.length > 1 && (
        <ul className="space-y-2" data-testid="chegada-pick">
          {store.orders.map(o => (
            <li key={o.id}>
              <button type="button" disabled={busy} onClick={() => checkIn(o.id)} data-testid="chegada-pick-order"
                className="w-full text-left px-3 py-3 rounded-2xl border-2 border-amber-300 bg-amber-50 font-bold text-gray-900 disabled:opacity-50">
                Pedido #{o.orderNumber} · {new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-xs font-bold text-red-700" data-testid="chegada-error">{err}</p>}
      {link}
    </>,
  );
};
