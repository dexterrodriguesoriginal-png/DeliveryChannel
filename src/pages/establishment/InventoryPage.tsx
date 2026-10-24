import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { inventoryRepository, StockIncoming } from '../../repositories/inventoryRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Tabs } from '../../components/ui/Tabs';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { StatCard } from '../../components/ui/StatCard';
import { useToast } from '../../context/ToastContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { isValidUuid } from '../../lib/uuid';
import { formatBRL } from '../../lib/pricing/money';
import { businessUsesStock, stockStatus } from '../../lib/stock';
import { InventoryMovement, StockCount, StockLocation, StockProductBalance } from '../../types';
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  Plus,
  RefreshCw,
  Settings2,
  TrendingDown,
} from 'lucide-react';

type InventoryTab = 'OVERVIEW' | 'PRODUCTS' | 'MOVEMENTS' | 'COUNT';
type Operation = 'INCOMING' | 'LOSS' | 'DAMAGE' | 'EXPIRY' | 'CONSUMPTION' | 'RETURN' | 'TRANSFER' | 'SETTINGS' | 'LOCATION' | 'LOCAL_ADJUST';

const UNIT_OPTIONS = ['un', 'kg', 'g', 'l', 'ml'] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha inesperada ao executar a operação de estoque.';
}

function quantity(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
}

function movementLabel(type: InventoryMovement['type']): string {
  const labels: Record<InventoryMovement['type'], string> = {
    ENTRADA: 'Entrada',
    SAIDA: 'Saída',
    AJUSTE: 'Ajuste',
    VENDA: 'Venda',
    ESTORNO: 'Estorno',
    PERDA: 'Perda',
    OPENING_BALANCE: 'Saldo inicial',
    RECEIPT: 'Recebimento',
    RESERVATION: 'Reserva',
    SALE: 'Venda',
    CONSUMPTION: 'Consumo',
    CANCEL_RELEASE: 'Liberação / estorno',
    CUSTOMER_RETURN: 'Devolução de cliente',
    LOSS: 'Perda',
    DAMAGE: 'Avaria',
    EXPIRY: 'Vencimento',
    COUNT_ADJUSTMENT: 'Ajuste de contagem',
    TRANSFER_IN: 'Transferência recebida',
    TRANSFER_OUT: 'Transferência enviada',
    WEIGHT_CORRECTION: 'Correção de peso',
  };
  return labels[type] || type;
}

export const InventoryPage: React.FC = () => {
  const { activeTenant, activeRole, securityContext } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<InventoryTab>('OVERVIEW');
  const [products, setProducts] = useState<StockProductBalance[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof inventoryRepository.getDashboard>>['alerts']>([]);
  const [summary, setSummary] = useState({ activeSkus: 0, criticalStock: 0, inventoryValue: 0, alertCount: 0 });
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [incoming, setIncoming] = useState<StockIncoming[]>([]);
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<StockProductBalance | null>(null);
  const [form, setForm] = useState({
    quantity: '',
    reason: '',
    supplier: '',
    unitCost: '',
    expectedAt: '',
    lotCode: '',
    targetLocation: '',
    locationName: '',
    stockUnit: 'un',
    minStock: '0',
    safetyStock: '0',
    trackLots: false,
    isResale: false,
  });
  const [countValues, setCountValues] = useState<Record<string, string>>({});

  const connected = isSupabaseConfigured && Boolean(activeTenant?.id && isValidUuid(activeTenant.id));
  const isManager = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const visibleProducts = useMemo(() => products.filter(row =>
    !selectedLocation || row.locationId === selectedLocation
  ), [products, selectedLocation]);

  const refresh = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError('');
    try {
      const [dashboard, movementRows] = await Promise.all([
        inventoryRepository.getDashboard(securityContext, activeTenant.id),
        inventoryRepository.getMovements(securityContext, activeTenant.id),
      ]);
      setProducts(dashboard.products);
      setLocations(dashboard.locations);
      setAlerts(dashboard.alerts);
      setSummary(dashboard.summary);
      setMovements(movementRows);
      if (!selectedLocation || !dashboard.locations.some(location => location.id === selectedLocation)) {
        setSelectedLocation(dashboard.locations.find(location => location.isDefault)?.id || dashboard.locations[0]?.id || '');
      }
      if (connected) {
        const [incomingRows, countRows] = await Promise.all([
          inventoryRepository.getIncoming(activeTenant.id),
          inventoryRepository.getCounts(activeTenant.id),
        ]);
        setIncoming(incomingRows);
        setCounts(countRows);
      } else {
        setIncoming([]);
        setCounts([]);
      }
    } catch (err) {
      console.warn('[InventoryPage] Falha ao carregar estoque:', err);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, connected, securityContext, selectedLocation]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeTenant || !businessUsesStock(activeTenant.businessType)) return null;

  const openOperation = (next: Operation, product: StockProductBalance | null = null) => {
    setSelectedProduct(product);
    setOperation(next);
    setForm({
      quantity: '',
      reason: '',
      supplier: '',
      unitCost: product?.costPrice ? String(product.costPrice) : '',
      expectedAt: '',
      lotCode: '',
      targetLocation: locations.find(location => location.id !== selectedLocation)?.id || '',
      locationName: '',
      stockUnit: product?.unit || 'un',
      minStock: product ? String(product.minStock) : '0',
      safetyStock: product ? String(product.safetyStock) : '0',
      trackLots: Boolean(product?.trackLots),
      isResale: Boolean(product?.stockIsResale),
    });
  };

  const handleOperation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeTenant?.id || !operation) return;
    setIsSubmitting(true);
    try {
      const amount = Number(form.quantity);
      if (operation === 'LOCATION') {
        await inventoryRepository.addLocation(activeTenant.id, form.locationName);
      } else if (operation === 'SETTINGS' && selectedProduct) {
        await inventoryRepository.updateSettings({
          tenantId: activeTenant.id,
          productId: selectedProduct.productId,
          unit: form.stockUnit,
          minStock: Number(form.minStock),
          safetyStock: Number(form.safetyStock),
          trackLots: form.trackLots,
          isResale: form.isResale,
        });
      } else if (operation === 'INCOMING' && selectedProduct) {
        await inventoryRepository.createIncoming({
          tenantId: activeTenant.id,
          productId: selectedProduct.productId,
          quantity: amount,
          supplierReference: form.supplier,
          unitCost: Number(form.unitCost),
          expectedAt: form.expectedAt || undefined,
        });
      } else if (operation === 'TRANSFER' && selectedProduct) {
        await inventoryRepository.transfer({
          tenantId: activeTenant.id,
          productId: selectedProduct.productId,
          fromLocation: selectedProduct.locationId,
          toLocation: form.targetLocation,
          quantity: amount,
          reason: form.reason,
        });
      } else if (operation === 'LOCAL_ADJUST' && selectedProduct) {
        const delta = form.reason === 'Entrada' ? amount : -amount;
        await inventoryRepository.adjustStock(
          securityContext,
          activeTenant.id,
          selectedProduct.productId,
          delta,
          delta > 0 ? 'ENTRADA' : 'SAIDA',
          form.reason
        );
      } else if (selectedProduct) {
        const type = operation === 'RETURN' ? 'CUSTOMER_RETURN' : operation;
        await inventoryRepository.recordMovement({
          tenantId: activeTenant.id,
          productId: selectedProduct.productId,
          locationId: selectedProduct.locationId,
          type,
          quantity: amount,
          reason: form.reason,
          lotCode: form.lotCode || undefined,
        });
      }
      showToast({ type: 'success', title: 'Estoque atualizado', message: 'A operação foi registrada com sucesso.' });
      setOperation(null);
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha no estoque', message: errorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitCount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeTenant?.id || !selectedLocation) return;
    const countsToSubmit = visibleProducts.map(product => ({
      product_id: product.productId,
      counted_quantity: Number(countValues[product.productId]),
    }));
    if (countsToSubmit.some(item => !Number.isFinite(item.counted_quantity) || item.counted_quantity < 0)) {
      showToast({ type: 'error', title: 'Contagem incompleta', message: 'Informe uma quantidade válida para cada produto.' });
      return;
    }
    setIsSubmitting(true);
    try {
      await inventoryRepository.submitCount(activeTenant.id, selectedLocation, countsToSubmit);
      setCountValues({});
      showToast({ type: 'success', title: 'Contagem enviada', message: 'Aguardando aprovação do responsável.' });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha na contagem', message: errorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const reviewCount = async (countId: string, approve: boolean) => {
    try {
      await inventoryRepository.approveCount(countId, approve, 'Revisão de contagem física');
      showToast({
        type: 'success',
        title: approve ? 'Contagem aprovada' : 'Contagem rejeitada',
        message: approve ? 'Os ajustes foram adicionados ao kardex.' : 'A contagem foi rejeitada sem alterar saldos.',
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha na revisão', message: errorMessage(err) });
    }
  };

  const receiveIncoming = async (item: StockIncoming) => {
    try {
      await inventoryRepository.receiveIncoming(item.id, selectedLocation);
      showToast({ type: 'success', title: 'Recebimento registrado', message: 'O saldo foi atualizado pelo servidor.' });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha no recebimento', message: errorMessage(err) });
    }
  };

  const modalTitle: Record<Operation, string> = {
    INCOMING: 'Registrar compra confirmada',
    LOSS: 'Registrar perda',
    DAMAGE: 'Registrar avaria',
    EXPIRY: 'Registrar produto vencido',
    CONSUMPTION: 'Registrar consumo',
    RETURN: 'Registrar devolução de cliente',
    TRANSFER: 'Transferir entre locais',
    SETTINGS: 'Configurar controle de estoque',
    LOCATION: 'Adicionar local de estoque',
    LOCAL_ADJUST: 'Ajustar saldo (modo local)',
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Estoque</h2>
          <p className="text-xs text-gray-500">Saldos calculados no servidor, reservas e histórico auditável.</p>
        </div>
        <div className="flex items-center gap-2">
          {locations.length > 1 && (
            <select
              aria-label="Local de estoque"
              value={selectedLocation}
              onChange={event => setSelectedLocation(event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
            >
              {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          )}
          {connected && isManager && (
            <Button size="sm" variant="outline" onClick={() => openOperation('LOCATION')}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Local
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </header>

      {!connected && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
          Modo local de demonstração: saldos e movimentos existentes estão disponíveis. Compras, aprovações e múltiplos locais exigem conexão ao servidor.
        </div>
      )}

      {error && (
        <Card className="flex items-center gap-3 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div><strong>Não foi possível atualizar o estoque.</strong><p className="text-xs">{error}</p></div>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>Tentar novamente</Button>
        </Card>
      )}

      <Tabs
        tabs={[
          { id: 'OVERVIEW', label: 'Visão geral' },
          { id: 'PRODUCTS', label: 'Produtos e saldos', badge: products.length },
          { id: 'MOVEMENTS', label: 'Movimentações', badge: movements.length },
          { id: 'COUNT', label: 'Contagem', badge: counts.filter(count => count.status === 'PENDING').length || undefined },
        ]}
        activeTab={activeTab}
        onChange={tab => setActiveTab(tab as InventoryTab)}
        variant="underline"
      />

      {activeTab === 'OVERVIEW' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard title="SKUs ativos" value={summary.activeSkus} icon={<Boxes className="h-4 w-4" />} />
            <StatCard title="Estoque crítico" value={summary.criticalStock} icon={<AlertTriangle className="h-4 w-4" />} iconColorClass="bg-amber-50 text-amber-700 border-amber-100" />
            <StatCard title="Valor em estoque" value={formatBRL(summary.inventoryValue)} subtext="Custo médio ponderado" icon={<PackageCheck className="h-4 w-4" />} />
            <StatCard title="Alertas" value={summary.alertCount} icon={<TrendingDown className="h-4 w-4" />} iconColorClass="bg-rose-50 text-rose-700 border-rose-100" />
          </div>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-bold text-gray-900">Alertas e ações sugeridas</h3>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Nenhum produto abaixo do mínimo.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {alerts.map(alert => (
                  <li key={`${alert.productId}:${alert.locationId}`} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs">
                      <strong className="text-gray-900">{alert.productName}</strong>
                      <Badge className="ml-2" variant={alert.cause === 'OUT_OF_STOCK' ? 'danger' : 'warning'} size="sm">
                        {alert.cause === 'OUT_OF_STOCK' ? 'Sem estoque' : 'Abaixo do mínimo'}
                      </Badge>
                      <p className="text-gray-500">{alert.suggestedAction}</p>
                    </div>
                    <span className="font-mono text-xs text-gray-600">{quantity(alert.available)} / mín. {quantity(alert.minimum)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'PRODUCTS' && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                <tr>
                  <th className="p-3">Produto</th>
                  {locations.length > 1 && <th className="p-3">Local</th>}
                  <th className="p-3">Físico</th>
                  <th className="p-3">Reservado</th>
                  <th className="p-3">Bloqueado</th>
                  <th className="p-3">Disponível</th>
                  <th className="p-3">A receber</th>
                  <th className="p-3">Mínimo / segurança</th>
                  <th className="p-3">Custo médio</th>
                  <th className="p-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleProducts.length === 0 ? (
                  <tr><td colSpan={locations.length > 1 ? 10 : 9} className="p-8 text-center text-gray-500">
                    Nenhum produto com controle de estoque neste local. Em salões, marque produtos de revenda no cadastro.
                  </td></tr>
                ) : visibleProducts.map(product => {
                  const status = stockStatus(product.availableQuantity, product.minStock);
                  const productIncoming = incoming.filter(item => item.productId === product.productId);
                  return (
                    <tr key={`${product.productId}:${product.locationId}`}>
                      <td className="p-3">
                        <strong className="block text-gray-900">{product.productName}</strong>
                        <span className="font-mono text-[10px] text-gray-400">{product.sku || product.productId}</span>
                      </td>
                      {locations.length > 1 && <td className="p-3">{product.locationName}</td>}
                      <td className="p-3 font-mono">{quantity(product.physicalQuantity)} {product.unit}</td>
                      <td className="p-3 font-mono">{quantity(product.reservedQuantity)}</td>
                      <td className="p-3 font-mono">{quantity(product.blockedQuantity)}</td>
                      <td className="p-3">
                        <Badge variant={status === 'OUT_OF_STOCK' ? 'danger' : status === 'BELOW_MINIMUM' ? 'warning' : 'success'} size="sm">
                          {quantity(product.availableQuantity)} {product.unit}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono">{quantity(product.incomingQuantity)} {product.unit}</td>
                      <td className="p-3 font-mono">{quantity(product.minStock)} / {quantity(product.safetyStock)}</td>
                      <td className="p-3 font-mono">{formatBRL(product.costPrice)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {connected ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openOperation('INCOMING', product)}>Compra</Button>
                              <Button size="sm" variant="outline" onClick={() => openOperation('LOSS', product)}>Perda</Button>
                              {isManager && <Button size="sm" variant="outline" onClick={() => openOperation('SETTINGS', product)}><Settings2 className="h-3.5 w-3.5" /></Button>}
                              {locations.length > 1 && <Button size="sm" variant="outline" onClick={() => openOperation('TRANSFER', product)}><ArrowLeftRight className="h-3.5 w-3.5" /></Button>}
                              {productIncoming.map(item => (
                                <Button key={item.id} size="sm" variant="primary" onClick={() => void receiveIncoming(item)}>Receber</Button>
                              ))}
                            </>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => openOperation('LOCAL_ADJUST', product)}>Ajustar</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {connected && <div className="flex flex-wrap gap-2 border-t border-gray-100 p-3">
            {visibleProducts.slice(0, 1).map(product => (
              <React.Fragment key={product.productId}>
                <Button size="sm" variant="outline" onClick={() => openOperation('DAMAGE', product)}>Avaria</Button>
                <Button size="sm" variant="outline" onClick={() => openOperation('EXPIRY', product)}>Vencimento</Button>
                <Button size="sm" variant="outline" onClick={() => openOperation('CONSUMPTION', product)}>Consumo</Button>
                <Button size="sm" variant="outline" onClick={() => openOperation('RETURN', product)}>Devolução</Button>
              </React.Fragment>
            ))}
          </div>}
        </Card>
      )}

      {activeTab === 'MOVEMENTS' && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                <tr><th className="p-3">Data / hora</th><th className="p-3">Produto</th><th className="p-3">Movimento</th><th className="p-3">Quantidade</th><th className="p-3">Saldo anterior → novo</th><th className="p-3">Motivo / referência</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-500">Nenhuma movimentação registrada.</td></tr>
                ) : movements.map(movement => (
                  <tr key={movement.id}>
                    <td className="p-3 text-gray-500">{new Date(movement.timestamp).toLocaleString('pt-BR')}</td>
                    <td className="p-3 font-semibold">{movement.productName}</td>
                    <td className="p-3"><Badge variant="neutral" size="sm">{movementLabel(movement.type)}</Badge></td>
                    <td className={`p-3 font-mono font-bold ${movement.quantity >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {movement.quantity > 0 ? '+' : ''}{quantity(movement.quantity)} {movement.unit || 'un'}
                    </td>
                    <td className="p-3 font-mono">{quantity(movement.previousStock)} → {quantity(movement.newStock)}</td>
                    <td className="p-3 text-gray-600">{movement.reason}{movement.referenceId ? <span className="block text-[10px] text-gray-400">Ref. {movement.referenceId}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'COUNT' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-emerald-700" />
              <div><h3 className="text-sm font-bold">Nova contagem física</h3><p className="text-[11px] text-gray-500">O servidor registra o saldo esperado; somente owner/gerente aprova ajustes.</p></div>
            </div>
            {!connected ? <p className="text-xs text-gray-500">Contagens exigem conexão ao servidor.</p> : (
              <form onSubmit={submitCount} className="space-y-3">
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {visibleProducts.map(product => (
                    <label key={product.productId} className="grid grid-cols-[1fr_auto_130px] items-center gap-3 rounded-lg border border-gray-100 p-2 text-xs">
                      <span className="font-semibold">{product.productName}</span>
                      <span className="font-mono text-gray-500">Esperado: {quantity(product.availableQuantity)} {product.unit}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={countValues[product.productId] || ''}
                        onChange={event => setCountValues(previous => ({ ...previous, [product.productId]: event.target.value }))}
                        aria-label={`Contagem de ${product.productName}`}
                        className="w-full rounded-md border border-gray-200 px-2 py-1.5 font-mono"
                        required
                      />
                    </label>
                  ))}
                </div>
                <Button type="submit" size="sm" variant="primary" disabled={isSubmitting || visibleProducts.length === 0}>
                  Enviar para aprovação
                </Button>
              </form>
            )}
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-gray-100 p-4"><h3 className="text-sm font-bold">Contagens enviadas</h3></div>
            {counts.length === 0 ? <p className="p-4 text-xs text-gray-500">Nenhuma contagem enviada.</p> : (
              <ul className="divide-y divide-gray-100">
                {counts.map(count => (
                  <li key={count.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs">
                      <strong>{new Date(count.submittedAt).toLocaleString('pt-BR')}</strong>
                      <Badge className="ml-2" variant={count.status === 'PENDING' ? 'warning' : count.status === 'APPROVED' ? 'success' : 'neutral'} size="sm">{count.status}</Badge>
                      <div className="mt-1 text-gray-500">{count.items.length} produtos · {count.items.map(item => `${item.productName}: ${quantity(item.expectedQuantity)} → ${quantity(item.countedQuantity)} ${item.unit}`).join(' · ')}</div>
                    </div>
                    {connected && isManager && count.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => void reviewCount(count.id, true)}>Aprovar</Button>
                        <Button size="sm" variant="outline" onClick={() => void reviewCount(count.id, false)}>Rejeitar</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {operation && (
        <Modal isOpen onClose={() => setOperation(null)} title={modalTitle[operation]} size="sm">
          <form onSubmit={handleOperation} className="space-y-3">
            {selectedProduct && <p className="rounded-lg bg-gray-50 p-2 text-xs font-semibold">{selectedProduct.productName} · disponível {quantity(selectedProduct.availableQuantity)} {selectedProduct.unit}</p>}
            {operation === 'LOCATION' ? (
              <Input label="Nome do local" value={form.locationName} onChange={event => setForm({ ...form, locationName: event.target.value })} required minLength={2} />
            ) : operation === 'SETTINGS' ? (
              <>
                <label className="block text-xs font-semibold">Unidade de estoque
                  <select value={form.stockUnit} onChange={event => setForm({ ...form, stockUnit: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 p-2">
                    {UNIT_OPTIONS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                <Input label="Estoque mínimo" type="number" step="0.001" min="0" value={form.minStock} onChange={event => setForm({ ...form, minStock: event.target.value })} required />
                <Input label="Estoque de segurança" type="number" step="0.001" min="0" value={form.safetyStock} onChange={event => setForm({ ...form, safetyStock: event.target.value })} required />
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.trackLots} onChange={event => setForm({ ...form, trackLots: event.target.checked })} /> Controlar lotes</label>
                {activeTenant.businessType === 'SALAO_BARBEARIA' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isResale} onChange={event => setForm({ ...form, isResale: event.target.checked })} /> Produto de revenda</label>}
              </>
            ) : (
              <>
                <Input
                  label={`Quantidade (${selectedProduct?.unit || 'un'})`}
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={form.quantity}
                  onChange={event => setForm({ ...form, quantity: event.target.value })}
                  required
                />
                {operation === 'INCOMING' ? (
                  <>
                    <Input label="Fornecedor / referência" value={form.supplier} onChange={event => setForm({ ...form, supplier: event.target.value })} required />
                    <Input label="Custo unitário (R$)" type="number" step="0.01" min="0" value={form.unitCost} onChange={event => setForm({ ...form, unitCost: event.target.value })} required />
                    <Input label="Previsão de recebimento" type="date" value={form.expectedAt} onChange={event => setForm({ ...form, expectedAt: event.target.value })} />
                  </>
                ) : operation === 'TRANSFER' ? (
                  <>
                    <label className="block text-xs font-semibold">Destino
                      <select value={form.targetLocation} onChange={event => setForm({ ...form, targetLocation: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 p-2" required>
                        <option value="">Selecione</option>
                        {locations.filter(location => location.id !== selectedProduct?.locationId).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
                      </select>
                    </label>
                    <Input label="Motivo" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} required />
                  </>
                ) : operation === 'LOCAL_ADJUST' ? (
                  <>
                    <label className="block text-xs font-semibold">Tipo
                      <select value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 p-2">
                        <option value="Entrada">Entrada</option><option value="Saída">Saída</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <Input label="Motivo (obrigatório)" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} required />
                    {selectedProduct?.trackLots && <Input label="Lote" value={form.lotCode} onChange={event => setForm({ ...form, lotCode: event.target.value })} required />}
                  </>
                )}
              </>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              <Button type="button" size="sm" variant="outline" onClick={() => setOperation(null)}>Cancelar</Button>
              <Button type="submit" size="sm" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? 'Salvando...' : 'Confirmar'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
