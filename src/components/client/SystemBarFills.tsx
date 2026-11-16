import React from 'react';
import { SAFE_BOTTOM, SAFE_TOP } from '../../lib/pwa/edgeToEdge';

/**
 * Pinta as áreas das barras do sistema (status em cima, navegação do Android embaixo) com as cores da loja.
 * Só ocupa espaço quando o Chrome desenha a página atrás das barras (edge-to-edge); caso contrário a altura é 0.
 */
export const SystemBarFills: React.FC<{ statusColor: string; navColor: string }> = ({ statusColor, navColor }) => (
  <>
    <div
      aria-hidden="true"
      data-testid="system-status-fill"
      className="fixed inset-x-0 top-0 z-[2000] pointer-events-none"
      style={{ height: SAFE_TOP, backgroundColor: statusColor }}
    />
    <div
      aria-hidden="true"
      data-testid="system-nav-fill"
      className="fixed inset-x-0 bottom-0 z-[2000] pointer-events-none"
      style={{ height: SAFE_BOTTOM, backgroundColor: navColor }}
    />
  </>
);
