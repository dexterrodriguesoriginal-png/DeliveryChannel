import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, MessageCircle, Smartphone } from 'lucide-react';
import { waiterEntryUrl, waiterLoginWhatsAppUrl, waiterWhatsAppUrl } from '../../lib/waiter/waiterAccess';

/**
 * "Acesso do garçom": QR do link /garcom + copiar + WhatsApp + 3 passos. Um único componente, usado na Equipe
 * (convite criado, convite pendente, "Conectar celular") e em Ferramentas ("Aplicativo do Garçom").
 */
export const WaiterAccessBlock: React.FC<{ email?: string | null; storeName?: string | null; origin?: string; title?: string; compact?: boolean; slug?: string | null; username?: string | null }> = ({ email, storeName, origin, title = 'Acesso do garçom', compact, slug, username }) => {
  const [copied, setCopied] = useState(false);
  const url = waiterEntryUrl(origin ?? (typeof window === 'undefined' ? 'https://deliverychannel.ai.studio' : window.location.origin), email, slug);
  const byLogin = !!slug && url.includes(`${'/garcom'}/`);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* sem permissão de área de transferência */ } };
  return (
    <div data-testid="waiter-access-block" className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50/60 text-slate-900 shadow-sm">
      <div className="flex items-center gap-2 border-b border-emerald-100/70 px-4 py-2.5"><span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-600 text-white"><Smartphone className="h-4 w-4" aria-hidden="true" /></span><h4 className="text-sm font-black">{title}</h4>{email && <span className="ml-auto truncate rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">{email}</span>}</div>
      <div className={`grid gap-4 p-4 ${compact ? '' : 'sm:grid-cols-[auto_1fr]'}`}>
        <div className="mx-auto self-start rounded-2xl bg-white p-2.5 shadow ring-1 ring-slate-200" data-testid="waiter-access-qr"><QRCodeSVG value={url} size={compact ? 148 : 172} level="M" includeMargin={false} aria-label="QR Code do acesso do garçom" /></div>
        <div className="min-w-0 space-y-3">
          <ol className="space-y-1.5 text-sm">
            {(byLogin ? ['Escaneie o QR fixo da loja com o celular do garçom.', `Entre com o usuário${username ? ` "${username}"` : ''} e a senha cadastrada (sem e-mail).`, 'Pronto: o celular lembra o acesso. Use "Sair" no fim do turno.'] : ['Escaneie o QR com o celular do garçom.', `Entre ou crie a conta com ${email ? 'ESTE e-mail' : 'o e-mail do convite'}${email ? ` (${email})` : ''}.`, 'Pronto: o app do garçom abre sozinho.']).map((step, index) => (
              <li key={step} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-[11px] font-black text-white">{index + 1}</span><span className="text-slate-700">{step}</span></li>
            ))}
          </ol>
          <p className="break-all rounded-lg bg-slate-100 px-2 py-1.5 font-mono text-[11px] text-slate-600" data-testid="waiter-access-url">{url}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-50">{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}{copied ? 'Link copiado' : 'Copiar link'}</button>
            <a href={byLogin ? waiterLoginWhatsAppUrl(url, storeName, username) : waiterWhatsAppUrl(url, storeName)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-xs font-black text-slate-950 shadow-sm hover:brightness-95"><MessageCircle className="h-4 w-4" aria-hidden="true" />Enviar pelo WhatsApp</a>
          </div>
        </div>
      </div>
    </div>
  );
};
