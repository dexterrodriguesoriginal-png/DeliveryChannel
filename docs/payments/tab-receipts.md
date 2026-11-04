# Recibo por E-mail da Comanda (`server/receipts`)

`POST /api/receipts/tabs/:tabId` exige a sessão Supabase no cabeçalho `Authorization: Bearer …`. A RPC `reserve_tab_receipt(p_tab, p_user, p_override_email)` valida o colaborador (dono, gerente, caixa ou garçom autorizado daquela mesa), exige comanda encerrada (`CLOSED`) com pagamento integral confirmado (PIX confirmado em `tab_pix_charges` ou dinheiro/cartão em `tab_payments`), limita a **3 tentativas por comanda a cada 10 minutos** (`tab_receipt_sends`) e retorna o destinatário apenas ao servidor (`service_role`).

## E-mail Mascarado e Opção "Enviar para outro email"

- No fechamento da conta (Salão do dono e App do Garçom), a UI consulta `tab_receipt_target(p_tab)` e exibe o e-mail do cliente cadastrado na conta **parcialmente mascarado** (ex.: `da***@gm***.com`). O endereço completo nunca é retornado ao navegador.
- Caso o cliente deseje receber em outro endereço (ou não tenha e-mail cadastrado na conta), o colaborador pode acionar **"Enviar para outro email"** e informar um endereço validado no cliente, no servidor (`isValidReceiptOverrideEmail`) e no banco (`reserve_tab_receipt`).
- Por conformidade com a LGPD, `tab_receipt_sends` registra apenas `tenant_id`, `tab_id`, `actor_id`, `charge_id`, `status` e `reason` — nenhum endereço de e-mail (cadastrado ou alternativo) é persistido na auditoria de envio.

## Variáveis e Secrets Necessárias (Resend)

O envio desta implementação é processado pela rota Express `server/receipts` (`ResendReceiptProvider`). Os segredos precisam estar no runtime do servidor Node que recebe `/api/receipts`; configurar somente Secrets de uma Edge Function não configura essa rota:

| Variável / Secret | Onde configurar | Finalidade |
|---|---|---|
| `RESEND_API_KEY` | AI Studio Secrets / ambiente privado do servidor Node (`server/receipts`) | Chave de API privada da conta Resend. **Nunca** expor com prefixo `VITE_`. |
| `RECEIPT_FROM` | AI Studio Secrets / ambiente privado do servidor Node (`server/receipts`) | Remetente verificado no domínio do Resend. |

### Comportamento quando não configurado

- Se `RESEND_API_KEY` ou `RECEIPT_FROM` não estiverem definidos no servidor, `ReceiptService` **não finge sucesso**:
  1. Verifica colaborador, loja, mesa e pagamento na RPC exclusiva do serviço `authorize_tab_receipt`.
  2. Registra no log o motivo (`[receipts] EMAIL_PROVIDER_NOT_CONFIGURED: RESEND_API_KEY or RECEIPT_FROM missing`), sem segredos nem dados pessoais. Não reserva envio nem consome cota.
  3. Retorna `200 {"sent": false, "reason": "EMAIL_PROVIDER_NOT_CONFIGURED"}` e a interface exibe **"Envio de email não configurado"**.


## Revisão de segurança

A seleção alternativa aceita um único endereço de email convencional, validado no navegador, no HTTP, no serviço e no SQL. Nomes de exibição, listas, CRLF e domínios malformados são recusados. O destinatário alternativo não muda o cadastro e compartilha o limite da própria conta, independentemente do endereço escolhido.

Quando o provedor não está configurado, a autorização da equipe e a confirmação do pagamento são verificadas por uma RPC exclusiva do serviço. Esse retorno não reserva tentativa nem esgota o limite de envios. A consulta de email mascarado precisa concluir antes de habilitar envio; falhas oferecem nova tentativa.

O rollback005 restaura o schema/ACL anterior somente quando não há registros de recibos manuais incompatíveis com o contrato antigo. Se existirem, ele recusa com `ROLLBACK_BLOCKED`; é necessário preservar/arquivar a auditoria conforme a retenção antes de uma reversão operacional. Não há exclusão automática de comprovantes ou histórico.

Com pagamentos mistos, o recibo lista todas as formas registradas (por exemplo `CASH + CREDIT_CARD`), sem reduzir o pagamento à última parcela.

Ao fechar mesas juntas, os vínculos ativos das mesas são liberados. O garçom que efetivamente fechou (`closed_by`) ou solicitou a cobrança PIX paga (`created_by` de uma cobrança confirmada, sem revisão e no valor correto) mantém acesso ao comprovante daquela conta. A regra continua exigindo vínculo ativo com a mesma loja, ferramenta/perfil habilitados e não concede acesso a outras contas.
