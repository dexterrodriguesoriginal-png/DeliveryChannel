import { Card } from '../../../../components/ui/Card';
import { SAFE_FONT_FAMILIES } from '../../../../lib/theme/themeEngine';
import { Type } from 'lucide-react';
import { useThemeEditorContext } from '../ThemeEditorContext';

export function FontsTab() {
  const { draftTokens, updateTokens } = useThemeEditorContext();
  return (
    <Card className="theme-tab-card p-5 space-y-5">
      <div className="pb-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Type className="w-4 h-4 text-emerald-700" />
          Fontes da sua loja
        </h3>
        <p className="text-xs text-gray-500">
          Alterações reais aplicadas imediatamente em títulos, descrições, preços e botões do prévia
        </p>
      </div>

      {/* Seleção de Família da Fonte */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-gray-700 block">
          Família Tipográfica Principal
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SAFE_FONT_FAMILIES.map((font) => {
            const currentFont = draftTokens.typography.fontFamily.toLowerCase();
            const isSelected =
              currentFont === font.name.toLowerCase() || currentFont === font.id.toLowerCase();
            return (
              <button
                key={font.id}
                type="button"
                data-testid={`font-family-${font.id}`}
                onClick={() => {
                  updateTokens((prev) => ({
                    ...prev,
                    typography: { ...prev.typography, fontFamily: font.name },
                  }));
                }}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-2xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{font.name}</span>
                  <span className="text-[10px] text-gray-400 uppercase font-mono">
                    {font.category}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 leading-snug">{font.description}</p>
                <span
                  className="text-xs pt-1 truncate opacity-80"
                  style={{ fontFamily: font.cssFamily }}
                >
                  Exemplo de texto 123
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pesos Independentes: Títulos vs Textos Corridos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-gray-100">
        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1.5">Peso dos Títulos</label>
          <select
            data-testid="typography-title-weight"
            value={draftTokens.typography.titleWeight}
            onChange={(e) =>
              updateTokens((prev) => ({
                ...prev,
                typography: { ...prev.typography, titleWeight: e.target.value as any },
              }))
            }
            className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
          >
            <option value="normal">Normal (400)</option>
            <option value="medium">Médio (500)</option>
            <option value="semibold">Semibold (600)</option>
            <option value="bold">Negrito (700)</option>
            <option value="extrabold">Extra Negrito (800)</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1.5">
            Peso dos Textos Corridos
          </label>
          <select
            data-testid="typography-body-weight"
            value={draftTokens.typography.bodyWeight}
            onChange={(e) =>
              updateTokens((prev) => ({
                ...prev,
                typography: { ...prev.typography, bodyWeight: e.target.value as any },
              }))
            }
            className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
          >
            <option value="normal">Normal (400)</option>
            <option value="medium">Médio (500)</option>
            <option value="semibold">Semibold (600)</option>
          </select>
        </div>
      </div>

      {/* Barra de Escala Geral das Letras */}
      <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-800">Escala Geral das Letras</label>
          <span className="text-xs font-mono font-bold text-emerald-700">
            {draftTokens.typography.scalePercent ?? 100}%
          </span>
        </div>
        <input
          type="range"
          min="85"
          max="125"
          step="1"
          data-testid="typography-scale-slider"
          value={draftTokens.typography.scalePercent ?? 100}
          onChange={(e) => {
            const val = Number(e.target.value);
            const scalePreset = val <= 93 ? 'compact' : val >= 107 ? 'spacious' : 'standard';
            updateTokens((prev) => ({
              ...prev,
              typography: {
                ...prev.typography,
                scalePercent: val,
                scale: scalePreset,
              },
            }));
          }}
          className="w-full accent-emerald-700 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>Compacta (85%)</span>
          <span>Padrão (100%)</span>
          <span>Expandida (125%)</span>
        </div>
      </div>

      {/* Estilo dos Títulos (Caixa Alta e Itálico) + Espaçamento e Altura de Linha */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-700 block">Estilo dos Títulos</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="typography-title-uppercase"
              onClick={() =>
                updateTokens((prev) => ({
                  ...prev,
                  typography: {
                    ...prev.typography,
                    titleUppercase: !prev.typography.titleUppercase,
                  },
                }))
              }
              className={`flex-1 py-2 px-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                draftTokens.typography.titleUppercase
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              AA Caixa Alta
            </button>
            <button
              type="button"
              data-testid="typography-title-italic"
              onClick={() =>
                updateTokens((prev) => ({
                  ...prev,
                  typography: {
                    ...prev.typography,
                    titleItalic: !prev.typography.titleItalic,
                  },
                }))
              }
              className={`flex-1 py-2 px-2.5 rounded-xl border text-xs font-bold italic cursor-pointer transition-all ${
                draftTokens.typography.titleItalic
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Itálico
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1.5">
            Espaçamento entre Letras
          </label>
          <select
            data-testid="typography-letter-spacing"
            value={draftTokens.typography.letterSpacing || 'normal'}
            onChange={(e) =>
              updateTokens((prev) => ({
                ...prev,
                typography: { ...prev.typography, letterSpacing: e.target.value as any },
              }))
            }
            className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
          >
            <option value="tight">Justo (-0.025em)</option>
            <option value="normal">Normal (0em)</option>
            <option value="wide">Espaçado (+0.05em)</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1.5">Altura de Linha</label>
          <select
            data-testid="typography-line-height"
            value={draftTokens.typography.lineHeight || 'normal'}
            onChange={(e) =>
              updateTokens((prev) => ({
                ...prev,
                typography: { ...prev.typography, lineHeight: e.target.value as any },
              }))
            }
            className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
          >
            <option value="tight">Compacta (1.2)</option>
            <option value="normal">Padrão (1.45)</option>
            <option value="relaxed">Confortável (1.65)</option>
          </select>
        </div>
      </div>
    </Card>
  );
}
