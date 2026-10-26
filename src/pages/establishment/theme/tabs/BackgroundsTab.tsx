import { ColorPicker } from '../../../../components/ui/ColorPicker';
import { Card } from '../../../../components/ui/Card';
import { BackgroundStyleConfig } from '../../../../types/theme';
import {
  validateHexColor,
  normalizeHexColor,
  formatCssBackground,
  getSurfaceBackgroundStyle,
} from '../../../../lib/theme/themeEngine';
import { ThemeImageUploader } from '../../../../components/establishment/theme/ThemeImageUploader';
import { RotateCcw, Layout, X, Move, Trash2, ZoomIn, Plus } from 'lucide-react';
import { useThemeEditorContext } from '../ThemeEditorContext';

export function BackgroundsTab() {
  const {
    activeTenant,
    draftTokens,
    activeBgTarget,
    setActiveBgTarget,
    activeGradientStopIndex,
    setActiveGradientStopIndex,
    imageFrameRef,
    isDraggingImageRef,
    dragStartRef,
    updateSurfaceBackground,
  } = useThemeEditorContext();
  return (
    <Card className="theme-tab-card p-5 space-y-5">
      <div className="pb-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Layout className="w-4 h-4 text-emerald-700" />
          Fundos & Estilos Visuais
        </h3>
        <p className="text-xs text-gray-500">
          Configure fundos sólidos, gradientes de 2 ou 3 cores e imagens com enquadramento
          interativo
        </p>
      </div>

      {/* Seletor de Superfície: Geral, Cabeçalho ou Cartões */}
      <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
        {[
          { id: 'general', label: 'Fundo Geral da Tela' },
          { id: 'header', label: 'Fundo do Cabeçalho' },
          { id: 'card', label: 'Fundo dos Cartões' },
        ].map((bg) => (
          <button
            key={bg.id}
            type="button"
            data-testid={`bg-surface-${bg.id}`}
            onClick={() => setActiveBgTarget(bg.id as 'general' | 'header' | 'card')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
              activeBgTarget === bg.id
                ? 'bg-white text-gray-900 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {bg.label}
          </button>
        ))}
      </div>

      {/* Configuração da superfície selecionada */}
      {(() => {
        const currentBg = draftTokens.backgrounds[activeBgTarget];
        const updateCurrentBg = (updates: Partial<BackgroundStyleConfig>) => {
          updateSurfaceBackground(activeBgTarget, updates);
        };

        const currentGradientColors: string[] =
          currentBg.gradientColors && currentBg.gradientColors.length >= 2
            ? currentBg.gradientColors
            : [currentBg.color || '#15803d', '#166534'];

        const activeStopIndex = Math.min(activeGradientStopIndex, currentGradientColors.length - 1);
        const activeStopColor =
          currentGradientColors[activeStopIndex] || currentGradientColors[0] || '#15803d';

        const handleGradientColorUpdate = (index: number, newHex: string) => {
          if (!validateHexColor(newHex)) return;
          const norm = normalizeHexColor(newHex);
          const nextColors = [...currentGradientColors];
          nextColors[index] = norm;
          updateCurrentBg({
            gradientColors: nextColors,
            gradientStops: nextColors.length,
          });
        };

        const handleAddGradientStop = () => {
          if (currentGradientColors.length >= 5) return;
          const candidateColors = ['#22c55e', '#3b82f6', '#ec4899', '#f59e0b'];
          const newColor = candidateColors[currentGradientColors.length - 2] || '#10b981';
          const nextColors = [...currentGradientColors, newColor];
          updateCurrentBg({
            gradientColors: nextColors,
            gradientStops: nextColors.length,
          });
          setActiveGradientStopIndex(nextColors.length - 1);
        };

        const handleRemoveGradientStop = (indexToRemove: number) => {
          if (currentGradientColors.length <= 2) return;
          const nextColors = currentGradientColors.filter((_, idx) => idx !== indexToRemove);
          updateCurrentBg({
            gradientColors: nextColors,
            gradientStops: nextColors.length,
          });
          setActiveGradientStopIndex((prev) => Math.min(prev, nextColors.length - 1));
        };

        const surfaceLabel =
          activeBgTarget === 'general'
            ? 'Fundo Geral da Tela'
            : activeBgTarget === 'header'
              ? 'Fundo do Cabeçalho'
              : 'Fundo dos Cartões';

        return (
          <div className="space-y-4">
            {/* Seletor de Tipo de Fundo */}
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1.5">
                Tipo de Fundo ({surfaceLabel})
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'solid', label: 'Sólido' },
                  { id: 'gradient-linear', label: 'Gradiente Linear' },
                  { id: 'gradient-radial', label: 'Gradiente Radial' },
                  { id: 'image', label: 'Imagem + Overlay' },
                ].map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    data-testid={`bg-type-${type.id}`}
                    onClick={() =>
                      updateCurrentBg({ type: type.id as BackgroundStyleConfig['type'] })
                    }
                    className={`p-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                      currentBg.type === type.id
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 1. MODO SÓLIDO COM SELETOR VISUAL COMPLETO */}
            {currentBg.type === 'solid' && (
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">Cor Sólida — {surfaceLabel}</h4>
                    <p className="text-[11px] text-gray-500">
                      Altera exclusivamente a superfície de {surfaceLabel.toLowerCase()}
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold bg-white px-2.5 py-1 rounded-md border">
                    {currentBg.color}
                  </span>
                </div>

                <ColorPicker
                  color={currentBg.color || '#ffffff'}
                  onChange={(hex) => updateCurrentBg({ color: hex })}
                  label={`Seletor de Cor — ${surfaceLabel}`}
                  defaultColor={activeBgTarget === 'general' ? '#f8fafc' : '#ffffff'}
                  testIdPrefix={`bg-solid-picker-${activeBgTarget}`}
                />
              </div>
            )}

            {/* 2. MODO GRADIENTE (LINEAR OU RADIAL) — PARADAS ADICIONÁVEIS E REMOVÍVEIS COM COLORPICKER */}
            {(currentBg.type === 'gradient-linear' || currentBg.type === 'gradient-radial') && (
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-4">
                {/* Header das paradas do gradiente */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-200/80">
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">
                      Paradas de Cor do Gradiente ({currentGradientColors.length} paradas)
                    </h4>
                    <p className="text-[11px] text-gray-500">
                      Edite, adicione ou remova paradas de cor (mínimo 2, máximo 5)
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="gradient-add-stop-btn"
                      onClick={handleAddGradientStop}
                      disabled={currentGradientColors.length >= 5}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        currentGradientColors.length >= 5
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                          : 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer shadow-2xs'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar Parada</span>
                    </button>
                  </div>
                </div>

                {/* Barra de Pré-visualização do Gradiente */}
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-gray-600">
                    Pré-visualização do Gradiente ({surfaceLabel}):
                  </span>
                  <div
                    data-testid="gradient-preview-bar"
                    className="h-10 w-full rounded-xl border border-gray-300 shadow-inner"
                    style={{
                      backgroundImage: formatCssBackground({
                        ...currentBg,
                        gradientStops: currentGradientColors.length,
                        gradientColors: currentGradientColors,
                      }),
                    }}
                  />
                </div>

                {/* Abas / Botões de Cada Parada de Cor */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {currentGradientColors.map((hex, idx) => (
                      <div
                        key={idx}
                        data-testid={`gradient-stop-tab-${idx + 1}`}
                        onClick={() => setActiveGradientStopIndex(idx)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                          activeStopIndex === idx
                            ? 'border-emerald-600 bg-white shadow-2xs ring-2 ring-emerald-500/20'
                            : 'border-gray-200 bg-white/70 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            data-testid={`gradient-stop-swatch-${idx + 1}`}
                            className="w-5 h-5 rounded-md border border-black/15 shrink-0"
                            style={{ backgroundColor: hex }}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-900 truncate">
                              Parada {idx + 1}
                            </p>
                            <p className="text-[10px] font-mono text-gray-500 uppercase truncate">
                              {hex}
                            </p>
                          </div>
                        </div>
                        {currentGradientColors.length > 2 && (
                          <button
                            type="button"
                            data-testid={`gradient-remove-stop-${idx + 1}`}
                            title={`Remover Parada ${idx + 1}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveGradientStop(idx);
                            }}
                            className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Seletor Gráfico Completo da Cor da Parada Selecionada */}
                  <ColorPicker
                    color={activeStopColor}
                    onChange={(hex) => handleGradientColorUpdate(activeStopIndex, hex)}
                    label={`Seletor de Cor — Parada ${activeStopIndex + 1} do Gradiente`}
                    defaultColor={activeStopIndex === 0 ? '#15803d' : '#166534'}
                    testIdPrefix={`gradient-picker-stop-${activeStopIndex + 1}`}
                  />
                </div>

                {/* Controle de Ângulo para Gradiente Linear */}
                {currentBg.type === 'gradient-linear' && (
                  <div className="pt-2 border-t border-gray-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-gray-700">
                        Ângulo do Gradiente: {currentBg.angle ?? 135}°
                      </label>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={currentBg.angle ?? 135}
                      onChange={(e) => updateCurrentBg({ angle: Number(e.target.value) })}
                      data-testid="gradient-angle-slider"
                      className="w-full accent-emerald-700 cursor-pointer"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      {[0, 45, 90, 135, 180, 270].map((angle) => (
                        <button
                          key={angle}
                          type="button"
                          onClick={() => updateCurrentBg({ angle })}
                          className={`px-2.5 py-1 text-xs rounded-lg border font-mono font-semibold cursor-pointer ${
                            (currentBg.angle ?? 135) === angle
                              ? 'bg-emerald-700 text-white border-emerald-700'
                              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {angle}°
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3. MODO IMAGEM + OVERLAY — QUADRO VISUAL INTERATIVO */}
            {currentBg.type === 'image' && (
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-4">
                <ThemeImageUploader
                  tenantId={activeTenant.id}
                  imageType="background"
                  label={`Imagem de Fundo (${surfaceLabel})`}
                  value={currentBg.imageUrl || ''}
                  onChange={(url) => updateCurrentBg({ imageUrl: url })}
                />

                {/* Quadro Interativo de Enquadramento (Arraste + Posição X/Y + Zoom) */}
                <div className="space-y-3 pt-2 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                        <Move className="w-3.5 h-3.5 text-emerald-700" />
                        Quadro Interativo de Enquadramento
                      </h4>
                      <p className="text-[11px] text-gray-500">
                        Clique e arraste a imagem abaixo para posicionar o enquadramento em tempo
                        real
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="bg-image-reset-pos"
                        onClick={() =>
                          updateCurrentBg({
                            positionX: 50,
                            positionY: 50,
                            zoom: 100,
                          })
                        }
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 cursor-pointer flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Posição Padrão</span>
                      </button>

                      {currentBg.imageUrl && (
                        <button
                          type="button"
                          data-testid="bg-image-remove"
                          onClick={() => updateCurrentBg({ imageUrl: '' })}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Remover Fundo</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quadro Visual Arrastável */}
                  <div
                    ref={imageFrameRef}
                    data-testid="bg-image-interactive-frame"
                    data-pos-x={currentBg.positionX ?? 50}
                    data-pos-y={currentBg.positionY ?? 50}
                    data-zoom={currentBg.zoom ?? 100}
                    onClick={(e) => {
                      if (!imageFrameRef.current) return;
                      const rect = imageFrameRef.current.getBoundingClientRect();
                      if (!rect.width || !rect.height) return;
                      const x = Math.max(
                        0,
                        Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100))
                      );
                      const y = Math.max(
                        0,
                        Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100))
                      );
                      updateCurrentBg({ positionX: x, positionY: y });
                    }}
                    onMouseDown={(e) => {
                      isDraggingImageRef.current = true;
                      dragStartRef.current = {
                        clientX: e.clientX,
                        clientY: e.clientY,
                        startX: currentBg.positionX ?? 50,
                        startY: currentBg.positionY ?? 50,
                      };
                    }}
                    onTouchStart={(e) => {
                      if (!e.touches[0]) return;
                      isDraggingImageRef.current = true;
                      dragStartRef.current = {
                        clientX: e.touches[0].clientX,
                        clientY: e.touches[0].clientY,
                        startX: currentBg.positionX ?? 50,
                        startY: currentBg.positionY ?? 50,
                      };
                    }}
                    className="relative h-44 w-full rounded-xl border-2 border-emerald-600/40 overflow-hidden cursor-crosshair active:cursor-grabbing select-none touch-none shadow-inner flex items-center justify-center"
                    style={getSurfaceBackgroundStyle(
                      {
                        ...currentBg,
                        imageUrl:
                          currentBg.imageUrl ||
                          'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=800&auto=format&fit=crop&q=80',
                      },
                      currentBg.color || '#0f172a'
                    )}
                  >
                    {/* Marcador Visual do Ponto Focal */}
                    <div
                      data-testid="focal-point-marker"
                      className="absolute w-7 h-7 -ml-3.5 -mt-3.5 rounded-full border-2 border-white shadow-lg bg-emerald-600/85 pointer-events-none flex items-center justify-center ring-2 ring-black/30"
                      style={{
                        left: `${currentBg.positionX ?? 50}%`,
                        top: `${currentBg.positionY ?? 50}%`,
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white shadow-xs" />
                    </div>

                    <div className="absolute bottom-2 px-3 py-1.5 rounded-full bg-black/70 text-white text-[11px] font-bold pointer-events-none flex items-center gap-1.5 backdrop-blur-xs">
                      <Move className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        Ponto Focal: {currentBg.positionX ?? 50}% X, {currentBg.positionY ?? 50}% Y
                        (Arraste ou clique)
                      </span>
                    </div>
                  </div>

                  {/* Controles Numéricos Sincronizados: Posição X, Posição Y e Zoom */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-2.5 bg-white rounded-xl border border-gray-200 space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-gray-700">
                        <span>Posição X</span>
                        <span className="font-mono text-emerald-700">
                          {currentBg.positionX ?? 50}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={currentBg.positionX ?? 50}
                        onChange={(e) => updateCurrentBg({ positionX: Number(e.target.value) })}
                        data-testid="bg-image-pos-x"
                        className="w-full accent-emerald-700 cursor-pointer"
                      />
                    </div>

                    <div className="p-2.5 bg-white rounded-xl border border-gray-200 space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-gray-700">
                        <span>Posição Y</span>
                        <span className="font-mono text-emerald-700">
                          {currentBg.positionY ?? 50}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={currentBg.positionY ?? 50}
                        onChange={(e) => updateCurrentBg({ positionY: Number(e.target.value) })}
                        data-testid="bg-image-pos-y"
                        className="w-full accent-emerald-700 cursor-pointer"
                      />
                    </div>

                    <div className="p-2.5 bg-white rounded-xl border border-gray-200 space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-gray-700">
                        <span className="flex items-center gap-1">
                          <ZoomIn className="w-3 h-3 text-emerald-700" />
                          Zoom
                        </span>
                        <span className="font-mono text-emerald-700">{currentBg.zoom ?? 100}%</span>
                      </div>
                      <input
                        type="range"
                        min="100"
                        max="250"
                        value={currentBg.zoom ?? 100}
                        onChange={(e) => updateCurrentBg({ zoom: Number(e.target.value) })}
                        data-testid="bg-image-zoom"
                        className="w-full accent-emerald-700 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Overlay: Seletor de Cor Completo + Controle de Transparência */}
                <div className="pt-3 border-t border-gray-200 space-y-3">
                  <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1.5">
                    <div className="flex justify-between text-xs font-bold text-gray-700">
                      <span>Transparência / Intensidade do Overlay</span>
                      <span className="font-mono text-emerald-700">
                        {currentBg.overlayOpacity ?? 40}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={currentBg.overlayOpacity ?? 40}
                      onChange={(e) => updateCurrentBg({ overlayOpacity: Number(e.target.value) })}
                      data-testid="bg-overlay-opacity"
                      className="w-full accent-emerald-700 cursor-pointer"
                    />
                  </div>

                  <ColorPicker
                    color={currentBg.overlayColor || '#000000'}
                    onChange={(hex) => updateCurrentBg({ overlayColor: hex })}
                    label="Cor da Camada de Sobreposição (Overlay)"
                    defaultColor="#000000"
                    testIdPrefix="bg-overlay-picker"
                    showOpacity={true}
                    opacity={currentBg.overlayOpacity ?? 40}
                    onOpacityChange={(op) => updateCurrentBg({ overlayOpacity: op })}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </Card>
  );
}
