import { useState } from 'react';
import type { TenantTheme } from '../../../types';
import { themeToTokens } from '../../../lib/theme/themeEngine';
import { systemBarsFromTokens } from '../../../lib/pwa/systemBars';
import { ThemeDialog } from './ThemeDialog';
import { Lock, Unlock, Smartphone, Palette, Eye, QrCode, RefreshCw, Image } from 'lucide-react';
import type { BarLocks } from './useThemeDraft';

export function BarSwitches({ enabled, onChange }: { enabled: BarLocks; onChange: (value: BarLocks) => void }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
    <p className="text-xs font-bold text-slate-900">Proteção das barras do celular</p>
    {([{ key: 'status', label: 'Habilitar barra de status' }, { key: 'nav', label: 'Habilitar barra de navegação' }] as const).map(({ key, label }) => <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" role="switch" checked={enabled[key]} onChange={e => onChange({ ...enabled, [key]: e.target.checked })} />
      {enabled[key] ? <Unlock size={14} /> : <Lock size={14} />}{label}
    </label>)}
    <p className="text-xs text-slate-500">Barras protegidas mantêm sua cor ao trocar de tema. A barra de ícones interna continua livre.</p>
  </div>;
}
const topics = [
  { icon: Image, title: '1. Identidade e ícone', description: 'Escolha e confirme a logo definitiva. Ela vira o ícone instalado no celular do cliente.' },
  { icon: Smartphone, title: '2. Barras do celular', description: 'A barra de status fica no topo e pode acompanhar o app aberto. A barra inferior fica gravada na instalação. Android recente pode impor claro ou escuro.' },
  { icon: Palette, title: '3. Temas e cores internas', description: 'Troque o visual interno sem alterar as barras protegidas. Habilite cada switch somente se quiser mudar aquela barra. Prefira cores neutras na barra inferior.' },
  { icon: Eye, title: '4. Prévia ao vivo', description: 'Confira o rascunho no celular de prévia antes de salvar. A prévia respeita as proteções ao experimentar modelos.' },
  { icon: QrCode, title: '5. Divulgação e QR Code', description: 'Depois de salvar, use o QR Code e o link público da sua loja para divulgar o aplicativo aos clientes.' },
  { icon: RefreshCw, title: '6. Atualização para clientes antigos', description: 'Para ver o novo ícone ou barra inferior, clientes que já instalaram usam Baixar nova versão. Eles continuam comprando normalmente enquanto isso.' },
];
export function BrandGuide() {
  return <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
    {topics.map(({ icon: Icon, title, description }) => <article key={title} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"><Icon size={22} /></span>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="text-xs leading-relaxed text-slate-600">{description}</p>
    </article>)}
  </div>;
}

export function BrandIdentityHelp({ draftTheme, savedTheme }: { draftTheme: TenantTheme; savedTheme: TenantTheme }) {
  const [faqOpen, setFaqOpen] = useState(false);
  const identityChanged = (draftTheme.logoUrl || '') !== (savedTheme.logoUrl || '') || systemBarsFromTokens(themeToTokens(draftTheme)).nav !== systemBarsFromTokens(themeToTokens(savedTheme)).nav;
  return <>
    <button type="button" className="theme-secondary" onClick={() => setFaqOpen(true)}>Guia de identidade e atualização</button>
    {identityChanged && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Clientes que já instalaram o app precisarão baixar a nova versão para ver o novo ícone ou barra de navegação. Eles continuam comprando normalmente. <button type="button" className="font-bold underline" onClick={() => setFaqOpen(true)}>Saiba mais</button></div>}
    {faqOpen && <ThemeDialog title="Guia de identidade do app" onClose={() => setFaqOpen(false)}><BrandGuide /></ThemeDialog>}
  </>;
}
