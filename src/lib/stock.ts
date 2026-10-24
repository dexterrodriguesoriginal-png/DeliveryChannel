import {
  BusinessType,
  InventoryMovement,
  PurchaseOrder,
  StockControlMode,
  StockCount,
  StockLot,
  StockLotStatus,
  StockProductBalance,
  StockReplenishmentRecommendation,
  StockSupplier,
  StockUnit,
} from '../types';

export const STOCK_UNIT_LABELS: Record<StockUnit, string> = {
  un: 'Unidade (un)',
  pack: 'Pacote / Pack (pack)',
  cx: 'Caixa (cx)',
  fd: 'Fardo (fd)',
  kg: 'Quilograma (kg)',
  g: 'Grama (g)',
  l: 'Litro (l)',
  ml: 'Mililitro (ml)',
  m: 'Metro (m)',
  cm: 'Centímetro (cm)',
  m2: 'Metro quadrado (m²)',
  cm2: 'Centímetro quadrado (cm²)',
};

export const STOCK_CONTROL_MODE_LABELS: Record<StockControlMode, { label: string; description: string; defaultUnit: StockUnit }> = {
  UNIT: {
    label: 'Unidade inteira',
    description: 'Controle por itens inteiros (garrafas, latas, peças avulsas).',
    defaultUnit: 'un',
  },
  PACKAGE: {
    label: 'Embalagem, caixa, pacote ou fardo',
    description: 'Compra ou movimentação em embalagens fechadas com fator de conversão para unidades.',
    defaultUnit: 'un',
  },
  WEIGHT: {
    label: 'Peso (kg / g)',
    description: 'Produtos fracionados ou pesados na balança (açougue, hortifrúti, frios, granel).',
    defaultUnit: 'kg',
  },
  VOLUME: {
    label: 'Volume (L / mL)',
    description: 'Líquidos, bebidas a granel, chope, cosméticos ou insumos líquidos.',
    defaultUnit: 'l',
  },
  LENGTH: {
    label: 'Comprimento (m / cm)',
    description: 'Cabos, fios, mangueiras, tecidos ou perfis vendidos por metro/centímetro.',
    defaultUnit: 'm',
  },
  AREA: {
    label: 'Área (m² / cm²)',
    description: 'Pisos, revestimentos, vidros, lonas ou chapas.',
    defaultUnit: 'm2',
  },
  VARIANT: {
    label: 'Grade de variações (cor, tamanho, modelo)',
    description: 'Roupas, calçados e acessórios com saldo desmembrado por variação.',
    defaultUnit: 'un',
  },
  SERIAL: {
    label: 'Número de série / IMEI individual',
    description: 'Eletrônicos, equipamentos e itens rastreados unidade a unidade.',
    defaultUnit: 'un',
  },
  LOT_EXPIRY: {
    label: 'Lote e validade (FEFO)',
    description: 'Farmácia, laticínios, perecíveis e bebidas com controle estrito de vencimento.',
    defaultUnit: 'un',
  },
  KIT: {
    label: 'Kit, combo ou composição',
    description: 'Conjunto formado por outros produtos ou insumos do estoque.',
    defaultUnit: 'un',
  },
  NONE: {
    label: 'Sem controle de estoque físico',
    description: 'Serviços ou itens sob demanda que não movimentam saldo físico.',
    defaultUnit: 'un',
  },
};

type UnitDimension = 'DISCRETE' | 'PACKAGE' | 'WEIGHT' | 'VOLUME' | 'LENGTH' | 'AREA';

const UNIT_META: Record<StockUnit, { dimension: UnitDimension; toBaseFactor: number; baseUnit: StockUnit; allowsFraction: boolean }> = {
  un: { dimension: 'DISCRETE', toBaseFactor: 1, baseUnit: 'un', allowsFraction: false },
  pack: { dimension: 'PACKAGE', toBaseFactor: 1, baseUnit: 'un', allowsFraction: false },
  cx: { dimension: 'PACKAGE', toBaseFactor: 1, baseUnit: 'un', allowsFraction: false },
  fd: { dimension: 'PACKAGE', toBaseFactor: 1, baseUnit: 'un', allowsFraction: false },
  kg: { dimension: 'WEIGHT', toBaseFactor: 1000, baseUnit: 'g', allowsFraction: true },
  g: { dimension: 'WEIGHT', toBaseFactor: 1, baseUnit: 'g', allowsFraction: true },
  l: { dimension: 'VOLUME', toBaseFactor: 1000, baseUnit: 'ml', allowsFraction: true },
  ml: { dimension: 'VOLUME', toBaseFactor: 1, baseUnit: 'ml', allowsFraction: true },
  m: { dimension: 'LENGTH', toBaseFactor: 100, baseUnit: 'cm', allowsFraction: true },
  cm: { dimension: 'LENGTH', toBaseFactor: 1, baseUnit: 'cm', allowsFraction: true },
  m2: { dimension: 'AREA', toBaseFactor: 10000, baseUnit: 'cm2', allowsFraction: true },
  cm2: { dimension: 'AREA', toBaseFactor: 1, baseUnit: 'cm2', allowsFraction: true },
};

export function roundStockQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function unitAllowsFraction(unit: StockUnit, mode?: StockControlMode): boolean {
  if (mode === 'WEIGHT' || mode === 'VOLUME' || mode === 'LENGTH' || mode === 'AREA') return true;
  return UNIT_META[unit]?.allowsFraction ?? false;
}

export function canConvertUnits(fromUnit: StockUnit, toUnit: StockUnit, packageQuantity?: number): boolean {
  if (fromUnit === toUnit) return true;
  const fromMeta = UNIT_META[fromUnit];
  const toMeta = UNIT_META[toUnit];
  if (!fromMeta || !toMeta) return false;

  if (fromMeta.dimension === toMeta.dimension && fromMeta.dimension !== 'PACKAGE') {
    return true;
  }

  const isFromPkg = fromMeta.dimension === 'PACKAGE';
  const isToPkg = toMeta.dimension === 'PACKAGE';
  const isFromDiscrete = fromMeta.dimension === 'DISCRETE';
  const isToDiscrete = toMeta.dimension === 'DISCRETE';

  if ((isFromPkg && isToDiscrete) || (isFromDiscrete && isToPkg)) {
    return Boolean(packageQuantity && packageQuantity > 0);
  }

  return false;
}

/**
 * Converte quantidades entre unidades compatíveis sem arredondamentos inadequados.
 * Exemplo: 1 kg -> 1000 g; 250 g -> 0.25 kg; 2 fardos (packageQuantity=12) -> 24 un.
 */
export function convertStockQuantity(
  quantity: number,
  fromUnit: StockUnit,
  toUnit: StockUnit,
  packageQuantity?: number
): number {
  if (!Number.isFinite(quantity)) {
    throw new Error('Quantidade inválida para conversão de unidade.');
  }
  if (fromUnit === toUnit) return roundStockQty(quantity);

  const fromMeta = UNIT_META[fromUnit];
  const toMeta = UNIT_META[toUnit];
  if (!fromMeta || !toMeta) {
    throw new Error(`Unidade de medida não reconhecida: ${fromUnit} → ${toUnit}.`);
  }

  if (fromMeta.dimension === toMeta.dimension && fromMeta.dimension !== 'PACKAGE') {
    const inBase = quantity * fromMeta.toBaseFactor;
    const converted = inBase / toMeta.toBaseFactor;
    return roundStockQty(converted);
  }

  const isFromPkg = fromMeta.dimension === 'PACKAGE';
  const isToPkg = toMeta.dimension === 'PACKAGE';
  const isFromDiscrete = fromMeta.dimension === 'DISCRETE';
  const isToDiscrete = toMeta.dimension === 'DISCRETE';

  if ((isFromPkg && isToDiscrete) || (isFromDiscrete && isToPkg)) {
    if (!packageQuantity || packageQuantity <= 0) {
      throw new Error(`Informe a quantidade por embalagem (fator > 0) para converter entre ${fromUnit} e ${toUnit}.`);
    }
    if (isFromPkg && isToDiscrete) {
      return roundStockQty(quantity * packageQuantity);
    }
    return roundStockQty(quantity / packageQuantity);
  }

  throw new Error(`Conversão incompatível entre "${fromUnit}" e "${toUnit}". As grandezas físicas são diferentes.`);
}

/**
 * Impede alteração silenciosa da interpretação de saldos existentes ao mudar a unidade-base.
 */
export function validateUnitMigration(
  currentUnit: StockUnit,
  nextUnit: StockUnit,
  currentPhysicalBalance: number,
  packageQuantity?: number
): {
  valid: boolean;
  requiresExplicitConversion: boolean;
  convertedBalance?: number;
  errorMessage?: string;
} {
  if (currentUnit === nextUnit) {
    return { valid: true, requiresExplicitConversion: false, convertedBalance: currentPhysicalBalance };
  }
  if (currentPhysicalBalance === 0) {
    return { valid: true, requiresExplicitConversion: false, convertedBalance: 0 };
  }
  if (canConvertUnits(currentUnit, nextUnit, packageQuantity)) {
    const converted = convertStockQuantity(currentPhysicalBalance, currentUnit, nextUnit, packageQuantity);
    return {
      valid: true,
      requiresExplicitConversion: true,
      convertedBalance: converted,
    };
  }
  return {
    valid: false,
    requiresExplicitConversion: false,
    errorMessage: `Não é permitido alterar a unidade de "${currentUnit}" para "${nextUnit}" com saldo físico ativo (${currentPhysicalBalance} ${currentUnit}), pois são grandezas incompatíveis. Zere o saldo via ajuste auditável antes de trocar a grandeza.`,
  };
}

/**
 * Regra operacional inegociável (ETAPA 4):
 * Estoque disponível = estoque físico − estoque reservado − estoque bloqueado.
 * Compras apenas solicitadas ou ainda não recebidas (incoming) NÃO entram no estoque físico nem no disponível.
 */
export function computeOperationalBalances(input: {
  physicalQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  expiredOrQuarantinedLotQuantity?: number;
  incomingQuantity?: number;
}): {
  physicalQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  availableQuantity: number;
  incomingQuantity: number;
} {
  const physical = roundStockQty(Math.max(0, input.physicalQuantity));
  const reserved = roundStockQty(Math.max(0, input.reservedQuantity));
  const blocked = roundStockQty(
    Math.max(0, input.blockedQuantity) + Math.max(0, input.expiredOrQuarantinedLotQuantity || 0)
  );
  const incoming = roundStockQty(Math.max(0, input.incomingQuantity || 0));
  const available = roundStockQty(Math.max(0, physical - reserved - blocked));

  return {
    physicalQuantity: physical,
    reservedQuantity: reserved,
    blockedQuantity: blocked,
    availableQuantity: available,
    incomingQuantity: incoming,
  };
}

/**
 * Cálculo determinístico do Custo Médio Ponderado Móvel (CMPM) na entrada de mercadoria recebida.
 */
export function computeWeightedAverageCost(
  currentPhysicalQty: number,
  currentAvgCost: number,
  receivedQty: number,
  receivedUnitCost: number
): number {
  if (receivedQty <= 0 || receivedUnitCost < 0) return roundCurrency(Math.max(0, currentAvgCost));
  const safeCurrentQty = Math.max(0, currentPhysicalQty);
  const safeCurrentCost = Math.max(0, currentAvgCost);
  if (safeCurrentQty <= 0 || safeCurrentCost <= 0) {
    return roundCurrency(receivedUnitCost);
  }
  const totalValue = safeCurrentQty * safeCurrentCost + receivedQty * receivedUnitCost;
  const totalQty = safeCurrentQty + receivedQty;
  return roundCurrency(totalValue / totalQty);
}

/**
 * Avalia situação do lote respeitando data de validade e saldo restante (ETAPA 6).
 */
export function evaluateLotStatus(
  lot: Pick<StockLot, 'status' | 'expiresOn' | 'remainingQuantity'>,
  referenceDate: Date = new Date()
): StockLotStatus {
  if (lot.remainingQuantity <= 0) return 'DEPLETED';
  if (lot.status === 'BLOCKED' || lot.status === 'QUARANTINE') return lot.status;
  if (lot.expiresOn) {
    const refDay = referenceDate.toISOString().slice(0, 10);
    if (lot.expiresOn < refDay) {
      return 'EXPIRED';
    }
  }
  return 'ACTIVE';
}

export function daysUntilDate(dateStr?: string, referenceDate: Date = new Date()): number | null {
  if (!dateStr) return null;
  const refDay = new Date(`${referenceDate.toISOString().slice(0, 10)}T00:00:00Z`);
  const targetDay = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(targetDay.getTime())) return null;
  return Math.round((targetDay.getTime() - refDay.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Seleção prioritária FEFO (First Expired, First Out — Primeiro que Vence, Primeiro que Sai).
 * Lotes vencidos, bloqueados ou em quarentena nunca são sugeridos como disponíveis para venda.
 */
export function selectLotsFEFO(
  lots: StockLot[],
  requiredQuantity: number,
  referenceDate: Date = new Date()
): {
  allocations: Array<{ lotId: string; lotCode: string; expiresOn?: string; allocatedQuantity: number }>;
  unfulfilledQuantity: number;
  blockedOrExpiredQuantity: number;
} {
  let blockedOrExpiredQuantity = 0;
  const eligibleLots: StockLot[] = [];

  for (const lot of lots) {
    const computedStatus = evaluateLotStatus(lot, referenceDate);
    if (computedStatus === 'EXPIRED' || computedStatus === 'BLOCKED' || computedStatus === 'QUARANTINE') {
      blockedOrExpiredQuantity = roundStockQty(blockedOrExpiredQuantity + Math.max(0, lot.remainingQuantity));
    } else if (computedStatus === 'ACTIVE' && lot.remainingQuantity > 0) {
      eligibleLots.push(lot);
    }
  }

  eligibleLots.sort((a, b) => {
    if (a.expiresOn && b.expiresOn) {
      if (a.expiresOn !== b.expiresOn) return a.expiresOn.localeCompare(b.expiresOn);
    } else if (a.expiresOn && !b.expiresOn) {
      return -1;
    } else if (!a.expiresOn && b.expiresOn) {
      return 1;
    }
    return a.receivedAt.localeCompare(b.receivedAt);
  });

  const allocations: Array<{ lotId: string; lotCode: string; expiresOn?: string; allocatedQuantity: number }> = [];
  let remainingToAllocate = roundStockQty(Math.max(0, requiredQuantity));

  for (const lot of eligibleLots) {
    if (remainingToAllocate <= 0) break;
    const take = roundStockQty(Math.min(lot.remainingQuantity, remainingToAllocate));
    if (take > 0) {
      allocations.push({
        lotId: lot.id,
        lotCode: lot.lotCode,
        expiresOn: lot.expiresOn,
        allocatedQuantity: take,
      });
      remainingToAllocate = roundStockQty(remainingToAllocate - take);
    }
  }

  return {
    allocations,
    unfulfilledQuantity: remainingToAllocate,
    blockedOrExpiredQuantity,
  };
}

export function stockStatus(available: number, minimum: number): StockProductBalance['stockStatus'] {
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= minimum) return 'BELOW_MINIMUM';
  return 'OK';
}

export function stockAlerts(products: StockProductBalance[]) {
  return products
    .filter(product => product.isActive && product.stockControlMode !== 'NONE' && product.availableQuantity <= product.minStock)
    .map(product => ({
      productId: product.productId,
      productName: product.productName,
      locationId: product.locationId,
      cause: product.availableQuantity <= 0 ? 'OUT_OF_STOCK' as const : 'BELOW_MINIMUM' as const,
      suggestedAction: product.availableQuantity <= 0
        ? 'Registrar recebimento ou revisar pedido de compra.'
        : 'Repor até o estoque mínimo configurado.',
      available: product.availableQuantity,
      minimum: product.minStock,
    }));
}

export function stockSummary(products: StockProductBalance[]) {
  const active = products.filter(product => product.isActive && product.stockControlMode !== 'NONE');
  return {
    activeSkus: new Set(active.map(product => product.productId)).size,
    criticalStock: active.filter(product => product.availableQuantity <= product.minStock).length,
    inventoryValue: roundCurrency(
      active.reduce(
        (total, product) => total + Math.max(0, product.physicalQuantity) * Math.max(0, product.costPrice),
        0
      )
    ),
    alertCount: active.filter(product => product.availableQuantity <= product.minStock).length,
  };
}

export function businessUsesStock(type?: BusinessType | null): boolean {
  return type !== 'OUTRO';
}

/**
 * Motor determinístico de Inteligência e Reposição de Estoque (ETAPA 5).
 * Baseado exclusivamente nos dados reais do estabelecimento, sem chamadas generativas de IA.
 */
export function computeReplenishmentRecommendations(params: {
  products: StockProductBalance[];
  movements: InventoryMovement[];
  lots?: StockLot[];
  suppliers?: StockSupplier[];
  analysisWindowDays?: number;
  referenceDate?: Date;
}): StockReplenishmentRecommendation[] {
  const windowDays = Math.max(7, params.analysisWindowDays || 30);
  const refDate = params.referenceDate || new Date();
  const cutoffMs = refDate.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const lots = params.lots || [];
  const suppliers = params.suppliers || [];

  const recommendations: StockReplenishmentRecommendation[] = [];

  for (const product of params.products) {
    if (!product.isActive || product.stockControlMode === 'NONE') continue;

    const prodMovements = params.movements.filter(
      m => m.productId === product.productId && new Date(m.timestamp).getTime() >= cutoffMs
    );

    const outboundMovements = prodMovements.filter(m =>
      ['SALE', 'VENDA', 'CONSUMPTION', 'SAIDA'].includes(m.type) && m.quantity < 0
    );

    const distinctMovementDays = new Set(
      prodMovements.map(m => m.timestamp.slice(0, 10))
    ).size;

    const totalConsumed = roundStockQty(
      outboundMovements.reduce((sum, m) => sum + Math.abs(m.quantity), 0)
    );

    // Identifica se o histórico é suficiente (>= 3 dias distintos com movimentações ou vendas registradas)
    const isPreliminary = distinctMovementDays < 3 && outboundMovements.length < 3;

    // Se houver vendas no período, calcula demanda diária observada na janela
    const effectiveDays = isPreliminary
      ? Math.max(1, distinctMovementDays || 7)
      : windowDays;
    const dailyDemand = totalConsumed > 0 ? roundStockQty(totalConsumed / effectiveDays) : 0;

    // Fornecedor preferencial vinculado ao produto
    let preferredSupplier: StockSupplier | undefined;
    let supplierCondition = undefined;
    for (const sup of suppliers) {
      if (!sup.isActive) continue;
      const cond = sup.products.find(p => p.productId === product.productId);
      if (cond) {
        preferredSupplier = sup;
        supplierCondition = cond;
        break;
      }
    }

    const leadTimeDays = Math.max(
      1,
      supplierCondition?.leadTimeDays ?? product.leadTimeDays ?? preferredSupplier?.defaultLeadTimeDays ?? 3
    );
    const packageQuantity = Math.max(
      1,
      supplierCondition?.packageQuantity ?? product.packageQuantity ?? 1
    );
    const minOrderQty = Math.max(
      0,
      supplierCondition?.minOrderQuantity ?? product.minOrderQty ?? 0
    );
    const estimatedUnitCost =
      supplierCondition?.lastUnitCost && supplierCondition.lastUnitCost > 0
        ? supplierCondition.lastUnitCost
        : product.costPrice > 0
          ? product.costPrice
          : null;

    // Avalia risco de perda por vencimento em lotes ativos do produto
    const productLots = lots.filter(l => l.productId === product.productId);
    let expiringRiskQuantity = 0;
    for (const lot of productLots) {
      const status = evaluateLotStatus(lot, refDate);
      if (status === 'EXPIRED' && lot.remainingQuantity > 0) {
        expiringRiskQuantity = roundStockQty(expiringRiskQuantity + lot.remainingQuantity);
      } else if (status === 'ACTIVE' && lot.expiresOn && lot.remainingQuantity > 0) {
        const daysLeft = daysUntilDate(lot.expiresOn, refDate);
        if (daysLeft !== null && daysLeft >= 0 && daysLeft <= Math.max(leadTimeDays, 7)) {
          const maxConsumableBeforeExpiry = dailyDemand > 0 ? dailyDemand * Math.max(0, daysLeft) : 0;
          if (lot.remainingQuantity > maxConsumableBeforeExpiry) {
            expiringRiskQuantity = roundStockQty(
              expiringRiskQuantity + (lot.remainingQuantity - maxConsumableBeforeExpiry)
            );
          }
        }
      }
    }

    const effectiveAvailable = roundStockQty(Math.max(0, product.availableQuantity - expiringRiskQuantity));
    const netProjected = roundStockQty(effectiveAvailable + product.incomingQuantity);

    const demandDuringLeadTime = roundStockQty(dailyDemand * leadTimeDays);
    const reorderPoint = roundStockQty(
      Math.max(product.minStock, demandDuringLeadTime + product.safetyStock)
    );

    const coverageDays =
      dailyDemand > 0 ? Math.round((effectiveAvailable / dailyDemand) * 10) / 10 : null;

    let urgency: StockReplenishmentRecommendation['urgency'] = 'HEALTHY';
    if (effectiveAvailable <= 0) {
      urgency = 'CRITICAL_OUT';
    } else if (coverageDays !== null && coverageDays < leadTimeDays && netProjected <= reorderPoint) {
      urgency = 'RUPTURE_BEFORE_LEAD_TIME';
    } else if (effectiveAvailable <= product.minStock && netProjected <= reorderPoint) {
      urgency = 'BELOW_MIN';
    } else if (netProjected <= reorderPoint && reorderPoint > 0) {
      urgency = 'BELOW_ROP';
    } else if (expiringRiskQuantity > 0) {
      urgency = 'EXPIRY_RISK';
    }

    const cycleDays = Math.max(leadTimeDays, 7);
    const targetStock = roundStockQty(
      Math.max(
        reorderPoint + dailyDemand * cycleDays,
        product.minStock + product.safetyStock
      )
    );

    let suggestedQuantity = 0;
    if (netProjected <= reorderPoint || effectiveAvailable <= product.minStock) {
      const rawDeficit = Math.max(0, targetStock - netProjected);
      if (rawDeficit > 0) {
        const packsNeeded = Math.ceil(rawDeficit / packageQuantity) * packageQuantity;
        suggestedQuantity = roundStockQty(Math.max(packsNeeded, minOrderQty));
      }
    }

    const factorsConsidered: string[] = [
      `Disponível atual: ${product.availableQuantity} ${product.unit}`,
      `Reservado em pedidos: ${product.reservedQuantity} ${product.unit}`,
      `A receber confirmado: ${product.incomingQuantity} ${product.unit}`,
      `Mínimo / Segurança: ${product.minStock} / ${product.safetyStock} ${product.unit}`,
      `Prazo do fornecedor (Lead Time): ${leadTimeDays} dia(s)`,
    ];

    if (dailyDemand > 0) {
      factorsConsidered.push(`Consumo médio diário: ${dailyDemand} ${product.unit}/dia`);
    } else {
      factorsConsidered.push('Consumo médio diário: sem saídas registradas na janela');
    }

    if (packageQuantity > 1) {
      factorsConsidered.push(`Múltiplo de embalagem: ${packageQuantity} ${product.unit}`);
    }
    if (minOrderQty > 0) {
      factorsConsidered.push(`Compra mínima do fornecedor: ${minOrderQty} ${product.unit}`);
    }
    if (expiringRiskQuantity > 0) {
      factorsConsidered.push(`Risco de vencimento descontado: ${expiringRiskQuantity} ${product.unit}`);
    }
    if (isPreliminary) {
      factorsConsidered.push('Previsão preliminar (histórico < 3 dias; usando parâmetros manuais)');
    }

    let reason = 'Saldo saudável para a demanda e parâmetros configurados.';
    if (urgency === 'CRITICAL_OUT') {
      reason = `Produto esgotado para venda (${effectiveAvailable} ${product.unit} disponível). Reposição imediata recomendada.`;
    } else if (urgency === 'RUPTURE_BEFORE_LEAD_TIME') {
      reason = `Risco de falta antes da entrega: cobertura estimada de ${coverageDays} dia(s) é menor que o prazo do fornecedor (${leadTimeDays} dias).`;
    } else if (urgency === 'BELOW_MIN') {
      reason = `Saldo disponível (${effectiveAvailable} ${product.unit}) atingiu ou ficou abaixo do estoque mínimo (${product.minStock} ${product.unit}).`;
    } else if (urgency === 'BELOW_ROP') {
      reason = `Saldo projetado (${netProjected} ${product.unit}) atingiu o ponto de pedido (${reorderPoint} ${product.unit}).`;
    } else if (urgency === 'EXPIRY_RISK') {
      reason = `Há ${expiringRiskQuantity} ${product.unit} em lotes vencidos ou com risco de vencer antes do giro previsto.`;
    }

    recommendations.push({
      productId: product.productId,
      productName: product.productName,
      sku: product.sku,
      unit: product.unit,
      availableQuantity: product.availableQuantity,
      reservedQuantity: product.reservedQuantity,
      incomingQuantity: product.incomingQuantity,
      minStock: product.minStock,
      safetyStock: product.safetyStock,
      dailyDemand,
      coverageDays,
      leadTimeDays,
      reorderPoint,
      suggestedQuantity,
      packageQuantity,
      minOrderQty,
      estimatedUnitCost,
      estimatedTotalCost:
        estimatedUnitCost !== null && suggestedQuantity > 0
          ? roundCurrency(suggestedQuantity * estimatedUnitCost)
          : null,
      preferredSupplierId: preferredSupplier?.id,
      preferredSupplierName: preferredSupplier?.name,
      expiringRiskQuantity,
      urgency,
      isPreliminary,
      historyDaysCount: distinctMovementDays,
      reason,
      factorsConsidered,
    });
  }

  const urgencyWeight: Record<StockReplenishmentRecommendation['urgency'], number> = {
    CRITICAL_OUT: 0,
    RUPTURE_BEFORE_LEAD_TIME: 1,
    BELOW_MIN: 2,
    BELOW_ROP: 3,
    EXPIRY_RISK: 4,
    HEALTHY: 5,
  };

  return recommendations.sort((a, b) => {
    const diff = urgencyWeight[a.urgency] - urgencyWeight[b.urgency];
    if (diff !== 0) return diff;
    return b.suggestedQuantity - a.suggestedQuantity;
  });
}

export interface StockFinancialReport {
  valuationMethod: string;
  totalActiveSkus: number;
  productsWithCostCount: number;
  productsWithoutCostCount: number;
  productsWithoutCostNames: string[];
  totalInventoryCostValue: number;
  totalPotentialRetailValue: number;
  registeredLossesValue: number;
  registeredLossesCount: number;
  receivedMerchandiseValue: number;
  receivedMerchandiseCount: number;
  cogsInWindow: number;
  stockTurnover: number | null;
  estimatedAverageCoverageDays: number | null;
  deadStockProducts: Array<{
    productId: string;
    productName: string;
    physicalQuantity: number;
    unit: StockUnit;
    tiedCapitalValue: number;
  }>;
  inventoryDivergences: Array<{
    source: 'COUNT' | 'PURCHASE_RECEIPT';
    referenceId: string;
    date: string;
    productName: string;
    expectedQty: number;
    actualQty: number;
    divergenceQty: number;
    unit: string;
    financialImpact: number;
    status: string;
  }>;
}

/**
 * Relatório Financeiro e Operacional de Estoque (ETAPA 8).
 * Separa rigorosamente preço de venda, custo de aquisição, valorização do estoque, perdas, recebimentos e giro.
 */
export function computeStockFinancialReport(params: {
  products: StockProductBalance[];
  movements: InventoryMovement[];
  counts: StockCount[];
  purchaseOrders?: PurchaseOrder[];
  daysWindow?: number;
  referenceDate?: Date;
}): StockFinancialReport {
  const windowDays = Math.max(1, params.daysWindow || 30);
  const refDate = params.referenceDate || new Date();
  const cutoffMs = refDate.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const activeProducts = params.products.filter(p => p.isActive && p.stockControlMode !== 'NONE');
  const productMap = new Map<string, StockProductBalance>();
  for (const p of activeProducts) {
    if (!productMap.has(p.productId)) {
      productMap.set(p.productId, p);
    }
  }

  let productsWithCostCount = 0;
  let productsWithoutCostCount = 0;
  const productsWithoutCostNames: string[] = [];
  let totalInventoryCostValue = 0;
  let totalPotentialRetailValue = 0;

  for (const prod of activeProducts) {
    const phys = Math.max(0, prod.physicalQuantity);
    const avail = Math.max(0, prod.availableQuantity);
    totalPotentialRetailValue += avail * Math.max(0, prod.price);
    if (prod.costPrice > 0) {
      productsWithCostCount += 1;
      totalInventoryCostValue += phys * prod.costPrice;
    } else {
      productsWithoutCostCount += 1;
      if (!productsWithoutCostNames.includes(prod.productName)) {
        productsWithoutCostNames.push(prod.productName);
      }
    }
  }

  const windowMovements = params.movements.filter(
    m => new Date(m.timestamp).getTime() >= cutoffMs
  );

  let registeredLossesValue = 0;
  let registeredLossesCount = 0;
  let receivedMerchandiseValue = 0;
  let receivedMerchandiseCount = 0;
  let cogsInWindow = 0;
  const productsWithOutboundInWindow = new Set<string>();

  for (const m of windowMovements) {
    const prod = productMap.get(m.productId);
    const unitCost = m.unitCost !== undefined && m.unitCost > 0 ? m.unitCost : (prod?.costPrice || 0);
    const absQty = Math.abs(m.quantity);

    if (['LOSS', 'DAMAGE', 'EXPIRY', 'PERDA'].includes(m.type)) {
      registeredLossesCount += 1;
      registeredLossesValue += absQty * unitCost;
    } else if (['RECEIPT', 'ENTRADA'].includes(m.type) && m.quantity > 0) {
      receivedMerchandiseCount += 1;
      receivedMerchandiseValue += absQty * unitCost;
    } else if (['SALE', 'VENDA', 'CONSUMPTION'].includes(m.type) && m.quantity < 0) {
      productsWithOutboundInWindow.add(m.productId);
      cogsInWindow += absQty * unitCost;
    }
  }

  const deadStockProducts = activeProducts
    .filter(p => p.physicalQuantity > 0 && !productsWithOutboundInWindow.has(p.productId))
    .map(p => ({
      productId: p.productId,
      productName: p.productName,
      physicalQuantity: p.physicalQuantity,
      unit: p.unit,
      tiedCapitalValue: roundCurrency(p.physicalQuantity * Math.max(0, p.costPrice)),
    }));

  const stockTurnover =
    totalInventoryCostValue > 0
      ? Math.round((cogsInWindow / totalInventoryCostValue) * 100) / 100
      : null;

  const dailyCogs = cogsInWindow / windowDays;
  const estimatedAverageCoverageDays =
    dailyCogs > 0 && totalInventoryCostValue > 0
      ? Math.round((totalInventoryCostValue / dailyCogs) * 10) / 10
      : null;

  const inventoryDivergences: StockFinancialReport['inventoryDivergences'] = [];

  for (const count of params.counts) {
    for (const item of count.items) {
      const div = roundStockQty(item.countedQuantity - item.expectedQuantity);
      if (div !== 0) {
        const prod = productMap.get(item.productId);
        const cost = item.unitCost ?? prod?.costPrice ?? 0;
        inventoryDivergences.push({
          source: 'COUNT',
          referenceId: count.id,
          date: count.submittedAt,
          productName: item.productName,
          expectedQty: item.expectedQuantity,
          actualQty: item.countedQuantity,
          divergenceQty: div,
          unit: item.unit,
          financialImpact: roundCurrency(div * cost),
          status: count.status,
        });
      }
    }
  }

  for (const po of params.purchaseOrders || []) {
    if (po.status === 'PARTIALLY_RECEIVED' || po.status === 'COMPLETED') {
      for (const item of po.items) {
        const div =
          item.divergenceQuantity !== undefined
            ? item.divergenceQuantity
            : roundStockQty(item.receivedQuantity - item.orderedQuantity);
        if (div !== 0) {
          inventoryDivergences.push({
            source: 'PURCHASE_RECEIPT',
            referenceId: po.code || po.id,
            date: po.receivedAt || po.createdAt,
            productName: item.productName,
            expectedQty: item.orderedQuantity,
            actualQty: item.receivedQuantity,
            divergenceQty: div,
            unit: item.unit,
            financialImpact: roundCurrency(div * item.unitCost),
            status: po.status,
          });
        }
      }
    }
  }

  return {
    valuationMethod: 'CMPM (Custo Médio Ponderado Móvel)',
    totalActiveSkus: productMap.size,
    productsWithCostCount,
    productsWithoutCostCount,
    productsWithoutCostNames,
    totalInventoryCostValue: roundCurrency(totalInventoryCostValue),
    totalPotentialRetailValue: roundCurrency(totalPotentialRetailValue),
    registeredLossesValue: roundCurrency(registeredLossesValue),
    registeredLossesCount,
    receivedMerchandiseValue: roundCurrency(receivedMerchandiseValue),
    receivedMerchandiseCount,
    cogsInWindow: roundCurrency(cogsInWindow),
    stockTurnover,
    estimatedAverageCoverageDays,
    deadStockProducts,
    inventoryDivergences,
  };
}
