import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dataStore } from '../../services/dataStore';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { FileText, Search, ShieldCheck, Filter, AlertTriangle } from 'lucide-react';

export const CeoAuditPage: React.FC = () => {
  const { securityContext } = useAuth();
  const [filter, setFilter] = useState('');
  const auditLogs = dataStore.getAuditLogs(securityContext);

  const filtered = auditLogs.filter(l => 
    l.action.toLowerCase().includes(filter.toLowerCase()) ||
    l.userName.toLowerCase().includes(filter.toLowerCase()) ||
    l.details.toLowerCase().includes(filter.toLowerCase()) ||
    (l.tenantName && l.tenantName.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Trilha de Auditoria Forense (Audit Log)</h2>
          <p className="text-xs text-gray-500">
            Registro imutável de todas as ações administrativas, alterações de preços, configurações e sessões de suporte
          </p>
        </div>

        <div className="w-full sm:w-72">
          <Input
            placeholder="Filtrar por ação, usuário ou termo..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            leftIcon={<Search className="w-4 h-4 text-gray-400" />}
          />
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
              <tr>
                <th className="p-3">Data / Hora</th>
                <th className="p-3">Usuário & Papel</th>
                <th className="p-3">Ação</th>
                <th className="p-3">Estabelecimento</th>
                <th className="p-3">Detalhes</th>
                <th className="p-3">IP / Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((log) => (
                <tr
                  key={log.id}
                  className={`hover:bg-gray-50/60 transition-colors ${
                    log.isCeoSupport ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <td className="p-3 font-mono text-gray-600 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString('pt-BR')}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <div className="font-bold text-gray-900">{log.userName}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{log.userRole}</div>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <span className="font-bold font-mono text-[11px] text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {log.action}
                    </span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {log.tenantName ? (
                      <span className="font-medium text-gray-900">{log.tenantName}</span>
                    ) : (
                      <span className="text-gray-400 italic">Global</span>
                    )}
                  </td>
                  <td className="p-3 max-w-xs text-gray-700">
                    <p className="line-clamp-2 leading-relaxed">{log.details}</p>
                    {log.isCeoSupport && (
                      <span className="inline-block mt-1 text-[10px] font-black uppercase tracking-wider text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        MODO SUPORTE CEO
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-gray-500 whitespace-nowrap text-[11px]">
                    {log.ipAddress}
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
