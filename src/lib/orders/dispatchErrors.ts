/**
 * Mensagens claras (pt-BR) para "Chamar motoboy" / "Despachar" (19/10).
 *
 * O que o servidor realmente devolve:
 *  - update_order_status(READY -> WAITING_FOR_DRIVER) NÃO verifica se a loja tem entregador: com zero
 *    entregadores aprovados a chamada "dá certo" e o pedido fica esperando para sempre. Por isso o painel
 *    avisa ANTES de chamar (noApprovedDriverMessage) quando a lista de entregadores aprovados está vazia.
 *  - assign_order_to_driver devolve frases P0001 em português ou P0414 (entregador não aprovado),
 *    DRIVER_ALREADY_ASSIGNED, "não está disponível", "não está pronto para despacho", etc.
 *  - update_order_status devolve TRANSITION_FORBIDDEN / ORDER_CANCELLED_IS_FINAL / STATUS_UNCHANGED.
 */
export const DRIVERS_MENU_HINT = 'menu Frota & Entregadores';

export const NO_APPROVED_DRIVER_TITLE = 'Sem entregador aprovado';

export function noApprovedDriverMessage(): string {
  return `Sua loja ainda não tem entregador aprovado, então ninguém receberia esta chamada. ` +
    `Cadastre ou aprove um entregador no ${DRIVERS_MENU_HINT} (convite por link) e tente de novo.`;
}

function rawMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in (err as any)) return String((err as any).message || '');
  return '';
}

function rawCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in (err as any) ? String((err as any).code || '') : '';
}

/** Traduz o erro de despacho/chamada de motoboy para uma frase que diz o porquê e o que fazer. */
export function dispatchErrorMessage(err: unknown): string {
  const msg = rawMessage(err);
  const code = rawCode(err);
  const m = msg.toLowerCase();

  const offers: Record<string, string> = {
    OFFER_EXPIRED: 'Esta chamada expirou. Aguarde uma nova oferta.',
    OFFER_NOT_FOUND: 'Esta chamada não está mais disponível.',
    OFFER_ALREADY_EXISTS: 'Este pedido já está aguardando aceite do entregador.',
    DRIVER_BUSY: 'Este entregador está indisponível ou já em outra entrega. Escolha outro.',
    NO_DRIVER_IN_QUEUE: 'Nenhum entregador aceitou. Não há outro entregador disponível na fila.',
    ORDER_NOT_READY: 'O pedido precisa estar "Pronto", sem entregador, para receber uma chamada.',
    DRIVER_REQUIRED: 'Selecione um entregador disponível.',
    PAYMENT_REQUIRED: 'Aguarde a confirmação do pagamento online.',
  };
  const prefix = msg.split(':')[0].trim();
  if (offers[prefix]) return offers[prefix];
  if (code === 'P0414' || /não aprovado|nao aprovado|not approved/.test(m)) {
    return `Este entregador ainda não foi aprovado na sua loja. Aprove o cadastro dele no ${DRIVERS_MENU_HINT} e tente de novo.`;
  }
  if (/cadastro operacional de motorista não encontrado|não é um motorista ativo|driver_not_found/.test(m)) {
    return `Este entregador não está cadastrado (ou foi removido) nesta loja. Confira no ${DRIVERS_MENU_HINT}.`;
  }
  if (/não está disponível para receber|driver_not_available/.test(m)) {
    return 'Este entregador está indisponível ou já em outra entrega. Escolha outro entregador disponível.';
  }
  if (/driver_already_assigned|já está com outro entregador/.test(m)) {
    return 'Este pedido já está com outro entregador. Remova o entregador atual antes de trocar.';
  }
  if (/não está pronto para despacho/.test(m)) {
    return 'O pedido precisa estar "Pronto" para chamar ou despachar o entregador. Avance o status e tente de novo.';
  }
  if (/order_cancelled_is_final|cancelado não pode/.test(m)) {
    return 'Este pedido foi cancelado e não pode mais ser despachado.';
  }
  if (/status_unchanged/.test(m)) {
    return 'O motoboy já foi chamado para este pedido. Aguarde um entregador aceitar.';
  }
  if (/transition_forbidden|permissão negada|sem permissão/.test(m) || code === '42501') {
    return 'Seu perfil não tem permissão para despachar pedidos. Peça ao dono ou ao gerente da loja.';
  }
  if (/failed to fetch|network|fetch failed|timeout/.test(m)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  }
  const clean = msg.replace(/^[A-Z_]{4,}:\s*/, '').trim();
  return clean ? `Não foi possível chamar o entregador: ${clean}` : 'Não foi possível chamar o entregador. Tente de novo em instantes.';
}

/**
 * Pode chamar o motoboy? Bloqueia só quando temos CERTEZA de que não há entregador aprovado
 * (lista carregada com sucesso e vazia, por quem pode listar). Na dúvida, deixa chamar.
 */
export function shouldBlockCallDriver(opts: { canListDrivers: boolean; driversLoaded: boolean; approvedCount: number }): boolean {
  return opts.canListDrivers && opts.driversLoaded && opts.approvedCount === 0;
}
// resync
