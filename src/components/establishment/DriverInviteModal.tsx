import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Copy, Check, Share2 } from 'lucide-react';
import { buildInviteUrl, buildWhatsAppInviteLink } from '../../utils/inviteUrl';
import type { DriverInviteLinkCreated } from '../../repositories/driverRepository';

export interface DriverInviteModalProps {
  /** Convite recém-criado/renovado. null = modal fechado (o token vive só aqui, em memória). */
  invite: DriverInviteLinkCreated | null;
  storeName: string;
  maxUses?: number | null;
  onClose: () => void;
}

/** Modal "Gerar link/QR" (F7). Usa Modal/Button/Badge existentes e o mesmo QRCodeSVG do QRCodeCard. */
export const DriverInviteModal: React.FC<DriverInviteModalProps> = ({ invite, storeName, maxUses, onClose }) => {
  const [copied, setCopied] = useState(false);
  let publicUrl = '';
  let urlError = false;
  if (invite) {
    try { publicUrl = buildInviteUrl(invite.url); } catch { urlError = true; }
  }

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: seleciona o texto para cópia manual.
      const el = (e.currentTarget.ownerDocument || document).getElementById('driver-invite-url') as HTMLInputElement | null;
      el?.select();
    }
  };

  const expires = invite?.expiresAt ? new Date(invite.expiresAt).toLocaleString('pt-BR') : '';

  return (
    <Modal
      isOpen={Boolean(invite)}
      onClose={() => { setCopied(false); onClose(); }}
      title="Convite de entregador por link/QR"
      description="Quem abrir o link se cadastra e fica pendente até você aprovar."
      size="md"
    >
      {invite && (urlError ? (
        <p className="text-xs text-rose-700">Não foi possível montar o link do convite.</p>
      ) : (
        <div className="space-y-4 text-xs">
          <div className="flex justify-center p-3 bg-white rounded-xl border border-gray-200">
            <QRCodeSVG value={publicUrl} size={180} level="M" includeMargin />
          </div>
          <input
            id="driver-invite-url"
            readOnly
            value={publicUrl}
            className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs font-mono outline-none focus:border-emerald-600"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info" size="sm">Válido até {expires}</Badge>
            <Badge variant="neutral" size="sm">{maxUses ? `Limite: ${maxUses} usos` : 'Sem limite de usos'}</Badge>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}
              leftIcon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
            <a href={buildWhatsAppInviteLink(storeName, publicUrl)} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="primary" size="sm" leftIcon={<Share2 className="w-3.5 h-3.5" />}>
                WhatsApp
              </Button>
            </a>
          </div>
        </div>
      ))}
    </Modal>
  );
};
