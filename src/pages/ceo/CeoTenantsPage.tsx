import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dataStore } from '../../services/dataStore';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Building2, Search, Headphones, ExternalLink, ShieldCheck, ArrowRight } from 'lucide-react';
import { Tenant } from '../../types';
import { getPublicStoreUrl, isValidStoreSlug } from '../../utils/publicStoreUrl';

export const CeoTenantsPage: React.FC<{ onNavigateToStore: (tenant: Tenant) => void }> = ({ onNavigateToStore }) => {
  const { securityContext, enterCeoSupportMode } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const tenants = dataStore.getTenants(securityContext);

  const filtered = tenants.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.document.includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Gestão de Estabelecimentos (Tenants)</h2>
          <p className="text-xs text-gray-500">
            Controle de todos os lojistas cadastrados, planos ativos e acesso via Modo Suporte CEO
          </p>
        </div>

        <div className="w-full sm:w-72">
          <Input
            placeholder="Buscar por nome, slug ou CNPJ..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="w-4 h-4 text-gray-400" />}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((tenant) => (
          <Card key={tenant.id} className="flex flex-col justify-between hover:border-gray-300">
            <div className="space-y-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-extrabold text-sm shadow-xs"
                    style={{ backgroundColor: tenant.theme.primaryColor || '#15803d' }}
                  >
                    {tenant.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-gray-900 leading-snug">{tenant.name}</h3>
                    <span className="text-xs text-gray-500 font-mono">/{tenant.slug}</span>
                  </div>
                </div>

                <Badge variant="success" size="sm">
                  {tenant.status}
                </Badge>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl space-y-1.5 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span>Razão Social:</span>
                  <span className="font-medium text-gray-900 truncate max-w-[170px]">{tenant.legalName}</span>
                </div>
                <div className="flex justify-between">
                  <span>CNPJ:</span>
                  <span className="font-mono text-gray-900">{tenant.document}</span>
                </div>
                <div className="flex justify-between">
                  <span>Plano SaaS:</span>
                  <span className="font-bold text-emerald-800">{tenant.planTier}</span>
                </div>
                <div className="flex justify-between">
                  <span>GMV Mensal:</span>
                  <span className="font-bold text-gray-900">
                    R$ {tenant.gmvMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-gray-100 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => {
                  enterCeoSupportMode(tenant);
                  onNavigateToStore(tenant);
                }}
                leftIcon={<Headphones className="w-3.5 h-3.5 text-emerald-800" />}
              >
                Acessar Modo Suporte
              </Button>
              {isValidStoreSlug(tenant.slug) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(getPublicStoreUrl(tenant.slug), '_blank')}
                  title="Abrir App Público"
                  className="px-2.5"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-gray-600" />
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
