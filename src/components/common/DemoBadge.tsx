import React from 'react';

export function DemoBadge({ isDemo }: { isDemo?: boolean }) {
  if (!isDemo) return null;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
      title="Item de demonstração. Ao editar, ele passa a fazer parte do seu catálogo."
    >
      Demo
    </span>
  );
}
