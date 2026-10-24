import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../supabase', () => ({
  supabase: {},
  isSupabaseConfigured: false,
  ensureValidSession: async () => true,
}));

import {
  createDefaultThemeTokens,
  tokensToTheme,
  themeToTokens,
  formatCssBackground,
  computeCardBoxShadow,
  computeTypographyStyles,
  DEFAULT_DELIVERY_CHANNEL_THEME,
} from '../themeEngine';
import { PRESET_THEMES } from '../presetThemes';
import { LiveStorePreview } from '../../../components/establishment/theme/LiveStorePreview';
import {
  ColorPicker,
  computePointerSaturationValue,
  hexToHsv,
  hsvToHex,
} from '../../../components/ui/ColorPicker';
import { themeService } from '../../../services/themeService';
import { tenantRepository } from '../../../repositories/tenantRepository';
import { SecurityContext } from '../../../services/securityEngine';

const mockContext: SecurityContext = {
  userId: 'user-owner-1',
  userName: 'Proprietário Teste',
  userRole: 'OWNER',
  tenantId: 'tenant-111',
};

/**
 * Extrai o atributo style="..." da primeira tag HTML que contém data-testid="<testId>"
 * e converte em um objeto { propriedadeCss: valor }.
 */
function getStyleByTestId(html: string, testId: string): Record<string, string> {
  const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(`<[^>]*data-testid="${escaped}"[^>]*>`, 'i');
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) {
    throw new Error(`Elemento com data-testid="${testId}" não encontrado no HTML renderizado.`);
  }
  const styleMatch = tagMatch[0].match(/style="([^"]*)"/i);
  if (!styleMatch) return {};

  const result: Record<string, string> = {};
  for (const decl of styleMatch[1].split(';')) {
    const idx = decl.indexOf(':');
    if (idx > 0) {
      const prop = decl.slice(0, idx).trim();
      const val = decl.slice(idx + 1).trim();
      result[prop] = val;
    }
  }
  return result;
}

function getAttrByTestId(html: string, testId: string, attr: string): string | null {
  const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(`<[^>]*data-testid="${escaped}"[^>]*>`, 'i');
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) return null;
  const attrMatch = tagMatch[0].match(new RegExp(`${attr}="([^"]*)"`, 'i'));
  return attrMatch ? attrMatch[1] : null;
}

function renderPreviewWithTokens(tokens = createDefaultThemeTokens(DEFAULT_DELIVERY_CHANNEL_THEME)) {
  const theme = tokensToTheme(tokens, {
    storeName: 'Loja Isolamento Teste',
    tagline: 'Slogan de teste',
  });
  return renderToStaticMarkup(<LiveStorePreview theme={theme} isOpen={true} defaultMode="mobile" />);
}

describe('SEÇÃO 11 — Testes Obrigatórios de Independência Visual no Emulador', () => {
  it('1. Alterar Fundo dos Menus (bgMenu) modifica somente o fundo da navegação inferior', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.bgMenu = '#1e293b';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    // O fundo do menu inferior mudou
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['background-color']).toBe('#1e293b');

    // Nenhum outro elemento mudou
    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-card')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-category-btn')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-category-btn')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-search-bar')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-search-bar')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-action-button')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-action-button')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-icon-nav-home')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-icon-nav-home')['color']
    );
  });

  it('2. Alterar Botão Categoria (categoryBg) modifica somente o fundo dos botões de categoria', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.categoryBg = '#fde047';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    // O botão de categoria recebeu a nova cor
    expect(getStyleByTestId(updatedHtml, 'preview-category-btn')['background-color']).toBe('#fde047');

    // Não alterou menu inferior, cartões, barra de pesquisa ou botões de ação principal
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-bottom-menu')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-card')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-search-bar')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-search-bar')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-action-button')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-action-button')['background-color']
    );
  });

  it('3. Alterar Cor dos Ícones (iconColor) modifica somente as cores dos ícones mapeados', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.iconColor = '#e11d48';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    // Todos os ícones mapeados receberam a nova cor
    expect(getStyleByTestId(updatedHtml, 'preview-icon-clock')['color']).toBe('#e11d48');
    expect(getStyleByTestId(updatedHtml, 'preview-icon-search')['color']).toBe('#e11d48');
    expect(getStyleByTestId(updatedHtml, 'preview-icon-nav-home')['color']).toBe('#e11d48');
    expect(getStyleByTestId(updatedHtml, 'preview-icon-nav-search')['color']).toBe('#e11d48');
    expect(getStyleByTestId(updatedHtml, 'preview-icon-nav-bag')['color']).toBe('#e11d48');

    // Não alterou textos, botões ou fundos
    expect(getStyleByTestId(updatedHtml, 'preview-store-title')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-store-title')['color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-product-desc')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-desc')['color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-nav-label')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-nav-label')['color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-action-button')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-action-button')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-bottom-menu')['background-color']
    );
  });

  it('4. Alterar Fundo dos Cards (bgCard) modifica somente os cartões de produtos', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.bgCard = '#fef3c7';
    updatedTokens.backgrounds.card.color = '#fef3c7';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    // O cartão de produto mudou
    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['background-color']).toBe('#fef3c7');

    // Não alterou botões de categoria, barra de pesquisa, menu inferior, fundo geral ou cabeçalho
    expect(getStyleByTestId(updatedHtml, 'preview-category-btn')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-category-btn')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-search-bar')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-search-bar')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-bottom-menu')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-general-surface')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-general-surface')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-header')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-header')['background-color']
    );
  });

  it('5. Alterar Fundo do Cabeçalho (bgHeader) modifica somente o cabeçalho', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.bgHeader = '#dbeafe';
    updatedTokens.backgrounds.header.color = '#dbeafe';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    expect(getStyleByTestId(updatedHtml, 'preview-header')['background-color']).toBe('#dbeafe');

    expect(getStyleByTestId(updatedHtml, 'preview-general-surface')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-general-surface')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-card')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-bottom-menu')['background-color']
    );
  });

  it('6. Alterar Fundo Geral (bgGeneral) modifica somente a superfície geral definida', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.bgGeneral = '#f3e8ff';
    updatedTokens.backgrounds.general.color = '#f3e8ff';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    expect(getStyleByTestId(updatedHtml, 'preview-general-surface')['background-color']).toBe('#f3e8ff');

    expect(getStyleByTestId(updatedHtml, 'preview-header')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-header')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-card')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-bottom-menu')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-category-btn')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-category-btn')['background-color']
    );
  });

  it('7. Alterar Texto Principal (textMain) modifica efetivamente os textos associados no emulador', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.textMain = '#7c2d12';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    // A descrição dos produtos no emulador reflete imediatamente textMain
    expect(getStyleByTestId(updatedHtml, 'preview-product-desc')['color']).toBe('#7c2d12');

    // Títulos e textos secundários permanecem inalterados
    expect(getStyleByTestId(updatedHtml, 'preview-product-title')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-title')['color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-text-secondary')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-text-secondary')['color']
    );
  });

  it('8. Alterar Fundo do Botão (buttonBg) não modifica Botão Categoria (categoryBg)', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.buttonBg = '#be123c';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    expect(getStyleByTestId(updatedHtml, 'preview-action-button')['background-color']).toBe('#be123c');
    expect(getStyleByTestId(updatedHtml, 'preview-category-btn')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-category-btn')['background-color']
    );
  });

  it('9. Alterar Cor do Preço (price) não modifica Preço Promocional (promoPrice) e vice-versa', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.price = '#0369a1';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    expect(getStyleByTestId(updatedHtml, 'preview-normal-price')['color']).toBe('#0369a1');
    expect(getStyleByTestId(updatedHtml, 'preview-promo-price')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-promo-price')['color']
    );

    // Agora altera apenas promoPrice
    const promoTokens = createDefaultThemeTokens();
    promoTokens.palette.promoPrice = '#db2777';
    const promoHtml = renderPreviewWithTokens(promoTokens);

    expect(getStyleByTestId(promoHtml, 'preview-promo-price')['color']).toBe('#db2777');
    expect(getStyleByTestId(promoHtml, 'preview-normal-price')['color']).toBe(
      getStyleByTestId(baseHtml, 'preview-normal-price')['color']
    );
  });

  it('10. Alterar a cor das bordas (border) não modifica os fundos', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.palette.border = '#9333ea';
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['border-color']).toBe('#9333ea');
    expect(getStyleByTestId(updatedHtml, 'preview-header')['border-color']).toBe('#9333ea');
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['border-color']).toBe('#9333ea');

    // Fundos intactos
    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-card')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-header')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-header')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-bottom-menu')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-bottom-menu')['background-color']
    );
  });

  it('11. Alterar o overlay e enquadramento de imagem não modifica as cores dos controles independentes', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.backgrounds.general = {
      type: 'image',
      color: '#f8fafc',
      imageUrl: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=800',
      positionX: 25,
      positionY: 75,
      zoom: 140,
      overlayColor: '#1e3a8a',
      overlayOpacity: 65,
    };
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    const genStyle = getStyleByTestId(updatedHtml, 'preview-general-surface');
    expect(genStyle['background-image']).toContain('rgba(30, 58, 138, 0.65)');
    expect(genStyle['background-position']).toBe('25% 75%');
    expect(genStyle['background-size']).toBe('140%');

    // Cabeçalho, cards, botões e categorias permanecem 100% independentes
    expect(getStyleByTestId(updatedHtml, 'preview-header')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-header')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-product-card')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-product-card')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-action-button')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-action-button')['background-color']
    );
    expect(getStyleByTestId(updatedHtml, 'preview-category-btn')['background-color']).toBe(
      getStyleByTestId(baseHtml, 'preview-category-btn')['background-color']
    );
  });

  it('12. Alterar uma propriedade tipográfica não altera involuntariamente outra propriedade tipográfica', () => {
    const baseTokens = createDefaultThemeTokens();
    const baseHtml = renderPreviewWithTokens(baseTokens);

    // Altera apenas o peso, caixa alta e itálico dos títulos
    const updatedTokens = createDefaultThemeTokens();
    updatedTokens.typography.titleWeight = 'extrabold';
    updatedTokens.typography.titleUppercase = true;
    updatedTokens.typography.titleItalic = true;
    const updatedHtml = renderPreviewWithTokens(updatedTokens);

    const titleStyle = getStyleByTestId(updatedHtml, 'preview-product-title');
    const bodyStyle = getStyleByTestId(updatedHtml, 'preview-product-desc');
    const baseBodyStyle = getStyleByTestId(baseHtml, 'preview-product-desc');

    expect(titleStyle['font-weight']).toBe('800');
    expect(titleStyle['text-transform']).toBe('uppercase');
    expect(titleStyle['font-style']).toBe('italic');

    // O texto corrido (descrição) não foi afetado pelo peso, caixa alta ou itálico do título
    expect(bodyStyle['font-weight']).toBe(baseBodyStyle['font-weight']);
    expect(bodyStyle['text-transform']).toBe('none');
    expect(bodyStyle['font-style']).toBe('normal');

    // Agora altera apenas o peso do texto corrido e escala
    const bodyTokens = createDefaultThemeTokens();
    bodyTokens.typography.bodyWeight = 'semibold';
    bodyTokens.typography.scalePercent = 120;
    const bodyHtml = renderPreviewWithTokens(bodyTokens);

    expect(getStyleByTestId(bodyHtml, 'preview-product-desc')['font-weight']).toBe('600');
    expect(getStyleByTestId(bodyHtml, 'preview-product-title')['font-weight']).toBe('700');
    expect(getStyleByTestId(bodyHtml, 'preview-product-desc')['font-size']).toBe('12px');
  });

  it('13. Alterar a sombra (intensidade, desfoque, espalhamento, cor) não modifica borda, fundo ou arredondamento', () => {
    const baseTokens = createDefaultThemeTokens();
    baseTokens.components.borderRadiusPx = 18;
    baseTokens.components.borderWidthPx = 2;
    const baseHtml = renderPreviewWithTokens(baseTokens);
    const baseCard = getStyleByTestId(baseHtml, 'preview-product-card');

    // Intensidade em 0%: sombra desaparece sem apagar borda ou mudar fundo/arredondamento
    const zeroShadowTokens = createDefaultThemeTokens();
    zeroShadowTokens.components.borderRadiusPx = 18;
    zeroShadowTokens.components.borderWidthPx = 2;
    zeroShadowTokens.components.shadowIntensity = 0;
    const zeroHtml = renderPreviewWithTokens(zeroShadowTokens);
    const zeroCard = getStyleByTestId(zeroHtml, 'preview-product-card');

    expect(zeroCard['box-shadow']).toBe('none');
    expect(zeroCard['border-width']).toBe('2px');
    expect(zeroCard['border-radius']).toBe('18px');
    expect(zeroCard['background-color']).toBe(baseCard['background-color']);

    // Ajustar blur não altera a opacidade nem o arredondamento
    const customShadowTokens = createDefaultThemeTokens();
    customShadowTokens.components.borderRadiusPx = 18;
    customShadowTokens.components.borderWidthPx = 2;
    customShadowTokens.components.shadowIntensity = 35;
    customShadowTokens.components.shadowBlur = 24;
    customShadowTokens.components.shadowSpread = 4;
    customShadowTokens.components.shadowColor = '#1e40af';
    const customHtml = renderPreviewWithTokens(customShadowTokens);
    const customCard = getStyleByTestId(customHtml, 'preview-product-card');

    expect(customCard['box-shadow']).toBe('0px 8px 24px 4px rgba(30, 64, 175, 0.35)');
    expect(customCard['border-radius']).toBe('18px');
    expect(customCard['border-width']).toBe('2px');
  });

  it('14, 15 & 16. Preview de tema não sobrescreve o rascunho; Sair restaura; Aplicar transfere os valores', () => {
    // Rascunho atual customizado pelo usuário
    const draftTokens = createDefaultThemeTokens();
    draftTokens.palette.bgCard = '#fef9c3';
    draftTokens.palette.buttonBg = '#047857';
    const draftTheme = tokensToTheme(draftTokens, { storeName: 'Minha Adega' });

    // 14. Ao abrir Preview de outro tema (ex: Preto Premium), o emulador mostra o preset, mas draftTheme permanece intacto
    const presetToPreview = PRESET_THEMES.find(p => p.id === 'preto-premium')!;
    const previewEmulatorTheme = tokensToTheme(presetToPreview.tokens, { storeName: draftTheme.storeName });

    const previewHtml = renderToStaticMarkup(<LiveStorePreview theme={previewEmulatorTheme} />);
    expect(getStyleByTestId(previewHtml, 'preview-product-card')['background-color']).toBe('#18181b');
    expect(draftTheme.tokens?.palette.bgCard).toBe('#fef9c3');

    // 15. Ao sair do Preview, o emulador volta imediatamente para draftTheme
    const restoredHtml = renderToStaticMarkup(<LiveStorePreview theme={draftTheme} />);
    expect(getStyleByTestId(restoredHtml, 'preview-product-card')['background-color']).toBe('#fef9c3');
    expect(getStyleByTestId(restoredHtml, 'preview-action-button')['background-color']).toBe('#047857');

    // 16. Ao clicar em Aplicar este tema, as configurações do tema são transferidas para o rascunho
    const appliedTheme = tokensToTheme(JSON.parse(JSON.stringify(presetToPreview.tokens)), {
      storeName: draftTheme.storeName,
    });
    const appliedHtml = renderToStaticMarkup(<LiveStorePreview theme={appliedTheme} />);
    expect(appliedTheme.tokens?.palette.bgGeneral).toBe('#09090b');
    expect(getStyleByTestId(appliedHtml, 'preview-general-surface')['background-color']).toBe('#09090b');
    expect(getStyleByTestId(appliedHtml, 'preview-action-button')['background-color']).toBe('#f59e0b');
  });

  it('17. Todas as cores continuam funcionando depois de salvar, recarregar e recuperar a configuração', async () => {
    themeService.clearCache();
    vi.spyOn(tenantRepository, 'updateTheme').mockResolvedValue(undefined);

    const customTokens = createDefaultThemeTokens();
    customTokens.palette.bgMenu = '#111827';
    customTokens.palette.categoryBg = '#fef08a';
    customTokens.palette.iconColor = '#ec4899';
    customTokens.palette.bgCard = '#f8fafc';
    customTokens.palette.textMain = '#1e293b';
    customTokens.palette.buttonBg = '#7c3aed';
    customTokens.palette.price = '#059669';
    customTokens.palette.promoPrice = '#dc2626';

    const themeToSave = tokensToTheme(customTokens, {
      storeName: 'Loja Persistida',
      tagline: 'Persistência completa',
    });

    await themeService.updateTheme(mockContext, 'tenant-111', themeToSave);
    const loadedTheme = themeService.getTheme(mockContext, 'tenant-111')!;
    const recoveredTokens = themeToTokens(loadedTheme);

    expect(recoveredTokens.palette.bgMenu).toBe('#111827');
    expect(recoveredTokens.palette.categoryBg).toBe('#fef08a');
    expect(recoveredTokens.palette.iconColor).toBe('#ec4899');
    expect(recoveredTokens.palette.textMain).toBe('#1e293b');
    expect(recoveredTokens.palette.buttonBg).toBe('#7c3aed');

    const htmlAfterReload = renderToStaticMarkup(<LiveStorePreview theme={loadedTheme} />);
    expect(getStyleByTestId(htmlAfterReload, 'preview-bottom-menu')['background-color']).toBe('#111827');
    expect(getStyleByTestId(htmlAfterReload, 'preview-category-btn')['background-color']).toBe('#fef08a');
    expect(getStyleByTestId(htmlAfterReload, 'preview-icon-clock')['color']).toBe('#ec4899');
    expect(getStyleByTestId(htmlAfterReload, 'preview-product-desc')['color']).toBe('#1e293b');
    expect(getStyleByTestId(htmlAfterReload, 'preview-action-button')['background-color']).toBe('#7c3aed');
  });
});

describe('SEÇÃO 4 & 6 — Seletor de Cores (Cursor 2D nos 4 Cantos, Centro e Intermediários) e Gradientes 2/3 Cores', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };

  it('posiciona o cursor exatamente nos 4 cantos, no centro e em posições intermediárias', () => {
    // Canto superior esquerdo (Branco: S=0%, V=100% -> left=0%, top=0%)
    const topLeft = computePointerSaturationValue(100, 50, rect);
    expect(topLeft).toEqual({ s: 0, v: 100, leftPercent: 0, topPercent: 0 });
    expect(hsvToHex(0, topLeft.s, topLeft.v)).toBe('#ffffff');

    // Canto superior direito (Cor pura: S=100%, V=100% -> left=100%, top=0%)
    const topRight = computePointerSaturationValue(300, 50, rect);
    expect(topRight).toEqual({ s: 100, v: 100, leftPercent: 100, topPercent: 0 });
    expect(hsvToHex(0, topRight.s, topRight.v)).toBe('#ff0000');

    // Canto inferior esquerdo (Preto: S=0%, V=0% -> left=0%, top=100%)
    const bottomLeft = computePointerSaturationValue(100, 150, rect);
    expect(bottomLeft).toEqual({ s: 0, v: 0, leftPercent: 0, topPercent: 100 });
    expect(hsvToHex(0, bottomLeft.s, bottomLeft.v)).toBe('#000000');

    // Canto inferior direito (Preto: S=100%, V=0% -> left=100%, top=100%)
    const bottomRight = computePointerSaturationValue(300, 150, rect);
    expect(bottomRight).toEqual({ s: 100, v: 0, leftPercent: 100, topPercent: 100 });
    expect(hsvToHex(0, bottomRight.s, bottomRight.v)).toBe('#000000');

    // Centro exato (S=50%, V=50% -> left=50%, top=50%)
    const center = computePointerSaturationValue(200, 100, rect);
    expect(center).toEqual({ s: 50, v: 50, leftPercent: 50, topPercent: 50 });

    // Posição intermediária (25% X, 75% Y -> S=25%, V=25%, left=25%, top=75%)
    const intermediate = computePointerSaturationValue(150, 125, rect);
    expect(intermediate).toEqual({ s: 25, v: 25, leftPercent: 25, topPercent: 75 });
  });

  it('sincroniza a posição gráfica do cursor com a cor hexadecimal selecionada', () => {
    const redHtml = renderToStaticMarkup(
      <ColorPicker color="#ff0000" onChange={() => {}} testIdPrefix="test-picker" />
    );
    expect(getAttrByTestId(redHtml, 'test-picker-cursor', 'data-left')).toBe('100');
    expect(getAttrByTestId(redHtml, 'test-picker-cursor', 'data-top')).toBe('0');

    const whiteHtml = renderToStaticMarkup(
      <ColorPicker color="#ffffff" onChange={() => {}} testIdPrefix="test-picker" />
    );
    expect(getAttrByTestId(whiteHtml, 'test-picker-cursor', 'data-left')).toBe('0');
    expect(getAttrByTestId(whiteHtml, 'test-picker-cursor', 'data-top')).toBe('0');

    const blackHtml = renderToStaticMarkup(
      <ColorPicker color="#000000" onChange={() => {}} testIdPrefix="test-picker" />
    );
    expect(getAttrByTestId(blackHtml, 'test-picker-cursor', 'data-top')).toBe('100');
  });

  it('aplica gradiente de 2 cores como padrão e inclui a 3ª cor somente quando o modo de 3 cores está ativo', () => {
    // Modo 2 cores (mesmo com 3 cores salvas no array para preservação)
    const twoStopsCss = formatCssBackground({
      type: 'gradient-linear',
      color: '#15803d',
      gradientStops: 2,
      gradientColors: ['#15803d', '#166534', '#f59e0b'],
      angle: 135,
    });
    expect(twoStopsCss).toBe('linear-gradient(135deg, #15803d, #166534)');
    expect(twoStopsCss).not.toContain('#f59e0b');

    // Modo 3 cores ativo
    const threeStopsCss = formatCssBackground({
      type: 'gradient-linear',
      color: '#15803d',
      gradientStops: 3,
      gradientColors: ['#15803d', '#166534', '#f59e0b'],
      angle: 135,
    });
    expect(threeStopsCss).toBe('linear-gradient(135deg, #15803d, #166534, #f59e0b)');
  });

  it('calcula estilos tipográficos e sombras de componentes de forma determinística e independente', () => {
    const typoA = computeTypographyStyles({
      fontFamily: 'Playfair Display',
      titleWeight: 'extrabold',
      bodyWeight: 'normal',
      scale: 'spacious',
      scalePercent: 115,
      titleUppercase: true,
      titleItalic: true,
      letterSpacing: 'wide',
      lineHeight: 'relaxed',
    });

    expect(typoA.cssFont).toContain('Playfair Display');
    expect(typoA.titleWeight).toBe(800);
    expect(typoA.bodyWeight).toBe(400);
    expect(typoA.scaleFactor).toBe(1.15);
    expect(typoA.titleTextTransform).toBe('uppercase');
    expect(typoA.titleFontStyle).toBe('italic');
    expect(typoA.letterSpacing).toBe('0.05em');
    expect(typoA.lineHeight).toBe('1.65');

    const shadowNone = computeCardBoxShadow({
      borderRadius: '16px',
      cardRadius: '16px',
      buttonRadius: '16px',
      cardShadow: 'none',
      buttonShadow: 'none',
      shadowIntensity: 0,
      shadowBlur: 20,
      shadowSpread: 5,
      shadowColor: '#000000',
      cardBorder: true,
      headerStyle: 'solid',
      categoryStyle: 'solid',
    });
    expect(shadowNone).toBe('none');
  });
});

