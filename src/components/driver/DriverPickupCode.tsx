import React, { useEffect, useState } from 'react';
import { handoffRepository } from '../../repositories/handoffRepository';
export function DriverPickupCode({ orderId }: { orderId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; setCode(null); setError('');
    const load = async () => { try { const info = await handoffRepository.getPickupCode(orderId); if (alive) { setCode(info?.code || null); setError(''); } } catch { if (alive) setError('Não foi possível carregar o código.'); } };
    void load(); const timer = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [orderId]);
  return <section className="rounded-xl bg-amber-50 p-4 text-center"><h3 className="font-bold">Seu código de retirada</h3>
    <p className="text-3xl font-mono tracking-widest">{code || '…'}</p><p>Mostre este código na loja.</p>{error && <p role="alert">{error}</p>}
  </section>;
}
