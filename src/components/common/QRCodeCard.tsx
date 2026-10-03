import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { QrCode, Copy, Check, Download, Share2, ExternalLink, Sparkles, AlertCircle } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { QRCodeSVG } from 'qrcode.react';
import { getPublicStoreUrl, isValidStoreSlug } from '../../utils/publicStoreUrl';

export interface QRCodeCardProps {
  slug: string;
  storeName: string;
  primaryColor?: string;
  onOpenApp?: () => void;
}

export const QRCodeCard: React.FC<QRCodeCardProps> = ({
  slug,
  storeName,
  primaryColor = '#15803d',
  onOpenApp,
}) => {
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const isSlugValid = isValidStoreSlug(slug);

  if (!isSlugValid) {
    return (
      <Card className="p-6 bg-amber-50/60 border border-amber-200">
        <div className="flex items-center gap-3 text-amber-850">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
          <div>
            <h4 className="font-bold text-sm">Carregando identificador do estabelecimento...</h4>
            <p className="text-xs text-amber-700 mt-0.5">
              O link público e o QR Code oficial serão gerados automaticamente assim que as permissões do estabelecimento forem sincronizadas.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const publicUrl = getPublicStoreUrl(slug);
  const cleanSlug = slug.trim().toLowerCase();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    showToast({
      type: 'success',
      title: 'Link copiado!',
      message: 'O link do aplicativo foi copiado para a área de transferência.',
    });
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadQR = () => {
    const svgElement = document.getElementById(`qr-code-svg-${cleanSlug}`);
    if (!svgElement) return;

    const svgString = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Fundo branco limpo com margens adequadas
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 600, 600);
      // Desenha o QR Code real de 500x500 centralizado com 50px de margem branca
      ctx.drawImage(img, 50, 50, 500, 500);

      const a = document.createElement('a');
      a.download = `qrcode-${cleanSlug}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();

      showToast({
        type: 'success',
        title: 'QR Code baixado',
        message: 'Arquivo PNG de alta resolução gerado para impressão em sacolas e balcão.',
      });
    };

    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${storeName} — Faça seu pedido`,
          text: `Peça agora direto no app oficial de ${storeName} sem taxas abusivas!`,
          url: publicUrl,
        });
      } catch {
        handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  };

  const handleOpenAppClick = () => {
    if (onOpenApp) {
      onOpenApp();
    } else {
      window.open(publicUrl, '_blank');
    }
  };

  return (
    <Card className="flex flex-col md:flex-row items-center gap-6 p-6 bg-linear-to-br from-white to-gray-50/50">
      {/* Real QR Code Graphic Container */}
      <div className="relative p-5 bg-white rounded-3xl border border-gray-200/90 shadow-md flex flex-col items-center justify-center shrink-0">
        <div className="w-48 h-48 sm:w-52 sm:h-52 bg-white flex items-center justify-center relative">
          <QRCodeSVG
            id={`qr-code-svg-${cleanSlug}`}
            value={publicUrl}
            size={192}
            level="H"
            includeMargin={false}
            fgColor={primaryColor || '#15803d'}
            className="w-full h-full"
          />
        </div>
        <div className="mt-2.5 text-center">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center justify-center gap-1">
            <QrCode className="w-3.5 h-3.5 text-emerald-700" />
            Aponte a Câmera
          </span>
        </div>
      </div>

      {/* Info & Action Controls */}
      <div className="flex-1 flex flex-col justify-between w-full space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Badge variant="brand" size="sm">
              <Sparkles className="w-3 h-3 mr-1 inline" />
              Canal Próprio Direto
            </Badge>
            <span className="text-xs text-gray-500">Origem: QR Code Embalagem / Balcão</span>
          </div>

          <h3 className="text-lg font-bold text-gray-900 leading-tight">
            QR Code Oficial de {storeName}
          </h3>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            Imprima este QR Code em adesivos para embalagens, sacolas, panfletos e displays de mesa. Seus clientes escaneiam e entram diretamente no seu Web App sem intermediários.
          </p>

          <div className="mt-3.5 p-2.5 bg-gray-100 rounded-xl flex items-center justify-between text-xs font-mono text-gray-700 overflow-hidden">
            <span className="truncate pr-2 select-all">{publicUrl}</span>
            <button
              onClick={handleCopyLink}
              className="text-emerald-700 hover:text-emerald-800 font-sans font-semibold shrink-0 flex items-center gap-1 cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadQR}
            leftIcon={<Download className="w-4 h-4 text-gray-600" />}
          >
            Baixar PNG
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            leftIcon={<Share2 className="w-4 h-4 text-gray-600" />}
          >
            Compartilhar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenAppClick}
            rightIcon={<ExternalLink className="w-4 h-4" />}
            className="col-span-2 sm:col-span-1"
          >
            Abrir App
          </Button>
        </div>
      </div>
    </Card>
  );
};
