import React, { useEffect } from 'react';
export function WaiterPanelRedirect({ target }: { target: string }) {
  useEffect(() => { window.location.replace(target); }, [target]);
  return <main role="status" className="grid min-h-[100dvh] place-items-center bg-slate-950 p-6 text-white"><div><p className="font-bold">Abrindo o app do garçom…</p><a className="mt-3 inline-block underline" href={target}>Continuar atendimento</a></div></main>;
}
