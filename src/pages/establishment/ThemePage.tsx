import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { themeService } from '../../services/themeService';
import { ColorPicker } from '../../components/ui/ColorPicker';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TenantTheme } from '../../types';
import {
  ThemeTokens,
  ThemePalette,
  BackgroundStyleConfig,
  PresetTheme,
} from '../../types/theme';
import {
  themeToTokens,
  tokensToTheme,
  validateHexColor,
  normalizeHexColor,
  validateWcagContrast,
  SAFE_FONT_FAMILIES,
  safeImageUrl,
  formatCssBackground,
  getSurfaceBackgroundStyle,
} from '../../lib/theme/themeEngine';
import { PRESET_THEMES } from '../../lib/theme/presetThemes';
import { LiveStorePreview } from '../../components/establishment/theme/LiveStorePreview';
import { ThemeImageUploader } from '../../components/establishment/theme/ThemeImageUploader';
import { useToast } from '../../context/ToastContext';
import {
  Sparkles,
  Save,
  RotateCcw,
  Check,
  Palette,
  Layers,
  Type,
  Layout,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  Undo2,
  Eye,
  X,
  Move,
  Trash2,
  ZoomIn,
} from 'lucide-react';

type EditorTab = 'presets' | 'identity' | 'palette' | 'backgrounds' | 'typography' | 'components';
type PaletteTarget = keyof ThemePalette;

export const ThemePage: React.FC = () => {
  const { activeTenant, securityContext, setActiveTenant } = useAuth();
  const { showToast } = useToast();

  if (!activeTenant) return null;

  // Estado salvo original do estabelecimento
  const savedTheme = activeTenant.theme;

  // Estado de Rascunho (Draft)
  const [draftTheme, setDraftTheme] = useState<TenantTheme>(() => ({
    ...savedTheme,
    buttonColor: savedTheme.buttonColor || savedTheme.primaryColor,
    fontFamily: savedTheme.fontFamily || 'Inter',
    borderRadius: savedTheme.borderRadius || '1rem',
  }));

  // Estado de Pré-visualização Temporária de Tema da Galeria (não sobrescreve o rascunho)
  const [previewingPreset, setPreviewingPreset] = useState<PresetTheme | null>(null);

  // Tokens derivados do rascunho
  const draftTokens = useMemo(() => themeToTokens(draftTheme), [draftTheme]);

  // Tema efetivamente exibido no Emulador (Preview temporário se ativo, caso contrário Rascunho)
  const emulatorTheme = useMemo(() => {
    if (!previewingPreset) return draftTheme;
    return tokensToTheme(previewingPreset.tokens, {
      storeName: draftTheme.storeName,
      tagline: draftTheme.tagline,
      logoUrl: draftTheme.logoUrl,
      bannerUrl: draftTheme.bannerUrl,
    });
  }, [previewingPreset, draftTheme]);

  // Tab ativa do editor
  const [activeTab, setActiveTab] = useState<EditorTab>('presets');

  // Alvo de cor selecionado na tab de paleta
  const [activeColorTarget, setActiveColorTarget] = useState<PaletteTarget>('primary');
  const [hexInputError, setHexInputError] = useState<string | null>(null);

  // Alvo de fundo selecionado na tab de fundos
  const [activeBgTarget, setActiveBgTarget] = useState<'general' | 'header' | 'card'>('general');

  // Aba de cor de gradiente ativa (1, 2 ou 3)
  const [activeGradientStopIndex, setActiveGradientStopIndex] = useState<0 | 1 | 2>(0);

  // Estado para arraste do quadro interativo de imagem de fundo
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const isDraggingImageRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number }>({
    clientX: 0,
    clientY: 0,
    startX: 50,
    startY: 50,
  });

  // Estado de carregamento e modal de confirmação
  const [isSaving, setIsSaving] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // Detecção de rascunho com alterações pendentes (isDirty)
  const isDirty = useMemo(() => {
    return JSON.stringify(draftTheme) !== JSON.stringify(savedTheme);
  }, [draftTheme, savedTheme]);

  // Checagens de contraste WCAG AA
  const contrastChecks = useMemo(() => {
    const p = draftTokens.palette;
    const textOnCard = validateWcagContrast(p.textMain, p.bgCard);
    const titleOnCard = validateWcagContrast(p.textTitle, p.bgCard);
    const buttonContrast = validateWcagContrast(p.buttonText, p.buttonBg);
    const titleOnHeader = validateWcagContrast(p.textTitle, p.bgHeader);

    const warnings: Array<{ label: string; ratio: number; fg: string; bg: string }> = [];

    if (!textOnCard.passNormal) {
      warnings.push({
        label: 'Texto Principal sobre Fundo do Card',
        ratio: textOnCard.ratio,
        fg: p.textMain,
        bg: p.bgCard,
      });
    }
    if (!titleOnCard.passNormal) {
      warnings.push({
        label: 'Título sobre Fundo do Card',
        ratio: titleOnCard.ratio,
        fg: p.textTitle,
        bg: p.bgCard,
      });
    }
    if (!buttonContrast.passNormal) {
      warnings.push({
        label: 'Texto do Botão sobre Botão de Ação',
        ratio: buttonContrast.ratio,
        fg: p.buttonText,
        bg: p.buttonBg,
      });
    }
    if (!titleOnHeader.passNormal) {
      warnings.push({
        label: 'Título sobre Fundo do Cabeçalho',
        ratio: titleOnHeader.ratio,
        fg: p.textTitle,
        bg: p.bgHeader,
      });
    }

    return {
      hasWarnings: warnings.length > 0,
      warnings,
      buttonContrast,
      textOnCard,
    };
  }, [draftTokens]);

  // Atualizador de Tokens com sincronização do TenantTheme
  const updateTokens = useCallback(
    (fn: (prevTokens: ThemeTokens) => ThemeTokens) => {
      setDraftTheme((prevDraft) => {
        const currentTokens = themeToTokens(prevDraft);
        const nextTokens = fn(currentTokens);
        return tokensToTheme(nextTokens, {
          storeName: prevDraft.storeName,
          tagline: prevDraft.tagline,
          logoUrl: prevDraft.logoUrl,
          bannerUrl: prevDraft.bannerUrl,
        });
      });
    },
    []
  );

  // Abrir Preview de um Tema Pronto sem alterar o rascunho
  const handlePreviewPreset = (preset: PresetTheme) => {
    setPreviewingPreset(preset);
  };

  // Sair do modo Preview restaurando imediatamente o rascunho atual
  const handleExitPreview = () => {
    setPreviewingPreset(null);
  };

  // Aplica um dos 20 Temas Prontos no Rascunho editável
  const handleApplyPreset = (presetTokens: ThemeTokens) => {
    setPreviewingPreset(null);
    // Clona profundamente para isolar o rascunho da constante do preset
    const clonedTokens: ThemeTokens = JSON.parse(JSON.stringify(presetTokens));
    updateTokens(() => clonedTokens);
    showToast({
      type: 'info',
      title: 'Tema Aplicado ao Rascunho',
      message: 'Revise os detalhes no preview e clique em "Salvar como padrão" quando desejar publicar.',
    });
  };

  // Salvar como padrão da minha loja
  const handleSaveStoreDefault = async () => {
    if (!draftTheme.storeName?.trim()) {
      showToast({
        type: 'error',
        title: 'Nome Obrigatório',
        message: 'Por favor, informe o nome comercial do estabelecimento.',
      });
      return;
    }

    for (const [key, color] of Object.entries(draftTokens.palette)) {
      if (!validateHexColor(color)) {
        showToast({
          type: 'error',
          title: 'Cor Inválida na Paleta',
          message: `A cor "${key}" possui um valor hexadecimal inválido (${color}).`,
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const sanitizedLogo = draftTheme.logoUrl ? (safeImageUrl(draftTheme.logoUrl) ?? '') : '';
      const sanitizedBanner = draftTheme.bannerUrl ? (safeImageUrl(draftTheme.bannerUrl) ?? '') : '';

      const sanitizedTheme: TenantTheme = {
        ...draftTheme,
        logoUrl: sanitizedLogo,
        bannerUrl: sanitizedBanner,
        tokens: {
          ...draftTokens,
          backgrounds: {
            general: {
              ...draftTokens.backgrounds.general,
              imageUrl: draftTokens.backgrounds.general.imageUrl
                ? (safeImageUrl(draftTokens.backgrounds.general.imageUrl) ?? '')
                : undefined,
            },
            header: {
              ...draftTokens.backgrounds.header,
              imageUrl: draftTokens.backgrounds.header.imageUrl
                ? (safeImageUrl(draftTokens.backgrounds.header.imageUrl) ?? '')
                : undefined,
            },
            card: {
              ...draftTokens.backgrounds.card,
              imageUrl: draftTokens.backgrounds.card.imageUrl
                ? (safeImageUrl(draftTokens.backgrounds.card.imageUrl) ?? '')
                : undefined,
            },
          },
        },
      };

      const saved = await themeService.updateTheme(securityContext, activeTenant.id, sanitizedTheme);

      setPreviewingPreset(null);
      setDraftTheme(saved);
      setActiveTenant({
        ...activeTenant,
        theme: saved,
      });

      showToast({
        type: 'success',
        title: 'Design Salvo & Publicado',
        message: 'A nova identidade visual foi salva como padrão da sua loja e sincronizada com o app.',
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Salvar Design',
        message: err.message || 'Falha ao salvar as alterações de design.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Descartar alterações do rascunho
  const handleDiscardChanges = () => {
    setPreviewingPreset(null);
    setDraftTheme(savedTheme);
    showToast({
      type: 'info',
      title: 'Alterações Descartadas',
      message: 'O rascunho foi revertido para o último design salvo da loja.',
    });
  };

  // Restaurar padrão oficial do Delivery Channel (Com confirmação)
  const handleConfirmResetDefault = async () => {
    setIsSaving(true);
    try {
      const restored = await themeService.resetToDeliveryChannelDefault(
        securityContext,
        activeTenant.id,
        {
          storeName: activeTenant.name,
          tagline: 'Seu canal de compras direto e exclusivo.',
          logoUrl: activeTenant.theme.logoUrl,
          bannerUrl: activeTenant.theme.bannerUrl,
        }
      );

      setPreviewingPreset(null);
      setDraftTheme(restored);
      setActiveTenant({
        ...activeTenant,
        theme: restored,
      });

      setIsResetConfirmOpen(false);
      showToast({
        type: 'success',
        title: 'Padrão Delivery Channel Restaurado',
        message: 'O tema visual foi redefinido para o padrão oficial, sem resíduos.',
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Restaurar Padrão',
        message: err.message || 'Falha ao restaurar padrão oficial.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Paleta de cores: lista de alvos configuráveis 100% independentes
  const paletteTargets: Array<{ id: PaletteTarget; label: string; group: string; desc: string }> = [
    { id: 'bgCard', label: 'Fundo dos Cards', group: 'Superfícies', desc: 'Controla somente o fundo dos cartões de produtos' },
    { id: 'bgMenu', label: 'Fundo dos Menus', group: 'Superfícies', desc: 'Controla exclusivamente o fundo da barra de navegação inferior' },
    { id: 'categoryBg', label: 'Botão Categoria', group: 'Superfícies', desc: 'Controla exclusivamente o fundo dos botões de categorias' },
    { id: 'iconColor', label: 'Cor dos Ícones', group: 'Ícones', desc: 'Ícones do menu inferior, lupa da pesquisa e relógio de entrega' },
    { id: 'bgHeader', label: 'Fundo do Cabeçalho', group: 'Superfícies', desc: 'Controla exclusivamente o fundo do cabeçalho da loja' },
    { id: 'bgGeneral', label: 'Fundo Geral', group: 'Superfícies', desc: 'Controla exclusivamente a superfície de fundo geral da tela' },
    { id: 'textTitle', label: 'Título Principal', group: 'Textos', desc: 'Nome da loja e títulos dos produtos' },
    { id: 'textMain', label: 'Texto Principal', group: 'Textos', desc: 'Descrições de produtos e textos corridos principais' },
    { id: 'textSecondary', label: 'Texto Secundário', group: 'Textos', desc: 'Metadados, horários, status e textos auxiliares' },
    { id: 'buttonBg', label: 'Fundo do Botão', group: 'Botões', desc: 'Fundo dos botões de ação principal (Adicionar, Sacola)' },
    { id: 'buttonText', label: 'Texto do Botão', group: 'Botões', desc: 'Cor do texto e conteúdo interno dos botões de ação' },
    { id: 'price', label: 'Cor do Preço', group: 'Preços', desc: 'Preço normal dos produtos sem promoção' },
    { id: 'promoPrice', label: 'Preço Promocional', group: 'Preços', desc: 'Preço promocional exibido nos produtos em oferta' },
    { id: 'accent', label: 'Destaque / Acento', group: 'Marca', desc: 'Selos e etiquetas de destaque visual (Oferta, Mais Vendido)' },
    { id: 'border', label: 'Cor das Bordas', group: 'Linhas', desc: 'Contornos e divisórias de cartões, cabeçalho e busca' },
    { id: 'primary', label: 'Cor Principal', group: 'Marca', desc: 'Cor institucional do banner principal e avatar da marca' },
    { id: 'secondary', label: 'Cor Secundária', group: 'Marca', desc: 'Detalhe complementar no banner institucional' },
  ];

  const currentTargetColor = draftTokens.palette[activeColorTarget] || '#15803d';

  const handleColorChange = (hex: string) => {
    if (!validateHexColor(hex)) {
      setHexInputError('Código HEX inválido');
      return;
    }
    setHexInputError(null);
    const normalized = normalizeHexColor(hex);
    updateTokens((prev) => {
      const nextPalette: ThemePalette = {
        ...prev.palette,
        [activeColorTarget]: normalized,
      };
      const nextBackgrounds = { ...prev.backgrounds };

      // Sincroniza apenas a superfície correspondente quando editada pela aba Paleta
      if (activeColorTarget === 'bgGeneral') {
        nextBackgrounds.general = { ...nextBackgrounds.general, color: normalized };
      } else if (activeColorTarget === 'bgHeader') {
        nextBackgrounds.header = { ...nextBackgrounds.header, color: normalized };
      } else if (activeColorTarget === 'bgCard') {
        nextBackgrounds.card = { ...nextBackgrounds.card, color: normalized };
      }

      return {
        ...prev,
        palette: nextPalette,
        backgrounds: nextBackgrounds,
      };
    });
  };

  // Atualização de fundo na aba Fundos & Efeitos com sincronia estrita por superfície
  const updateSurfaceBackground = useCallback(
    (
      surface: 'general' | 'header' | 'card',
      updates: Partial<BackgroundStyleConfig>
    ) => {
      updateTokens((prev) => {
        const updatedBg: BackgroundStyleConfig = {
          ...prev.backgrounds[surface],
          ...updates,
        };
        const nextPalette = { ...prev.palette };
        if (updates.color && validateHexColor(updates.color)) {
          const norm = normalizeHexColor(updates.color);
          updatedBg.color = norm;
          if (surface === 'general') nextPalette.bgGeneral = norm;
          if (surface === 'header') nextPalette.bgHeader = norm;
          if (surface === 'card') nextPalette.bgCard = norm;
        }
        return {
          ...prev,
          palette: nextPalette,
          backgrounds: {
            ...prev.backgrounds,
            [surface]: updatedBg,
          },
        };
      });
    },
    [updateTokens]
  );

  // Listeners globais para arraste interativo de enquadramento da imagem de fundo
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!isDraggingImageRef.current || !imageFrameRef.current) return;
      const rect = imageFrameRef.current.getBoundingClientRect();
      const width = rect.width || 300;
      const height = rect.height || 180;

      const deltaX = ((clientX - dragStartRef.current.clientX) / width) * 100;
      const deltaY = ((clientY - dragStartRef.current.clientY) / height) * 100;

      const nextX = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startX + deltaX)));
      const nextY = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startY + deltaY)));

      updateSurfaceBackground(activeBgTarget, {
        positionX: nextX,
        positionY: nextY,
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingImageRef.current) return;
      e.preventDefault();
      handleMove(e.clientX, e.clientY);
    };

    const onMouseUp = () => {
      isDraggingImageRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingImageRef.current || !e.touches[0]) return;
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    };

    const onTouchEnd = () => {
      isDraggingImageRef.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [activeBgTarget, updateSurfaceBackground]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Design do App</h2>
            {isDirty ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Rascunho não salvo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Tema sincronizado
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Personalize a identidade visual, paleta de cores, tipografia e componentes do aplicativo da sua loja
          </p>
        </div>

        {/* Botões de Ação Principais */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsResetConfirmOpen(true)}
            leftIcon={<RotateCcw className="w-4 h-4 text-gray-500" />}
            className="text-xs text-gray-700 hover:text-gray-900"
            title="Restaura o tema oficial padrão do Delivery Channel"
          >
            Restaurar Padrão
          </Button>

          {isDirty && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscardChanges}
              leftIcon={<Undo2 className="w-4 h-4 text-gray-500" />}
              className="text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
            >
              Descartar
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveStoreDefault}
            isLoading={isSaving}
            leftIcon={<Save className="w-4 h-4" />}
            className="text-xs bg-emerald-700 hover:bg-emerald-800 shadow-xs font-bold"
          >
            Salvar como padrão da minha loja
          </Button>
        </div>
      </div>

      {/* Faixa Verde de Modo Preview de Tema da Galeria */}
      {previewingPreset && (
        <div
          data-testid="preset-preview-banner"
          className="p-4 rounded-xl bg-emerald-900 text-white border border-emerald-700 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center shrink-0">
              <Eye className="w-4 h-4 text-emerald-100" />
            </div>
            <div>
              <p className="text-xs font-extrabold tracking-wide uppercase text-emerald-200">
                Modo de Pré-visualização Ativo
              </p>
              <p className="text-sm font-bold text-white">
                Visualizando tema: <span data-testid="preset-preview-name">{previewingPreset.name}</span>
              </p>
              <p className="text-[11px] text-emerald-100/90">
                Seu rascunho atual não foi alterado. Aplique se desejar carregar este tema ou saia para voltar.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              data-testid="preset-preview-exit"
              onClick={handleExitPreview}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-800 hover:bg-emerald-700 text-white border border-emerald-600 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              <span>Sair do Preview</span>
            </button>
            <button
              type="button"
              data-testid="preset-preview-confirm-apply"
              onClick={() => handleApplyPreset(previewingPreset.tokens)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-white hover:bg-emerald-50 text-emerald-950 shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5 text-emerald-700" />
              <span>Aplicar este tema</span>
            </button>
          </div>
        </div>
      )}

      {/* Banner de Aviso de Baixo Contraste (WCAG AA) */}
      {contrastChecks.hasWarnings && (
        <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200/80 text-amber-900 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <h4 className="text-xs font-bold text-amber-950">
              Aviso de Acessibilidade & Legibilidade (Norma WCAG AA)
            </h4>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            Detectamos combinações de cores com contraste abaixo do recomendado (4.5:1). Suas cores foram mantidas,
            mas recomendamos revisar para garantir que todos os seus clientes consigam ler com conforto:
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {contrastChecks.warnings.map((w, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] bg-white text-amber-900 border border-amber-200 shadow-2xs font-medium"
              >
                <span>{w.label}:</span>
                <span className="font-mono font-bold text-amber-700">{w.ratio}:1</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Grid Principal: Editor de Seções à esquerda, Live Preview à direita */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Lado Esquerdo: Editor por Seções */}
        <div className="lg:col-span-7 space-y-4">
          {/* Navegação entre Seções do Editor */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto no-scrollbar">
            {[
              { id: 'presets', label: '20 Temas Prontos', icon: <Sparkles className="w-3.5 h-3.5" /> },
              { id: 'identity', label: 'Identidade', icon: <Layers className="w-3.5 h-3.5" /> },
              { id: 'palette', label: 'Paleta & Contraste', icon: <Palette className="w-3.5 h-3.5" /> },
              { id: 'backgrounds', label: 'Fundos & Efeitos', icon: <Layout className="w-3.5 h-3.5" /> },
              { id: 'typography', label: 'Tipografia', icon: <Type className="w-3.5 h-3.5" /> },
              { id: 'components', label: 'Componentes', icon: <Sliders className="w-3.5 h-3.5" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`editor-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as EditorTab)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-white text-gray-900 shadow-2xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* ------------------------------------------------------------- */}
          {/* SEÇÃO 1: GALERIA DOS 20 TEMAS PRONTOS                          */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'presets' && (
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-700" />
                    Galeria de 20 Temas Prontos
                  </h3>
                  <p className="text-xs text-gray-500">
                    Use <strong>Preview</strong> para comparar no emulador sem perder seu rascunho, ou clique em{' '}
                    <strong>Aplicar este tema</strong> para editar
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[580px] overflow-y-auto pr-1">
                {PRESET_THEMES.map((preset) => {
                  const p = preset.tokens.palette;
                  const isPreviewingThis = previewingPreset?.id === preset.id;
                  return (
                    <div
                      key={preset.id}
                      data-testid={`preset-card-${preset.id}`}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-3 shadow-2xs group ${
                        isPreviewingThis
                          ? 'border-emerald-600 bg-emerald-50/40 ring-2 ring-emerald-500/20'
                          : 'border-gray-200 bg-white hover:border-emerald-500'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-bold text-gray-900 group-hover:text-emerald-700 transition-colors">
                            {preset.name}
                          </h4>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                            {preset.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">
                          {preset.description}
                        </p>
                      </div>

                      <div className="space-y-2.5">
                        {/* Faixa de Cores da Paleta */}
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-5 h-5 rounded-md border border-black/10 shrink-0"
                            style={{ backgroundColor: p.primary }}
                            title={`Principal: ${p.primary}`}
                          />
                          <span
                            className="w-5 h-5 rounded-md border border-black/10 shrink-0"
                            style={{ backgroundColor: p.secondary }}
                            title={`Secundária: ${p.secondary}`}
                          />
                          <span
                            className="w-5 h-5 rounded-md border border-black/10 shrink-0"
                            style={{ backgroundColor: p.accent }}
                            title={`Destaque: ${p.accent}`}
                          />
                          <span
                            className="w-5 h-5 rounded-md border border-black/10 shrink-0"
                            style={{ backgroundColor: p.bgGeneral }}
                            title={`Fundo: ${p.bgGeneral}`}
                          />
                          <span
                            className="w-5 h-5 rounded-md border border-black/10 shrink-0"
                            style={{ backgroundColor: p.buttonBg }}
                            title={`Botão: ${p.buttonBg}`}
                          />
                          <span className="text-[10px] text-gray-400 font-mono ml-auto">
                            {preset.tokens.typography.fontFamily}
                          </span>
                        </div>

                        {/* Duas Ações Visualmente Distintas: Preview (olho) e Aplicar este tema */}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            data-testid={`preset-preview-${preset.id}`}
                            onClick={() => handlePreviewPreset(preset)}
                            className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                              isPreviewingThis
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Preview</span>
                          </button>

                          <button
                            type="button"
                            data-testid={`preset-apply-${preset.id}`}
                            onClick={() => handleApplyPreset(preset.tokens)}
                            className="py-1.5 px-2.5 rounded-lg text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 hover:border-emerald-300 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Aplicar este tema</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ------------------------------------------------------------- */}
          {/* SEÇÃO 2: IDENTIDADE & MARCA                                    */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'identity' && (
            <Card className="p-5 space-y-4">
              <div className="pb-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-700" />
                  Identidade da Marca & Logotipo
                </h3>
                <p className="text-xs text-gray-500">
                  Defina o nome comercial, slogan e os arquivos gráficos oficiais exibidos no app do cliente
                </p>
              </div>

              <div className="space-y-4">
                <Input
                  label="Nome Comercial Exibido no App *"
                  value={draftTheme.storeName}
                  onChange={(e) => setDraftTheme({ ...draftTheme, storeName: e.target.value })}
                  placeholder="Ex: Adega Premium Jardins"
                />

                <Input
                  label="Slogan / Chamada Principal *"
                  value={draftTheme.tagline}
                  onChange={(e) => setDraftTheme({ ...draftTheme, tagline: e.target.value })}
                  placeholder="Ex: Seu canal de compras direto e exclusivo."
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <ThemeImageUploader
                      tenantId={activeTenant.id}
                      imageType="logo"
                      label="Logotipo Oficial da Loja"
                      value={draftTheme.logoUrl || ''}
                      onChange={(url) => setDraftTheme({ ...draftTheme, logoUrl: url })}
                    />
                  </div>

                  <div>
                    <ThemeImageUploader
                      tenantId={activeTenant.id}
                      imageType="banner"
                      label="Imagem de Capa / Banner Superior"
                      value={draftTheme.bannerUrl || ''}
                      onChange={(url) => setDraftTheme({ ...draftTheme, bannerUrl: url })}
                    />
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ------------------------------------------------------------- */}
          {/* SEÇÃO 3: PALETA DE CORES & CONTRASTE                           */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'palette' && (
            <Card className="p-5 space-y-5">
              <div className="pb-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <Palette className="w-4 h-4 text-emerald-700" />
                    Paleta de Cores Semântica & Contraste
                  </h3>
                  <p className="text-xs text-gray-500">
                    Cada controle de cor possui destino visual exclusivo e independente no aplicativo do cliente
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
          )}

          {/* ------------------------------------------------------------- */}
          {/* SEÇÃO 4: FUNDOS & EFEITOS                                      */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'backgrounds' && (
            <Card className="p-5 space-y-5">
              <div className="pb-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Layout className="w-4 h-4 text-emerald-700" />
                  Fundos & Estilos Visuais
                </h3>
                <p className="text-xs text-gray-500">
                  Configure fundos sólidos, gradientes de 2 ou 3 cores e imagens com enquadramento interativo
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

                const stopsCount: 2 | 3 =
                  currentBg.gradientStops ??
                  (currentBg.gradientColors && currentBg.gradientColors.length >= 3 ? 3 : 2);

                const storedColors = currentBg.gradientColors || [
                  currentBg.color || '#15803d',
                  '#166534',
                  '#22c55e',
                ];
                const color1 = storedColors[0] || currentBg.color || '#15803d';
                const color2 = storedColors[1] || '#166534';
                const color3 = storedColors[2] || '#22c55e';

                const safeStopIndex: 0 | 1 | 2 =
                  stopsCount === 2 && activeGradientStopIndex === 2 ? 0 : activeGradientStopIndex;

                const handleGradientColorUpdate = (index: 0 | 1 | 2, newHex: string) => {
                  if (!validateHexColor(newHex)) return;
                  const norm = normalizeHexColor(newHex);
                  const nextColors: [string, string, ...string[]] = [color1, color2, color3];
                  nextColors[index] = norm;
                  updateCurrentBg({
                    gradientColors: nextColors,
                  });
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
                            onClick={() => updateCurrentBg({ type: type.id as BackgroundStyleConfig['type'] })}
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
                            <h4 className="text-xs font-bold text-gray-900">
                              Cor Sólida — {surfaceLabel}
                            </h4>
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

                    {/* 2. MODO GRADIENTE (LINEAR OU RADIAL) — 2 CORES PADRÃO E 3ª COR OPCIONAL */}
                    {(currentBg.type === 'gradient-linear' || currentBg.type === 'gradient-radial') && (
                      <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-4">
                        {/* Escolha explícita: 2 cores (padrão) vs 3 cores */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-200/80">
                          <div>
                            <h4 className="text-xs font-bold text-gray-900">
                              Modo de Cores do Gradiente
                            </h4>
                            <p className="text-[11px] text-gray-500">
                              Escolha entre gradiente de 2 cores (padrão) ou 3 cores
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-gray-200">
                            <button
                              type="button"
                              data-testid="gradient-mode-2"
                              onClick={() => {
                                updateCurrentBg({
                                  gradientStops: 2,
                                  gradientColors: [color1, color2, color3],
                                });
                                if (activeGradientStopIndex === 2) setActiveGradientStopIndex(0);
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                stopsCount === 2
                                  ? 'bg-emerald-700 text-white shadow-2xs'
                                  : 'text-gray-600 hover:text-gray-900'
                              }`}
                            >
                              Gradiente de 2 cores
                            </button>
                            <button
                              type="button"
                              data-testid="gradient-mode-3"
                              onClick={() =>
                                updateCurrentBg({
                                  gradientStops: 3,
                                  gradientColors: [color1, color2, color3],
                                })
                              }
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                stopsCount === 3
                                  ? 'bg-emerald-700 text-white shadow-2xs'
                                  : 'text-gray-600 hover:text-gray-900'
                              }`}
                            >
                              Gradiente de 3 cores
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
                                gradientStops: stopsCount,
                                gradientColors: [color1, color2, color3],
                              }),
                            }}
                          />
                        </div>

                        {/* Seletores das Cores Habilitadas (Cor 1, Cor 2 e, se habilitada, Cor 3) */}
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {[
                              { idx: 0 as const, label: 'Cor 1', hex: color1 },
                              { idx: 1 as const, label: 'Cor 2', hex: color2 },
                              ...(stopsCount === 3
                                ? [{ idx: 2 as const, label: 'Cor 3', hex: color3 }]
                                : []),
                            ].map((stop) => (
                              <button
                                key={stop.idx}
                                type="button"
                                data-testid={`gradient-stop-tab-${stop.idx + 1}`}
                                onClick={() => setActiveGradientStopIndex(stop.idx)}
                                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                                  safeStopIndex === stop.idx
                                    ? 'border-emerald-600 bg-white shadow-2xs ring-2 ring-emerald-500/20'
                                    : 'border-gray-200 bg-white/70 hover:bg-white'
                                }`}
                              >
                                <span
                                  data-testid={`gradient-stop-swatch-${stop.idx + 1}`}
                                  className="w-6 h-6 rounded-lg border border-black/15 shrink-0"
                                  style={{ backgroundColor: stop.hex }}
                                />
                                <div>
                                  <p className="text-xs font-bold text-gray-900">{stop.label}</p>
                                  <p className="text-[10px] font-mono text-gray-500 uppercase">
                                    {stop.hex}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>

                          {/* Seletor Gráfico Completo da Cor do Gradiente Selecionada */}
                          <ColorPicker
                            color={
                              safeStopIndex === 0
                                ? color1
                                : safeStopIndex === 1
                                ? color2
                                : color3
                            }
                            onChange={(hex) => handleGradientColorUpdate(safeStopIndex, hex)}
                            label={`Seletor de ${
                              safeStopIndex === 0
                                ? 'Cor 1'
                                : safeStopIndex === 1
                                ? 'Cor 2'
                                : 'Cor 3'
                            } do Gradiente`}
                            defaultColor={
                              safeStopIndex === 0
                                ? '#15803d'
                                : safeStopIndex === 1
                                ? '#166534'
                                : '#22c55e'
                            }
                            testIdPrefix={`gradient-picker-stop-${safeStopIndex + 1}`}
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
                                Clique e arraste a imagem abaixo para posicionar o enquadramento em tempo real
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
                            className="relative h-44 w-full rounded-xl border-2 border-emerald-600/40 overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none shadow-inner flex items-center justify-center"
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
                            <div className="px-3 py-1.5 rounded-full bg-black/65 text-white text-[11px] font-bold pointer-events-none flex items-center gap-1.5 backdrop-blur-xs">
                              <Move className="w-3.5 h-3.5 text-emerald-400" />
                              <span>
                                Arraste para mover ({currentBg.positionX ?? 50}% X, {currentBg.positionY ?? 50}% Y · Zoom{' '}
                                {currentBg.zoom ?? 100}%)
                              </span>
                            </div>
                          </div>

                          {/* Controles Numéricos Sincronizados: Posição X, Posição Y e Zoom */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="p-2.5 bg-white rounded-xl border border-gray-200 space-y-1">
                              <div className="flex justify-between text-[11px] font-bold text-gray-700">
                                <span>Posição X</span>
                                <span className="font-mono text-emerald-700">{currentBg.positionX ?? 50}%</span>
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
                                <span className="font-mono text-emerald-700">{currentBg.positionY ?? 50}%</span>
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
                              onChange={(e) =>
                                updateCurrentBg({ overlayOpacity: Number(e.target.value) })
                              }
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
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>
          )}

          {/* ------------------------------------------------------------- */}
          {/* SEÇÃO 5: TIPOGRAFIA                                            */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'typography' && (
            <Card className="p-5 space-y-5">
              <div className="pb-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Type className="w-4 h-4 text-emerald-700" />
                  Tipografia & Fontes Homologadas
                </h3>
                <p className="text-xs text-gray-500">
                  Alterações reais aplicadas imediatamente em títulos, descrições, preços e botões do emulador
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
                      currentFont === font.name.toLowerCase() ||
                      currentFont === font.id.toLowerCase();
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
                  <label className="text-xs font-bold text-gray-700 block mb-1.5">
                    Peso dos Títulos
                  </label>
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
                  <label className="text-xs font-bold text-gray-800">
                    Escala Geral das Letras
                  </label>
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
                  <label className="text-xs font-bold text-gray-700 block">
                    Estilo dos Títulos
                  </label>
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
                  <label className="text-xs font-bold text-gray-700 block mb-1.5">
                    Altura de Linha
                  </label>
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
          )}

          {/* ------------------------------------------------------------- */}
          {/* SEÇÃO 6: COMPONENTES & CONTROLE PRECISO DAS SOMBRAS            */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'components' && (
            <Card className="p-5 space-y-5">
              <div className="pb-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-700" />
                  Estilos de Componentes, Bordas & Sombras
                </h3>
                <p className="text-xs text-gray-500">
                  Controles independentes de arredondamento, espessura de borda e sombra dos cartões
                </p>
              </div>

              {/* Arredondamento dos Cantos (0 px a 32 px) */}
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-800">
                    Arredondamento dos Cantos
                  </label>
                  <span className="text-xs font-mono font-bold text-emerald-700">
                    {draftTokens.components.borderRadiusPx ?? 16} px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  step="1"
                  data-testid="component-border-radius-slider"
                  value={draftTokens.components.borderRadiusPx ?? 16}
                  onChange={(e) => {
                    const px = Number(e.target.value);
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
              </div>

              {/* Espessura da Borda (0 px a 4 px) */}
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-800">
                    Espessura da Borda dos Cartões
                  </label>
                  <span className="text-xs font-mono font-bold text-emerald-700">
                    {draftTokens.components.borderWidthPx ?? (draftTokens.components.cardBorder === false ? 0 : 1)} px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="4"
                  step="1"
                  data-testid="component-border-width-slider"
                  value={draftTokens.components.borderWidthPx ?? (draftTokens.components.cardBorder === false ? 0 : 1)}
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

              {/* Controle Preciso das Sombras dos Cartões */}
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-4">
                <h4 className="text-xs font-bold text-gray-900">
                  Sombra dos Cartões (Intensidade, Suavidade, Espalhamento e Cor)
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
          )}
        </div>

        {/* Lado Direito: Preview ao Vivo Sticky */}
        <div className="lg:col-span-5 sticky top-6">
          <Card className="p-4 shadow-sm border-gray-200">
            <LiveStorePreview
              theme={emulatorTheme}
              storeSlug={activeTenant.slug}
              isOpen={activeTenant.settings.isOpen}
              defaultMode="mobile"
            />
          </Card>
        </div>
      </div>

      {/* Modal de Confirmação: Restaurar Padrão Delivery Channel */}
      <Modal
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        title="Restaurar Padrão do Delivery Channel?"
      >
        <div className="space-y-4 text-xs text-gray-600">
          <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-amber-700" />
              Restauração Oficial de Fábrica
            </p>
            <p className="leading-relaxed">
              Esta ação restaura a paleta oficial verde esmeralda, tipografia Inter, fundos e componentes para o padrão
              original do Delivery Channel, sem nenhum resíduo de customizações anteriores.
            </p>
          </div>

          <p className="leading-relaxed">
            <strong>O que será preservado:</strong> O nome da loja, slogan, logotipo, fotos de capa, catálogo de produtos,
            pedidos e clientes permanecerão 100% intactos.
          </p>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsResetConfirmOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmResetDefault}
              isLoading={isSaving}
              className="bg-emerald-700 hover:bg-emerald-800"
            >
              Sim, Restaurar Padrão
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
