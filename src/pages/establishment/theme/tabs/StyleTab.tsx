import { ColorPicker } from '../../../../components/ui/ColorPicker';
import { Card } from '../../../../components/ui/Card';
import { Sliders } from 'lucide-react';
import { useThemeEditorContext } from '../ThemeEditorContext';

export function StyleTab() {
  const { draftTokens, updateTokens } = useThemeEditorContext();
  return (
    <Card className="theme-tab-card p-5 space-y-5">
      <div className="pb-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-700" />
          Estilos de Componentes, Bordas & Sombras
        </h3>
        <p className="text-xs text-gray-500">
          Controles independentes de arredondamento, espessura de borda e sombra dos cartões
        </p>
      </div>

      {/* Arredondamento dos Cantos (0 px a 28 px) */}
      <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-800">
            Arredondamento dos Cantos (0 px a 28 px)
          </label>
          <span className="text-xs font-mono font-bold text-emerald-700">
            {Math.min(28, Math.max(0, draftTokens.components.borderRadiusPx ?? 16))} px
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="28"
          step="1"
          data-testid="component-border-radius-slider"
          value={Math.min(28, Math.max(0, draftTokens.components.borderRadiusPx ?? 16))}
          onChange={(e) => {
            const px = Math.min(28, Math.max(0, Number(e.target.value)));
            updateTokens((prev) => ({
              ...prev,
              components: {
                ...prev.components,
                borderRadiusPx: px,
                borderRadius: `${px}px`,
                cardRadius: `${px}px`,
                buttonRadius: `${px}px`,
              },
            }));
          }}
          className="w-full accent-emerald-700 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>0 px (Reto)</span>
          <span>14 px (Médio)</span>
          <span>28 px (Máximo)</span>
        </div>
      </div>

      {/* Sombra dos Cartões (0 a 5 Níveis) */}
      <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-800">Sombra do Card (0 a 5 Níveis)</label>
          <span className="text-xs font-mono font-bold text-emerald-700">
            Nível {draftTokens.components.shadowLevel ?? 2}
            {draftTokens.components.shadowLevel === 0 ? ' (Nenhuma)' : ''}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="5"
          step="1"
          data-testid="component-shadow-level-slider"
          value={draftTokens.components.shadowLevel ?? 2}
          onChange={(e) => {
            const lvl = Math.min(5, Math.max(0, Number(e.target.value)));
            updateTokens((prev) => ({
              ...prev,
              components: {
                ...prev.components,
                shadowLevel: lvl,
                cardShadow: lvl === 0 ? 'none' : lvl === 1 ? 'sm' : lvl <= 3 ? 'md' : 'lg',
              },
            }));
          }}
          className="w-full accent-emerald-700 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-gray-500 font-medium">
          <span>0 (Sem)</span>
          <span>1 (Suave)</span>
          <span>2 (Padrão)</span>
          <span>3 (Médio)</span>
          <span>4 (Forte)</span>
          <span>5 (Máximo)</span>
        </div>
      </div>

      {/* Espessura da Borda (0 px a 4 px) */}
      <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-800">Espessura da Borda dos Cartões</label>
          <span className="text-xs font-mono font-bold text-emerald-700">
            {draftTokens.components.borderWidthPx ??
              (draftTokens.components.cardBorder === false ? 0 : 1)}{' '}
            px
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="4"
          step="1"
          data-testid="component-border-width-slider"
          value={
            draftTokens.components.borderWidthPx ??
            (draftTokens.components.cardBorder === false ? 0 : 1)
          }
          onChange={(e) => {
            const px = Number(e.target.value);
            updateTokens((prev) => ({
              ...prev,
              components: {
                ...prev.components,
                borderWidthPx: px,
                cardBorder: px > 0,
              },
            }));
          }}
          className="w-full accent-emerald-700 cursor-pointer"
        />
      </div>

      {/* Controle Avançado das Sombras dos Cartões */}
      <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-4">
        <h4 className="text-xs font-bold text-gray-900">
          Ajustes Finos de Sombra (Intensidade, Suavidade, Espalhamento e Cor)
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Intensidade da Sombra (0% a 100%) */}
          <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1.5">
            <div className="flex justify-between text-[11px] font-bold text-gray-700">
              <span>Intensidade</span>
              <span className="font-mono text-emerald-700">
                {draftTokens.components.shadowIntensity ?? 8}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              data-testid="component-shadow-intensity"
              value={draftTokens.components.shadowIntensity ?? 8}
              onChange={(e) => {
                const val = Number(e.target.value);
                updateTokens((prev) => ({
                  ...prev,
                  components: {
                    ...prev.components,
                    shadowIntensity: val,
                    cardShadow: val === 0 ? 'none' : val <= 10 ? 'sm' : val <= 20 ? 'md' : 'lg',
                  },
                }));
              }}
              className="w-full accent-emerald-700 cursor-pointer"
            />
          </div>

          {/* Suavidade / Desfoque da Sombra (Blur 0 px a 40 px) */}
          <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1.5">
            <div className="flex justify-between text-[11px] font-bold text-gray-700">
              <span>Suavidade (Blur)</span>
              <span className="font-mono text-emerald-700">
                {draftTokens.components.shadowBlur ?? 12} px
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              data-testid="component-shadow-blur"
              value={draftTokens.components.shadowBlur ?? 12}
              onChange={(e) => {
                const val = Number(e.target.value);
                updateTokens((prev) => ({
                  ...prev,
                  components: {
                    ...prev.components,
                    shadowBlur: val,
                  },
                }));
              }}
              className="w-full accent-emerald-700 cursor-pointer"
            />
          </div>

          {/* Espalhamento da Sombra (Spread -10 px a 20 px) */}
          <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1.5">
            <div className="flex justify-between text-[11px] font-bold text-gray-700">
              <span>Espalhamento</span>
              <span className="font-mono text-emerald-700">
                {draftTokens.components.shadowSpread ?? 0} px
              </span>
            </div>
            <input
              type="range"
              min="-10"
              max="20"
              step="1"
              data-testid="component-shadow-spread"
              value={draftTokens.components.shadowSpread ?? 0}
              onChange={(e) => {
                const val = Number(e.target.value);
                updateTokens((prev) => ({
                  ...prev,
                  components: {
                    ...prev.components,
                    shadowSpread: val,
                  },
                }));
              }}
              className="w-full accent-emerald-700 cursor-pointer"
            />
          </div>
        </div>

        {/* Cor da Sombra com Seletor de Cores Corrigido */}
        <ColorPicker
          color={draftTokens.components.shadowColor || '#000000'}
          onChange={(hex) =>
            updateTokens((prev) => ({
              ...prev,
              components: {
                ...prev.components,
                shadowColor: hex,
              },
            }))
          }
          label="Cor da Sombra dos Cartões"
          defaultColor="#000000"
          testIdPrefix="component-shadow-color"
        />
      </div>

      {/* Estilo das Guias de Categoria */}
      <div className="pt-2 border-t border-gray-100">
        <label className="text-xs font-bold text-gray-700 block mb-1.5">
          Estilo das Guias de Categoria
        </label>
        <select
          data-testid="component-category-style"
          value={draftTokens.components.categoryStyle}
          onChange={(e) =>
            updateTokens((prev) => ({
              ...prev,
              components: { ...prev.components, categoryStyle: e.target.value as any },
            }))
          }
          className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
        >
          <option value="solid">Sólido Preenchido</option>
          <option value="outline">Contorno com Borda</option>
          <option value="pill">Cápsula Arredondada (Pill)</option>
          <option value="subtle">Sutil / Minimalista</option>
        </select>
      </div>
    </Card>
  );
}
