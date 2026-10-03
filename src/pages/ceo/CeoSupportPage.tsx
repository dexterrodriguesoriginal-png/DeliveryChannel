import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { dataStore } from '../../services/dataStore';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Headphones, CheckCircle2, MessageSquare, AlertCircle } from 'lucide-react';
import { Tenant } from '../../types';

export const CeoSupportPage: React.FC<{ onNavigateToStore: (tenant: Tenant) => void }> = ({ onNavigateToStore }) => {
  const { securityContext, enterCeoSupportMode } = useAuth();
  const tenants = dataStore.getTenants(securityContext);

  const mockTickets = [
    {
      id: 'TCK-801',
      tenantId: 'tenant-adega-01',
      tenantName: 'Adega Premium Jardins',
      subject: 'Dúvida na configuração do raio de entrega de 5km',
      priority: 'ALTA',
      status: 'ABERTO',
      time: 'Há 25 minutos',
    },
    {
      id: 'TCK-798',
      tenantId: 'tenant-burger-02',
      tenantName: 'Burger Craft & Beers',
      subject: 'Ajuste de cupom promocional no carrossel de ofertas',
      priority: 'MÉDIA',
      status: 'EM_ATENDIMENTO',
      time: 'Há 1 hora',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Central de Suporte a Estabelecimentos</h2>
        <p className="text-xs text-gray-500">
          Atendimento a chamados de donos de loja com acesso instantâneo via Modo Suporte CEO
        </p>
      </div>

      <div className="space-y-4">
        {mockTickets.map((t) => {
          const tenantMatch = tenants.find(te => te.id === t.tenantId);
          return (
            <Card key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="warning" size="sm">{t.status}</Badge>
                  <span className="font-mono text-xs text-gray-400 font-bold">{t.id}</span>
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs text-gray-500">{t.time}</span>
                </div>
                <h4 className="text-sm font-bold text-gray-900">{t.subject}</h4>
                <p className="text-xs text-emerald-800 font-semibold">{t.tenantName}</p>
              </div>

              {tenantMatch && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    enterCeoSupportMode(tenantMatch);
                    onNavigateToStore(tenantMatch);
                  }}
                  leftIcon={<Headphones className="w-4 h-4 text-emerald-800" />}
                >
                  Entrar no Painel do Lojista
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};
