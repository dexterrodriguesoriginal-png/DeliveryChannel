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
import { formatBRL } from '../../lib/pricing/money';
import {
  businessUsesStock,
  canConvertUnits,
  computeReplenishmentRecommendations,
  computeStockFinancialReport,
  convertStockQuantity,
  daysUntilDate,
  evaluateLotStatus,
  selectLotsFEFO,
  STOCK_CONTROL_MODE_LABELS,
  STOCK_UNIT_LABELS,
  stockStatus,
} from '../../lib/stock';
import {
  InventoryMovement,
  PurchaseOrder,
  PurchaseOrderStatus,
  StockAdjustmentRequest,
  StockControlMode,
  StockCount,
  StockLocation,
  StockLot,
  StockLotStatus,
  StockProductBalance,
  StockReplenishmentRecommendation,
  StockSupplier,
  StockUnit,
} from '../../types';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Lock,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShoppingCart,
  TrendingDown,
  Truck,
  Unlock,
} from 'lucide-react';

type InventoryTab =
  | 'OVERVIEW'
  | 'PRODUCTS'
  | 'MOVEMENTS'
  | 'LOTS'
  | 'INVENTORY'
  | 'PURCHASES'
  | 'REPORTS';

type ModalOperation =
  | 'RECORD_MOVEMENT'
  | 'CORRECT_STOCK'
  | 'BLOCK_STOCK'
  | 'TRANSFER'
  | 'SETTINGS'
  | 'LOCATION'
  | 'NEW_LOT'
  | 'NEW_SUPPLIER'
  | 'NEW_PO'
  | 'RECEIVE_PO';

const ALL_UNITS: StockUnit[] = ['un', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'm2', 'cm2', 'pack', 'cx', 'fd'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha inesperada ao executar a operação de estoque.';
}

function formatQty(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
}

function movementLabel(type: InventoryMovement['type']): string {
  const labels: Record<InventoryMovement['type'], string> = {
    ENTRADA: 'Entrada',
    SAIDA: 'Saída',
    AJUSTE: 'Ajuste auditado',
    VENDA: 'Venda',
    ESTORNO: 'Cancelamento / Estorno',
    PERDA: 'Perda',
    OPENING_BALANCE: 'Saldo inicial',
    RECEIPT: 'Recebimento de fornecedor',
    RESERVATION: 'Reserva para pedido',
    SALE: 'Venda concluída',
    CONSUMPTION: 'Consumo interno',
    CANCEL_RELEASE: 'Liberação de reserva',
    CUSTOMER_RETURN: 'Devolução de cliente',
    LOSS: 'Perda',
    DAMAGE: 'Avaria',
    EXPIRY: 'Baixa por vencimento',
    COUNT_ADJUSTMENT: 'Ajuste de inventário',
    TRANSFER_IN: 'Transferência recebida',
    TRANSFER_OUT: 'Transferência enviada',
    WEIGHT_CORRECTION: 'Correção de peso',
  };
  return labels[type] || type;
}

function poStatusLabel(status: PurchaseOrderStatus): { label: string; variant: 'neutral' | 'warning' | 'info' | 'success' | 'danger' } {
  switch (status) {
    case 'DRAFT':
      return { label: 'Rascunho', variant: 'neutral' };
    case 'PENDING_APPROVAL':
      return { label: 'Aguardando aprovação', variant: 'warning' };
    case 'APPROVED':
      return { label: 'Aprovado (A receber)', variant: 'info' };
    case 'PARTIALLY_RECEIVED':
      return { label: 'Recebido parcialmente', variant: 'warning' };
    case 'COMPLETED':
      return { label: 'Concluído (Recebido)', variant: 'success' };
    case 'CANCELLED':
      return { label: 'Cancelado', variant: 'danger' };
  }
}

function lotStatusBadge(status: StockLotStatus): { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Ativo (Apto para venda)', variant: 'success' };
    case 'QUARANTINE':
      return { label: 'Em quarentena (Bloqueado)', variant: 'warning' };
    case 'BLOCKED':
      return { label: 'Bloqueado', variant: 'danger' };
    case 'EXPIRED':
      return { label: 'Vencido (Indisponível)', variant: 'danger' };
    case 'DEPLETED':
      return { label: 'Esgotado', variant: 'neutral' };
  }
}

export const InventoryPage: React.FC = () => {
  const { activeTenant, activeRole, securityContext } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<InventoryTab>('OVERVIEW');
  const [products, setProducts] = useState<StockProductBalance[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [lots, setLots] = useState<StockLot[]>([]);
  const [suppliers, setSuppliers] = useState<StockSupplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [adjustmentRequests, setAdjustmentRequests] = useState<StockAdjustmentRequest[]>([]);
  const [incoming, setIncoming] = useState<StockIncoming[]>([]);

  const [selectedLocation, setSelectedLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filters
  const [productSearch, setProductSearch] = useState('');
  const [productFilter, setProductFilter] = useState<'ALL' | 'CRITICAL' | 'OUT' | 'BELOW_MIN' | 'LOTS' | 'BLOCKED'>('ALL');
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('ALL');

  // Modals & Active Selections
  const [modalOp, setModalOp] = useState<ModalOperation | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<StockProductBalance | null>(null);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

  // Generic Operation Form
  const [opForm, setOpForm] = useState({
    movementType: 'RECEIPT',
    quantity: '',
    inputUnit: 'un' as StockUnit,
    targetPhysicalBalance: '',
    reason: '',
    supplierReference: '',
    unitCost: '',
    lotCode: '',
    expiresOn: '',
    targetLocation: '',
    locationName: '',
    blockAction: 'BLOCK' as 'BLOCK' | 'UNBLOCK',
    requireApproval: false,
    // Settings
    stockControlMode: 'UNIT' as StockControlMode,
    stockUnit: 'un' as StockUnit,
    packageQuantity: '1',
    leadTimeDays: '3',
    minOrderQty: '0',
    minStock: '5',
    safetyStock: '0',
    trackLots: false,
    trackSerials: false,
    isResale: false,
  });

  // New Supplier Form
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    legalName: '',
    document: '',
    contactName: '',
    phone: '',
    email: '',
    defaultLeadTimeDays: '3',
    minOrderValue: '0',
    paymentTerms: '28 dias',
  });

  // New Purchase Order Form
  const [poForm, setPoForm] = useState({
    supplierId: '',
    expectedDeliveryDate: '',
    notes: '',
    submitForApproval: false,
    productId: '',
    orderedQuantity: '',
    unitCost: '',
  });

  // Receive Purchase Order Form
  const [receiveItemsState, setReceiveItemsState] = useState<
    Record<
      string,
      {
        receivedNowQuantity: string;
        unitCost: string;
        lotCode: string;
        expiresOn: string;
        divergenceReason: string;
      }
    >
  >({});

  // Physical Inventory Count Form
  const [countValues, setCountValues] = useState<Record<string, string>>({});
  const [countReasons, setCountReasons] = useState<Record<string, string>>({});

  const isManager =
    activeRole === 'OWNER' ||
    activeRole === 'MANAGER' ||
    activeRole === 'CEO' ||
    activeRole === 'SUPER_ADMIN';

  const refresh = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError('');
    try {
      const [
        dashboard,
        movementRows,
        lotRows,
        supplierRows,
        poRows,
        countRows,
        adjRows,
        incomingRows,
      ] = await Promise.all([
        inventoryRepository.getDashboard(securityContext, activeTenant.id),
        inventoryRepository.getMovements(securityContext, activeTenant.id),
        inventoryRepository.getLots(securityContext, activeTenant.id),
        inventoryRepository.getSuppliers(securityContext, activeTenant.id),
        inventoryRepository.getPurchaseOrders(securityContext, activeTenant.id),
        inventoryRepository.getCounts(activeTenant.id),
        inventoryRepository.getAdjustmentRequests(securityContext, activeTenant.id),
        inventoryRepository.getIncoming(activeTenant.id),
      ]);

      setProducts(dashboard.products);
      setLocations(dashboard.locations);
      setMovements(movementRows);
      setLots(lotRows);
      setSuppliers(supplierRows);
      setPurchaseOrders(poRows);
      setCounts(countRows);
      setAdjustmentRequests(adjRows);
      setIncoming(incomingRows);

      if (
        !selectedLocation ||
        !dashboard.locations.some(location => location.id === selectedLocation)
      ) {
        setSelectedLocation(
          dashboard.locations.find(location => location.isDefault)?.id ||
            dashboard.locations[0]?.id ||
            ''
        );
      }
    } catch (err) {
      console.warn('[InventoryPage] Falha ao carregar estoque:', err);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, securityContext, selectedLocation]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleProducts = useMemo(
    () =>
      products.filter(row => !selectedLocation || row.locationId === selectedLocation),
    [products, selectedLocation]
  );

  const filteredProducts = useMemo(() => {
    return visibleProducts.filter(p => {
      const matchesSearch =
        !productSearch.trim() ||
        p.productName.toLowerCase().includes(productSearch.toLowerCase()) ||
        (p.sku && p.sku.toLowerCase().includes(productSearch.toLowerCase()));
      if (!matchesSearch) return false;

      if (productFilter === 'OUT') return p.availableQuantity <= 0;
      if (productFilter === 'BELOW_MIN')
        return p.availableQuantity > 0 && p.availableQuantity <= p.minStock;
      if (productFilter === 'CRITICAL') return p.availableQuantity <= p.minStock;
      if (productFilter === 'LOTS') return p.trackLots;
      if (productFilter === 'BLOCKED') return p.blockedQuantity > 0;
      return true;
    });
  }, [visibleProducts, productSearch, productFilter]);

  const filteredMovements = useMemo(() => {
    return movements.filter(m => {
      if (movementTypeFilter !== 'ALL' && m.type !== movementTypeFilter) return false;
      if (!movementSearch.trim()) return true;
      const q = movementSearch.toLowerCase();
      return (
        m.productName.toLowerCase().includes(q) ||
        m.reason.toLowerCase().includes(q) ||
        (m.referenceId && m.referenceId.toLowerCase().includes(q)) ||
        (m.lotCode && m.lotCode.toLowerCase().includes(q)) ||
        (m.createdByName && m.createdByName.toLowerCase().includes(q))
      );
    });
  }, [movements, movementTypeFilter, movementSearch]);

  const recommendations = useMemo(
    () =>
      computeReplenishmentRecommendations({
        products: visibleProducts,
        movements,
        lots,
        suppliers,
      }),
    [visibleProducts, movements, lots, suppliers]
  );

  const financialReport = useMemo(
    () =>
      computeStockFinancialReport({
        products: visibleProducts,
        movements,
        counts,
        purchaseOrders,
      }),
    [visibleProducts, movements, counts, purchaseOrders]
  );

  // Executive Overview Metrics (ETAPA 2)
  const overviewMetrics = useMemo(() => {
    const active = visibleProducts.filter(p => p.isActive && p.stockControlMode !== 'NONE');
    const outOfStock = active.filter(p => p.availableQuantity <= 0);
    const belowMin = active.filter(
      p => p.availableQuantity > 0 && p.availableQuantity <= p.minStock
    );
    const critical = active.filter(p => p.availableQuantity <= p.minStock);
    const ruptureRisk = recommendations.filter(
      r => r.urgency === 'CRITICAL_OUT' || r.urgency === 'RUPTURE_BEFORE_LEAD_TIME'
    );
    const actionableSuggestions = recommendations.filter(r => r.suggestedQuantity > 0);

    const expiringLots = lots.filter(l => {
      if (l.remainingQuantity <= 0) return false;
      const st = evaluateLotStatus(l);
      if (st === 'EXPIRED') return true;
      const days = daysUntilDate(l.expiresOn);
      return days !== null && days <= 15;
    });

    const pendingPOs = purchaseOrders.filter(po => po.status === 'PENDING_APPROVAL');
    const pendingCounts = counts.filter(c => c.status === 'PENDING');
    const pendingAdjustments = adjustmentRequests.filter(r => r.status === 'PENDING_APPROVAL');
    const totalPendingApprovals =
      pendingPOs.length + pendingCounts.length + pendingAdjustments.length;

    return {
      activeCount: active.length,
      outOfStock,
      belowMin,
      critical,
      ruptureRisk,
      actionableSuggestions,
      expiringLots,
      pendingPOs,
      pendingCounts,
      pendingAdjustments,
      totalPendingApprovals,
    };
  }, [visibleProducts, recommendations, lots, purchaseOrders, counts, adjustmentRequests]);

  if (!activeTenant || !businessUsesStock(activeTenant.businessType)) return null;

  const openProductModal = (op: ModalOperation, product: StockProductBalance | null = null) => {
    setSelectedProduct(product);
    setModalOp(op);
    const unit = product?.unit || 'un';
    setOpForm({
      movementType: op === 'RECORD_MOVEMENT' ? 'RECEIPT' : 'COUNT_ADJUSTMENT',
      quantity: '',
      inputUnit: unit,
      targetPhysicalBalance: product ? String(product.physicalQuantity) : '',
      reason: '',
      supplierReference: '',
      unitCost: product?.costPrice ? String(product.costPrice) : '',
      lotCode: '',
      expiresOn: '',
      targetLocation:
        locations.find(location => location.id !== (product?.locationId || selectedLocation))
          ?.id || '',
      locationName: '',
      blockAction: 'BLOCK',
      requireApproval: !isManager,
      stockControlMode: product?.stockControlMode || (product?.trackLots ? 'LOT_EXPIRY' : 'UNIT'),
      stockUnit: unit,
      packageQuantity: String(product?.packageQuantity || 1),
      leadTimeDays: String(product?.leadTimeDays || 3),
      minOrderQty: String(product?.minOrderQty || 0),
      minStock: product ? String(product.minStock) : '5',
      safetyStock: product ? String(product.safetyStock) : '0',
      trackLots: Boolean(product?.trackLots),
      trackSerials: Boolean(product?.trackSerials),
      isResale: Boolean(product?.stockIsResale),
    });
  };

  const handleCreateDraftPOFromSuggestion = async (rec: StockReplenishmentRecommendation) => {
    if (!activeTenant?.id) return;
    setIsSubmitting(true);
    try {
      const defaultSupplier =
        suppliers.find(s => s.id === rec.preferredSupplierId) || suppliers[0];
      const po = await inventoryRepository.createPurchaseOrder(securityContext, activeTenant.id, {
        supplierId: defaultSupplier?.id || 'Fornecedor Homologado',
        locationId: selectedLocation,
        expectedDeliveryDate: new Date(
          Date.now() + rec.leadTimeDays * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .slice(0, 10),
        notes: `Gerado a partir de sugestão determinística de reposição (${rec.reason})`,
        submitForApproval: false, // Sempre cria como RASCUNHO (ETAPA 5 & 10)
        originRecommendation: true,
        items: [
          {
            productId: rec.productId,
            orderedQuantity: rec.suggestedQuantity,
            unitCost: rec.estimatedUnitCost || 0,
            unit: rec.unit,
            packageQuantity: rec.packageQuantity,
          },
        ],
      });
      showToast({
        type: 'success',
        title: 'Rascunho de compra preparado',
        message: `Pedido ${po.code} criado em RASCUNHO para revisão humana na aba Compras e fornecedores.`,
      });
      await refresh();
      setActiveTab('PURCHASES');
    } catch (err) {
      showToast({ type: 'error', title: 'Falha ao preparar compra', message: errorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenant?.id || !modalOp) return;
    setIsSubmitting(true);
    try {
      if (modalOp === 'LOCATION') {
        await inventoryRepository.addLocation(activeTenant.id, opForm.locationName, securityContext);
        showToast({
          type: 'success',
          title: 'Local adicionado',
          message: `O local "${opForm.locationName}" foi cadastrado.`,
        });
      } else if (modalOp === 'SETTINGS' && selectedProduct) {
        await inventoryRepository.updateSettings(
          {
            tenantId: activeTenant.id,
            productId: selectedProduct.productId,
            unit: opForm.stockUnit,
            stockControlMode: opForm.stockControlMode,
            packageQuantity: Math.max(1, Number(opForm.packageQuantity) || 1),
            leadTimeDays: Math.max(1, Number(opForm.leadTimeDays) || 3),
            minOrderQty: Math.max(0, Number(opForm.minOrderQty) || 0),
            minStock: Number(opForm.minStock),
            safetyStock: Number(opForm.safetyStock),
            trackLots: opForm.trackLots || opForm.stockControlMode === 'LOT_EXPIRY',
            trackSerials: opForm.trackSerials || opForm.stockControlMode === 'SERIAL',
            isResale: opForm.isResale,
          },
          securityContext
        );
        showToast({
          type: 'success',
          title: 'Parâmetros atualizados',
          message: `Configuração de controle de "${selectedProduct.productName}" salva.`,
        });
      } else if (modalOp === 'TRANSFER' && selectedProduct) {
        await inventoryRepository.transfer(
          {
            tenantId: activeTenant.id,
            productId: selectedProduct.productId,
            fromLocation: selectedProduct.locationId,
            toLocation: opForm.targetLocation,
            quantity: Number(opForm.quantity),
            reason: opForm.reason,
          },
          securityContext
        );
        showToast({
          type: 'success',
          title: 'Transferência concluída',
          message: 'Movimentação entre locais registrada com sucesso.',
        });
      } else if (modalOp === 'BLOCK_STOCK' && selectedProduct) {
        await inventoryRepository.setBlock(securityContext, {
          tenantId: activeTenant.id,
          productId: selectedProduct.productId,
          locationId: selectedProduct.locationId,
          quantity: Number(opForm.quantity),
          reason: opForm.reason,
          block: opForm.blockAction === 'BLOCK',
        });
        showToast({
          type: 'success',
          title: opForm.blockAction === 'BLOCK' ? 'Estoque bloqueado' : 'Bloqueio liberado',
          message: 'O saldo disponível para venda foi recalculado.',
        });
      } else if (modalOp === 'CORRECT_STOCK' && selectedProduct) {
        const target = Number(opForm.targetPhysicalBalance);
        if (!Number.isFinite(target) || target < 0) {
          throw new Error('Informe um saldo físico corrigido válido (zero ou maior).');
        }
        const delta = Math.round((target - selectedProduct.physicalQuantity + Number.EPSILON) * 1000) / 1000;
        if (delta === 0) {
          throw new Error('O saldo informado é idêntico ao saldo físico atual.');
        }
        const isWeightProduct =
          selectedProduct.stockControlMode === 'WEIGHT' ||
          selectedProduct.unit === 'kg' ||
          selectedProduct.unit === 'g';
        const res = await inventoryRepository.recordMovement(
          {
            tenantId: activeTenant.id,
            productId: selectedProduct.productId,
            locationId: selectedProduct.locationId,
            type: isWeightProduct ? 'WEIGHT_CORRECTION' : 'COUNT_ADJUSTMENT',
            quantity: delta,
            inputUnit: selectedProduct.unit,
            reason: `Correção controlada de estoque (${selectedProduct.physicalQuantity} → ${target} ${selectedProduct.unit}): ${opForm.reason.trim()}`,
            lotCode: opForm.lotCode || undefined,
            requireApproval: opForm.requireApproval,
          },
          securityContext
        );
        if (res.pendingRequest) {
          showToast({
            type: 'info',
            title: 'Correção aguardando aprovação',
            message: 'A solicitação foi registrada e aguarda validação do gerente/proprietário.',
          });
        } else {
          showToast({
            type: 'success',
            title: 'Estoque corrigido com auditoria',
            message: `Saldo ajustado de ${formatQty(selectedProduct.physicalQuantity)} para ${formatQty(target)} ${selectedProduct.unit}.`,
          });
        }
      } else if (modalOp === 'RECORD_MOVEMENT' && selectedProduct) {
        const qty = Number(opForm.quantity);
        const res = await inventoryRepository.recordMovement(
          {
            tenantId: activeTenant.id,
            productId: selectedProduct.productId,
            locationId: selectedProduct.locationId,
            type: opForm.movementType,
            quantity: qty,
            inputUnit: opForm.inputUnit,
            reason: opForm.reason,
            supplierReference: opForm.supplierReference || undefined,
            lotCode: opForm.lotCode || undefined,
            expiresOn: opForm.expiresOn || undefined,
            unitCost: opForm.unitCost ? Number(opForm.unitCost) : undefined,
            requireApproval: opForm.requireApproval,
          },
          securityContext
        );
        if (res.pendingRequest) {
          showToast({
            type: 'info',
            title: 'Operação enviada para aprovação',
            message: 'Registrada na fila de aprovações pendentes.',
          });
        } else {
          showToast({
            type: 'success',
            title: 'Movimentação registrada',
            message: 'O histórico e os saldos foram atualizados.',
          });
        }
      } else if (modalOp === 'NEW_LOT' && selectedProduct) {
        await inventoryRepository.createOrUpdateLot(securityContext, activeTenant.id, {
          productId: selectedProduct.productId,
          locationId: selectedProduct.locationId,
          lotCode: opForm.lotCode,
          supplierName: opForm.supplierReference || undefined,
          expiresOn: opForm.expiresOn || undefined,
          receivedQuantity: Number(opForm.quantity),
          unitCost: Number(opForm.unitCost || selectedProduct.costPrice || 0),
          notes: opForm.reason || undefined,
          recordReceiptMovement: true,
        });
        showToast({
          type: 'success',
          title: 'Lote registrado',
          message: `Lote ${opForm.lotCode.toUpperCase()} incorporado ao estoque físico.`,
        });
      } else if (modalOp === 'NEW_SUPPLIER') {
        await inventoryRepository.saveSupplier(securityContext, activeTenant.id, {
          name: supplierForm.name,
          legalName: supplierForm.legalName,
          document: supplierForm.document,
          contactName: supplierForm.contactName,
          phone: supplierForm.phone,
          email: supplierForm.email,
          defaultLeadTimeDays: Number(supplierForm.defaultLeadTimeDays) || 3,
          minOrderValue: Number(supplierForm.minOrderValue) || 0,
          paymentTerms: supplierForm.paymentTerms,
        });
        showToast({
          type: 'success',
          title: 'Fornecedor cadastrado',
          message: `"${supplierForm.name}" adicionado à base do estabelecimento.`,
        });
      } else if (modalOp === 'NEW_PO') {
        const po = await inventoryRepository.createPurchaseOrder(securityContext, activeTenant.id, {
          supplierId: poForm.supplierId,
          locationId: selectedLocation,
          expectedDeliveryDate: poForm.expectedDeliveryDate || undefined,
          notes: poForm.notes || undefined,
          submitForApproval: poForm.submitForApproval,
          items: [
            {
              productId: poForm.productId,
              orderedQuantity: Number(poForm.orderedQuantity),
              unitCost: Number(poForm.unitCost),
            },
          ],
        });
        showToast({
          type: 'success',
          title: po.status === 'PENDING_APPROVAL' ? 'Pedido enviado para aprovação' : 'Rascunho criado',
          message: `Ordem de compra ${po.code} registrada sem alterar o estoque físico.`,
        });
      } else if (modalOp === 'RECEIVE_PO' && selectedPO) {
        const payload = selectedPO.items.map(item => {
          const st = receiveItemsState[item.id] || {
            receivedNowQuantity: '0',
            unitCost: String(item.unitCost),
            lotCode: '',
            expiresOn: '',
            divergenceReason: '',
          };
          return {
            itemId: item.id,
            receivedNowQuantity: Number(st.receivedNowQuantity || 0),
            unitCost: Number(st.unitCost || item.unitCost),
            lotCode: st.lotCode || undefined,
            expiresOn: st.expiresOn || undefined,
            divergenceReason: st.divergenceReason || undefined,
          };
        });
        await inventoryRepository.receivePurchaseOrder(
          securityContext,
          activeTenant.id,
          selectedPO.id,
          payload
        );
        showToast({
          type: 'success',
          title: 'Mercadoria recebida no estoque',
          message: `Entrada física e custo médio atualizados para ${selectedPO.code}.`,
        });
      }

      setModalOp(null);
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Operação não realizada', message: errorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitCount = async (asDraft: boolean) => {
    if (!activeTenant?.id || !selectedLocation) return;
    const filledProducts = visibleProducts.filter(
      p => countValues[p.productId] !== undefined && countValues[p.productId] !== ''
    );
    if (filledProducts.length === 0) {
      showToast({
        type: 'error',
        title: 'Contagem vazia',
        message: 'Preencha a quantidade contada de ao menos um produto.',
      });
      return;
    }

    const countsToSubmit = filledProducts.map(product => ({
      product_id: product.productId,
      counted_quantity: Number(countValues[product.productId]),
      reason: countReasons[product.productId] || undefined,
    }));

    if (
      countsToSubmit.some(
        item => !Number.isFinite(item.counted_quantity) || item.counted_quantity < 0
      )
    ) {
      showToast({
        type: 'error',
        title: 'Quantidade inválida',
        message: 'As quantidades contadas devem ser números maiores ou iguais a zero.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await inventoryRepository.submitCount(
        activeTenant.id,
        selectedLocation,
        countsToSubmit,
        securityContext,
        asDraft
      );
      setCountValues({});
      setCountReasons({});
      showToast({
        type: 'success',
        title: asDraft ? 'Rascunho de inventário salvo' : 'Contagem enviada para aprovação',
        message: asDraft
          ? 'Você pode revisar e submeter para aprovação quando concluir a conferência.'
          : 'As divergências foram apuradas e aguardam revisão do responsável.',
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha no inventário', message: errorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewCount = async (countId: string, approve: boolean) => {
    if (!activeTenant?.id) return;
    try {
      await inventoryRepository.approveCount(
        countId,
        approve,
        approve
          ? 'Ajuste de divergência aprovado após conferência de inventário físico'
          : 'Contagem física rejeitada para recontagem',
        securityContext,
        activeTenant.id
      );
      showToast({
        type: 'success',
        title: approve ? 'Inventário aprovado' : 'Inventário rejeitado',
        message: approve
          ? 'Os ajustes de saldo foram lançados de forma rastreável nas movimentações.'
          : 'A contagem foi encerrada sem alterar os saldos físicos.',
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha na revisão', message: errorMessage(err) });
    }
  };

  const handlePromoteDraftCount = async (countId: string) => {
    if (!activeTenant?.id) return;
    try {
      await inventoryRepository.promoteDraftCount(securityContext, activeTenant.id, countId);
      showToast({
        type: 'success',
        title: 'Enviado para aprovação',
        message: 'O rascunho de contagem agora aguarda aprovação gerencial.',
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha ao enviar', message: errorMessage(err) });
    }
  };

  const handlePOAction = async (
    poId: string,
    action: 'SUBMIT' | 'APPROVE' | 'CANCEL'
  ) => {
    if (!activeTenant?.id) return;
    try {
      await inventoryRepository.updatePurchaseOrderStatus(
        securityContext,
        activeTenant.id,
        poId,
        action
      );
      showToast({
        type: 'success',
        title:
          action === 'APPROVE'
            ? 'Pedido de compra aprovado'
            : action === 'SUBMIT'
              ? 'Pedido enviado para aprovação'
              : 'Pedido cancelado',
        message:
          action === 'APPROVE'
            ? 'As quantidades constam agora em "Estoque a receber" até a conferência física.'
            : 'Status do pedido atualizado.',
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha no pedido', message: errorMessage(err) });
    }
  };

  const openReceivePOModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    const initial: typeof receiveItemsState = {};
    for (const item of po.items) {
      const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity);
      initial[item.id] = {
        receivedNowQuantity: String(remaining),
        unitCost: String(item.unitCost),
        lotCode: item.lotCode || '',
        expiresOn: item.expiresOn || '',
        divergenceReason: item.divergenceReason || '',
      };
    }
    setReceiveItemsState(initial);
    setModalOp('RECEIVE_PO');
  };

  const handleReviewAdjustment = async (reqId: string, approve: boolean) => {
    if (!activeTenant?.id) return;
    try {
      await inventoryRepository.reviewAdjustmentRequest(
        securityContext,
        activeTenant.id,
        reqId,
        approve
      );
      showToast({
        type: 'success',
        title: approve ? 'Ajuste aprovado' : 'Ajuste rejeitado',
        message: approve
          ? 'A movimentação foi efetivada no saldo do produto.'
          : 'A solicitação foi arquivada sem alterar saldos.',
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Erro na aprovação', message: errorMessage(err) });
    }
  };

  const handleLotStatusChange = async (lot: StockLot, nextStatus: StockLotStatus) => {
    if (!activeTenant?.id) return;
    try {
      await inventoryRepository.setLotStatus(
        securityContext,
        activeTenant.id,
        lot.id,
        nextStatus,
        nextStatus === 'ACTIVE'
          ? 'Lote liberado após inspeção de qualidade'
          : 'Bloqueio preventivo / quarentena de lote'
      );
      showToast({
        type: 'success',
        title: 'Situação do lote atualizada',
        message: `Lote ${lot.lotCode} marcado como ${nextStatus}.`,
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', title: 'Falha ao atualizar lote', message: errorMessage(err) });
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Executive Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Controle de Estoque, Rastreabilidade & Reposição
          </h2>
          <p className="text-xs text-gray-500">
            Gestão multi-segmento com saldos separados (físico, reservado, bloqueado, disponível e a receber), lotes FEFO e compras sob aprovação.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {locations.length > 0 && (
            <select
              aria-label="Local de estoque"
              value={selectedLocation}
              onChange={event => setSelectedLocation(event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700"
            >
              {locations.map(location => (
                <option key={location.id} value={location.id}>
                  Local: {location.name}
                </option>
              ))}
            </select>
          )}
          {isManager && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openProductModal('LOCATION')}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Novo local
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </header>

      {error && (
        <Card className="flex items-center justify-between gap-3 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <strong>Não foi possível atualizar o estoque.</strong>
              <p className="text-xs">{error}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Tentar novamente
          </Button>
        </Card>
      )}

      {/* 7 Required Navigation Areas (ETAPA 2) */}
      <Tabs
        tabs={[
          {
            id: 'OVERVIEW',
            label: 'Visão geral',
            badge:
              overviewMetrics.critical.length + overviewMetrics.totalPendingApprovals ||
              undefined,
          },
          {
            id: 'PRODUCTS',
            label: 'Produtos e saldos',
            badge: visibleProducts.length,
          },
          {
            id: 'MOVEMENTS',
            label: 'Movimentações do estoque',
            badge: movements.length,
          },
          {
            id: 'LOTS',
            label: 'Lotes e validade',
            badge: overviewMetrics.expiringLots.length || lots.length || undefined,
          },
          {
            id: 'INVENTORY',
            label: 'Inventário físico',
            badge: overviewMetrics.pendingCounts.length || undefined,
          },
          {
            id: 'PURCHASES',
            label: 'Compras e fornecedores',
            badge: purchaseOrders.filter(po => po.status !== 'COMPLETED' && po.status !== 'CANCELLED').length || undefined,
          },
          {
            id: 'REPORTS',
            label: 'Relatórios',
          },
        ]}
        activeTab={activeTab}
        onChange={tab => setActiveTab(tab as InventoryTab)}
        variant="underline"
      />

      {/* ===================================================================== */}
      {/* 1. VISÃO GERAL (ETAPA 2, 5 & 10)                                      */}
      {/* ===================================================================== */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-5">
          {/* Priority Status Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              title="Estoque Crítico"
              value={overviewMetrics.critical.length}
              subtext={`${overviewMetrics.belowMin.length} abaixo do mín.`}
              icon={<AlertTriangle className="h-4 w-4" />}
              iconColorClass="bg-amber-50 text-amber-700 border-amber-100"
            />
            <StatCard
              title="Indisponíveis"
              value={overviewMetrics.outOfStock.length}
              subtext="Saldo disponível zero"
              icon={<TrendingDown className="h-4 w-4" />}
              iconColorClass="bg-rose-50 text-rose-700 border-rose-100"
            />
            <StatCard
              title="Risco antes da entrega"
              value={overviewMetrics.ruptureRisk.length}
              subtext="Cobertura < prazo fornecedor"
              icon={<Truck className="h-4 w-4" />}
              iconColorClass="bg-orange-50 text-orange-700 border-orange-100"
            />
            <StatCard
              title="Próximos ao vencimento"
              value={overviewMetrics.expiringLots.length}
              subtext="Lotes em até 15 dias / vencidos"
              icon={<CalendarClock className="h-4 w-4" />}
              iconColorClass="bg-purple-50 text-purple-700 border-purple-100"
            />
            <StatCard
              title="Aguardando aprovação"
              value={overviewMetrics.totalPendingApprovals}
              subtext="Compras, contagens e ajustes"
              icon={<FileCheck2 className="h-4 w-4" />}
              iconColorClass="bg-sky-50 text-sky-700 border-sky-100"
            />
            <StatCard
              title="Valor do estoque (CMPM)"
              value={
                financialReport.productsWithCostCount > 0
                  ? formatBRL(financialReport.totalInventoryCostValue)
                  : 'Custo pendente'
              }
              subtext={
                financialReport.productsWithoutCostCount > 0
                  ? `${financialReport.productsWithCostCount}/${financialReport.totalActiveSkus} SKUs c/ custo`
                  : `Custo médio (${financialReport.productsWithCostCount} SKUs)`
              }
              icon={<PackageCheck className="h-4 w-4" />}
            />
          </div>

          {/* Transparency banner when some products don't have acquisition cost registered */}
          {financialReport.productsWithoutCostCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <strong>Atenção na valorização financeira:</strong> {financialReport.productsWithoutCostCount} produto(s) ativo(s) ainda não possuem custo de aquisição cadastrado ({financialReport.productsWithoutCostNames.slice(0, 3).join(', ')}). O valor do estoque soma apenas os itens com custo válido comprovado.
              </div>
              <Button size="sm" variant="outline" onClick={() => setActiveTab('REPORTS')}>
                Ver detalhes em Relatórios
              </Button>
            </div>
          )}

          {/* Central de Aprovações Pendentes (ETAPA 10) */}
          {overviewMetrics.totalPendingApprovals > 0 && (
            <Card className="p-4 border-sky-200 bg-sky-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    Operações Aguardando Aprovação Humana ({overviewMetrics.totalPendingApprovals})
                  </h3>
                  <p className="text-xs text-gray-500">
                    Nenhuma ordem de compra, ajuste de inventário ou correção crítica é efetivada sem validação de um responsável autorizado.
                  </p>
                </div>
              </div>

              <div className="divide-y divide-gray-200/70 bg-white rounded-xl border border-gray-200 px-3">
                {overviewMetrics.pendingPOs.map(po => (
                  <div
                    key={po.id}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-gray-900">
                        Pedido de Compra {po.code} · {po.supplierName}
                      </span>
                      <span className="text-gray-500">
                        {' '}
                        · Solicitado por {po.submittedByName || po.createdByName} · Total estimado{' '}
                        <strong className="font-mono">{formatBRL(po.totalEstimated)}</strong>
                      </span>
                    </div>
                    {isManager && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handlePOAction(po.id, 'APPROVE')}
                        >
                          Aprovar Compra
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handlePOAction(po.id, 'CANCEL')}
                        >
                          Cancelar
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {overviewMetrics.pendingCounts.map(cnt => (
                  <div
                    key={cnt.id}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-gray-900">
                        Contagem de Inventário Físico ({cnt.items.length} itens)
                      </span>
                      <span className="text-gray-500">
                        {' '}
                        · Enviada por {cnt.submittedByName || 'Operador'} em{' '}
                        {new Date(cnt.submittedAt).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    {isManager && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handleReviewCount(cnt.id, true)}
                        >
                          Aprovar Ajustes
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleReviewCount(cnt.id, false)}
                        >
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {overviewMetrics.pendingAdjustments.map(req => (
                  <div
                    key={req.id}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-gray-900">
                        Solicitação de {movementLabel(req.type)}: {req.productName}
                      </span>
                      <span className="text-gray-500 font-mono">
                        {' '}
                        · {formatQty(req.previousQuantity)} → {formatQty(req.newQuantity)} {req.unit} ({req.delta > 0 ? '+' : ''}{formatQty(req.delta)})
                      </span>
                      <p className="text-gray-500">
                        Por {req.requestedByName} · Motivo: {req.reason}
                      </p>
                    </div>
                    {isManager && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handleReviewAdjustment(req.id, true)}
                        >
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleReviewAdjustment(req.id, false)}
                        >
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Motor Determinístico de Inteligência e Reposição (ETAPA 5) */}
          <Card className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-900">
                  Inteligência de Cobertura & Sugestões de Reposição
                </h3>
                <p className="text-xs text-gray-500">
                  Cálculo determinístico baseado no histórico real de vendas, reservas ativas, compras a receber, prazo do fornecedor, lotes a vencer e múltiplos de embalagem.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActiveTab('PURCHASES')}>
                Ver Pedidos de Compra
              </Button>
            </div>

            {recommendations.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-4">
                Nenhum produto com controle de estoque ativo neste local.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-xs">
                  <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                    <tr>
                      <th className="p-2.5">Produto</th>
                      <th className="p-2.5">Situação / Risco</th>
                      <th className="p-2.5">Disponível / A receber</th>
                      <th className="p-2.5">Demanda & Cobertura</th>
                      <th className="p-2.5">Ponto de Pedido</th>
                      <th className="p-2.5">Sugestão de Compra</th>
                      <th className="p-2.5">Diagnóstico & Fatores</th>
                      <th className="p-2.5 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recommendations.map(rec => {
                      const urgencyBadge =
                        rec.urgency === 'CRITICAL_OUT'
                          ? { label: 'Sem estoque', variant: 'danger' as const }
                          : rec.urgency === 'RUPTURE_BEFORE_LEAD_TIME'
                            ? { label: 'Risco antes da entrega', variant: 'danger' as const }
                            : rec.urgency === 'BELOW_MIN'
                              ? { label: 'Abaixo do mínimo', variant: 'warning' as const }
                              : rec.urgency === 'BELOW_ROP'
                                ? { label: 'Atingiu ponto de pedido', variant: 'warning' as const }
                                : rec.urgency === 'EXPIRY_RISK'
                                  ? { label: 'Risco de vencimento', variant: 'warning' as const }
                                  : { label: 'Saudável', variant: 'success' as const };

                      return (
                        <tr key={rec.productId} className="align-top hover:bg-gray-50/60">
                          <td className="p-2.5">
                            <strong className="block text-gray-900">{rec.productName}</strong>
                            <span className="font-mono text-[10px] text-gray-400">
                              {rec.sku || rec.productId} · Prazo: {rec.leadTimeDays}d
                            </span>
                            {rec.isPreliminary && (
                              <span className="block mt-0.5 text-[10px] text-amber-700 font-medium">
                                Previsão preliminar (regras manuais)
                              </span>
                            )}
                          </td>
                          <td className="p-2.5">
                            <Badge variant={urgencyBadge.variant} size="sm">
                              {urgencyBadge.label}
                            </Badge>
                          </td>
                          <td className="p-2.5 font-mono">
                            <div>
                              Disp.: <strong>{formatQty(rec.availableQuantity)}</strong> {rec.unit}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              A receber: {formatQty(rec.incomingQuantity)} {rec.unit}
                            </div>
                          </td>
                          <td className="p-2.5 font-mono">
                            <div>
                              {rec.dailyDemand > 0
                                ? `${formatQty(rec.dailyDemand)} ${rec.unit}/dia`
                                : 'Sem saídas'}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              Cobertura:{' '}
                              {rec.coverageDays !== null ? `${rec.coverageDays} dias` : '—'}
                            </div>
                          </td>
                          <td className="p-2.5 font-mono">
                            <div>
                              ROP: {formatQty(rec.reorderPoint)} {rec.unit}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              Mín: {formatQty(rec.minStock)} / Seg: {formatQty(rec.safetyStock)}
                            </div>
                          </td>
                          <td className="p-2.5 font-mono">
                            {rec.suggestedQuantity > 0 ? (
                              <div>
                                <strong className="text-emerald-800">
                                  +{formatQty(rec.suggestedQuantity)} {rec.unit}
                                </strong>
                                {rec.estimatedTotalCost !== null && (
                                  <span className="block text-[11px] text-gray-500">
                                    Est.: {formatBRL(rec.estimatedTotalCost)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">Sem necessidade</span>
                            )}
                          </td>
                          <td className="p-2.5 text-[11px] text-gray-600 max-w-xs">
                            <p className="font-medium text-gray-800">{rec.reason}</p>
                            <p className="text-gray-400 mt-0.5">
                              {rec.factorsConsidered.slice(0, 3).join(' · ')}
                            </p>
                          </td>
                          <td className="p-2.5 text-right">
                            {rec.suggestedQuantity > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSubmitting}
                                onClick={() => void handleCreateDraftPOFromSuggestion(rec)}
                              >
                                <ShoppingCart className="mr-1 h-3.5 w-3.5" /> Gerar rascunho OC
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. PRODUTOS E SALDOS (ETAPA 3 & 4)                                    */}
      {/* ===================================================================== */}
      {activeTab === 'PRODUCTS' && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar produto por nome ou SKU..."
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'Todos' },
                  { id: 'CRITICAL', label: 'Críticos' },
                  { id: 'OUT', label: 'Indisponíveis' },
                  { id: 'BELOW_MIN', label: 'Abaixo do mínimo' },
                  { id: 'LOTS', label: 'Com Lote/Validade' },
                  { id: 'BLOCKED', label: 'Com Bloqueio' },
                ] as const
              ).map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setProductFilter(f.id)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    productFilter === f.id
                      ? 'bg-emerald-700 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-2.5 text-[11px] text-gray-600 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Regra operacional:</strong> Estoque disponível = Estoque físico − Estoque reservado − Estoque bloqueado. Compras a receber não integram o saldo físico até o recebimento validado.
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                  <tr>
                    <th className="p-3">Produto / Modo de Controle</th>
                    {locations.length > 1 && <th className="p-3">Local</th>}
                    <th className="p-3">Estoque físico</th>
                    <th className="p-3">Reservado</th>
                    <th className="p-3">Bloqueado</th>
                    <th className="p-3">Disponível</th>
                    <th className="p-3">A receber</th>
                    <th className="p-3">Mín. / Seg.</th>
                    <th className="p-3">Custo médio</th>
                    <th className="p-3 text-right">Operações Auditáveis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={locations.length > 1 ? 10 : 9}
                        className="p-8 text-center text-gray-500"
                      >
                        Nenhum produto encontrado para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map(product => {
                      const status = stockStatus(product.availableQuantity, product.minStock);
                      const modeInfo =
                        STOCK_CONTROL_MODE_LABELS[product.stockControlMode || 'UNIT'];
                      return (
                        <tr
                          key={`${product.productId}:${product.locationId}`}
                          className="hover:bg-gray-50/50"
                        >
                          <td className="p-3">
                            <strong className="block text-gray-900">{product.productName}</strong>
                            <span className="font-mono text-[10px] text-gray-500">
                              {product.sku || product.productId} · {modeInfo?.label || 'Unidade'}
                              {product.packageQuantity && product.packageQuantity > 1
                                ? ` (1 emb = ${product.packageQuantity} ${product.unit})`
                                : ''}
                              {product.trackLots ? ' · Lote/FEFO' : ''}
                            </span>
                          </td>
                          {locations.length > 1 && (
                            <td className="p-3 text-gray-600">{product.locationName}</td>
                          )}
                          <td className="p-3 font-mono font-semibold text-gray-900">
                            {formatQty(product.physicalQuantity)} {product.unit}
                          </td>
                          <td className="p-3 font-mono text-amber-700">
                            {formatQty(product.reservedQuantity)} {product.unit}
                          </td>
                          <td className="p-3 font-mono text-rose-700">
                            {formatQty(product.blockedQuantity)} {product.unit}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={
                                status === 'OUT_OF_STOCK'
                                  ? 'danger'
                                  : status === 'BELOW_MINIMUM'
                                    ? 'warning'
                                    : 'success'
                              }
                              size="sm"
                            >
                              {formatQty(product.availableQuantity)} {product.unit}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono text-sky-700">
                            {formatQty(product.incomingQuantity)} {product.unit}
                          </td>
                          <td className="p-3 font-mono text-gray-600">
                            {formatQty(product.minStock)} / {formatQty(product.safetyStock)}
                          </td>
                          <td className="p-3 font-mono text-gray-800">
                            {product.costPrice > 0 ? (
                              formatBRL(product.costPrice)
                            ) : (
                              <span className="text-gray-400">Não inf.</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openProductModal('RECORD_MOVEMENT', product)}
                              >
                                Registrar movimentação
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openProductModal('CORRECT_STOCK', product)}
                              >
                                Corrigir estoque
                              </Button>
                              {isManager && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  title="Bloquear ou liberar unidades"
                                  onClick={() => openProductModal('BLOCK_STOCK', product)}
                                >
                                  <Lock className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {isManager && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  title="Configurar modo de controle e unidade"
                                  onClick={() => openProductModal('SETTINGS', product)}
                                >
                                  <Settings2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {locations.length > 1 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  title="Transferir entre locais"
                                  onClick={() => openProductModal('TRANSFER', product)}
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. MOVIMENTAÇÕES DO ESTOQUE (ETAPA 4)                                 */}
      {/* ===================================================================== */}
      {activeTab === 'MOVEMENTS' && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Filtrar por produto, motivo, pedido, lote ou responsável..."
                value={movementSearch}
                onChange={e => setMovementSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={movementTypeFilter}
                onChange={e => setMovementTypeFilter(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
              >
                <option value="ALL">Todos os tipos de movimentação</option>
                <option value="RECEIPT">Recebimento de fornecedor</option>
                <option value="ENTRADA">Entrada</option>
                <option value="RESERVATION">Reserva para pedido</option>
                <option value="SALE">Venda concluída</option>
                <option value="VENDA">Venda (Checkout)</option>
                <option value="CANCEL_RELEASE">Liberação de reserva</option>
                <option value="ESTORNO">Cancelamento / Estorno</option>
                <option value="CUSTOMER_RETURN">Devolução de cliente</option>
                <option value="LOSS">Perda</option>
                <option value="DAMAGE">Avaria</option>
                <option value="EXPIRY">Vencimento</option>
                <option value="COUNT_ADJUSTMENT">Ajuste de inventário</option>
                <option value="WEIGHT_CORRECTION">Correção de peso</option>
                <option value="TRANSFER_OUT">Transferência enviada</option>
                <option value="TRANSFER_IN">Transferência recebida</option>
              </select>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                  <tr>
                    <th className="p-3">Data / Horário</th>
                    <th className="p-3">Produto</th>
                    <th className="p-3">Tipo de Movimentação</th>
                    <th className="p-3">Quantidade</th>
                    <th className="p-3">Saldo Anterior → Corrigido</th>
                    <th className="p-3">Vínculo / Origem</th>
                    <th className="p-3">Responsável</th>
                    <th className="p-3">Justificativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-gray-500">
                        Nenhuma movimentação encontrada para os filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.map(movement => (
                      <tr key={movement.id} className="hover:bg-gray-50/50">
                        <td className="p-3 font-mono text-gray-500">
                          {new Date(movement.timestamp).toLocaleString('pt-BR')}
                        </td>
                        <td className="p-3 font-semibold text-gray-900">
                          {movement.productName}
                        </td>
                        <td className="p-3">
                          <Badge variant="neutral" size="sm">
                            {movementLabel(movement.type)}
                          </Badge>
                        </td>
                        <td
                          className={`p-3 font-mono font-bold ${
                            movement.quantity >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {movement.quantity > 0 ? '+' : ''}
                          {formatQty(movement.quantity)} {movement.unit || 'un'}
                        </td>
                        <td className="p-3 font-mono text-gray-700">
                          {formatQty(movement.previousStock)} →{' '}
                          <strong>{formatQty(movement.newStock)}</strong>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-gray-600">
                          {movement.lotCode && (
                            <span className="block">Lote: {movement.lotCode}</span>
                          )}
                          {movement.supplierReference && (
                            <span className="block">Forn.: {movement.supplierReference}</span>
                          )}
                          {movement.referenceId && (
                            <span className="block text-gray-400">Ref: {movement.referenceId}</span>
                          )}
                          {!movement.lotCode &&
                            !movement.supplierReference &&
                            !movement.referenceId && <span>Operação interna</span>}
                        </td>
                        <td className="p-3 text-gray-700">
                          <span className="font-medium">
                            {movement.createdByName || 'Sistema'}
                          </span>
                          {movement.approvedByName && (
                            <span className="block text-[10px] text-emerald-700">
                              Aprov.: {movement.approvedByName}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-gray-600">{movement.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 4. LOTES E VALIDADE — FEFO (ETAPA 6)                                  */}
      {/* ===================================================================== */}
      {activeTab === 'LOTS' && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">
                Rastreabilidade de Lotes & Prioridade FEFO (Primeiro que Vence, Primeiro que Sai)
              </h3>
              <p className="text-xs text-gray-500">
                Lotes vencidos, em quarentena ou bloqueados são automaticamente deduzidos do estoque disponível para impedir venda indevida.
              </p>
            </div>
            {visibleProducts.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => openProductModal('NEW_LOT', visibleProducts[0])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Registrar Entrada de Lote
              </Button>
            )}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                  <tr>
                    <th className="p-3">Código do Lote</th>
                    <th className="p-3">Produto</th>
                    <th className="p-3">Fornecedor</th>
                    <th className="p-3">Recebimento</th>
                    <th className="p-3">Data de Validade</th>
                    <th className="p-3">Qtd. Recebida / Restante</th>
                    <th className="p-3">Custo Aquisição</th>
                    <th className="p-3">Situação / Prioridade FEFO</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lots.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-gray-500">
                        Nenhum lote cadastrado. Habilite o controle de lotes nos produtos perecíveis ou registre um novo recebimento com lote.
                      </td>
                    </tr>
                  ) : (
                    lots.map(lot => {
                      const computedStatus = evaluateLotStatus(lot);
                      const badge = lotStatusBadge(computedStatus);
                      const daysLeft = daysUntilDate(lot.expiresOn);
                      const productActiveLots = lots.filter(
                        l =>
                          l.productId === lot.productId &&
                          evaluateLotStatus(l) === 'ACTIVE' &&
                          l.remainingQuantity > 0
                      );
                      const fefoPick = selectLotsFEFO(productActiveLots, 1);
                      const isFefoPriority =
                        fefoPick.allocations[0]?.lotId === lot.id && computedStatus === 'ACTIVE';

                      return (
                        <tr key={lot.id} className="hover:bg-gray-50/50">
                          <td className="p-3 font-mono font-bold text-gray-900">
                            {lot.lotCode}
                            {isFefoPriority && (
                              <span className="block text-[10px] font-sans font-bold text-emerald-700">
                                ★ 1º na fila FEFO (Usar primeiro)
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-semibold text-gray-900">{lot.productName}</td>
                          <td className="p-3 text-gray-600">
                            {lot.supplierName || 'Não informado'}
                          </td>
                          <td className="p-3 font-mono text-gray-500">
                            {new Date(lot.receivedAt).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="p-3 font-mono">
                            {lot.expiresOn ? (
                              <div>
                                <span
                                  className={
                                    daysLeft !== null && daysLeft < 0
                                      ? 'font-bold text-rose-700'
                                      : daysLeft !== null && daysLeft <= 15
                                        ? 'font-bold text-amber-700'
                                        : 'text-gray-800'
                                  }
                                >
                                  {new Date(`${lot.expiresOn}T12:00:00Z`).toLocaleDateString('pt-BR')}
                                </span>
                                {daysLeft !== null && (
                                  <span className="block text-[10px] text-gray-500">
                                    {daysLeft < 0
                                      ? `Vencido há ${Math.abs(daysLeft)} dia(s)`
                                      : daysLeft === 0
                                        ? 'Vence hoje'
                                        : `Vence em ${daysLeft} dia(s)`}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">Indeterminada</span>
                            )}
                          </td>
                          <td className="p-3 font-mono">
                            {formatQty(lot.receivedQuantity)} →{' '}
                            <strong>{formatQty(lot.remainingQuantity)}</strong> {lot.unit}
                          </td>
                          <td className="p-3 font-mono">{formatBRL(lot.unitCost)}</td>
                          <td className="p-3">
                            <Badge variant={badge.variant} size="sm">
                              {badge.label}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            {isManager && lot.remainingQuantity > 0 && (
                              <div className="flex justify-end gap-1">
                                {computedStatus === 'ACTIVE' ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleLotStatusChange(lot, 'QUARANTINE')}
                                  >
                                    Quarentena
                                  </Button>
                                ) : computedStatus === 'QUARANTINE' ||
                                  computedStatus === 'BLOCKED' ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleLotStatusChange(lot, 'ACTIVE')}
                                  >
                                    Liberar
                                  </Button>
                                ) : null}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 5. INVENTÁRIO FÍSICO (ETAPA 7 & 10)                                   */}
      {/* ===================================================================== */}
      {activeTab === 'INVENTORY' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-emerald-700" />
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    Contagem Física & Apuração de Divergências
                  </h3>
                  <p className="text-xs text-gray-500">
                    Informe a quantidade física contada no local. O sistema apura sobras e faltas e exige aprovação gerencial antes de ajustar o saldo.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSubmitting || visibleProducts.length === 0}
                  onClick={() => void handleSubmitCount(true)}
                >
                  Salvar em Rascunho
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isSubmitting || visibleProducts.length === 0}
                  onClick={() => void handleSubmitCount(false)}
                >
                  Enviar para Aprovação
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                  <tr>
                    <th className="p-2.5">Produto</th>
                    <th className="p-2.5">Saldo Físico Esperado</th>
                    <th className="p-2.5">Quantidade Contada</th>
                    <th className="p-2.5">Divergência Apurada</th>
                    <th className="p-2.5">Impacto Financeiro (CMPM)</th>
                    <th className="p-2.5">Observação / Justificativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleProducts.map(product => {
                    const rawVal = countValues[product.productId];
                    const hasVal = rawVal !== undefined && rawVal !== '';
                    const countedNum = hasVal ? Number(rawVal) : product.physicalQuantity;
                    const div = hasVal
                      ? Math.round((countedNum - product.physicalQuantity + Number.EPSILON) * 1000) /
                        1000
                      : 0;
                    const impact = div * product.costPrice;

                    return (
                      <tr key={product.productId}>
                        <td className="p-2.5 font-semibold text-gray-900">
                          {product.productName}
                          <span className="block font-mono text-[10px] text-gray-400">
                            {product.sku || product.productId}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono text-gray-700">
                          {formatQty(product.physicalQuantity)} {product.unit}
                        </td>
                        <td className="p-2.5">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            placeholder={String(product.physicalQuantity)}
                            value={countValues[product.productId] ?? ''}
                            onChange={e =>
                              setCountValues(prev => ({
                                ...prev,
                                [product.productId]: e.target.value,
                              }))
                            }
                            aria-label={`Contagem de ${product.productName}`}
                            className="w-32 rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </td>
                        <td className="p-2.5 font-mono">
                          {!hasVal ? (
                            <span className="text-gray-400">—</span>
                          ) : div === 0 ? (
                            <span className="text-emerald-700 font-semibold">Sem divergência</span>
                          ) : (
                            <span
                              className={`font-bold ${
                                div > 0 ? 'text-sky-700' : 'text-rose-700'
                              }`}
                            >
                              {div > 0 ? '+' : ''}
                              {formatQty(div)} {product.unit}
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono">
                          {!hasVal || div === 0 ? (
                            <span className="text-gray-400">R$ 0,00</span>
                          ) : (
                            <span className={impact >= 0 ? 'text-sky-700' : 'text-rose-700'}>
                              {impact > 0 ? '+' : ''}
                              {formatBRL(impact)}
                            </span>
                          )}
                        </td>
                        <td className="p-2.5">
                          <input
                            type="text"
                            placeholder="Opcional (ex: quebra, sobra de caixa)..."
                            value={countReasons[product.productId] ?? ''}
                            onChange={e =>
                              setCountReasons(prev => ({
                                ...prev,
                                [product.productId]: e.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-gray-100 p-4">
              <h3 className="text-sm font-bold text-gray-900">
                Histórico de Contagens Físicas & Aprovações
              </h3>
            </div>
            {counts.length === 0 ? (
              <p className="p-6 text-xs text-gray-500 text-center">
                Nenhum inventário físico registrado até o momento.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {counts.map(count => (
                  <li
                    key={count.id}
                    className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="text-xs space-y-1">
                      <div className="flex items-center gap-2">
                        <strong>{new Date(count.submittedAt).toLocaleString('pt-BR')}</strong>
                        <Badge
                          variant={
                            count.status === 'PENDING'
                              ? 'warning'
                              : count.status === 'APPROVED'
                                ? 'success'
                                : count.status === 'DRAFT'
                                  ? 'neutral'
                                  : 'danger'
                          }
                          size="sm"
                        >
                          {count.status === 'PENDING'
                            ? 'Aguardando aprovação'
                            : count.status === 'APPROVED'
                              ? 'Concluído (Aprovado)'
                              : count.status === 'DRAFT'
                                ? 'Rascunho'
                                : 'Rejeitado'}
                        </Badge>
                        {count.submittedByName && (
                          <span className="text-gray-500">
                            Contado por: <strong>{count.submittedByName}</strong>
                          </span>
                        )}
                        {count.approvedByName && (
                          <span className="text-emerald-700">
                            · Revisado por: <strong>{count.approvedByName}</strong>
                          </span>
                        )}
                      </div>
                      <div className="text-gray-600 font-mono text-[11px]">
                        {count.items
                          .map(
                            item =>
                              `${item.productName}: esp. ${formatQty(item.expectedQuantity)} → cont. ${formatQty(item.countedQuantity)} ${item.unit}`
                          )
                          .join(' · ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {count.status === 'DRAFT' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handlePromoteDraftCount(count.id)}
                        >
                          Enviar para aprovação
                        </Button>
                      )}
                      {isManager && count.status === 'PENDING' && (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => void handleReviewCount(count.id, true)}
                          >
                            Aprovar e Ajustar Saldos
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleReviewCount(count.id, false)}
                          >
                            Rejeitar
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 6. COMPRAS E FORNECEDORES (ETAPA 7 & 10)                              */}
      {/* ===================================================================== */}
      {activeTab === 'PURCHASES' && (
        <div className="space-y-5">
          {/* Purchase Orders Section */}
          <Card className="overflow-hidden p-0">
            <div className="border-b border-gray-100 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-900">
                  Pedidos de Compra & Conferência de Recebimento
                </h3>
                <p className="text-xs text-gray-500">
                  Fluxo controlado: Rascunho → Aguardando aprovação → Aprovado (Estoque a receber) → Recebimento validado (Entrada física).
                </p>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setPoForm({
                    supplierId: suppliers[0]?.id || '',
                    expectedDeliveryDate: '',
                    notes: '',
                    submitForApproval: false,
                    productId: visibleProducts[0]?.productId || '',
                    orderedQuantity: '12',
                    unitCost: String(visibleProducts[0]?.costPrice || 10),
                  });
                  setModalOp('NEW_PO');
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Novo Pedido de Compra
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                  <tr>
                    <th className="p-3">Código / Data</th>
                    <th className="p-3">Fornecedor</th>
                    <th className="p-3">Status Operacional</th>
                    <th className="p-3">Itens (Pedido vs. Recebido)</th>
                    <th className="p-3">Valor Estimado / Recebido</th>
                    <th className="p-3">Rastreabilidade</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {purchaseOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-500">
                        Nenhum pedido de compra registrado.
                      </td>
                    </tr>
                  ) : (
                    purchaseOrders.map(po => {
                      const st = poStatusLabel(po.status);
                      return (
                        <tr key={po.id} className="hover:bg-gray-50/50 align-top">
                          <td className="p-3">
                            <strong className="font-mono text-gray-900 block">{po.code}</strong>
                            <span className="text-[11px] text-gray-500">
                              {new Date(po.createdAt).toLocaleDateString('pt-BR')}
                            </span>
                            {po.originRecommendation && (
                              <span className="block text-[10px] text-emerald-700 font-medium">
                                Origem: Sugestão de Reposição
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-semibold text-gray-900">
                            {po.supplierName}
                            {po.expectedDeliveryDate && (
                              <span className="block text-[10px] font-normal text-gray-500">
                                Entrega prev.: {po.expectedDeliveryDate}
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <Badge variant={st.variant} size="sm">
                              {st.label}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono text-[11px]">
                            {po.items.map(item => (
                              <div key={item.id} className="mb-1">
                                <span className="font-sans font-semibold text-gray-800">
                                  {item.productName}:
                                </span>{' '}
                                pedido {formatQty(item.orderedQuantity)} / recebido{' '}
                                <strong>{formatQty(item.receivedQuantity)}</strong> {item.unit}
                                {item.divergenceQuantity !== undefined &&
                                  item.divergenceQuantity !== 0 && (
                                    <span className="text-amber-700 block">
                                      Divergência: {item.divergenceQuantity > 0 ? '+' : ''}
                                      {formatQty(item.divergenceQuantity)} {item.unit}
                                      {item.divergenceReason ? ` (${item.divergenceReason})` : ''}
                                    </span>
                                  )}
                              </div>
                            ))}
                          </td>
                          <td className="p-3 font-mono">
                            <div>Est.: {formatBRL(po.totalEstimated)}</div>
                            {po.totalReceivedValue > 0 && (
                              <div className="text-[11px] text-emerald-700">
                                Rec.: {formatBRL(po.totalReceivedValue)}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-[11px] text-gray-600">
                            <div>Criado: {po.createdByName}</div>
                            {po.approvedByName && (
                              <div className="text-emerald-700">Aprovado: {po.approvedByName}</div>
                            )}
                            {po.receivedByName && (
                              <div className="text-sky-700">Recebido: {po.receivedByName}</div>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {po.status === 'DRAFT' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handlePOAction(po.id, 'SUBMIT')}
                                >
                                  Enviar p/ aprovação
                                </Button>
                              )}
                              {isManager &&
                                (po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL') && (
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => void handlePOAction(po.id, 'APPROVE')}
                                  >
                                    Aprovar OC
                                  </Button>
                                )}
                              {(po.status === 'APPROVED' ||
                                po.status === 'PARTIALLY_RECEIVED') && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => openReceivePOModal(po)}
                                >
                                  Receber mercadoria
                                </Button>
                              )}
                              {isManager &&
                                po.status !== 'COMPLETED' &&
                                po.status !== 'CANCELLED' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handlePOAction(po.id, 'CANCEL')}
                                  >
                                    Cancelar
                                  </Button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Suppliers Section */}
          <Card className="overflow-hidden p-0">
            <div className="border-b border-gray-100 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-900">
                  Fornecedores & Condições Comerciais
                </h3>
                <p className="text-xs text-gray-500">
                  Prazos médios de entrega (Lead Time), pedido mínimo e condições de fornecimento.
                </p>
              </div>
              {isManager && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSupplierForm({
                      name: '',
                      legalName: '',
                      document: '',
                      contactName: '',
                      phone: '',
                      email: '',
                      defaultLeadTimeDays: '3',
                      minOrderValue: '0',
                      paymentTerms: '28 dias',
                    });
                    setModalOp('NEW_SUPPLIER');
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Cadastrar Fornecedor
                </Button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                  <tr>
                    <th className="p-3">Fornecedor / Razão Social</th>
                    <th className="p-3">CNPJ / Documento</th>
                    <th className="p-3">Contato</th>
                    <th className="p-3">Prazo Habitual (Lead Time)</th>
                    <th className="p-3">Pedido Mínimo / Condições</th>
                    <th className="p-3">Produtos Vinculados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {suppliers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        Nenhum fornecedor cadastrado neste estabelecimento.
                      </td>
                    </tr>
                  ) : (
                    suppliers.map(sup => (
                      <tr key={sup.id}>
                        <td className="p-3">
                          <strong className="block text-gray-900">{sup.name}</strong>
                          {sup.legalName && (
                            <span className="text-[11px] text-gray-500">{sup.legalName}</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-gray-600">{sup.document || '—'}</td>
                        <td className="p-3 text-gray-600">
                          <div>{sup.contactName || '—'}</div>
                          <div className="text-[11px] text-gray-400">
                            {sup.phone} {sup.email ? `· ${sup.email}` : ''}
                          </div>
                        </td>
                        <td className="p-3 font-mono font-semibold text-gray-900">
                          {sup.defaultLeadTimeDays} dia(s)
                        </td>
                        <td className="p-3 text-gray-600">
                          <div>
                            Mín.:{' '}
                            <span className="font-mono">
                              {sup.minOrderValue ? formatBRL(sup.minOrderValue) : 'Sem mínimo'}
                            </span>
                          </div>
                          {sup.paymentTerms && (
                            <div className="text-[11px] text-gray-400">{sup.paymentTerms}</div>
                          )}
                        </td>
                        <td className="p-3 text-gray-600">
                          {sup.products.length > 0
                            ? sup.products
                                .map(
                                  p =>
                                    `${p.productName} (${formatBRL(p.lastUnitCost)}/${p.baseUnit}, mín. ${p.minOrderQuantity})`
                                )
                                .join(' · ')
                            : 'Fornecedor geral'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 7. RELATÓRIOS FINANCEIROS E OPERACIONAIS (ETAPA 8)                    */}
      {/* ===================================================================== */}
      {activeTab === 'REPORTS' && (
        <div className="space-y-5">
          <Card className="p-4 border-gray-200 bg-gray-50/70">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
              <div>
                <strong className="text-gray-900">
                  Método de Valorização Definido: {financialReport.valuationMethod}
                </strong>
                <p className="text-gray-600 mt-0.5">
                  Os indicadores abaixo separam estritamente o custo de aquisição imobilizado em estoque, o valor potencial de venda no catálogo, as entradas recebidas e as perdas operacionais. Faturamento de vendas não é misturado com valorização de estoque.
                </p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              title="Valor Total do Estoque"
              value={formatBRL(financialReport.totalInventoryCostValue)}
              subtext={`Pelo custo médio (${financialReport.productsWithCostCount} SKUs)`}
              icon={<PackageCheck className="h-4 w-4" />}
            />
            <StatCard
              title="Potencial de Venda"
              value={formatBRL(financialReport.totalPotentialRetailValue)}
              subtext="Preço de venda × saldo disponível"
              icon={<Boxes className="h-4 w-4" />}
            />
            <StatCard
              title="Mercadorias Recebidas"
              value={formatBRL(financialReport.receivedMerchandiseValue)}
              subtext={`${financialReport.receivedMerchandiseCount} recebimento(s) (30d)`}
              icon={<Truck className="h-4 w-4" />}
            />
            <StatCard
              title="Perdas Registradas"
              value={formatBRL(financialReport.registeredLossesValue)}
              subtext={`${financialReport.registeredLossesCount} ocorrência(s) (30d)`}
              icon={<TrendingDown className="h-4 w-4" />}
              iconColorClass="bg-rose-50 text-rose-700 border-rose-100"
            />
            <StatCard
              title="Giro de Estoque (30d)"
              value={
                financialReport.stockTurnover !== null
                  ? `${financialReport.stockTurnover}x`
                  : 'Sem base'
              }
              subtext={`CMV 30d: ${formatBRL(financialReport.cogsInWindow)}`}
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <StatCard
              title="Cobertura Estimada"
              value={
                financialReport.estimatedAverageCoverageDays !== null
                  ? `${financialReport.estimatedAverageCoverageDays} dias`
                  : 'Sem saídas'
              }
              subtext={`${financialReport.deadStockProducts.length} SKU(s) sem giro`}
              icon={<CalendarClock className="h-4 w-4" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Produtos sem movimentação (Estoque parado) */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-gray-100 p-4">
                <h3 className="text-sm font-bold text-gray-900">
                  Produtos sem Movimentação de Saída ( últimos 30 dias)
                </h3>
                <p className="text-xs text-gray-500">
                  Itens com saldo físico positivo e nenhuma venda ou consumo registrado no período.
                </p>
              </div>
              {financialReport.deadStockProducts.length === 0 ? (
                <p className="p-6 text-xs text-gray-500 text-center">
                  Todos os produtos com saldo físico tiveram movimentação recente.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                    <tr>
                      <th className="p-3">Produto</th>
                      <th className="p-3">Saldo Parado</th>
                      <th className="p-3 text-right">Capital Imobilizado (Custo)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {financialReport.deadStockProducts.map(item => (
                      <tr key={item.productId}>
                        <td className="p-3 font-semibold text-gray-900">{item.productName}</td>
                        <td className="p-3 font-mono">
                          {formatQty(item.physicalQuantity)} {item.unit}
                        </td>
                        <td className="p-3 font-mono text-right">
                          {formatBRL(item.tiedCapitalValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Divergências de Inventário e Recebimento */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-gray-100 p-4">
                <h3 className="text-sm font-bold text-gray-900">
                  Divergências de Inventário Físico & Recebimento
                </h3>
                <p className="text-xs text-gray-500">
                  Diferenças apuradas entre o saldo esperado/pedido e a conferência física real.
                </p>
              </div>
              {financialReport.inventoryDivergences.length === 0 ? (
                <p className="p-6 text-xs text-gray-500 text-center">
                  Nenhuma divergência apurada em contagens ou recebimentos.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-gray-100 bg-gray-50 font-semibold text-gray-500">
                    <tr>
                      <th className="p-3">Origem / Produto</th>
                      <th className="p-3">Esperado → Conferido</th>
                      <th className="p-3">Diferença</th>
                      <th className="p-3 text-right">Impacto (R$)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {financialReport.inventoryDivergences.map((div, idx) => (
                      <tr key={`${div.referenceId}-${idx}`}>
                        <td className="p-3">
                          <strong className="block text-gray-900">{div.productName}</strong>
                          <span className="text-[10px] text-gray-500">
                            {div.source === 'COUNT' ? 'Inventário' : 'Recebimento OC'} ·{' '}
                            {div.referenceId}
                          </span>
                        </td>
                        <td className="p-3 font-mono">
                          {formatQty(div.expectedQty)} → {formatQty(div.actualQty)} {div.unit}
                        </td>
                        <td
                          className={`p-3 font-mono font-bold ${
                            div.divergenceQty >= 0 ? 'text-sky-700' : 'text-rose-700'
                          }`}
                        >
                          {div.divergenceQty > 0 ? '+' : ''}
                          {formatQty(div.divergenceQty)} {div.unit}
                        </td>
                        <td className="p-3 font-mono text-right">
                          {formatBRL(div.financialImpact)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAIS DE OPERAÇÕES CONTROLADAS                                       */}
      {/* ===================================================================== */}
      {modalOp && (
        <Modal
          isOpen
          onClose={() => setModalOp(null)}
          title={
            modalOp === 'RECORD_MOVEMENT'
              ? 'Registrar Movimentação Auditável'
              : modalOp === 'CORRECT_STOCK'
                ? 'Corrigir Estoque Físico (Com Auditoria)'
                : modalOp === 'BLOCK_STOCK'
                  ? 'Bloquear / Liberar Estoque'
                  : modalOp === 'SETTINGS'
                    ? 'Configurar Modo de Controle & Unidades'
                    : modalOp === 'TRANSFER'
                      ? 'Transferir Estoque entre Locais'
                      : modalOp === 'LOCATION'
                        ? 'Novo Local de Armazenamento'
                        : modalOp === 'NEW_LOT'
                          ? 'Registrar Entrada de Lote e Validade'
                          : modalOp === 'NEW_SUPPLIER'
                            ? 'Cadastrar Fornecedor Homologado'
                            : modalOp === 'NEW_PO'
                              ? 'Novo Pedido de Compra'
                              : 'Conferência e Recebimento de Pedido de Compra'
          }
          size={modalOp === 'RECEIVE_PO' ? 'lg' : 'md'}
        >
          <form onSubmit={handleModalSubmit} className="space-y-3.5 text-xs">
            {selectedProduct &&
              ['RECORD_MOVEMENT', 'CORRECT_STOCK', 'BLOCK_STOCK', 'SETTINGS', 'TRANSFER', 'NEW_LOT'].includes(
                modalOp
              ) && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1">
                  <div className="font-bold text-gray-900">{selectedProduct.productName}</div>
                  <div className="font-mono text-[11px] text-gray-600 flex flex-wrap gap-3">
                    <span>
                      Físico: <strong>{formatQty(selectedProduct.physicalQuantity)}</strong>{' '}
                      {selectedProduct.unit}
                    </span>
                    <span>
                      Reservado: <strong>{formatQty(selectedProduct.reservedQuantity)}</strong>
                    </span>
                    <span>
                      Bloqueado: <strong>{formatQty(selectedProduct.blockedQuantity)}</strong>
                    </span>
                    <span className="text-emerald-700">
                      Disponível: <strong>{formatQty(selectedProduct.availableQuantity)}</strong>{' '}
                      {selectedProduct.unit}
                    </span>
                  </div>
                </div>
              )}

            {/* 1. REGISTRAR MOVIMENTAÇÃO */}
            {modalOp === 'RECORD_MOVEMENT' && selectedProduct && (
              <>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    Natureza da Movimentação
                  </label>
                  <select
                    value={opForm.movementType}
                    onChange={e => setOpForm({ ...opForm, movementType: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                  >
                    <option value="RECEIPT">Recebimento de fornecedor (+)</option>
                    <option value="CUSTOMER_RETURN">Devolução de cliente (+)</option>
                    <option value="CONSUMPTION">Consumo interno / produção (-)</option>
                    <option value="LOSS">Perda operacional (-)</option>
                    <option value="DAMAGE">Avaria / quebra (-)</option>
                    <option value="EXPIRY">Baixa por vencimento (-)</option>
                    <option value="WEIGHT_CORRECTION">Correção de produto por peso (+/-)</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Quantidade"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={opForm.quantity}
                    onChange={e => setOpForm({ ...opForm, quantity: e.target.value })}
                    required
                  />
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">
                      Unidade da Operação
                    </label>
                    <select
                      value={opForm.inputUnit}
                      onChange={e =>
                        setOpForm({ ...opForm, inputUnit: e.target.value as StockUnit })
                      }
                      className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    >
                      {ALL_UNITS.filter(u =>
                        canConvertUnits(u, selectedProduct.unit, selectedProduct.packageQuantity)
                      ).map(u => (
                        <option key={u} value={u}>
                          {STOCK_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                    {opForm.inputUnit !== selectedProduct.unit &&
                      Number(opForm.quantity) > 0 && (
                        <p className="mt-1 font-mono text-[10px] text-emerald-700">
                          Equivale a{' '}
                          {formatQty(
                            convertStockQuantity(
                              Number(opForm.quantity),
                              opForm.inputUnit,
                              selectedProduct.unit,
                              selectedProduct.packageQuantity
                            )
                          )}{' '}
                          {selectedProduct.unit} na unidade-base.
                        </p>
                      )}
                  </div>
                </div>

                {opForm.movementType === 'RECEIPT' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Fornecedor / Nota Fiscal"
                      value={opForm.supplierReference}
                      onChange={e =>
                        setOpForm({ ...opForm, supplierReference: e.target.value })
                      }
                      placeholder="Ex: NF 4590 - Vinícola Serra"
                    />
                    <Input
                      label={`Custo Unitário por ${selectedProduct.unit} (R$)`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={opForm.unitCost}
                      onChange={e => setOpForm({ ...opForm, unitCost: e.target.value })}
                    />
                  </div>
                )}

                {(selectedProduct.trackLots ||
                  opForm.movementType === 'RECEIPT' ||
                  opForm.movementType === 'EXPIRY') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label={
                        selectedProduct.trackLots
                          ? 'Código do Lote (Obrigatório)'
                          : 'Código do Lote (Opcional)'
                      }
                      value={opForm.lotCode}
                      onChange={e => setOpForm({ ...opForm, lotCode: e.target.value })}
                      required={selectedProduct.trackLots && opForm.movementType === 'RECEIPT'}
                      placeholder="Ex: LOTE-2026-A"
                    />
                    {opForm.movementType === 'RECEIPT' && (
                      <Input
                        label="Data de Validade"
                        type="date"
                        value={opForm.expiresOn}
                        onChange={e => setOpForm({ ...opForm, expiresOn: e.target.value })}
                      />
                    )}
                  </div>
                )}

                <Input
                  label="Motivo / Justificativa Auditável *"
                  value={opForm.reason}
                  onChange={e => setOpForm({ ...opForm, reason: e.target.value })}
                  placeholder="Descreva a razão operacional da movimentação..."
                  required
                />
              </>
            )}

            {/* 2. CORRIGIR ESTOQUE (COM HISTÓRICO ANTERIOR -> CORRIGIDO) */}
            {modalOp === 'CORRECT_STOCK' && selectedProduct && (
              <>
                <Input
                  label={`Novo Saldo Físico Real (${selectedProduct.unit}) *`}
                  type="number"
                  step="0.001"
                  min="0"
                  value={opForm.targetPhysicalBalance}
                  onChange={e =>
                    setOpForm({ ...opForm, targetPhysicalBalance: e.target.value })
                  }
                  required
                />

                {opForm.targetPhysicalBalance !== '' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 font-mono text-xs text-amber-900">
                    <div>
                      Saldo anterior: <strong>{formatQty(selectedProduct.physicalQuantity)}</strong>{' '}
                      {selectedProduct.unit}
                    </div>
                    <div>
                      Saldo corrigido:{' '}
                      <strong>{formatQty(Number(opForm.targetPhysicalBalance))}</strong>{' '}
                      {selectedProduct.unit}
                    </div>
                    <div>
                      Diferença a registrar:{' '}
                      <strong>
                        {Number(opForm.targetPhysicalBalance) -
                          selectedProduct.physicalQuantity >
                        0
                          ? '+'
                          : ''}
                        {formatQty(
                          Number(opForm.targetPhysicalBalance) -
                            selectedProduct.physicalQuantity
                        )}{' '}
                        {selectedProduct.unit}
                      </strong>
                    </div>
                  </div>
                )}

                <Input
                  label="Motivo Obrigatório da Correção *"
                  value={opForm.reason}
                  onChange={e => setOpForm({ ...opForm, reason: e.target.value })}
                  placeholder="Ex: Quebra de balança, acerto após conferência de gôndola..."
                  required
                />

                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={opForm.requireApproval}
                    onChange={e =>
                      setOpForm({ ...opForm, requireApproval: e.target.checked })
                    }
                  />
                  <span>Submeter para aprovação gerencial antes de alterar o saldo</span>
                </label>
              </>
            )}

            {/* 3. BLOQUEAR / LIBERAR ESTOQUE */}
            {modalOp === 'BLOCK_STOCK' && selectedProduct && (
              <>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Ação</label>
                  <select
                    value={opForm.blockAction}
                    onChange={e =>
                      setOpForm({
                        ...opForm,
                        blockAction: e.target.value as 'BLOCK' | 'UNBLOCK',
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                  >
                    <option value="BLOCK">
                      Bloquear unidades (Retirar do estoque disponível para venda)
                    </option>
                    <option value="UNBLOCK">
                      Liberar unidades bloqueadas (Devolver ao disponível)
                    </option>
                  </select>
                </div>
                <Input
                  label={`Quantidade (${selectedProduct.unit}) *`}
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={opForm.quantity}
                  onChange={e => setOpForm({ ...opForm, quantity: e.target.value })}
                  required
                />
                <Input
                  label="Motivo do Bloqueio / Liberação *"
                  value={opForm.reason}
                  onChange={e => setOpForm({ ...opForm, reason: e.target.value })}
                  placeholder="Ex: Embalagem amassada aguardando troca do fornecedor"
                  required
                />
              </>
            )}

            {/* 4. CONFIGURAR MODO DE CONTROLE & UNIDADES */}
            {modalOp === 'SETTINGS' && selectedProduct && (
              <>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    Modo de Controle do Produto
                  </label>
                  <select
                    value={opForm.stockControlMode}
                    onChange={e =>
                      setOpForm({
                        ...opForm,
                        stockControlMode: e.target.value as StockControlMode,
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                  >
                    {(Object.keys(STOCK_CONTROL_MODE_LABELS) as StockControlMode[]).map(m => (
                      <option key={m} value={m}>
                        {STOCK_CONTROL_MODE_LABELS[m].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">
                      Unidade-Base de Estoque
                    </label>
                    <select
                      value={opForm.stockUnit}
                      onChange={e =>
                        setOpForm({ ...opForm, stockUnit: e.target.value as StockUnit })
                      }
                      className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    >
                      {ALL_UNITS.map(u => (
                        <option key={u} value={u}>
                          {STOCK_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="Fator de Embalagem (un/pack)"
                    type="number"
                    min="1"
                    step="1"
                    value={opForm.packageQuantity}
                    onChange={e =>
                      setOpForm({ ...opForm, packageQuantity: e.target.value })
                    }
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    label="Estoque Mínimo"
                    type="number"
                    step="0.001"
                    min="0"
                    value={opForm.minStock}
                    onChange={e => setOpForm({ ...opForm, minStock: e.target.value })}
                    required
                  />
                  <Input
                    label="Estoque de Segurança"
                    type="number"
                    step="0.001"
                    min="0"
                    value={opForm.safetyStock}
                    onChange={e => setOpForm({ ...opForm, safetyStock: e.target.value })}
                    required
                  />
                  <Input
                    label="Prazo Fornecedor (dias)"
                    type="number"
                    step="1"
                    min="1"
                    value={opForm.leadTimeDays}
                    onChange={e => setOpForm({ ...opForm, leadTimeDays: e.target.value })}
                    required
                  />
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={opForm.trackLots}
                      onChange={e => setOpForm({ ...opForm, trackLots: e.target.checked })}
                    />
                    <span>Habilitar rastreabilidade por Lote e Validade (FEFO)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={opForm.trackSerials}
                      onChange={e =>
                        setOpForm({ ...opForm, trackSerials: e.target.checked })
                      }
                    />
                    <span>Controlar individualmente por Número de Série / IMEI</span>
                  </label>
                </div>
              </>
            )}

            {/* 5. TRANSFERIR ENTRE LOCAIS */}
            {modalOp === 'TRANSFER' && selectedProduct && (
              <>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    Local de Destino
                  </label>
                  <select
                    value={opForm.targetLocation}
                    onChange={e => setOpForm({ ...opForm, targetLocation: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    required
                  >
                    <option value="">Selecione o local de destino</option>
                    {locations
                      .filter(l => l.id !== selectedProduct.locationId)
                      .map(l => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </div>
                <Input
                  label={`Quantidade a Transferir (${selectedProduct.unit}) *`}
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={opForm.quantity}
                  onChange={e => setOpForm({ ...opForm, quantity: e.target.value })}
                  required
                />
                <Input
                  label="Motivo da Transferência *"
                  value={opForm.reason}
                  onChange={e => setOpForm({ ...opForm, reason: e.target.value })}
                  placeholder="Ex: Abastecimento da geladeira de frente de loja"
                  required
                />
              </>
            )}

            {/* 6. NOVO LOCAL */}
            {modalOp === 'LOCATION' && (
              <Input
                label="Nome do Local de Armazenamento *"
                value={opForm.locationName}
                onChange={e => setOpForm({ ...opForm, locationName: e.target.value })}
                placeholder="Ex: Câmara Fria 02, Depósito Secundário..."
                required
              />
            )}

            {/* 7. NOVO LOTE */}
            {modalOp === 'NEW_LOT' && (
              <>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Produto *</label>
                  <select
                    value={selectedProduct?.productId || ''}
                    onChange={e => {
                      const prod =
                        visibleProducts.find(p => p.productId === e.target.value) || null;
                      setSelectedProduct(prod);
                    }}
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    required
                  >
                    {visibleProducts.map(p => (
                      <option key={p.productId} value={p.productId}>
                        {p.productName} ({p.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Código do Lote *"
                    value={opForm.lotCode}
                    onChange={e => setOpForm({ ...opForm, lotCode: e.target.value })}
                    placeholder="Ex: LOTE-2026-10"
                    required
                  />
                  <Input
                    label="Data de Validade"
                    type="date"
                    value={opForm.expiresOn}
                    onChange={e => setOpForm({ ...opForm, expiresOn: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label={`Quantidade Recebida (${selectedProduct?.unit || 'un'}) *`}
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={opForm.quantity}
                    onChange={e => setOpForm({ ...opForm, quantity: e.target.value })}
                    required
                  />
                  <Input
                    label="Custo Unitário de Aquisição (R$) *"
                    type="number"
                    step="0.01"
                    min="0"
                    value={opForm.unitCost}
                    onChange={e => setOpForm({ ...opForm, unitCost: e.target.value })}
                    required
                  />
                </div>
                <Input
                  label="Fornecedor"
                  value={opForm.supplierReference}
                  onChange={e =>
                    setOpForm({ ...opForm, supplierReference: e.target.value })
                  }
                  placeholder="Nome do fornecedor"
                />
              </>
            )}

            {/* 8. NOVO FORNECEDOR */}
            {modalOp === 'NEW_SUPPLIER' && (
              <>
                <Input
                  label="Nome Fantasia do Fornecedor *"
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  required
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Razão Social"
                    value={supplierForm.legalName}
                    onChange={e =>
                      setSupplierForm({ ...supplierForm, legalName: e.target.value })
                    }
                  />
                  <Input
                    label="CNPJ / CPF"
                    value={supplierForm.document}
                    onChange={e =>
                      setSupplierForm({ ...supplierForm, document: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    label="Contato Comercial"
                    value={supplierForm.contactName}
                    onChange={e =>
                      setSupplierForm({ ...supplierForm, contactName: e.target.value })
                    }
                  />
                  <Input
                    label="Telefone / WhatsApp"
                    value={supplierForm.phone}
                    onChange={e =>
                      setSupplierForm({ ...supplierForm, phone: e.target.value })
                    }
                  />
                  <Input
                    label="Prazo Entrega (dias) *"
                    type="number"
                    min="1"
                    value={supplierForm.defaultLeadTimeDays}
                    onChange={e =>
                      setSupplierForm({
                        ...supplierForm,
                        defaultLeadTimeDays: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Pedido Mínimo (R$)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={supplierForm.minOrderValue}
                    onChange={e =>
                      setSupplierForm({
                        ...supplierForm,
                        minOrderValue: e.target.value,
                      })
                    }
                  />
                  <Input
                    label="Condições de Pagamento"
                    value={supplierForm.paymentTerms}
                    onChange={e =>
                      setSupplierForm({
                        ...supplierForm,
                        paymentTerms: e.target.value,
                      })
                    }
                  />
                </div>
              </>
            )}

            {/* 9. NOVO PEDIDO DE COMPRA */}
            {modalOp === 'NEW_PO' && (
              <>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    Fornecedor *
                  </label>
                  <select
                    value={poForm.supplierId}
                    onChange={e => setPoForm({ ...poForm, supplierId: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    required
                  >
                    <option value="">Selecione um fornecedor</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} (Prazo: {s.defaultLeadTimeDays}d)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Produto *</label>
                  <select
                    value={poForm.productId}
                    onChange={e => {
                      const prod = visibleProducts.find(p => p.productId === e.target.value);
                      setPoForm({
                        ...poForm,
                        productId: e.target.value,
                        unitCost: prod?.costPrice ? String(prod.costPrice) : poForm.unitCost,
                      });
                    }}
                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                    required
                  >
                    {visibleProducts.map(p => (
                      <option key={p.productId} value={p.productId}>
                        {p.productName} ({p.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    label="Quantidade Solicitada *"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={poForm.orderedQuantity}
                    onChange={e =>
                      setPoForm({ ...poForm, orderedQuantity: e.target.value })
                    }
                    required
                  />
                  <Input
                    label="Custo Unitário (R$) *"
                    type="number"
                    step="0.01"
                    min="0"
                    value={poForm.unitCost}
                    onChange={e => setPoForm({ ...poForm, unitCost: e.target.value })}
                    required
                  />
                  <Input
                    label="Previsão de Entrega"
                    type="date"
                    value={poForm.expectedDeliveryDate}
                    onChange={e =>
                      setPoForm({ ...poForm, expectedDeliveryDate: e.target.value })
                    }
                  />
                </div>

                <Input
                  label="Observações do Pedido"
                  value={poForm.notes}
                  onChange={e => setPoForm({ ...poForm, notes: e.target.value })}
                />

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={poForm.submitForApproval}
                    onChange={e =>
                      setPoForm({ ...poForm, submitForApproval: e.target.checked })
                    }
                  />
                  <span>Enviar diretamente para aprovação gerencial</span>
                </label>
              </>
            )}

            {/* 10. RECEBER PEDIDO DE COMPRA (PARCIAL OU TOTAL COM DIVERGÊNCIA) */}
            {modalOp === 'RECEIVE_PO' && selectedPO && (
              <div className="space-y-3">
                <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
                  <strong>
                    Recebimento Físico · {selectedPO.code} ({selectedPO.supplierName})
                  </strong>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Informe a quantidade física efetivamente conferida no ato da entrega. Caso haja divergência ou entrega parcial, registre o motivo abaixo.
                  </p>
                </div>

                {selectedPO.items.map(item => {
                  const st = receiveItemsState[item.id] || {
                    receivedNowQuantity: '0',
                    unitCost: String(item.unitCost),
                    lotCode: '',
                    expiresOn: '',
                    divergenceReason: '',
                  };
                  const totalAfter =
                    item.receivedQuantity + (Number(st.receivedNowQuantity) || 0);
                  const hasDivergence = totalAfter !== item.orderedQuantity;

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-gray-200 p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-gray-900">{item.productName}</strong>
                        <span className="font-mono text-gray-600">
                          Pedido: {formatQty(item.orderedQuantity)} {item.unit} · Já recebido:{' '}
                          {formatQty(item.receivedQuantity)} {item.unit}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                        <Input
                          label={`Receber Agora (${item.unit})`}
                          type="number"
                          step="0.001"
                          min="0"
                          value={st.receivedNowQuantity}
                          onChange={e =>
                            setReceiveItemsState(prev => ({
                              ...prev,
                              [item.id]: { ...st, receivedNowQuantity: e.target.value },
                            }))
                          }
                        />
                        <Input
                          label="Custo Unit. NF (R$)"
                          type="number"
                          step="0.01"
                          min="0"
                          value={st.unitCost}
                          onChange={e =>
                            setReceiveItemsState(prev => ({
                              ...prev,
                              [item.id]: { ...st, unitCost: e.target.value },
                            }))
                          }
                        />
                        <Input
                          label="Lote"
                          value={st.lotCode}
                          placeholder="Ex: LOTE-105"
                          onChange={e =>
                            setReceiveItemsState(prev => ({
                              ...prev,
                              [item.id]: { ...st, lotCode: e.target.value },
                            }))
                          }
                        />
                        <Input
                          label="Validade"
                          type="date"
                          value={st.expiresOn}
                          onChange={e =>
                            setReceiveItemsState(prev => ({
                              ...prev,
                              [item.id]: { ...st, expiresOn: e.target.value },
                            }))
                          }
                        />
                      </div>

                      {hasDivergence && (
                        <Input
                          label="Justificativa de Recebimento Parcial / Divergência"
                          placeholder="Ex: Fornecedor entregou 2 caixas a menos; saldo restante virá na próxima rota"
                          value={st.divergenceReason}
                          onChange={e =>
                            setReceiveItemsState(prev => ({
                              ...prev,
                              [item.id]: { ...st, divergenceReason: e.target.value },
                            }))
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setModalOp(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? 'Processando...' : 'Confirmar Operação'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
