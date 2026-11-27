import { useState } from 'react';
import { CheckCircle2, Circle, Share2, Sparkles } from 'lucide-react';
import type { TenantTheme } from '../../../types';
import { isDraftLogoConfirmed, isLogoConfirmed } from '../../../lib/pwa/logoConfirmation';
import { QRCodeCard } from '../../../components/common/QRCodeCard';

type Step = 'identity' | 'colors' | 'preview';
type Props = {
  draftTheme: TenantTheme;
  savedTheme: TenantTheme;
  barsReviewed: boolean;
  previewViewed: boolean;
  slug: string;
  storeName: string;
  onNavigate: (step: Step) => void;
};

export function OwnerBrandChecklist({ draftTheme, savedTheme, barsReviewed, previewViewed, slug, storeName, onNavigate }: Props) {
  const [sharing, setSharing] = useState(false);
  const logoConfirmed = isDraftLogoConfirmed(draftTheme, savedTheme)
    && isLogoConfirmed(savedTheme)
    && draftTheme.logoUrl?.trim() === savedTheme.logoUrl?.trim();
  const steps = [
    { id: 'identity' as const, label: 'Logo escolhida e confirmada', done: logoConfirmed, action: 'Revisar logo' },
    { id: 'colors' as const, label: 'Cores das barras revisadas', done: barsReviewed, action: 'Revisar cores' },
    { id: 'preview' as const, label: 'Prévia visualizada', done: previewViewed, action: 'Ver prévia' },
  ];
  const count = steps.filter(step => step.done).length;
  const ready = count === steps.length;
  return (
    <section className="mb-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" data-testid="owner-brand-checklist">
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><Sparkles size={15} /> Identidade da sua loja</span>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">Sua marca merece ser reconhecida</h2>
        <p className="text-sm leading-relaxed text-slate-600">Pense no verde do WhatsApp, no amarelo e preto da 99 e no vermelho do iFood. Uma identidade consistente ajuda seus clientes a reconhecerem sua loja.</p>
        <p className="text-sm leading-relaxed text-slate-600">Cardápio, preços, banners, promoções e o visual interno atualizam na hora. No Android, o ícone da tela inicial, a tela de abertura do sistema e a cor da barra de navegação inferior ficam gravados na instalação. Se mudar essa identidade no futuro, o cliente pode precisar baixar a nova versão, mas continua comprando normalmente. Vale escolher bem sua logo e suas cores antes de divulgar.</p>
      </div>
      <div className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Antes de divulgar, confira</h3>
          <span className="text-xs font-semibold text-slate-600" role="status">{count} de 3</span>
        </div>
        <progress aria-label="Progresso do checklist" max={3} value={count} className="h-1.5 w-full accent-emerald-700" />
        <ol className="space-y-1">
          {steps.map(step => (
            <li key={step.id} data-testid={`brand-step-${step.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-medium text-slate-700">
                {step.done ? <CheckCircle2 size={16} className="shrink-0 text-emerald-700" /> : <Circle size={16} className="shrink-0 text-slate-400" />}
                {step.label}<span className="sr-only">{step.done ? ' — concluído' : ' — pendente'}</span>
              </span>
              <button type="button" className="text-xs font-semibold text-emerald-800 underline" onClick={() => onNavigate(step.id)}>{step.action}</button>
            </li>
          ))}
        </ol>
        {!logoConfirmed && <p className="text-xs text-slate-500">Confirme a logo na aba Identidade e salve o design.</p>}
      </div>
      {ready && (
        <div data-testid="brand-share-highlight" className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-900">Sua identidade está pronta para ser divulgada!</p>
          <button type="button" className="theme-primary" aria-expanded={sharing} onClick={() => setSharing(value => !value)}><Share2 size={16} /> Divulgar meu aplicativo</button>
          {sharing && <QRCodeCard slug={slug} storeName={storeName} />}
        </div>
      )}
      <p className="text-xs text-slate-500">O checklist é uma recomendação. O link público e o QR Code da loja continuam disponíveis nos atalhos de divulgação.</p>
    </section>
  );
}
