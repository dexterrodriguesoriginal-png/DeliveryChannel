import { describe, expect, it } from 'vitest';
import {
  businessUsesStock,
  canConvertUnits,
  computeOperationalBalances,
  computeReplenishmentRecommendations,
  computeStockFinancialReport,
  computeWeightedAverageCost,
  convertStockQuantity,
  daysUntilDate,
  evaluateLotStatus,
  selectLotsFEFO,
  stockAlerts,
  stockStatus,
  stockSummary,
  validateUnitMigration,
} from '../stock';
import {
  InventoryMovement,
  StockLot,
  StockProductBalance,
} from '../../types';
import { inventoryRepository } from '../../repositories/inventoryRepository';
import { SecurityContext } from '../../services/securityEngine';

function makeProductBalance(overrides: Partial<StockProductBalance> = {}): StockProductBalance {
  return {
    productId: 'prod-adega-1',
    productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
    sku: 'VIN-001',
    categoryId: 'cat-1',
    categoryName: 'Vinhos',
    locationId: 'loc-adega-main',
    locationName: 'Depósito Climatizado Principal',
    unit: 'un',
    stockControlMode: 'UNIT',
    packageQuantity: 6,
    physicalQuantity: 20,
    reservedQuantity: 0,
    blockedQuantity: 0,
    availableQuantity: 20,
    incomingQuantity: 0,
    minStock: 5,
    safetyStock: 3,
    leadTimeDays: 3,
    minOrderQty: 6,
    trackLots: true,
    isResale: true,
    isActive: true,
    costPrice: 40,
    price: 89.9,
    stockStatus: 'OK',
    ...overrides,
  };
}

function makeLot(overrides: Partial<StockLot> = {}): StockLot {
  return {
    id: 'lot-1',
    tenantId: 'tenant-adega-01',
    productId: 'prod-adega-1',
    productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
    locationId: 'loc-adega-main',
    lotCode: 'LOTE-2026-A',
    receivedAt: '2026-10-01T10:00:00Z',
    expiresOn: '2026-12-31',
    receivedQuantity: 20,
    remainingQuantity: 20,
    unit: 'un',
    unitCost: 40,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('stock domain helpers & multi-segment architecture', () => {
  describe('stockStatus & computeOperationalBalances (ETAPA 4)', () => {
    it('classifies stock status accurately', () => {
      expect(stockStatus(0, 5)).toBe('OUT_OF_STOCK');
      expect(stockStatus(-2, 5)).toBe('OUT_OF_STOCK');
      expect(stockStatus(5, 5)).toBe('BELOW_MINIMUM');
      expect(stockStatus(3, 5)).toBe('BELOW_MINIMUM');
      expect(stockStatus(6, 5)).toBe('OK');
    });

    it('discounts reserved, blocked, and expired/quarantined lot quantities from available stock and keeps incoming separate', () => {
      const bal = computeOperationalBalances({
        physicalQuantity: 30,
        reservedQuantity: 5,
        blockedQuantity: 3,
        expiredOrQuarantinedLotQuantity: 4,
        incomingQuantity: 15,
      });
      // Available = 30 - 5 - (3 + 4) = 18. Incoming (15) does NOT enter physical or available.
      expect(bal.physicalQuantity).toBe(30);
      expect(bal.reservedQuantity).toBe(5);
      expect(bal.blockedQuantity).toBe(7);
      expect(bal.availableQuantity).toBe(18);
      expect(bal.incomingQuantity).toBe(15);
    });

    it('identifies alerts and summary metrics excluding NONE control mode products', () => {
      const products = [
        makeProductBalance({ productId: 'p1', physicalQuantity: 10, availableQuantity: 10, minStock: 5, costPrice: 12 }),
        makeProductBalance({ productId: 'p2', physicalQuantity: 2, availableQuantity: 2, minStock: 5, costPrice: 20 }),
        makeProductBalance({ productId: 'p3', physicalQuantity: 0, availableQuantity: 0, minStock: 5, costPrice: 15, stockControlMode: 'NONE' }),
      ];

      const alerts = stockAlerts(products);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].productId).toBe('p2');
      expect(alerts[0].cause).toBe('BELOW_MINIMUM');

      const summary = stockSummary(products);
      expect(summary.activeSkus).toBe(2);
      expect(summary.criticalStock).toBe(1);
      expect(summary.inventoryValue).toBe(160); // 10*12 + 2*20
    });

    it('determines whether business type uses stock', () => {
      expect(businessUsesStock('RESTAURANTE')).toBe(true);
      expect(businessUsesStock('MERCADO')).toBe(true);
      expect(businessUsesStock('OUTRO')).toBe(false);
    });
  });

  describe('unit conversions & unit migration rules (ETAPA 3)', () => {
    it('converts accurately between weight, volume, length, area, and package units without precision loss', () => {
      expect(convertStockQuantity(1.5, 'kg', 'g')).toBe(1500);
      expect(convertStockQuantity(750, 'g', 'kg')).toBe(0.75);
      expect(convertStockQuantity(2, 'l', 'ml')).toBe(2000);
      expect(convertStockQuantity(350, 'ml', 'l')).toBe(0.35);
      expect(convertStockQuantity(2.5, 'm', 'cm')).toBe(250);
      expect(convertStockQuantity(1.2, 'm2', 'cm2')).toBe(12000);
      expect(convertStockQuantity(3, 'cx', 'un', 12)).toBe(36);
      expect(convertStockQuantity(24, 'un', 'cx', 12)).toBe(2);
    });

    it('rejects incompatible unit conversions with explicit error', () => {
      expect(canConvertUnits('kg', 'l')).toBe(false);
      expect(() => convertStockQuantity(5, 'kg', 'l')).toThrow(/incompatível/i);
    });

    it('validates unit migration when product already has physical balance', () => {
      const compatible = validateUnitMigration('kg', 'g', 2.5);
      expect(compatible.valid).toBe(true);
      expect(compatible.requiresExplicitConversion).toBe(true);
      expect(compatible.convertedBalance).toBe(2500);

      const incompatible = validateUnitMigration('un', 'kg', 10);
      expect(incompatible.valid).toBe(false);
      expect(incompatible.errorMessage).toContain('grandezas incompatíveis');
    });
  });

  describe('lots, expiration & FEFO selection (ETAPA 6)', () => {
    const refNow = new Date('2026-10-20T12:00:00Z');

    it('evaluates expired, depleted, and active lots accurately', () => {
      expect(evaluateLotStatus(makeLot({ expiresOn: '2026-10-10', remainingQuantity: 5 }), refNow)).toBe('EXPIRED');
      expect(evaluateLotStatus(makeLot({ expiresOn: '2026-11-10', remainingQuantity: 0 }), refNow)).toBe('DEPLETED');
      expect(evaluateLotStatus(makeLot({ expiresOn: '2026-10-28', remainingQuantity: 10 }), refNow)).toBe('ACTIVE');
      expect(daysUntilDate('2026-10-28', refNow)).toBe(8);
    });

    it('allocates quantities using FEFO (First Expired, First Out) and blocks expired/quarantine lots', () => {
      const lots: StockLot[] = [
        makeLot({ id: 'lot-expired', lotCode: 'EXP-01', expiresOn: '2026-10-01', remainingQuantity: 10 }),
        makeLot({ id: 'lot-quarantine', lotCode: 'QUAR-01', expiresOn: '2026-11-01', remainingQuantity: 8, status: 'QUARANTINE' }),
        makeLot({ id: 'lot-later', lotCode: 'VAL-DEC', expiresOn: '2026-12-20', remainingQuantity: 10 }),
        makeLot({ id: 'lot-sooner', lotCode: 'VAL-NOV', expiresOn: '2026-11-05', remainingQuantity: 6 }),
      ];

      const allocation = selectLotsFEFO(lots, 12, refNow);
      expect(allocation.unfulfilledQuantity).toBe(0);
      expect(allocation.blockedOrExpiredQuantity).toBe(18); // 10 expired + 8 quarantine
      expect(allocation.allocations).toHaveLength(2);
      // Must pick VAL-NOV (expires sooner) first, then VAL-DEC
      expect(allocation.allocations[0]).toEqual({
        lotId: 'lot-sooner',
        lotCode: 'VAL-NOV',
        expiresOn: '2026-11-05',
        allocatedQuantity: 6,
      });
      expect(allocation.allocations[1]).toEqual({
        lotId: 'lot-later',
        lotCode: 'VAL-DEC',
        expiresOn: '2026-12-20',
        allocatedQuantity: 6,
      });
    });
  });

  describe('weighted average cost & deterministic replenishment intelligence (ETAPA 5)', () => {
    it('computes weighted average cost accurately on purchase entry', () => {
      const newAvg = computeWeightedAverageCost(10, 8, 10, 12);
      expect(newAvg).toBe(10);
    });

    it('generates explainable replenishment recommendations based on real consumption, lead time, and safety stock', () => {
      const refDate = new Date('2026-10-20T12:00:00Z');
      const products = [
        makeProductBalance({
          productId: 'p-1',
          productName: 'Heineken 330ml',
          physicalQuantity: 6,
          reservedQuantity: 2,
          availableQuantity: 4,
          incomingQuantity: 0,
          minStock: 10,
          safetyStock: 5,
          leadTimeDays: 3,
          packageQuantity: 6,
          minOrderQty: 12,
          costPrice: 4.5,
          stockStatus: 'BELOW_MINIMUM',
        }),
      ];

      // 30 units sold across 3 distinct days over 15-day window = 2 units/day consumption
      const movements: InventoryMovement[] = [
        {
          id: 'm-1',
          tenantId: 'tenant-adega-01',
          productId: 'p-1',
          productName: 'Heineken 330ml',
          quantity: -10,
          type: 'SALE',
          reason: 'Venda #1',
          timestamp: '2026-10-10T10:00:00Z',
        },
        {
          id: 'm-2',
          tenantId: 'tenant-adega-01',
          productId: 'p-1',
          productName: 'Heineken 330ml',
          quantity: -10,
          type: 'SALE',
          reason: 'Venda #2',
          timestamp: '2026-10-12T10:00:00Z',
        },
        {
          id: 'm-3',
          tenantId: 'tenant-adega-01',
          productId: 'p-1',
          productName: 'Heineken 330ml',
          quantity: -10,
          type: 'SALE',
          reason: 'Venda #3',
          timestamp: '2026-10-15T10:00:00Z',
        },
      ];

      const recs = computeReplenishmentRecommendations({
        products,
        movements,
        analysisWindowDays: 15,
        referenceDate: refDate,
      });

      expect(recs).toHaveLength(1);
      expect(recs[0].dailyDemand).toBe(2);
      expect(recs[0].coverageDays).toBe(2); // 4 available / 2 per day = 2 days (< 3 days lead time)
      expect(recs[0].urgency).toBe('RUPTURE_BEFORE_LEAD_TIME');
      expect(recs[0].suggestedQuantity).toBeGreaterThanOrEqual(12);
      expect(recs[0].suggestedQuantity % 6).toBe(0); // Respects package multiple of 6
      expect(recs[0].factorsConsidered.some(f => f.includes('Consumo médio diário'))).toBe(true);
    });
  });

  describe('separated operational vs financial report summary (ETAPA 2 & 8)', () => {
    it('does not mix potential retail price with inventory cost valuation and reports missing costs', () => {
      const products = [
        makeProductBalance({
          productId: 'p-1',
          physicalQuantity: 10,
          availableQuantity: 10,
          price: 25,
          costPrice: 10,
        }),
        makeProductBalance({
          productId: 'p-2',
          productName: 'Produto Sem Custo Cadastrado',
          physicalQuantity: 5,
          availableQuantity: 5,
          price: 30,
          costPrice: 0,
        }),
      ];

      const report = computeStockFinancialReport({
        products,
        movements: [],
        counts: [],
      });

      // Only p-1 has cost (10 * 10 = 100)
      expect(report.totalInventoryCostValue).toBe(100);
      // Potential retail revenue is tracked separately (10*25 + 5*30 = 400)
      expect(report.totalPotentialRetailValue).toBe(400);
      expect(report.productsWithCostCount).toBe(1);
      expect(report.productsWithoutCostCount).toBe(1);
      expect(report.productsWithoutCostNames).toContain('Produto Sem Custo Cadastrado');
    });
  });

  describe('multi-tenant repository workflows: reservations, approvals, counts & purchase orders', () => {
    const ownerCtx: SecurityContext = {
      userId: 'user-owner-adega',
      userName: 'Proprietário Adega',
      userRole: 'OWNER',
      tenantId: 'tenant-adega-01',
    };

    const operatorCtx: SecurityContext = {
      userId: 'user-op-adega',
      userName: 'Operador Adega',
      userRole: 'OPERATOR',
      tenantId: 'tenant-adega-01',
    };

    const otherTenantCtx: SecurityContext = {
      userId: 'user-owner-burger',
      userName: 'Proprietário Burger',
      userRole: 'OWNER',
      tenantId: 'tenant-burger-02',
    };

    it('reserves stock on order creation, blocks overselling, and releases on cancellation (ETAPA 4)', async () => {
      inventoryRepository.resetTestState();
      const dashBefore = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const target = dashBefore.products.find(p => p.availableQuantity >= 4)!;
      expect(target).toBeDefined();

      const initialAvail = target.availableQuantity;
      const initialPhysical = target.physicalQuantity;

      // 1. Reserve 2 units for order-test-100
      const reservations = await inventoryRepository.reserveOrderStock(
        ownerCtx,
        'tenant-adega-01',
        'order-test-100',
        [{ productId: target.productId, quantity: 2 }]
      );
      expect(reservations).toHaveLength(1);

      // Available must decrease by 2 while physical stays the same
      const dashReserved = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const afterReserve = dashReserved.products.find(
        p => p.productId === target.productId && p.locationId === target.locationId
      )!;
      expect(afterReserve.reservedQuantity).toBe(target.reservedQuantity + 2);
      expect(afterReserve.availableQuantity).toBe(initialAvail - 2);
      expect(afterReserve.physicalQuantity).toBe(initialPhysical);

      // 2. Concurrent order trying to reserve more than available must fail atomically
      await expect(
        inventoryRepository.reserveOrderStock(
          ownerCtx,
          'tenant-adega-01',
          'order-test-101',
          [{ productId: target.productId, quantity: initialAvail + 100 }]
        )
      ).rejects.toThrow(/OUT_OF_STOCK/);

      // 3. Cancel order -> releases reservation and restores available stock
      await inventoryRepository.finalizeOrderStock(
        ownerCtx,
        'tenant-adega-01',
        'order-test-100',
        'CANCELLED_RELEASE'
      );

      const dashReleased = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const afterRelease = dashReleased.products.find(
        p => p.productId === target.productId && p.locationId === target.locationId
      )!;
      expect(afterRelease.availableQuantity).toBe(initialAvail);
    });

    it('holds OPERATOR critical adjustments for human approval before changing stock balance (ETAPA 5 & 10)', async () => {
      inventoryRepository.resetTestState();
      const dashBefore = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const target = dashBefore.products[0];
      const initialPhysical = target.physicalQuantity;

      // Operator records a loss of 2 units -> must create pending request instead of changing stock
      const res = await inventoryRepository.recordMovement(
        {
          tenantId: 'tenant-adega-01',
          productId: target.productId,
          locationId: target.locationId,
          type: 'LOSS',
          quantity: 2,
          reason: 'Garrafas danificadas na reposição da geladeira',
        },
        operatorCtx
      );

      expect(res.pendingRequest).toBeDefined();
      expect(res.pendingRequest?.status).toBe('PENDING_APPROVAL');

      // Physical balance must remain untouched before approval
      const dashPending = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const whilePending = dashPending.products.find(
        p => p.productId === target.productId && p.locationId === target.locationId
      )!;
      expect(whilePending.physicalQuantity).toBe(initialPhysical);

      // Owner approves the request
      const reviewed = await inventoryRepository.reviewAdjustmentRequest(
        ownerCtx,
        'tenant-adega-01',
        res.pendingRequest!.id,
        true,
        'Conferido no CFTV e aprovado'
      );
      expect(reviewed.status).toBe('COMPLETED');

      const dashApproved = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const afterApprove = dashApproved.products.find(
        p => p.productId === target.productId && p.locationId === target.locationId
      )!;
      expect(afterApprove.physicalQuantity).toBe(initialPhysical - 2);
    });

    it('processes purchase order approval, partial receipt, incoming balance, and weighted average cost (ETAPA 7)', async () => {
      inventoryRepository.resetTestState();
      const dashBefore = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const target = dashBefore.products.find(p => !p.trackLots) || dashBefore.products[0];
      const initialPhysical = target.physicalQuantity;

      // 1. Create PO in draft -> does not enter physical or incoming yet
      const draftPo = await inventoryRepository.createPurchaseOrder(ownerCtx, 'tenant-adega-01', {
        supplierId: 'sup-adega-01',
        locationId: target.locationId,
        items: [
          {
            productId: target.productId,
            orderedQuantity: 20,
            unitCost: 35,
          },
        ],
      });
      expect(draftPo.status).toBe('DRAFT');

      // 2. Approve PO -> enters incomingQuantity (in transit), still NOT in physicalQuantity
      const approvedPo = await inventoryRepository.updatePurchaseOrderStatus(
        ownerCtx,
        'tenant-adega-01',
        draftPo.id,
        'APPROVE'
      );
      expect(approvedPo.status).toBe('APPROVED');

      const dashAfterApprove = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const afterPoApprove = dashAfterApprove.products.find(
        p => p.productId === target.productId && p.locationId === target.locationId
      )!;
      expect(afterPoApprove.physicalQuantity).toBe(initialPhysical);
      expect(afterPoApprove.incomingQuantity).toBeGreaterThanOrEqual(20);

      // 3. Receive partial (12 of 20 units)
      const partialPo = await inventoryRepository.receivePurchaseOrder(
        ownerCtx,
        'tenant-adega-01',
        draftPo.id,
        [
          {
            itemId: draftPo.items[0].id,
            receivedNowQuantity: 12,
            unitCost: 35,
            lotCode: 'LOTE-OC-TESTE-01',
            expiresOn: '2027-08-30',
          },
        ]
      );
      expect(partialPo.status).toBe('PARTIALLY_RECEIVED');

      const dashAfterPartial = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const afterPartial = dashAfterPartial.products.find(
        p => p.productId === target.productId && p.locationId === target.locationId
      )!;
      expect(afterPartial.physicalQuantity).toBe(initialPhysical + 12);
    });

    it('applies physical inventory count adjustments ONLY after human approval (ETAPA 9)', async () => {
      inventoryRepository.resetTestState();
      const dashBefore = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      const target = dashBefore.products[0];
      const initialPhysical = target.physicalQuantity;

      // Submit count with +5 units divergence
      const count = await inventoryRepository.submitCount(
        'tenant-adega-01',
        target.locationId,
        [
          {
            product_id: target.productId,
            counted_quantity: initialPhysical + 5,
            reason: 'Caixa fechada localizada no fundo do depósito',
          },
        ],
        operatorCtx,
        false
      );
      expect(count.status).toBe('PENDING');

      // Physical balance must NOT change while count is PENDING
      const dashPending = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      expect(
        dashPending.products.find(
          p => p.productId === target.productId && p.locationId === target.locationId
        )?.physicalQuantity
      ).toBe(initialPhysical);

      // Owner approves physical count
      const approvedCount = await inventoryRepository.approveCount(
        count.id,
        true,
        'Inventário validado pela gerência',
        ownerCtx,
        'tenant-adega-01'
      );
      expect(approvedCount.status).toBe('APPROVED');

      const dashApproved = await inventoryRepository.getDashboard(ownerCtx, 'tenant-adega-01');
      expect(
        dashApproved.products.find(
          p => p.productId === target.productId && p.locationId === target.locationId
        )?.physicalQuantity
      ).toBe(initialPhysical + 5);
    });

    it('enforces strict multi-tenant isolation across stores (ETAPA 10)', async () => {
      await expect(
        inventoryRepository.getLots(ownerCtx, 'tenant-burger-02')
      ).rejects.toThrow(/ACESSO NEGADO|isola/i);

      const burgerLots = await inventoryRepository.getLots(otherTenantCtx, 'tenant-burger-02');
      expect(burgerLots.every(l => l.tenantId === 'tenant-burger-02')).toBe(true);
    });
  });
});
