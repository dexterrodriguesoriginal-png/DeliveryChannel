# Comprovante de PIX da comanda

`POST /api/receipts/tabs/:tabId` exige a sessão Supabase no cabeçalho `Authorization: Bearer …`. O corpo não escolhe destinatário, loja, valor ou estado do pagamento. A RPC `reserve_tab_receipt` valida o funcionário e a loja, exige PIX pago e comanda encerrada, limita a três tentativas por comanda em dez minutos e retorna o destinatário somente ao servidor. `finish_tab_receipt` registra resultado, autor e horário sem guardar o e-mail.

A equipe consulta apenas `tab_receipt_target`, que fornece existência e e-mail mascarado. O endereço completo nunca é retornado pela API de envio nem incluído em logs. O conteúdo contém loja, mesa, itens, taxa de serviço, total, forma, horário de Brasília e ID da cobrança, sem CPF ou telefone.

## Configuração pendente

**TODO(email-provider):** cadastrar um remetente verificado no Resend e definir `RESEND_API_KEY` e `RECEIPT_FROM` como segredos do ambiente do servidor. Não usar variáveis `VITE_*` para esses valores. Sem ambas, uma solicitação autorizada responde `200 {"sent":false,"reason":"EMAIL_PROVIDER_NOT_CONFIGURED"}`; a interface informa “Envio de comprovante ainda não configurado”. Nenhum e-mail foi enviado ou credencial configurada nesta entrega.

O adaptador usa exclusivamente `https://api.resend.com/emails`, recusa redirecionamentos, aplica timeout e não registra nem retorna respostas do provedor. Cada tentativa tem uma chave de idempotência própria. Falhas também consomem a tentativa para impedir abuso; um resultado incerto de rede pode representar um envio concluído pelo provedor, e o usuário deve aguardar antes de reenviar.
