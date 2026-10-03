import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { themeService } from '../../services/themeService';
import { MobileSimulator } from '../../components/common/MobileSimulator';
import { ColorPicker } from '../../components/ui/ColorPicker';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { TenantTheme } from '../../types';
import { Sparkles, Save, RotateCcw, Smartphone, Check, Palette } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const ThemePage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();

  if (!activeTenant) return null;

  const currentTheme = activeTenant.theme;

  // Local draft state for real-time live preview
  const [draftTheme, setDraftTheme] = useState<TenantTheme>({
    ...currentTheme,
    buttonColor: currentTheme.buttonColor || currentTheme.primaryColor,
    fontFamily: currentTheme.fontFamily || 'Inter',
  });

  const [activeColorTarget, setActiveColorTarget] = useState<'primary' | 'secondary' | 'background' | 'card' | 'button' | 'text'>('primary');
  const [isSaving, setIsSaving] = useState(false);

  const handleApply = () => {
    setIsSaving(true);
    try {
      themeService.updateTheme(securityContext, activeTenant.id, draftTheme);
      showToast({
        type: 'success',
        title: 'Tema Aplicado & Persistido',
        message: 'A identidade visual foi salva no banco de dados e sincronizada com o app do cliente.',
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Salvar Tema',
        message: err.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefault = () => {
    const defaultTheme: TenantTheme = {
      primaryColor: '#15803d',
      secondaryColor: '#166534',
      backgroundColor: '#f8fafc',
      cardColor: '#ffffff',
      buttonColor: '#15803d',
      textColor: '#0f172a',
      borderRadius: '1rem',
      fontFamily: 'Inter',
      storeName: activeTenant.name,
      tagline: 'Seu canal de compras direto e exclusivo.',
      logoUrl: activeTenant.theme.logoUrl,
      bannerUrl: activeTenant.theme.bannerUrl,
    };
    setDraftTheme(defaultTheme);
    showToast({
      type: 'info',
      title: 'Valores Restaurados',
      message: 'Padrão Adega Clean restaurado no preview. Clique em "Aplicar" para salvar.',
    });
  };

  const getTargetColor = () => {
    switch (activeColorTarget) {
      case 'primary': return draftTheme.primaryColor;
      case 'secondary': return draftTheme.secondaryColor;
      case 'background': return draftTheme.backgroundColor;
      case 'card': return draftTheme.cardColor;
      case 'button': return draftTheme.buttonColor || draftTheme.primaryColor;
      case 'text': return draftTheme.textColor;
    }
  };

  const setTargetColor = (color: string) => {
    switch (activeColorTarget) {
      case 'primary':
        setDraftTheme(prev => ({ ...prev, primaryColor: color }));
        break;
      case 'secondary':
        setDraftTheme(prev => ({ ...prev, secondaryColor: color }));
        break;
      case 'background':
        setDraftTheme(prev => ({ ...prev, backgroundColor: color }));
        break;
      case 'card':
        setDraftTheme(prev => ({ ...prev, cardColor: color }));
        break;
      case 'button':
        setDraftTheme(prev => ({ ...prev, buttonColor: color }));
        break;
      case 'text':
        setDraftTheme(prev => ({ ...prev, textColor: color }));
        break;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Meu Aplicativo & Identidade Visual</h2>
          <p className="text-xs text-gray-500">
            Personalize cores, tipografia, bordas e logotipo com simulação em tempo real
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetDefault}
            leftIcon={<RotateCcw className="w-4 h-4 text-gray-500" />}
            className="text-xs"
          >
            Restaurar Padrão
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleApply}
            isLoading={isSaving}
            leftIcon={<Save className="w-4 h-4" />}
            className="text-xs bg-emerald-700 hover:bg-emerald-800 shadow-xs"
          >
            Aplicar Alterações
          </Button>
        </div>
      </div>

      {/* Grid: Editor controls on left, Mobile Simulator on right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Theme Configuration Panel */}
        <div className="lg:col-span-7 space-y-5">
          {/* Brand & Slogan */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 pb-2 border-b border-gray-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-700" />
              Identidade da Marca & Logotipo
            </h3>

            <div className="space-y-3">
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
                placeholder="Ex: Bebidas nobres e geladas entregues em minutos"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="URL do Logotipo (Ícone Redondo)"
                  value={draftTheme.logoUrl || ''}
                  onChange={(e) => setDraftTheme({ ...draftTheme, logoUrl: e.target.value })}
                  placeholder="https://..."
                />
                <Input
                  label="URL do Banner Superior"
                  value={draftTheme.bannerUrl || ''}
                  onChange={(e) => setDraftTheme({ ...draftTheme, bannerUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>
          </Card>

          {/* Color Palette Manager & Professional ColorPicker */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 pb-2 border-b border-gray-100 flex items-center gap-2">
              <Palette className="w-4 h-4 text-emerald-700" />
              Paleta de Cores do Aplicativo
            </h3>

            {/* Target Selector Tabs */}
            <div className="flex flex-wrap gap-1.5 p-1 bg-gray-100 rounded-xl">
              {[
                { id: 'primary', label: 'Cor Principal', hex: draftTheme.primaryColor },
                { id: 'secondary', label: 'Secundária', hex: draftTheme.secondaryColor },
                { id: 'button', label: 'Botões', hex: draftTheme.buttonColor || draftTheme.primaryColor },
                { id: 'background', label: 'Fundo da Tela', hex: draftTheme.backgroundColor },
                { id: 'card', label: 'Superfície Cards', hex: draftTheme.cardColor },
                { id: 'text', label: 'Texto Principal', hex: draftTheme.textColor },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveColorTarget(item.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeColorTarget === item.id
                      ? 'bg-white text-gray-900 shadow-2xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0"
                    style={{ backgroundColor: item.hex }}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {/* Embed ColorPicker */}
            <div className="pt-2">
              <ColorPicker
                color={getTargetColor()}
                onChange={setTargetColor}
                onApply={handleApply}
                onResetDefault={handleResetDefault}
                defaultColor="#15803d"
                label={`Ajustando: ${
                  activeColorTarget === 'primary' ? 'Cor Primária (Header, Destaques)' :
                  activeColorTarget === 'secondary' ? 'Cor Secundária (Acentos, Badges)' :
                  activeColorTarget === 'button' ? 'Botões de Ação (Comprar, Adicionar)' :
                  activeColorTarget === 'background' ? 'Fundo da Tela' :
                  activeColorTarget === 'card' ? 'Superfície dos Cards' : 'Texto Principal'
                }`}
              />
            </div>
          </Card>

          {/* Typography & Border Radius */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 pb-2 border-b border-gray-100">
              Estilo dos Componentes & Tipografia
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-gray-700 block text-xs mb-1">
                  Arredondamento dos Cantos (Border Radius)
                </label>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  {[
                    { label: 'Reto (0.375rem)', value: '0.375rem' },
                    { label: 'Suave (0.75rem)', value: '0.75rem' },
                    { label: 'Padrão (1rem)', value: '1rem' },
                    { label: 'Pílula (1.5rem)', value: '1.5rem' },
                  ].map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setDraftTheme({ ...draftTheme, borderRadius: r.value })}
                      className={`p-2.5 rounded-xl border font-semibold text-center cursor-pointer transition-all ${
                        draftTheme.borderRadius === r.value
                          ? 'border-emerald-700 bg-emerald-50 text-emerald-900 font-bold'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {r.label.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-semibold text-gray-700 block text-xs mb-1">
                  Fonte Principal do Aplicativo
                </label>
                <select
                  value={draftTheme.fontFamily || 'Inter'}
                  onChange={(e) => setDraftTheme({ ...draftTheme, fontFamily: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
                >
                  <option value="Inter">Inter (Moderna & Clean)</option>
                  <option value="system-ui">Sistema Nativo iOS/Android</option>
                  <option value="Plus Jakarta Sans">Plus Jakarta Sans (Premium)</option>
                  <option value="Outfit">Outfit (Arrojada)</option>
                </select>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Side: Sticky Live Mobile Simulator */}
        <div className="lg:col-span-5 sticky top-6">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-700" />
              Simulador em Tempo Real
            </span>
            <span className="text-[11px] text-gray-400">
              iPhone 15 Pro • 390 × 844 px
            </span>
          </div>

          <MobileSimulator
            theme={draftTheme}
            storeSlug={activeTenant.slug}
            isOpen={activeTenant.settings.isOpen}
          />
        </div>
      </div>
    </div>
  );
};
