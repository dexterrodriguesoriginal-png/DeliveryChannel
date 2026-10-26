import { ColorPicker } from '../../../../components/ui/ColorPicker';
import { Card } from '../../../../components/ui/Card';
import { Palette, AlertTriangle } from 'lucide-react';
import { useThemeEditorContext } from '../ThemeEditorContext';

export function ColorsTab() {
  const {
    draftTokens,
    activeColorTarget,
    setActiveColorTarget,
    hexInputError,
    paletteTargets,
    currentTargetColor,
    handleColorChange,
  } = useThemeEditorContext();
  return (
    <Card className="theme-tab-card p-5 space-y-5">
      <div className="pb-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Palette className="w-4 h-4 text-emerald-700" />
            Cores da sua loja
          </h3>
          <p className="text-xs text-gray-500">
            Cada controle de cor possui destino visual exclusivo e independente no aplicativo do
            cliente
          </p>
        </div>
      </div>

      {/* Seletor de Alvos de Cor */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-gray-700 block">
          Selecione o elemento para customizar a cor:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {paletteTargets.map((item) => {
            const isSelected = activeColorTarget === item.id;
            const hex = draftTokens.palette[item.id] || '#15803d';
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`palette-target-${item.id}`}
                onClick={() => setActiveColorTarget(item.id)}
                className={`p-2 rounded-xl text-left border transition-all cursor-pointer flex items-center gap-2 ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/70 shadow-2xs font-bold text-gray-900'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <span
                  className="w-5 h-5 rounded-md border border-black/15 shrink-0 shadow-2xs"
                  style={{ backgroundColor: hex }}
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate leading-tight">{item.label}</p>
                  <p className="text-[10px] text-gray-400 font-mono uppercase">{hex}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Editor da Cor Ativa */}
      <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-gray-900">
              Ajustando: {paletteTargets.find((t) => t.id === activeColorTarget)?.label}
            </h4>
            <p className="text-[11px] text-gray-500">
              {paletteTargets.find((t) => t.id === activeColorTarget)?.desc}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-gray-700 bg-white px-2 py-1 rounded-md border">
              {currentTargetColor}
            </span>
          </div>
        </div>

        {/* ColorPicker Visual Integrado */}
        <div className="pt-2">
          <ColorPicker
            color={currentTargetColor}
            onChange={handleColorChange}
            label={`Cor Hexadecimal de ${paletteTargets.find((t) => t.id === activeColorTarget)?.label}`}
            defaultColor="#15803d"
            testIdPrefix="palette-color-picker"
          />
        </div>

        {hexInputError && (
          <p className="text-xs font-medium text-rose-600 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {hexInputError}
          </p>
        )}
      </div>
    </Card>
  );
}
