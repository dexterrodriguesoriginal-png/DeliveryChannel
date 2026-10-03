import React from 'react';
import { dataStore } from '../../services/dataStore';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Sparkles, DollarSign, MousePointerClick, BarChart3, Plus } from 'lucide-react';

export const CeoSponsorsPage: React.FC = () => {
  const sponsors = dataStore.getSponsors();

  const totalClicks = sponsors.reduce((acc, s) => acc + s.totalClicks, 0);
  const totalRevenue = sponsors.reduce((acc, s) => acc + (s.totalClicks * s.cpcValue), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Patrocínios & Rede de Mídia AdegaFood</h2>
          <p className="text-xs text-gray-500">
            Administração de anunciantes nacionais e globais exibidos nos aplicativos de clientes
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase">Receita Bruta com Cliques</div>
          <div className="text-2xl font-black text-emerald-800 mt-1">
            R$ {totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Receita compartilhada com a rede</p>
        </Card>

        <Card className="p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase">Total de Cliques Auditados</div>
          <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
            {totalClicks.toLocaleString('pt-BR')}
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Tráfego verificado anti-fraude</p>
        </Card>

        <Card className="p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase">Campanhas Ativas</div>
          <div className="text-2xl font-black text-gray-900 mt-1">
            {sponsors.length} anunciantes
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Heineken, Coca-Cola e parceiros</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {sponsors.map((sp) => (
          <Card key={sp.id} className="overflow-hidden p-0 border-gray-200">
            <div className="h-32 w-full relative overflow-hidden bg-gray-100">
              <img
                src={sp.bannerUrl}
                alt={sp.campaignTitle}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/30 to-transparent flex items-end p-4">
                <span className="text-white font-bold text-sm drop-shadow-xs">{sp.campaignTitle}</span>
              </div>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-sm text-gray-900">{sp.brandName}</span>
                <Badge variant="success" size="sm">{sp.status}</Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center p-3 bg-gray-50 rounded-xl text-xs">
                <div>
                  <div className="text-gray-400 text-[10px]">CPC</div>
                  <div className="font-bold text-gray-900 font-mono">R$ {sp.cpcValue.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-[10px]">Cliques</div>
                  <div className="font-bold text-gray-900 font-mono">{sp.totalClicks}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-[10px]">Faturado</div>
                  <div className="font-bold text-emerald-800 font-mono">
                    R$ {(sp.totalClicks * sp.cpcValue).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
