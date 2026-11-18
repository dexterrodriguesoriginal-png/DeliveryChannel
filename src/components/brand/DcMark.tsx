import React from 'react';
import { DC_MARK_DATA_URI } from '../../lib/brand/dcMark';

/** Selo do Delivery Channel (imagem inline, sem requisição). Substitui o antigo "AF". */
export const DcMark: React.FC<{ className?: string; size?: number }> = ({ className = '', size = 48 }) => (
  <img src={DC_MARK_DATA_URI} width={size} height={size} alt="Delivery Channel" className={`inline-block rounded-2xl ${className}`} draggable={false} />
);
