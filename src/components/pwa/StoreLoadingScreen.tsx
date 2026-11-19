import React from 'react';

/**
 * Carregamento da vitrine no React: neutro (sem marca do Delivery Channel nem de outra loja). Fica por baixo
 * da #store-boot do servidor (logo da loja) e, sem ela, não pinta nada por cima do fundo da página.
 */
export const StoreLoadingScreen: React.FC = () => (
  <div role="status" aria-label="Carregando" data-testid="store-loading-screen" style={{ position: 'fixed', inset: 0 }} />
);
