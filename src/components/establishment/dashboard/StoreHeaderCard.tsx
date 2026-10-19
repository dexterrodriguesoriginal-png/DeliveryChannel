import React, { useState } from 'react';
import { Power, ExternalLink, Copy, Check, QrCode, Megaphone } from 'lucide-react';
import type { Tenant } from '../../../types';
import { StoreLogo } from '../../client/StoreLogo';
import { Modal } from '../../ui/Modal';
import { QRCodeCard } from '../../common/QRCodeCard';
import { getPublicStoreUrl, isValidStoreSlug } from '../../../utils/publicStoreUrl';

interface Props {
  tenant: Tenant;
  isOpen: boolean;
  /** Mostra "Abrir/Fechar loja" (só quem pode mudar configurações). */
  canToggleOpen: boolean;
  toggling?: boolean;
  onToggleOpen?: () => void;
  /** Atalho "Banners & Ofertas" (Marketing) quando o papel acessa. */
  onOpenMarketing?: () => void;
  onCopied?: () => void;
}

/** 19/10: cartão da loja no topo do Dashboard (marca Delivery Channel, verde #15803d). Sem plano/dias restantes. */
export const StoreHeaderCard: React.FC<Props> = ({ tenant, isOpen, canToggleOpen, toggling, onToggleOpen, onOpenMarketing, onCopied }) => {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const name = tenant.theme?.storeName || tenant.name;
  const slugOk = isValidStoreSlug(tenant.slug);
  const url = slugOk ? getPublicStoreUrl(tenant.slug) : '';

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); } catch { /* sem permissão de área de transferência */ }
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 2000);
  };

  const btn = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-60';

  return (
    <div data-testid="store-header-card" className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <StoreLogo logoUrl={tenant.theme?.logoUrl} name={name} color={tenant.theme?.primaryColor || '#15803d'} className="w-12 h-12 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-black text-slate-900 truncate">{name}</h2>
            <span data-testid="store-open-badge" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
              isOpen ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-700 border-rose-300'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {isOpen ? 'Loja aberta' : 'Loja fechada'}
            </span>
          </div>
          {url ? (
            <p className="text-[11px] text-slate-500 truncate">Link público: <span className="font-mono text-slate-700" data-testid="store-public-url">{url}</span></p>
          ) : (
            <p className="text-[11px] text-amber-700">Link público indisponível: defina o endereço da loja nas Configurações.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        {canToggleOpen && onToggleOpen && (
          <button type="button" onClick={onToggleOpen} disabled={toggling} data-testid="toggle-store-open"
            className={`${btn} ${isOpen ? 'bg-white hover:bg-red-50 text-red-700 border border-red-300' : 'bg-[#15803d] hover:bg-[#166534] text-white'}`}>
            <Power className="w-4 h-4" /> {toggling ? 'Salvando…' : isOpen ? 'Fechar loja' : 'Abrir loja'}
          </button>
        )}
        {url && (
          <>
            <a href={url} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#15803d] hover:bg-[#166534] text-white`}>
              <ExternalLink className="w-4 h-4" /> Ver loja
            </a>
            <button type="button" onClick={copy} className={`${btn} bg-white hover:bg-slate-50 text-slate-800 border border-slate-300`}>
              {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />} {copied ? 'Copiado' : 'Copiar link'}
            </button>
            <button type="button" onClick={() => setQrOpen(true)} className={`${btn} bg-white hover:bg-slate-50 text-slate-800 border border-slate-300`}>
              <QrCode className="w-4 h-4" /> QR Code
            </button>
          </>
        )}
        {onOpenMarketing && (
          <button type="button" onClick={onOpenMarketing} className={`${btn} bg-white hover:bg-slate-50 text-slate-800 border border-slate-300`}>
            <Megaphone className="w-4 h-4" /> Banners & Ofertas
          </button>
        )}
      </div>

      <Modal isOpen={qrOpen} onClose={() => setQrOpen(false)} title={`QR Code de ${name}`} size="sm">
        <QRCodeCard slug={tenant.slug} storeName={name} primaryColor={tenant.theme?.primaryColor || '#15803d'} />
      </Modal>
    </div>
  );
};
