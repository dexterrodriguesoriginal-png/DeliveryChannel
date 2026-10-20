import React, { useState, useMemo } from 'react';
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
} from '../../types/theme';
import {
  themeToTokens,
  tokensToTheme,
  validateHexColor,
  normalizeHexColor,
  validateWcagContrast,
  SAFE_FONT_FAMILIES,
  DEFAULT_DELIVERY_CHANNEL_THEME,
  safeImageUrl,
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
  SlidersHorizontal,
  ChevronRight,
  ShieldCheck,
  Eye,
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

  // Tokens derivados do rascunho
  const draftTokens = useMemo(() => themeToTokens(draftTheme), [draftTheme]);

  // Tab ativa do editor
  const [activeTab, setActiveTab] = useState<EditorTab>('presets');

  // Alvo de cor selecionado na tab de paleta
  const [activeColorTarget, setActiveColorTarget] = useState<PaletteTarget>('primary');
  const [hexInputError, setHexInputError] = useState<string | null>(null);

  // Alvo de fundo selecionado na tab de fundos
  const [activeBgTarget, setActiveBgTarget] = useState<'general' | 'header' | 'card'>('general');

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
  const updateTokens = (fn: (prevTokens: ThemeTokens) => ThemeTokens) => {
    const nextTokens = fn(draftTokens);
    const synchronizedTheme = tokensToTheme(nextTokens, {
      storeName: draftTheme.storeName,
      tagline: draftTheme.tagline,
      logoUrl: draftTheme.logoUrl,
      bannerUrl: draftTheme.bannerUrl,
    });
    setDraftTheme(synchronizedTheme);
  };

  // Aplica um dos 20 Temas Prontos no Rascunho
  const handleApplyPreset = (presetTokens: ThemeTokens) => {
    updateTokens(() => presetTokens);
    showToast({
      type: 'info',
      title: 'Tema Aplicado ao Rascunho',
      message: 'Revise os detalhes no preview e clique em "Salvar como padrão" quando desejar publicar.',
    });
  };

  // Salvar como padrão da minha loja
  const handleSaveStoreDefault = async () => {
    // 1. Validação de nome
    if (!draftTheme.storeName?.trim()) {
      showToast({
        type: 'error',
        title: 'Nome Obrigatório',
        message: 'Por favor, informe o nome comercial do estabelecimento.',
      });
      return;
    }

    // 2. Validação de Cores Hex da Paleta
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
      // 3. Sanitização de URLs de imagens com safeImageUrl
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

      // Salva no backend / Supabase
      const saved = await themeService.updateTheme(securityContext, activeTenant.id, sanitizedTheme);

      // Atualiza o estado da aplicação no AuthContext e o rascunho
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

  // Paleta de cores: lista de alvos configuráveis
  const paletteTargets: Array<{ id: PaletteTarget; label: string; group: string; desc: string }> = [
    { id: 'primary', label: 'Cor Principal', group: 'Marca', desc: 'Destaques principais, badges ativas e elementos de topo' },
    { id: 'secondary', label: 'Cor Secundária', group: 'Marca', desc: 'Acentos secundários e detalhes complementares' },
    { id: 'accent', label: 'Destaque / Acento', group: 'Marca', desc: 'Badges de oferta e acentos luminosos' },
    { id: 'bgGeneral', label: 'Fundo Geral', group: 'Superfícies', desc: 'Fundo da tela de todo o aplicativo' },
    { id: 'bgHeader', label: 'Fundo Cabeçalho', group: 'Superfícies', desc: 'Barra superior com logotipo e nome da loja' },
    { id: 'bgCard', label: 'Fundo dos Cards', group: 'Superfícies', desc: 'Superfície dos cards de produtos e blocos de conteúdo' },
    { id: 'bgMenu', label: 'Fundo dos Menus', group: 'Superfícies', desc: 'Barra de navegação inferior e menus retráteis' },
    { id: 'textTitle', label: 'Título Principal', group: 'Textos', desc: 'Nome dos produtos, títulos de seções e do cabeçalho' },
    { id: 'textMain', label: 'Texto Principal', group: 'Textos', desc: 'Descrições de produtos e texto de leitura corrente' },
    { id: 'textSecondary', label: 'Texto Secundário', group: 'Textos', desc: 'Metadados, tempos de entrega e legendas' },
    { id: 'buttonBg', label: 'Fundo do Botão', group: 'Botões', desc: 'Botões de compra, adicionar e ações de finalização' },
    { id: 'buttonText', label: 'Texto do Botão', group: 'Botões', desc: 'Rótulo em texto dos botões de ação' },
    { id: 'price', label: 'Cor do Preço', group: 'Preços', desc: 'Valor padrão de venda do item no cardápio' },
    { id: 'promoPrice', label: 'Preço Promocional', group: 'Preços', desc: 'Destaque de desconto e valores promocionais' },
    { id: 'border', label: 'Cor das Bordas', group: 'Linhas', desc: 'Linhas divisórias, contornos de cards e campos' },
  ];

  const currentTargetColor = draftTokens.palette[activeColorTarget] || '#15803d';

  const handleColorChange = (hex: string) => {
    if (!validateHexColor(hex)) {
      setHexInputError('Código HEX inválido');
      return;
    }
    setHexInputError(null);
    const normalized = normalizeHexColor(hex);
    updateTokens(prev => ({
      ...prev,
      palette: {
        ...prev.palette,
        [activeColorTarget]: normalized,
      },
    }));
  };

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
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
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
                    Aplique qualquer tema com 1 clique e personalize cada detalhe nas abas seguintes
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[580px] overflow-y-auto pr-1">
                {PRESET_THEMES.map(preset => {
                  const p = preset.tokens.palette;
                  return (
                    <div
                      key={preset.id}
                      className="p-3.5 rounded-xl border border-gray-200 bg-white hover:border-emerald-600 transition-all flex flex-col justify-between gap-3 shadow-2xs group cursor-pointer"
                      onClick={() => handleApplyPreset(preset.tokens)}
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

                      <div className="space-y-2">
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

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApplyPreset(preset.tokens);
                          }}
                          className="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-gray-50 hover:bg-emerald-50 text-gray-700 hover:text-emerald-800 border border-gray-200 hover:border-emerald-300 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Aplicar este tema</span>
                        </button>
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
                    Ajuste cada ponto de cor do app com feedback visual e conformidade WCAG AA
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
                      Ajustando: {paletteTargets.find(t => t.id === activeColorTarget)?.label}
                    </h4>
                    <p className="text-[11px] text-gray-500">
                      {paletteTargets.find(t => t.id === activeColorTarget)?.desc}
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
                    label={`Cor Hexadecimal de ${paletteTargets.find(t => t.id === activeColorTarget)?.label}`}
                    defaultColor="#15803d"
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
                  Configure fundos sólidos, gradientes com ângulo e imagens com camada de sobreposição
                </p>
              </div>

              {/* Seletor de Fundo: Geral, Cabeçalho ou Cartões */}
              <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
                {[
                  { id: 'general', label: 'Fundo Geral da Tela' },
                  { id: 'header', label: 'Fundo do Cabeçalho' },
                  { id: 'card', label: 'Fundo dos Cartões' },
                ].map(bg => (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() => setActiveBgTarget(bg.id as any)}
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

              {/* Configuração do fundo selecionado */}
              {(() => {
                const currentBg = draftTokens.backgrounds[activeBgTarget];
                const updateCurrentBg = (updates: Partial<BackgroundStyleConfig>) => {
                  updateTokens(prev => ({
                    ...prev,
                    backgrounds: {
                      ...prev.backgrounds,
                      [activeBgTarget]: {
                        ...prev.backgrounds[activeBgTarget],
                        ...updates,
                      },
                    },
                  }));
                };

                return (
                  <div className="space-y-4">
                    {/* Seletor de Tipo de Fundo */}
                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1.5">
                        Tipo de Fundo
                      </label>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { id: 'solid', label: 'Sólido' },
                          { id: 'gradient-linear', label: 'Gradiente Linear' },
                          { id: 'gradient-radial', label: 'Gradiente Radial' },
                          { id: 'image', label: 'Imagem + Overlay' },
                        ].map(type => (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => updateCurrentBg({ type: type.id as any })}
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

                    {/* Controles para Sólido */}
                    {currentBg.type === 'solid' && (
                      <div className="space-y-2">
                        <Input
                          label="Cor Sólida (HEX)"
                          value={currentBg.color}
                          onChange={(e) => updateCurrentBg({ color: e.target.value })}
                          placeholder="#ffffff"
                        />
                      </div>
                    )}

                    {/* Controles para Gradiente Linear */}
                    {currentBg.type === 'gradient-linear' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label="Cor Inicial do Gradiente"
                            value={currentBg.gradientColors?.[0] || currentBg.color}
                            onChange={(e) =>
                              updateCurrentBg({
                                gradientColors: [
                                  e.target.value,
                                  currentBg.gradientColors?.[1] || '#166534',
                                ],
                              })
                            }
                            placeholder="#15803d"
                          />
                          <Input
                            label="Cor Final do Gradiente"
                            value={currentBg.gradientColors?.[1] || '#166534'}
                            onChange={(e) =>
                              updateCurrentBg({
                                gradientColors: [
                                  currentBg.gradientColors?.[0] || '#15803d',
                                  e.target.value,
                                ],
                              })
                            }
                            placeholder="#166534"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-gray-700 block mb-1">
                            Ângulo do Gradiente: {currentBg.angle ?? 135}°
                          </label>
                          <div className="flex items-center gap-2">
                            {[0, 45, 90, 135, 180, 270].map(angle => (
                              <button
                                key={angle}
                                type="button"
                                onClick={() => updateCurrentBg({ angle })}
                                className={`px-2.5 py-1 text-xs rounded-lg border font-mono font-semibold cursor-pointer ${
                                  (currentBg.angle ?? 135) === angle
                                    ? 'bg-emerald-700 text-white border-emerald-700'
                                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {angle}°
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Controles para Gradiente Radial */}
                    {currentBg.type === 'gradient-radial' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          label="Cor Central"
                          value={currentBg.gradientColors?.[0] || '#15803d'}
                          onChange={(e) =>
                            updateCurrentBg({
                              gradientColors: [
                                e.target.value,
                                currentBg.gradientColors?.[1] || '#166534',
                              ],
                            })
                          }
                          placeholder="#15803d"
                        />
                        <Input
                          label="Cor Externa"
                          value={currentBg.gradientColors?.[1] || '#166534'}
                          onChange={(e) =>
                            updateCurrentBg({
                              gradientColors: [
                                currentBg.gradientColors?.[0] || '#15803d',
                                e.target.value,
                              ],
                            })
                          }
                          placeholder="#166534"
                        />
                      </div>
                    )}

                    {/* Controles para Imagem com Camada de Sobreposição */}
                    {currentBg.type === 'image' && (
                      <div className="space-y-3">
                        <ThemeImageUploader
                          tenantId={activeTenant.id}
                          imageType="background"
                          label={`Imagem de Fundo (${
                            activeBgTarget === 'general'
                              ? 'Geral da Tela'
                              : activeBgTarget === 'header'
                              ? 'Cabeçalho'
                              : 'Superfície dos Cartões'
                          })`}
                          value={currentBg.imageUrl || ''}
                          onChange={(url) => updateCurrentBg({ imageUrl: url })}
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label="Cor da Camada de Sobreposição (Overlay)"
                            value={currentBg.overlayColor || '#000000'}
                            onChange={(e) => updateCurrentBg({ overlayColor: e.target.value })}
                            placeholder="#000000"
                          />

                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">
                              Intensidade do Overlay: {currentBg.overlayOpacity ?? 40}%
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={currentBg.overlayOpacity ?? 40}
                              onChange={(e) => updateCurrentBg({ overlayOpacity: Number(e.target.value) })}
                              className="w-full accent-emerald-700 cursor-pointer"
                            />
                          </div>
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
                  Lista fechada de fontes estáveis, pesos e escala legível
                </p>
              </div>

              {/* Seleção de Fonte */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-700 block">
                  Família Tipográfica Principal
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {SAFE_FONT_FAMILIES.map(font => {
                    const isSelected = draftTokens.typography.fontFamily.toLowerCase() === font.name.toLowerCase();
                    return (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => {
                          updateTokens(prev => ({
                            ...prev,
                            typography: { ...prev.typography, fontFamily: font.name },
                          }));
                          setDraftTheme(prev => ({ ...prev, fontFamily: font.name }));
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-2xs'
                            : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{font.name}</span>
                          <span className="text-[10px] text-gray-400 uppercase font-mono">{font.category}</span>
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

              {/* Pesos e Escala */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5">
                    Peso dos Títulos
                  </label>
                  <select
                    value={draftTokens.typography.titleWeight}
                    onChange={(e) =>
                      updateTokens(prev => ({
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
                    Peso do Texto Corrente
                  </label>
                  <select
                    value={draftTokens.typography.bodyWeight}
                    onChange={(e) =>
                      updateTokens(prev => ({
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
            </Card>
          )}

          {/* ------------------------------------------------------------- */}
          {/* SEÇÃO 6: COMPONENTES                                           */}
          {/* ------------------------------------------------------------- */}
          {activeTab === 'components' && (
            <Card className="p-5 space-y-5">
              <div className="pb-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-700" />
                  Estilos de Componentes & Formas
                </h3>
                <p className="text-xs text-gray-500">
                  Arredondamento de bordas, elevação e comportamento de cards, botões e categorias
                </p>
              </div>

              {/* Arredondamento Geral */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-700 block">
                  Arredondamento dos Cantos (Border Radius)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: 'Reto', value: '0.25rem' },
                    { label: 'Suave', value: '0.5rem' },
                    { label: 'Padrão', value: '0.75rem' },
                    { label: 'Conforto', value: '1rem' },
                    { label: 'Pílula', value: '1.5rem' },
                  ].map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => {
                        updateTokens(prev => ({
                          ...prev,
                          components: {
                            ...prev.components,
                            borderRadius: r.value,
                            cardRadius: r.value,
                            buttonRadius: r.value === '1.5rem' ? '1.5rem' : r.value,
                          },
                        }));
                        setDraftTheme(prev => ({ ...prev, borderRadius: r.value }));
                      }}
                      className={`p-2.5 rounded-xl border text-center text-xs font-bold cursor-pointer transition-all ${
                        draftTokens.components.borderRadius === r.value
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sombras dos Cards e Botões */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5">
                    Elevação / Sombra dos Cards
                  </label>
                  <select
                    value={draftTokens.components.cardShadow}
                    onChange={(e) =>
                      updateTokens(prev => ({
                        ...prev,
                        components: { ...prev.components, cardShadow: e.target.value as any },
                      }))
                    }
                    className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
                  >
                    <option value="none">Nenhuma (Flat)</option>
                    <option value="sm">Sutil (Padrão)</option>
                    <option value="md">Média (Flutuante)</option>
                    <option value="lg">Marcante (Profunda)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5">
                    Estilo das Guias de Categoria
                  </label>
                  <select
                    value={draftTokens.components.categoryStyle}
                    onChange={(e) =>
                      updateTokens(prev => ({
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
              </div>
            </Card>
          )}
        </div>

        {/* Lado Direito: Preview ao Vivo Sticky */}
        <div className="lg:col-span-5 sticky top-6">
          <Card className="p-4 shadow-sm border-gray-200">
            <LiveStorePreview
              theme={draftTheme}
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
