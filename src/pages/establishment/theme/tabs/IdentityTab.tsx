import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { ThemeImageUploader } from '../../../../components/establishment/theme/ThemeImageUploader';
import { Layers } from 'lucide-react';
import { useThemeEditorContext } from '../ThemeEditorContext';

export function IdentityTab() {
  const { activeTenant, draftTheme, setDraftTheme } = useThemeEditorContext();
  return (
    <Card className="theme-tab-card p-5 space-y-4">
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

        <div className="grid grid-cols-1 gap-5 pt-2">
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
  );
}
