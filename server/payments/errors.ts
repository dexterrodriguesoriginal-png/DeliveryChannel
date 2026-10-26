import { PaymentError } from './types';

// Match only messages we own. Never send arbitrary database details to the browser.
const databaseErrors: Record<string, [string, string, number?]> = {
  'Acesso negado.': ['FORBIDDEN', 'Somente o proprietário ou gerente pode configurar os pagamentos.', 403],
  'Conta não conectada.': ['ACCOUNT_NOT_CONNECTED', 'Conecte esta conta antes de escolhê-la para receber.'],
  'Conexão expirada; inicie novamente.': ['CONNECTION_EXPIRED', 'A conexão expirou. Clique em Conectar e tente novamente.'],
  'Conexão alterada; conecte novamente.': ['RECONNECT_REQUIRED', 'A conexão mudou. Conecte sua conta novamente.'],
  'Credenciais ausentes.': ['RECONNECT_REQUIRED', 'Não foi possível autorizar a conta. Conecte novamente.'],
  'Configure a chave PIX da loja.': ['PIX_SETTINGS_REQUIRED', 'Cadastre e ative a chave PIX da loja antes de conectar.'],
  'Aguarde os pagamentos pendentes antes de desconectar.': ['PENDING_PAYMENTS', 'Confira os pagamentos em aberto antes de desconectar esta conta.'],
  'Pedido não aceita confirmação.': ['ORDER_NOT_CONFIRMABLE', 'Este pedido foi cancelado, já foi pago ou teve o valor alterado. Atualize o pedido antes de confirmar.'],
  'Confirmação manual não permitida.': ['MANUAL_CONFIRMATION_FORBIDDEN', 'Somente o proprietário ou gerente pode confirmar um PIX manual ou pagamento InfinitePay.', 403],
  'Pagamento indisponível.': ['PAYMENT_UNAVAILABLE', 'Este pagamento não está mais disponível. Atualize o pedido.'],
  'Pedido indisponível.': ['ORDER_NOT_FOUND', 'Este pedido não está disponível para sua conta.', 404],
  'Pedido não aceita pagamento.': ['ORDER_NOT_PAYABLE', 'Este pedido já foi pago, cancelado ou estornado.'],
  'Este pedido já tem um pagamento em andamento.': ['PAYMENT_IN_PROGRESS', 'Este pedido já tem um pagamento em andamento. Consulte o pedido antes de tentar outra forma.'],
  'Confira o pagamento com a loja antes de tentar novamente.': ['PAYMENT_IN_PROGRESS', 'Confira o recebimento na InfinitePay antes de tentar cobrar novamente.'],
  'Forma de pagamento indisponível.': ['METHOD_UNAVAILABLE', 'Esta forma de pagamento está desativada. Confira a conta conectada e os meios aceitos.'],
  'Forma de pagamento incompatível com o pedido.': ['METHOD_MISMATCH', 'Escolha uma forma de pagamento compatível com o pedido.'],
};
export function paymentStorageError(error: { code?: string; message?: string }) {
  const known = databaseErrors[error.message ?? ''];
  if (known) return new PaymentError(known[0], known[2] ?? 409, known[1]);
  if (error.code === '42501') return new PaymentError('FORBIDDEN', 403, 'Você não tem permissão para alterar este pagamento.');
  return new PaymentError('PAYMENT_STORAGE_ERROR', 409, 'Não foi possível salvar a alteração. Atualize a página e tente novamente.');
}
