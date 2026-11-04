# Entrega 1.1 — validação local

Base: `537d266` (`main`). Branch: `feat/entrega1-1`. Nenhum acesso a produção, deploy ou merge.

## Parte A

### Causa do PIX parecer liberar a mesa

`reserve_tab_pix` mantém a comanda em `AWAITING_PAYMENT`. `close_tab` recusa cobrança `creating/pending`; somente a confirmação paga do provedor fecha a comanda. A derivação de status inclui `AWAITING_PAYMENT` entre as comandas ativas. A regressão visual estava em `tableStatus.ts` e `salon.css`: PIX pendente compartilhava a família verde de Livre. Agora usa azul e o rótulo “Aguardando PIX”. Não foi encontrada chamada de fechamento ao gerar o QR.

Outro problema de apresentação: `TabPixPanel` dispensava a confirmação automaticamente após 1,8 s, e o refresh das comandas ativas desmontava o painel ao receber `CLOSED`. A confirmação fica aberta até “Concluir”, com contexto da comanda capturado e descartado ao trocar de loja/mesa.

A reprodução usa PostgreSQL 17 local descartável, sem rede, cobrindo reserva, recusa de fechamento, pagamento, expiração e cancelamento; o frontend usa respostas controladas do servidor e atualização do estado da mesa. Não houve consulta ao banco de staging remoto ou produção.

### Comprovantes

Não existe provedor transacional prévio no repo. O adaptador Resend lê `RESEND_API_KEY` e `RECEIPT_FROM` somente no servidor. `TODO(email-provider)`: configurar remetente verificado e segredo no ambiente antes de habilitar envio real. Sem configuração, retorna `EMAIL_PROVIDER_NOT_CONFIGURED`. Os testes não enviam e-mails reais.

A equipe recebe apenas existência/endereço mascarado via RPC. O servidor autentica o usuário, valida vínculo e acesso à comanda e reserva até três tentativas por comanda em dez minutos sob lock no banco. Auditoria registra ator, horário e resultado, sem endereço. O conteúdo não inclui CPF ou telefone.

### Segurança e LGPD

- RPCs novas com `SECURITY DEFINER SET search_path=''`, revogação de PUBLIC e grants mínimos.
- Reabertura verifica sessão autenticada, aprovação e validade; equipe verifica loja/atribuição. PIX ativo ou pago impede reabrir.
- Consultas e links resolvem apenas mesas/pedidos da loja atual; contexto de pagamento é descartado na troca de loja.
- Endereço completo restrito ao caminho servidor → provedor; erros externos não são refletidos ou registrados.
- Rollbacks acompanham as migrações e são exercitados em bancos descartáveis.
- PWA, totem, PDV, cobrança e produção fora das alterações.

Resultados e contagens são preenchidos após as verificações de cada parte.

Verificações da Parte A: TypeScript sem erros; Vitest completo 220 arquivos / 1.847 testes aprovados. Após revisão final de isolamento, a regressão afetada do dashboard aprovou 7 testes (2 novos de troca de loja/resposta atrasada). SQL: 11/11 scripts `supabase/tests/*/run_regressions.sh` aprovados; suíte nova 42/42 asserções, inclusive modo de privilégios herdados. `mesas_access` repetida isoladamente depois de instalar Python no contêiner local. Migração e rollback comparados por fingerprint de schema/ACL duas vezes.
