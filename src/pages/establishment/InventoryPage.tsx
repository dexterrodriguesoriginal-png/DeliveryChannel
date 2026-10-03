import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { inventoryRepository } from '../../repositories/inventoryRepository';
import { productRepository } from '../../repositories/productRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Tabs } from '../../components/ui/Tabs';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Product, InventoryMovement } from '../../types';
import { 
  Boxes, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowUpRight, 
  ArrowDownLeft, 
  RotateCcw, 
  Sliders, 
  Plus, 
  Minus,
  History,
  TrendingDown,
  RefreshCw
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const InventoryPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'STOCK' | 'MOVEMENTS'>('STOCK');
  const [remoteProducts, setRemoteProducts] = useState<Product[] | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal de ajuste manual de estoque
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [adjustmentDelta, setAdjustmentDelta] = useState<number>(10);
  const [adjustmentType, setAdjustmentType] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');
  const [adjustmentReason, setAdjustmentReason] = useState<string>('Reposição de Fornecedor / Compra');

  const fetchProducts = useCallback(async () => {
    if (!activeTenant?.id) return;
    try {
      const data = await productRepository.getProducts(securityContext, activeTenant.id);
      setRemoteProducts(data);
    } catch (err: any) {
      console.warn('[InventoryPage] Erro ao carregar produtos do Supabase:', err);
      throw err;
    }
  }, [activeTenant?.id, securityContext]);

  const fetchMovements = useCallback(async () => {
    if (!activeTenant?.id) return;
    try {
      const data = await inventoryRepository.getMovements(securityContext, activeTenant.id);
      setMovements(data);
    } catch (err: any) {
      console.warn('[InventoryPage] Erro ao carregar movimentações do Supabase:', err);
      throw err;
    }
  }, [activeTenant?.id, securityContext]);

  const loadAllData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchProducts(), fetchMovements()]);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar dados do estoque do banco de dados.');
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, fetchProducts, fetchMovements]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  if (!activeTenant) return null;

  const products = remoteProducts || [];

  const lowStockCount = products.filter(p => p.stockQuantity < 20).length;
  const outOfStockCount = products.filter(p => p.stockQuantity <= 0).length;

  const handleApplyAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct || !activeTenant?.id) return;

    const delta = adjustmentType === 'ENTRADA' ? Math.abs(adjustmentDelta) : -Math.abs(adjustmentDelta);
    setIsSubmitting(true);
    try {
      const res = await inventoryRepository.adjustStock(
        securityContext,
        activeTenant.id,
        adjustingProduct.id,
        delta,
        adjustmentType,
        adjustmentReason
      );
      showToast({
        type: 'success',
        title: 'Estoque Atualizado',
        message: `Saldo de ${adjustingProduct.name} ajustado com sucesso no Supabase (${res.previousStock} → ${res.newStock} un).`,
      });
      setAdjustingProduct(null);
      await Promise.all([fetchProducts(), fetchMovements()]);
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Falha no Ajuste',
        message: err.message || 'Não foi possível registrar o ajuste de estoque no servidor.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Controle de Estoque & Movimentações</h2>
          <p className="text-xs text-gray-500">
            Rastreamento atômico de vendas, estornos, compras e histórico auditável de cada unidade
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={loadAllData}
            disabled={loading}
            className="text-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          {lowStockCount > 0 && (
            <Badge variant="warning" size="sm">
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />
              {lowStockCount} itens com estoque baixo
            </Badge>
          )}
          {outOfStockCount > 0 && (
            <Badge variant="danger" size="sm">
              {outOfStockCount} esgotados
            </Badge>
          )}
        </div>
      </div>

      {error && products.length === 0 && (
        <Card className="p-6 text-center border-amber-200 bg-amber-50/50 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-gray-900">Não foi possível carregar o estoque</h3>
          <p className="text-xs text-gray-600 max-w-md mx-auto">{error}</p>
          <Button size="sm" variant="primary" onClick={loadAllData} className="cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Tentar Novamente
          </Button>
        </Card>
      )}

      <Tabs
        tabs={[
          { id: 'STOCK', label: 'Saldos Atuais', badge: products.length },
          { id: 'MOVEMENTS', label: 'Histórico de Movimentações (Kardex)', badge: movements.length }
        ]}
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab as any)}
        variant="pills"
      />

      {activeTab === 'STOCK' ? (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                <tr>
                  <th className="p-3">Produto</th>
                  <th className="p-3">Unidade</th>
                  <th className="p-3">Saldo Disponível</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Preço Un.</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((p) => {
                  const isLow = p.stockQuantity < 20 && p.stockQuantity > 0;
                  const isOut = p.stockQuantity <= 0;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-bold text-gray-900 flex items-center gap-2.5">
                        <img src={p.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                        <div>
                          <div>{p.name}</div>
                          <div className="text-[11px] text-gray-400 font-mono">SKU: {p.id}</div>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-gray-600 uppercase">{p.unit}</td>
                      <td className="p-3 font-mono font-bold text-base text-gray-900">
                        {p.stockQuantity}
                      </td>
                      <td className="p-3">
                        <Badge 
                          variant={isOut ? 'danger' : isLow ? 'warning' : 'success'} 
                          size="sm"
                        >
                          {isOut ? 'Esgotado' : isLow ? 'Estoque Baixo' : 'Disponível'}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-800">
                        R$ {p.price.toFixed(2)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAdjustingProduct(p);
                            setAdjustmentDelta(10);
                            setAdjustmentType('ENTRADA');
                            setAdjustmentReason('Reposição de Fornecedor');
                          }}
                          className="text-xs"
                        >
                          Ajustar Saldo
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                <tr>
                  <th className="p-3">Data / Hora</th>
                  <th className="p-3">Produto</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Qtd</th>
                  <th className="p-3">Saldo Anterior → Novo</th>
                  <th className="p-3">Origem / Motivo</th>
                  <th className="p-3 text-right">Operador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-gray-400">
                      Nenhuma movimentação de estoque registrada até o momento.
                    </td>
                  </tr>
                ) : (
                  movements.map((m) => {
                    const isPositive = m.quantity > 0;
                    return (
                      <tr key={m.id} className="hover:bg-gray-50/50">
                        <td className="p-3 text-gray-500 font-mono">
                          {new Date(m.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="p-3 font-bold text-gray-900">
                          {m.productName}
                        </td>
                        <td className="p-3">
                          <Badge 
                            variant={
                              m.type === 'VENDA' ? 'neutral' : 
                              m.type === 'ESTORNO' ? 'brand' : 
                              m.type === 'ENTRADA' ? 'success' : 'warning'
                            } 
                            size="sm"
                          >
                            {m.type}
                          </Badge>
                        </td>
                        <td className="p-3 font-mono font-bold">
                          <span className={isPositive ? 'text-emerald-700' : 'text-rose-700'}>
                            {isPositive ? `+${m.quantity}` : m.quantity}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-gray-600">
                          {m.previousStock} → <strong className="text-gray-900">{m.newStock}</strong>
                        </td>
                        <td className="p-3 text-gray-700">
                          <div>{m.reason}</div>
                          {m.referenceId && (
                            <span className="text-[10px] font-mono text-gray-400">
                              Ref: {m.referenceId}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-medium text-gray-600">
                          {m.createdByName}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal de Ajuste de Saldo */}
      {adjustingProduct && (
        <Modal
          isOpen={!!adjustingProduct}
          onClose={() => setAdjustingProduct(null)}
          title={`Ajustar Estoque: ${adjustingProduct.name}`}
          size="sm"
        >
          <form onSubmit={handleApplyAdjustment} className="space-y-4 text-xs">
            <div className="p-3 bg-gray-50 rounded-xl flex items-center justify-between font-mono">
              <span className="text-gray-600">Saldo Atual em Prateleira:</span>
              <span className="font-bold text-sm text-gray-900">{adjustingProduct.stockQuantity} {adjustingProduct.unit}</span>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-gray-700">Tipo de Movimentação</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentType('ENTRADA')}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                    adjustmentType === 'ENTRADA'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Entrada / Reposição
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentType('SAIDA')}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                    adjustmentType === 'SAIDA'
                      ? 'bg-rose-50 border-rose-500 text-rose-800'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Minus className="w-3.5 h-3.5" />
                  Saída / Perda / Avaria
                </button>
              </div>
            </div>

            <Input
              label={`Quantidade a ${adjustmentType === 'ENTRADA' ? 'Adicionar' : 'Subtrair'}`}
              type="number"
              min="1"
              value={adjustmentDelta}
              onChange={(e) => setAdjustmentDelta(Number(e.target.value))}
              required
            />

            <div className="space-y-1">
              <label className="font-bold text-gray-700">Motivo da Alteração</label>
              <select
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                className="w-full p-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-800"
              >
                <option value="Reposição de Fornecedor / Compra">Reposição de Fornecedor / Compra</option>
                <option value="Ajuste de Balanço / Inventário Físico">Ajuste de Balanço / Inventário Físico</option>
                <option value="Avaria / Quebra de Frasco">Avaria / Quebra de Frasco</option>
                <option value="Produto Vencido / Descarte">Produto Vencido / Descarte</option>
                <option value="Consumo Interno / Degustação">Consumo Interno / Degustação</option>
              </select>
            </div>

            <div className="p-3 bg-emerald-50 text-emerald-900 rounded-xl font-mono flex justify-between items-center">
              <span>Novo Saldo Previsto:</span>
              <strong className="text-sm">
                {adjustmentType === 'ENTRADA'
                  ? adjustingProduct.stockQuantity + Number(adjustmentDelta)
                  : adjustingProduct.stockQuantity - Number(adjustmentDelta)}{' '}
                {adjustingProduct.unit}
              </strong>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAdjustingProduct(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
                {isSubmitting ? 'Salvando no banco...' : 'Confirmar Ajuste'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
