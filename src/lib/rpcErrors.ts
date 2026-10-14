/**
 * Erros de negócio das RPCs (fix R3, 14/10).
 * O PostgREST só mapeia P0001 para HTTP 400; os códigos próprios P04xx chegam como HTTP 500.
 * O status HTTP não importa aqui: o supabase-js devolve `error` e o repositório SEMPRE lança
 * (erro nunca vira sucesso). Esta camada só traduz o código para uma mensagem amigável.
 */
export const RPC_ERROR_MESSAGES: Record<string, string> = {
  P0410: 'Conflito de papel: esta conta já faz parte da equipe da loja e não pode ser entregador.',
  P0412: 'Este usuário já faz parte da equipe.',
  P0413: 'Já existe um convite pendente para este e-mail.',
  P0414: 'Entregador não aprovado.',
  P0416: 'Vínculo inconsistente. Fale com a loja.',
  P0417: 'Transição inválida.',
  P0418: 'Entregador está com pedido em rota; desatribua antes.',
  P0429: 'Muitas tentativas. Aguarde e tente novamente.',
  '42501': 'Sem permissão para esta ação.',
};

const GENERIC = 'Não foi possível concluir a ação. Tente novamente.';

/** Código de regra de negócio emitido pelas nossas funções (P04xx). */
export function isBusinessRpcCode(code: unknown): code is string {
  return typeof code === 'string' && /^P04\d\d$/.test(code);
}

/** Mapeamento estrito: código conhecido → texto fixo; o resto → genérico (nunca expõe detalhes). */
export function mapStrictRpcError(err: any): string {
  const code = err?.code as string | undefined;
  if (code && RPC_ERROR_MESSAGES[code]) return RPC_ERROR_MESSAGES[code];
  const msg = String(err?.message || '');
  if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(msg)) {
    return 'Recurso ainda não disponível.';
  }
  return GENERIC;
}

/**
 * Para RPCs legadas cujas mensagens P0001 já são frases em português pensadas para o usuário:
 * código conhecido → texto fixo; P04xx desconhecido ou P0001 → mensagem do servidor; vazio → genérico.
 */
export function rpcErrorMessage(err: any): string {
  const code = err?.code as string | undefined;
  if (code && RPC_ERROR_MESSAGES[code]) return RPC_ERROR_MESSAGES[code];
  const msg = String(err?.message || '').trim();
  if ((isBusinessRpcCode(code) || code === 'P0001') && msg) return msg;
  return msg || GENERIC;
}

/** Erro lançado pelos repositórios; preserva o código para quem precisar decidir por ele. */
export class RpcBusinessError extends Error {
  code?: string;
  constructor(err: any, message?: string) {
    super(message ?? rpcErrorMessage(err));
    this.code = err?.code;
    this.name = 'RpcBusinessError';
  }
}
