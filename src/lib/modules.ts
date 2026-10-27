import type { BusinessType } from '../types';

export type { BusinessType } from '../types';

export const BUSINESS_TYPES = [
  { key: 'RESTAURANTE', label: 'Restaurante', icon: 'Utensils' },
  { key: 'BAR', label: 'Bar', icon: 'Beer' },
  { key: 'LANCHONETE_CAFE', label: 'Lanchonete/Café', icon: 'Coffee' },
  { key: 'PIZZARIA', label: 'Pizzaria', icon: 'Pizza' },
  { key: 'MERCADO', label: 'Mercado', icon: 'ShoppingBasket' },
  { key: 'ADEGA', label: 'Adega', icon: 'Wine' },
  { key: 'ROUPAS', label: 'Roupas', icon: 'Shirt' },
  { key: 'PERFUMARIA', label: 'Perfumaria', icon: 'Sparkles' },
  { key: 'SALAO_BARBEARIA', label: 'Salão/Barbearia', icon: 'Scissors' },
  { key: 'CONSTRUCAO', label: 'Construção', icon: 'Hammer' },
  { key: 'AMBULANTE', label: 'Ambulante', icon: 'Bike' },
  { key: 'OUTRO', label: 'Outro', icon: 'Store' },
] as const;

export type ModuleKey =
  | 'delivery' | 'pickup' | 'addons' | 'kds' | 'dine_in' | 'counter'
  | 'service_fee' | 'printing' | 'weight' | 'barcode' | 'substitution'
  | 'variants' | 'reserve_exchange' | 'scheduling' | 'quotes'
  | 'street_vendor' | 'pos' | 'loyalty' | 'credit_tab';

export interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  changes: string;
  implemented: boolean;
}

export const MODULES: ModuleDefinition[] = [
  { key: 'delivery', label: 'Entrega', description: 'Receba pedidos para entregar no endereço do cliente.', changes: 'Exibe Entregadores e a opção de entrega no catálogo.', implemented: true },
  { key: 'pickup', label: 'Retirada', description: 'Permita que clientes retirem pedidos no estabelecimento.', changes: 'Exibe a opção de retirada no catálogo.', implemented: true },
  { key: 'addons', label: 'Adicionais', description: 'Ofereça complementos e personalizações nos produtos.', changes: 'Adiciona escolhas de complementos ao cardápio.', implemented: true },
  { key: 'kds', label: 'Tela da Cozinha', description: 'Organize os pedidos em uma tela de preparo para a cozinha.', changes: 'Exibe Tela da Cozinha, alertas de pedido pronto e Tempo de Preparo no painel.', implemented: true },
  { key: 'dine_in', label: 'Mesa/Comanda', description: 'Atenda clientes em mesas ou comandas individuais.', changes: 'Adiciona atendimento e acompanhamento por mesa/comanda.', implemented: true },
  { key: 'counter', label: 'Balcão', description: 'Registre pedidos feitos diretamente no balcão.', changes: 'Adiciona o fluxo de atendimento no balcão.', implemented: false },
  { key: 'service_fee', label: 'Taxa de serviço', description: 'Configure a taxa opcional do atendimento no salão.', changes: 'Aplica a taxa configurada somente às comandas de salão.', implemented: true },
  { key: 'printing', label: 'Impressão', description: 'Imprima pedidos e documentos operacionais.', changes: 'Adiciona opções de impressão ao painel.', implemented: true },
  { key: 'weight', label: 'Venda por peso', description: 'Venda produtos com preço calculado por peso.', changes: 'Exibe unidades e campos de peso no catálogo.', implemented: false },
  { key: 'barcode', label: 'Código de barras', description: 'Identifique produtos pelo código de barras.', changes: 'Adiciona leitura e busca por código de barras.', implemented: false },
  { key: 'substitution', label: 'Substituição', description: 'Permita substituir itens indisponíveis.', changes: 'Adiciona opções de substituição aos pedidos.', implemented: false },
  { key: 'variants', label: 'Variações', description: 'Cadastre tamanhos, cores e outras variações.', changes: 'Adiciona variações às opções de produtos.', implemented: false },
  { key: 'reserve_exchange', label: 'Reserva e troca', description: 'Gerencie reservas e trocas de produtos.', changes: 'Adiciona os fluxos de reserva e troca.', implemented: false },
  { key: 'scheduling', label: 'Agendamento', description: 'Organize horários e serviços agendados.', changes: 'Adiciona agenda e horários ao painel.', implemented: false },
  { key: 'quotes', label: 'Orçamentos', description: 'Prepare e acompanhe orçamentos.', changes: 'Adiciona o fluxo de orçamento ao painel.', implemented: false },
  { key: 'street_vendor', label: 'Ambulante', description: 'Organize vendas realizadas na rua.', changes: 'Adiciona ferramentas para operação ambulante.', implemented: false },
  { key: 'pos', label: 'PDV', description: 'Registre vendas presenciais no ponto de venda.', changes: 'Exibe o acesso ao ponto de venda.', implemented: true },
  { key: 'loyalty', label: 'Fidelidade', description: 'Recompense clientes recorrentes.', changes: 'Adiciona recursos de fidelidade ao painel.', implemented: false },
  { key: 'credit_tab', label: 'Fiado', description: 'Acompanhe vendas a prazo e saldos de clientes.', changes: 'Adiciona controle de conta e fiado.', implemented: false },
];

export type ModulePreset = Partial<Record<ModuleKey, Record<string, unknown>>>;

export const BUSINESS_PRESETS: Record<BusinessType, ModulePreset> = {
  RESTAURANTE: { delivery: {}, pickup: {}, kds: {}, dine_in: { mode: 'TABLE' }, service_fee: { percent: 10 }, pos: {} },
  PIZZARIA: { delivery: {}, pickup: {}, kds: {}, dine_in: { mode: 'TABLE' }, service_fee: { percent: 10 }, pos: {}, loyalty: {} },
  BAR: { kds: { mode: 'BAR' }, dine_in: { mode: 'INDIVIDUAL' }, counter: {}, service_fee: { percent: 10 }, pos: {} },
  LANCHONETE_CAFE: { delivery: {}, pickup: {}, kds: {}, counter: {}, pos: {}, loyalty: {} },
  MERCADO: { delivery: {}, pickup: {}, weight: {}, barcode: {}, substitution: {}, pos: {} },
  ADEGA: { delivery: {}, pickup: {}, barcode: {}, pos: {}, loyalty: {} },
  ROUPAS: { delivery: {}, pickup: {}, barcode: {}, variants: {}, reserve_exchange: {}, pos: {} },
  PERFUMARIA: { delivery: {}, pickup: {}, barcode: {}, variants: {}, reserve_exchange: {}, pos: {}, loyalty: {} },
  SALAO_BARBEARIA: { scheduling: {}, pos: {}, loyalty: {} },
  CONSTRUCAO: { delivery: {}, pickup: {}, barcode: {}, quotes: {}, pos: {} },
  AMBULANTE: { pickup: {}, street_vendor: {}, pos: {} },
  OUTRO: { delivery: {}, pickup: {} },
};

export const LEGACY_ENABLED_MODULES: ReadonlySet<ModuleKey> = new Set(['delivery', 'pickup', 'pos', 'printing']);

export function isModuleEnabled(modules: ReadonlySet<ModuleKey> | null | undefined, key: ModuleKey): boolean {
  return modules ? modules.has(key) : LEGACY_ENABLED_MODULES.has(key);
}

export function presetModuleKeys(type: BusinessType): ModuleKey[] {
  return Object.keys(BUSINESS_PRESETS[type]) as ModuleKey[];
}

export interface DisableCheck {
  allowed: boolean;
  message?: string;
}

export type CanDisableModule = (tenantId: string) => Promise<DisableCheck>;

export const MODULE_DISABLE_CHECKS: Partial<Record<ModuleKey, CanDisableModule>> = {
  dine_in: async () => ({ allowed: true }),
};

export function canDisableModule(key: ModuleKey, tenantId: string): Promise<DisableCheck> {
  return (MODULE_DISABLE_CHECKS[key] || (async () => ({ allowed: true })))(tenantId);
}

/** Telas do painel que dependem de um módulo. Telas fora daqui não dependem de módulo. */
export const TAB_MODULES: Readonly<Record<string, ModuleKey>> = {
  'est-kitchen': 'kds',
  'est-drivers': 'delivery',
  'est-salon': 'dine_in',
  'est-mesas-qr': 'dine_in',
};

export function tabRequiredModule(tab: string): ModuleKey | undefined {
  return TAB_MODULES[tab];
}

export function isTabModuleEnabled(modules: ReadonlySet<ModuleKey> | null | undefined, tab: string): boolean {
  const key = tabRequiredModule(tab);
  return !key || isModuleEnabled(modules, key);
}

export function moduleLabel(key: ModuleKey): string {
  return MODULES.find(module => module.key === key)?.label || key;
}
