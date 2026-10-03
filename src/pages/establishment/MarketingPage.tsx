import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { QRCodeCard } from '../../components/common/QRCodeCard';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Sparkles, QrCode, MessageCircle, Instagram } from 'lucide-react';
import { getPublicStoreUrl, isValidStoreSlug } from '../../utils/publicStoreUrl';

export const MarketingPage: React.FC = () => {
  const { activeTenant } = useAuth();
  if (!activeTenant) return null;

  const isSlugValid = isValidStoreSlug(activeTenant.slug);
  const storeUrl = isSlugValid ? getPublicStoreUrl(activeTenant.slug) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Marketing & Aquisição de Clientes</h2>
        <p className="text-xs text-gray-500">
          Transforme compradores de canais intermediários em clientes recorrentes do seu próprio aplicativo
        </p>
      </div>

      {/* Main QR Code Generator & Downloader */}
      <QRCodeCard
        slug={activeTenant.slug}
        storeName={activeTenant.name}
        primaryColor={activeTenant.theme.primaryColor}
        onOpenApp={storeUrl ? () => window.open(storeUrl, '_blank') : undefined}
      />

      {/* Strategies and Actionable Guides */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <QrCode className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-bold text-gray-900">1. Adesivo de Embalagem & Sacola</h4>
          <p className="text-xs text-gray-600 leading-relaxed">
            Ao despachar qualquer pedido feito pelo iFood/Rappi, cole um adesivo: <em>"Gostou? No nosso app próprio você tem cupom de 15% OFF e entrega mais rápida!"</em>
          </p>
          <div className="pt-2">
            <Badge variant="brand" size="sm">Estratégia nº 1 de Conversão</Badge>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <MessageCircle className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-bold text-gray-900">2. Link na Bio & WhatsApp</h4>
          <p className="text-xs text-gray-600 leading-relaxed">
            Configure seu WhatsApp Business para responder automaticamente com o link do seu Web App oficial:{' '}
            <strong className="font-mono text-emerald-850">
              {isSlugValid ? `/app/${activeTenant.slug}` : 'aguardando sincronização...'}
            </strong>.
          </p>
          <div className="pt-2">
            <Badge variant="success" size="sm">Zero Taxas de Intermediação</Badge>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center">
            <Instagram className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-bold text-gray-900">3. Stories com Ofertas do Dia</h4>
          <p className="text-xs text-gray-600 leading-relaxed">
            Divulgue as promoções cadastradas no carrossel de ofertas nos seus stories com o sticker de link direto para a compra.
          </p>
          <div className="pt-2">
            <Badge variant="info" size="sm">Alcance Orgânico</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
};
