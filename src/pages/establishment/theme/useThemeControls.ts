import { useState, useRef, useEffect, useCallback } from 'react';
import { ThemePalette, ThemeTokens, BackgroundStyleConfig } from '../../../types/theme';
import { normalizeHexColor, validateHexColor } from '../../../lib/theme/themeEngine';
type PaletteTarget = keyof ThemePalette;
export function useThemeControls(
  draftTokens: ThemeTokens,
  updateTokens: (fn: (tokens: ThemeTokens) => ThemeTokens) => void
) {
  const [activeColorTarget, setActiveColorTarget] = useState<PaletteTarget>('primary');
  const [hexInputError, setHexInputError] = useState<string | null>(null);
  const [activeBgTarget, setActiveBgTarget] = useState<'general' | 'header' | 'card'>('general');
  const [activeGradientStopIndex, setActiveGradientStopIndex] = useState(0);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const isDraggingImageRef = useRef(false);
  const dragStartRef = useRef({ clientX: 0, clientY: 0, startX: 50, startY: 50 });
  // Paleta de cores: lista de alvos configuráveis 100% independentes
  const paletteTargets: Array<{ id: PaletteTarget; label: string; group: string; desc: string }> = [
    {
      id: 'bgCard',
      label: 'Fundo dos Cards',
      group: 'Superfícies',
      desc: 'Controla somente o fundo dos cartões de produtos',
    },
    {
      id: 'bgMenu',
      label: 'Fundo dos Menus',
      group: 'Superfícies',
      desc: 'Controla exclusivamente o fundo da barra de navegação inferior',
    },
    {
      id: 'categoryBg',
      label: 'Botão Categoria',
      group: 'Superfícies',
      desc: 'Controla exclusivamente o fundo dos botões de categorias',
    },
    {
      id: 'iconColor',
      label: 'Cor dos Ícones',
      group: 'Ícones',
      desc: 'Ícones do menu inferior, lupa da pesquisa e relógio de entrega',
    },
    {
      id: 'bgHeader',
      label: 'Fundo do Cabeçalho',
      group: 'Superfícies',
      desc: 'Controla exclusivamente o fundo do cabeçalho da loja',
    },
    {
      id: 'bgGeneral',
      label: 'Fundo Geral',
      group: 'Superfícies',
      desc: 'Controla exclusivamente a superfície de fundo geral da tela',
    },
    {
      id: 'textTitle',
      label: 'Título Principal',
      group: 'Textos',
      desc: 'Nome da loja e títulos dos produtos',
    },
    {
      id: 'textMain',
      label: 'Texto Principal',
      group: 'Textos',
      desc: 'Descrições de produtos e textos corridos principais',
    },
    {
      id: 'textSecondary',
      label: 'Texto Secundário',
      group: 'Textos',
      desc: 'Metadados, horários, status e textos auxiliares',
    },
    {
      id: 'buttonBg',
      label: 'Fundo do Botão',
      group: 'Botões',
      desc: 'Fundo dos botões de ação principal (Adicionar, Sacola)',
    },
    {
      id: 'buttonText',
      label: 'Texto do Botão',
      group: 'Botões',
      desc: 'Cor do texto e conteúdo interno dos botões de ação',
    },
    {
      id: 'price',
      label: 'Cor do Preço',
      group: 'Preços',
      desc: 'Preço normal dos produtos sem promoção',
    },
    {
      id: 'promoPrice',
      label: 'Preço Promocional',
      group: 'Preços',
      desc: 'Preço promocional exibido nos produtos em oferta',
    },
    {
      id: 'accent',
      label: 'Destaque / Acento',
      group: 'Marca',
      desc: 'Selos e etiquetas de destaque visual (Oferta, Mais Vendido)',
    },
    {
      id: 'border',
      label: 'Cor das Bordas',
      group: 'Linhas',
      desc: 'Contornos e divisórias de cartões, cabeçalho e busca',
    },
    {
      id: 'primary',
      label: 'Cor Principal',
      group: 'Marca',
      desc: 'Cor institucional do banner principal e avatar da marca',
    },
    {
      id: 'secondary',
      label: 'Cor Secundária',
      group: 'Marca',
      desc: 'Detalhe complementar no banner institucional',
    },
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
    (surface: 'general' | 'header' | 'card', updates: Partial<BackgroundStyleConfig>) => {
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

  return {
    activeColorTarget,
    setActiveColorTarget,
    hexInputError,
    activeBgTarget,
    setActiveBgTarget,
    activeGradientStopIndex,
    setActiveGradientStopIndex,
    imageFrameRef,
    isDraggingImageRef,
    dragStartRef,
    paletteTargets,
    currentTargetColor,
    handleColorChange,
    updateSurfaceBackground,
  };
}
