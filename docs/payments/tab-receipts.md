# Recibo por E-mail da Comanda (`server/receipts`)

`POST /api/receipts/tabs/:tabId` exige a sessão Supabase no cabeçalho `Authorization: Bearer …`. A RPC `reserve_tab_receipt(p_tab, p_user, p_override_email)` valida o colaborador (dono, gerente, caixa ou garçom autorizado daquela mesa), exige comanda encerrada (`CLOSED`) com pagamento integral confirmado (PIX confirmado em `tab_pix_charges` ou dinheiro/cartão em `tab_payments`), limita a **3 tentativas por comanda a cada 10 minutos** (`tab_receipt_sends`) e retorna o destinatário apenas ao servidor (`service_role`).

## E-mail Mascarado e Opção "Enviar para outro email"

- No fechamento da conta (Salão do dono e App do Garçom), a UI consulta `tab_receipt_target(p_tab)` e exibe o e-mail do cliente cadastrado na conta **parcialmente mascarado** (ex.: `da***@gm***.com`). O endereço completo nunca é retornado ao navegador.
- Caso o cliente deseje receber em outro endereço (ou não tenha e-mail cadastrado na conta), o colaborador pode acionar **"Enviar para outro email"** e informar um endereço validado no cliente, no servidor (`isValidReceiptOverrideEmail`) e no banco (`reserve_tab_receipt`).
- Por conformidade com a LGPD, `tab_receipt_sends` registra apenas `tenant_id`, `tab_id`, `actor_id`, `charge_id`, `status` e `reason` — nenhum endereço de e-mail (cadastrado ou alternativo) é persistido na auditoria de envio.

## Variáveis e Secrets Necessárias (Resend)

O envio é processado pelo adaptador `server/receipts` (`ResendReceiptProvider`) e/ou Edge Function/runtime do servidor:

| Variável / Secret | Onde configurar | Finalidade |
|---|---|---|
| `RESEND_API_KEY` | AI Studio Secrets / Ambiente do servidor Node (`server/receipts`) / Supabase Edge Function Secrets (`supabase secrets set RESEND_API_KEY=...`) | Chave de API privada da conta Resend. **Nunca** expor com prefixo `VITE_`. |
| `RECEIPT_FROM` | AI Studio Secrets / Ambiente do servidor Node (`server/receipts`) / Supabase Edge Function Secrets (`supabase secrets set RECEIPT_FROM="Nome da Loja <recibo@seudominio.com>"`) | Remetente verificado no domínio do Resend. |

### Comportamento quando não configurado

- Se `RESEND_API_KEY` ou `RECEIPT_FROM` não estiverem definidos no servidor, `ReceiptService` **não finge sucesso**:
  1. Registra no log do servidor o motivo (`[receipts] EMAIL_PROVIDER_NOT_CONFIGURED: RESEND_API_KEY or RECEIPT_FROM missing`), sem expor segredos nem dados pessoais.
  2. Grava a tentativa em `tab_receipt_sends` com `status = 'FAILED'` e `reason = 'EMAIL_PROVIDER_NOT_CONFIGURED'` via `finish_tab_receipt`.
  3. Retorna `200 {"sent": false, "reason": "EMAIL_PROVIDER_NOT_CONFIGURED"}` e a interface exibe **"Envio de email não configurado"**.
