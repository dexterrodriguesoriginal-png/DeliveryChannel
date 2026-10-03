import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { dataStore } from '../../services/dataStore';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { DollarSign, CreditCard, ArrowUpRight, TrendingUp } from 'lucide-react';

export const CeoFinancePage: React.FC = () => {
  const { securityContext } = useAuth();
  const tenants = dataStore.getTenants(securityContext);

  const totalGmv = tenants.reduce((acc, t) => acc + t.gmvMonthly, 0);
  const mrrSaas = tenants.length * 299.00;
  const takeRate = totalGmv * 0.025; // 2.5% take rate simulada

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Financeiro & Receita AdegaFood (HQ)</h2>
        <p className="text-xs text-gray-500">
          Receitas consolidadas do SaaS, mensalidades de planos e volume total transacionado
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="MRR (Mensalidades SaaS)"
          value={`R$ ${mrrSaas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          change={14.8}
          subtext="Receita recorrente contratada"
          icon={<CreditCard className="w-5 h-5 text-emerald-700" />}
        />
        <StatCard
          title="GMV Total dos Lojistas"
          value={`R$ ${totalGmv.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          change={21.2}
          subtext="Volume de vendas nos apps"
          icon={<DollarSign className="w-5 h-5 text-emerald-700" />}
        />
        <StatCard
          title="Receita de Take-rate Estimada"
          value={`R$ ${takeRate.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          change={19.5}
          subtext="Taxa de processamento de pagamentos"
          icon={<TrendingUp className="w-5 h-5 text-emerald-700" />}
        />
      </div>

      <Card>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Cobrança e Planos por Estabelecimento</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
              <tr>
                <th className="p-3">Estabelecimento</th>
                <th className="p-3">Plano</th>
                <th className="p-3">Mensalidade</th>
                <th className="p-3">Status Cobrança</th>
                <th className="p-3 text-right">GMV Mês</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map(t => (
                <tr key={t.id} className="hover:bg-gray-50/50">
                  <td className="p-3 font-bold text-gray-900">{t.name}</td>
                  <td className="p-3">
                    <Badge variant="brand" size="sm">{t.planTier}</Badge>
                  </td>
                  <td className="p-3 font-mono font-bold text-gray-700">R$ 299,00/mês</td>
                  <td className="p-3">
                    <Badge variant="success" size="sm">Em dia</Badge>
                  </td>
                  <td className="p-3 text-right font-mono font-extrabold text-emerald-800">
                    R$ {t.gmvMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
