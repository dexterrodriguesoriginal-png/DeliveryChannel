/**
 * Grade do cardápio (totem e mesa): exatamente as colunas configuradas pelo dono
 * (1, 2 ou 3). Sem largura mínima — no telefone estreito também ficam 3 quando o
 * dono escolhe 3; o conteúdo escala com a largura do card.
 */
export function kioskProductGridColumns(columns: 1 | 2 | 3): string {
  return `repeat(${columns}, minmax(0, 1fr))`;
}
