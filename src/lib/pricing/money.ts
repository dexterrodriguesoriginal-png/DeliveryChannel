/**
 * Formatação monetária brasileira da vitrine (carrinho, checkout e pedidos): "R$ 9,00", "R$ 1.234,50".
 * Usa Intl pt-BR para o número e um espaço comum depois de "R$" (evita o espaço não separável do Intl
 * em textos copiados/notas do pedido).
 */
const NUMBER_BR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Só o número em pt-BR: 9 → "9,00"; 1234.5 → "1.234,50". Valor inválido vira "0,00". */
export function brNumber(value: number | string | null | undefined): string {
  const n = Number(value);
  return NUMBER_BR.format(Number.isFinite(n) ? n : 0);
}

/** Valor com símbolo: 9 → "R$ 9,00". */
export function formatBRL(value: number | string | null | undefined): string {
  return `R$ ${brNumber(value)}`;
}
