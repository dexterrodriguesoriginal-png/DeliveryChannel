import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dataStore } from '../../services/dataStore';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { 
  Building2, 
  DollarSign, 
  TrendingUp, 
  ShoppingBag, 
  Users, 
  ShieldAlert, 
  Sparkles, 
  ExternalLink,
  ChevronRight,
  ArrowUpRight,
  ShieldCheck,
  Headphones
} from 'lucide-react';
import { Tenant } from '../../types';

export const CeoDashboard: React.FC<{ onNavigate: (tabId: string) => void }> = ({ onNavigate }) => {
  const { securityContext, enterCeoSupportMode } = useAuth();
  const tenants = dataStore.getTenants(securityContext);
  const sponsors = dataStore.getSponsors();
  const auditLogs = dataStore.getAuditLogs(securityContext);

  const totalGmv = tenants.reduce((acc, t) => acc + t.gmvMonthly, 0);
  const totalOrders = tenants.reduce((acc, t) => acc + t.activeOrdersToday, 0);
  const totalCustomers = tenants.reduce((acc, t) => acc + t.totalCustomers, 0);
  const saasRevenue = tenants.length * 299.00; // mensalidade média demonstrativa

  return (
    <div className="space-y-6">
      {/* Top Banner Notice: CEO Overview */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-linear-to-r from-emerald-900 to-green-950 text-white shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-700/80 text-emerald-100 border border-emerald-500/30">
              Command Center Global
            </span>
            <span className="text-xs text-emerald-200/80 font-mono">
              Visão Consolidada Multi-Tenant
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            HQ AdegaFood — Painel da Diretoria
          </h2>
          <p className="text-xs text-emerald-100/90 max-w-xl">
            Monitoramento de todos os estabelecimentos cadastrados, faturamento consolidado de pedidos (GMV), receita de assinaturas e rede de patrocinadores.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onNavigate('security-lab')}
            leftIcon={<ShieldCheck className="w-4 h-4 text-emerald-800" />}
          >
            Auditar RLS & Segurança
          </Button>
        </div>
      </div>

      {/* Global Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="GMV Consolidado (Mês)"
          value={`R$ ${totalGmv.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          change={18.4}
          subtext="Volume total transacionado"
          icon={<DollarSign className="w-5 h-5 text-emerald-700" />}
          iconColorClass="bg-emerald-50 text-emerald-700 border-emerald-200"
        />
        <StatCard
          title="Estabelecimentos Ativos"
          value={tenants.length}
          change={12.0}
          subtext="Lojas faturando na plataforma"
          icon={<Building2 className="w-5 h-5 text-emerald-700" />}
          iconColorClass="bg-emerald-50 text-emerald-700 border-emerald-200"
        />
        <StatCard
          title="Pedidos Hoje (Rede)"
          value={totalOrders}
          change={8.5}
          subtext="Transações em tempo real"
          icon={<ShoppingBag className="w-5 h-5 text-emerald-700" />}
          iconColorClass="bg-emerald-50 text-emerald-700 border-emerald-200"
        />
        <StatCard
          title="Base de Clientes Únicos"
          value={totalCustomers.toLocaleString('pt-BR')}
          change={24.2}
          subtext="Consumidores cadastrados"
          icon={<Users className="w-5 h-5 text-emerald-700" />}
          iconColorClass="bg-emerald-50 text-emerald-700 border-emerald-200"
        />
      </div>

      {/* Grid: Tenants Table + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tenants List (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Estabelecimentos Cadastrados
                </h3>
                <p className="text-xs text-gray-500">
                  Gerencie lojas ou entre em <strong>Modo Suporte CEO</strong> para prestar assistência técnica auditada.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('ceo-tenants')}
                rightIcon={<ArrowUpRight className="w-3.5 h-3.5" />}
              >
                Ver Todos
              </Button>
            </div>

            <div className="divide-y divide-gray-100 mt-2">
              {tenants.map((tenant) => (
                <div
                  key={tenant.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50/70 p-2 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0 shadow-xs"
                      style={{ backgroundColor: tenant.theme.primaryColor || '#15803d' }}
                    >
                      {tenant.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-900">{tenant.name}</span>
                        <Badge variant="success" size="sm">
                          {tenant.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                        <span>{tenant.category}</span>
                        <span>•</span>
                        <span>Plano {tenant.planTier}</span>
                        <span>•</span>
                        <span className="font-mono text-gray-700">/{tenant.slug}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 justify-between sm:justify-end">
                    <div className="text-left sm:text-right">
                      <div className="text-xs text-gray-500 font-medium">GMV Mês</div>
                      <div className="text-sm font-extrabold text-emerald-800">
                        R$ {tenant.gmvMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        enterCeoSupportMode(tenant);
                        onNavigate('est-dashboard');
                      }}
                      leftIcon={<Headphones className="w-3.5 h-3.5 text-emerald-800" />}
                      className="text-xs"
                    >
                      Modo Suporte CEO
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Sponsors Section */}
          <Card>
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    Rede de Patrocinadores Globais
                  </h3>
                  <p className="text-xs text-gray-500">
                    Monetização por impressões e cliques em banners nos aplicativos de clientes
                  </p>
                </div>
              </div>
              <Badge variant="warning" size="sm">
                Monetização HQ
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-4">
              {sponsors.map((sp) => (
                <div
                  key={sp.id}
                  className="p-3.5 rounded-xl border border-gray-200 bg-linear-to-b from-white to-gray-50/50 flex flex-col justify-between gap-3 shadow-2xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-emerald-800 uppercase tracking-wider">{sp.brandName}</span>
                      <Badge variant="neutral" size="sm">CPC R$ {sp.cpcValue.toFixed(2)}</Badge>
                    </div>
                    <h4 className="text-xs font-bold text-gray-900">{sp.campaignTitle}</h4>
                    <p className="text-[11px] text-gray-500">Segmento: {sp.targetCategory}</p>
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span className="text-gray-500">Cliques totais:</span>
                    <strong className="text-gray-900 font-mono">{sp.totalClicks.toLocaleString('pt-BR')}</strong>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Audit Log / Security Feed (1 col) */}
        <div className="space-y-4">
          <Card className="h-full flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-emerald-700" />
                <h3 className="text-sm font-bold text-gray-900">
                  Auditoria & Segurança em Tempo Real
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('ceo-audit')}
                className="text-xs p-1"
              >
                Log Completo
              </Button>
            </div>

            <div className="space-y-3 mt-3 flex-1 overflow-y-auto max-h-[500px] pr-1">
              {auditLogs.slice(0, 7).map((log) => (
                <div
                  key={log.id}
                  className={`p-3 rounded-xl border text-xs ${
                    log.isCeoSupport
                      ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                      : 'bg-gray-50/80 border-gray-200 text-gray-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-[11px] uppercase tracking-wider">
                      {log.action}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-700 mt-1 leading-snug">
                    {log.details}
                  </p>

                  <div className="mt-2 pt-1 border-t border-black/5 flex items-center justify-between text-[10px] text-gray-500 font-mono">
                    <span>{log.userName}</span>
                    <span>{log.ipAddress}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
