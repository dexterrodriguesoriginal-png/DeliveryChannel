import { Smartphone } from 'lucide-react';
import { ColorPicker } from '../../../../components/ui/ColorPicker';
import { Card } from '../../../../components/ui/Card';
import { BAR_PRESETS, systemBarsFromTokens } from '../../../../lib/pwa/systemBars';
import { useThemeEditorContext } from '../ThemeEditorContext';

type Which = 'statusBarColor' | 'navBarColor';
const FIELDS: { key: Which; label: string; hint: string; testId: string }[] = [
  { key: 'statusBarColor', label: 'Cor da barra de status', hint: 'Barra de cima do celular (hora, sinal, bateria).', testId: 'bar-status' },
  { key: 'navBarColor', label: 'Cor da barra de navegação', hint: 'Barra de baixo do Android (voltar, início, recentes).', testId: 'bar-nav' },
];

/** Cores das barras do sistema do app instalado. Padrão: cor do cabeçalho do tema. */
export function SystemBarsCard() {
  const { draftTokens, updateSystemBars } = useThemeEditorContext();
  const bars = systemBarsFromTokens(draftTokens);
  const custom = draftTokens.meta?.systemBars || {};
  const current: Record<Which, string> = { statusBarColor: bars.status, navBarColor: bars.nav };
  return (
    <Card className="theme-tab-card p-5 space-y-5" data-testid="system-bars-card">
      <div className="pb-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-emerald-700" />
          Barras do celular
        </h3>
        <p className="text-xs text-gray-500">
          Combine as barras do Android com o visual da sua loja. Por padrão usam a cor do cabeçalho. No app já
          instalado, o Android pode levar até 1 dia para atualizar; reinstalar aplica na hora.
        </p>
      </div>
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-2" data-testid={`${f.testId}-field`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-gray-800">{f.label}</p>
              <p className="text-[11px] text-gray-500">{f.hint}</p>
            </div>
            <button
              type="button"
              data-testid={`${f.testId}-auto`}
              disabled={!custom[f.key]}
              onClick={() => updateSystemBars({ [f.key]: null })}
              className="theme-secondary text-[11px]"
            >
              Usar cor do cabeçalho
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Atalhos de cor: ${f.label}`}>
            {BAR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid={`${f.testId}-preset-${p.id}`}
                aria-pressed={current[f.key] === p.color}
                onClick={() => updateSystemBars({ [f.key]: p.color })}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${
                  current[f.key] === p.color ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                <span className="h-3.5 w-3.5 rounded-full border border-black/20" style={{ backgroundColor: p.color }} />
                {p.label}
              </button>
            ))}
          </div>
          <ColorPicker
            color={current[f.key]}
            onChange={(hex: string) => updateSystemBars({ [f.key]: hex })}
            label={f.label}
            defaultColor={current[f.key]}
            testIdPrefix={`${f.testId}-picker`}
          />
        </div>
      ))}
    </Card>
  );
}
