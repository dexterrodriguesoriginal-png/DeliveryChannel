import { useState } from 'react';
import { BatteryFull, CheckCircle2, ChevronLeft, Circle, Share2, Signal, Sparkles, Square, Store } from 'lucide-react';
import type { TenantTheme } from '../../../types';
import { isDraftLogoConfirmed, isLogoConfirmed } from '../../../lib/pwa/logoConfirmation';
import { QRCodeCard } from '../../../components/common/QRCodeCard';
import { safeImageUrl, themeToTokens } from '../../../lib/theme/themeEngine';
import { isDarkColor, systemBarsFromTokens } from '../../../lib/pwa/systemBars';

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

const LESSONS = [
  {
    title: '1. Crie reconhecimento',
    text: 'Pense na sua marca como uma assinatura: quanto mais consistente, mais fácil será encontrá-la no celular. Escolha uma identidade que represente sua loja o ano inteiro, não apenas a campanha do mês.',
    tip: 'Pergunte-se: meu cliente reconheceria minha marca sem ler o nome?',
  },
  {
    title: '2. Escolha uma logo memorável',
    text: 'Prefira uma forma simples, com poucos detalhes, boa leitura em tamanho pequeno e margem suficiente para o recorte do ícone. Evite datas, preços e mensagens promocionais na logo. Confira como ela aparece na tela inicial abaixo.',
    tip: 'Quando estiver satisfeito, confirme a logo na aba Identidade e salve o design.',
  },
  {
    title: '3. Escolha cores que atravessam campanhas',
    text: 'Defina uma cor principal ligada à personalidade da loja e uma cor de apoio com contraste. Para a barra inferior, recomendamos branco, preto ou cinza neutro (como grafite). Evite combinações sazonais, como preto e vermelho de Black Friday: a barra inferior não muda em tempo real e uma cor neutra combina melhor com futuros temas internos.',
    tip: 'Use as cores de campanha nos banners e no conteúdo interno, não na identidade instalada.',
  },
  {
    title: '4. Saiba o que muda no celular',
    text: 'Cardápio, preços, banners e promoções atualizam na hora após salvar. Em instalações compatíveis, o ícone pode levar 24 a 72 horas para atualizar, sem garantia. No Android, o app antigo consulta o manifesto da instalação original; quando o endereço do manifesto muda, o ícone pode não atualizar sozinho. Nesse caso, o cliente verá “Baixar nova versão” e continuará comprando normalmente.',
    tip: 'Confira a prévia, salve suas escolhas e divulgue o link oficial quando estiver pronto.',
  },
] as const;

const PHONE_AREAS = [
  { id: 'status', label: 'Barra de status (topo)', text: 'Mostra hora, sinal e bateria. A cor pode acompanhar o tema quando o app está aberto, sem reinstalar.' },
  { id: 'icon', label: 'Ícone na tela inicial', text: 'É a sua assinatura no celular do cliente. Fica associado à instalação original. Em instalações compatíveis, mudanças podem levar 24 a 72 horas; no fluxo versionado, pode ser necessário baixar a nova versão.' },
  { id: 'nav', label: 'Barra de navegação (inferior)', text: 'Mostra os controles de voltar, início e recentes do Android. A cor fica gravada na instalação e não muda em tempo real. Prefira branco, preto ou cinza neutro; o Android também pode impor uma aparência clara ou escura.' },
] as const;
type PhoneArea = (typeof PHONE_AREAS)[number]['id'];

function BrandPhone({ theme, storeName }: { theme: TenantTheme; storeName: string }) {
  const [selected, setSelected] = useState<PhoneArea>('icon');
  const tokens = themeToTokens(theme);
  const bars = systemBarsFromTokens(tokens);
  const logo = safeImageUrl(theme.logoUrl);
  const area = PHONE_AREAS.find(item => item.id === selected)!;
  const selectionClass = (id: PhoneArea) => selected === id ? 'ring-2 ring-offset-2 ring-emerald-600' : 'hover:ring-2 hover:ring-slate-400';
  return (
    <div className="grid items-center gap-5 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2" data-testid="brand-phone">
      <div className="mx-auto w-full max-w-48 rounded-[2rem] border-4 border-slate-800 bg-white p-2 shadow-sm">
        <div className="space-y-3 rounded-[1.4rem] p-1" style={{ backgroundColor: tokens.palette.bgHeader }}>
          <button type="button" aria-label={PHONE_AREAS[0].label} aria-pressed={selected === 'status'} onClick={() => setSelected('status')}
            className={`flex w-full items-center justify-between rounded-t-2xl px-2 py-2 text-xs font-semibold ${bars.statusIsDark ? 'text-white' : 'text-slate-900'} ${selectionClass('status')}`} style={{ backgroundColor: bars.status }}>
            <span>09:41</span><span className="flex gap-1"><Signal size={13} /><BatteryFull size={15} /></span>
          </button>
          <div className="flex min-h-52 flex-col items-center justify-center gap-4 rounded-xl bg-white/95 px-2 py-5">
            <div aria-hidden="true" className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map(item => <span key={item} className="h-8 w-8 rounded-lg bg-slate-200" />)}
            </div>
            <button type="button" aria-label={PHONE_AREAS[1].label} aria-pressed={selected === 'icon'} onClick={() => setSelected('icon')} className="flex max-w-full flex-col items-center gap-1 text-xs font-semibold text-slate-800">
              <span className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl ${isDarkColor(tokens.palette.primary) ? 'text-white' : 'text-slate-900'} ${selectionClass('icon')}`} style={{ backgroundColor: tokens.palette.primary }}>
                {logo ? <img src={logo} alt="" className="h-full w-full object-contain" /> : <Store size={26} />}
              </span>
              <span className="max-w-full truncate">{storeName}</span>
            </button>
            <div aria-hidden="true" className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map(item => <span key={item} className="h-8 w-8 rounded-lg bg-slate-200" />)}
            </div>
          </div>
          <button type="button" aria-label={PHONE_AREAS[2].label} aria-pressed={selected === 'nav'} onClick={() => setSelected('nav')}
            className={`flex w-full items-center justify-around rounded-b-2xl px-2 py-3 ${bars.navIsDark ? 'text-white' : 'text-slate-900'} ${selectionClass('nav')}`} style={{ backgroundColor: bars.nav }}>
            <ChevronLeft size={14} /><Circle size={12} /><Square size={12} />
          </button>
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold text-slate-600">Toque nas áreas do celular ou selecione abaixo.</p>
        <div className="flex flex-col gap-1" role="group" aria-label="Áreas do celular">
          {PHONE_AREAS.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold ${selected === item.id ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'}`}>{item.label}</button>)}
        </div>
        <div aria-live="polite" data-testid="brand-phone-explanation" className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600">
          <p className="mb-1 font-bold text-slate-900">{area.label}</p>
          <p>{area.text}</p>
        </div>
        <p className="text-xs text-slate-500">Ilustração do tema em edição; a aparência real depende do aparelho.</p>
      </div>
    </div>
  );
}

function BrandTraining({ theme, storeName }: { theme: TenantTheme; storeName: string }) {
  const [open, setOpen] = useState(false);
  const [lesson, setLesson] = useState(0);
  const current = LESSONS[lesson];
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="brand-training">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Como montar a marca do seu app</h3>
          <p className="text-xs text-slate-600">Mini-treinamento opcional em quatro etapas.</p>
        </div>
        <button type="button" aria-expanded={open} className="theme-secondary" onClick={() => setOpen(value => !value)}>{open ? 'Fechar treinamento' : 'Abrir treinamento'}</button>
      </div>
      {open && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Etapa {lesson + 1} de {LESSONS.length}</span>
            <progress aria-label="Progresso do treinamento" value={lesson + 1} max={LESSONS.length} className="h-1.5 w-24 accent-emerald-700" />
          </div>
          <div aria-live="polite" className="space-y-2 rounded-xl bg-white p-4">
            <h4 className="text-sm font-bold text-slate-900">{current.title}</h4>
            <p className="text-sm leading-relaxed text-slate-600">{current.text}</p>
            <p className="rounded-lg bg-emerald-50 p-2 text-xs font-medium text-emerald-900">{current.tip}</p>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className="theme-secondary" disabled={lesson === 0} onClick={() => setLesson(value => Math.max(0, value - 1))}>Voltar</button>
            {lesson < LESSONS.length - 1 ? <button type="button" className="theme-primary" onClick={() => setLesson(value => Math.min(LESSONS.length - 1, value + 1))}>Próxima etapa</button> : <button type="button" className="theme-primary" onClick={() => setOpen(false)}>Concluir treinamento</button>}
          </div>
        </div>
      )}
      <BrandPhone theme={theme} storeName={storeName} />
    </section>
  );
}

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
      <BrandTraining theme={draftTheme} storeName={storeName} />
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
