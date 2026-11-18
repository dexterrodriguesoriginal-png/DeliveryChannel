import React from 'react';
import { DC_MARK_DATA_URI } from '../../lib/brand/dcMark';
import { DC_BOOT_MARK_SIZE_PX, DC_PRESENTS_BACKGROUND, DC_PRESENTS_TEXT, DC_PRESENTS_TEXT_COLOR } from '../../lib/pwa/bootScreen';

/** Mesma tela "Delivery Channel apresenta" do servidor, enquanto a vitrine carrega (fica por baixo da #dc-boot). */
export const DcBootScreen: React.FC = () => (
  <div
    role="status"
    aria-label={DC_PRESENTS_TEXT}
    data-testid="dc-boot-screen"
    style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, background: DC_PRESENTS_BACKGROUND, color: DC_PRESENTS_TEXT_COLOR, fontWeight: 600, fontSize: 15, letterSpacing: '.02em' }}
  >
    <img src={DC_MARK_DATA_URI} width={DC_BOOT_MARK_SIZE_PX} height={DC_BOOT_MARK_SIZE_PX} alt="" />
    <span>{DC_PRESENTS_TEXT}</span>
  </div>
);
