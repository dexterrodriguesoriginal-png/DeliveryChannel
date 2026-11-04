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

## Parte B

Alertas abrem `#/painel/est-orders?order=<id>` com drawer da própria loja, inclusive quando o hash muda; fechar remove o parâmetro. Aceitar usa o gateway validado do kanban, passando de PENDING a CONFIRMED e PREPARING com checagem do estado esperado. Rodadas já CONFIRMED oferecem “Enviar p/ produção”.

O garçom não tem mais o link administrativo no menu Mais. O roteamento bloqueia a montagem do painel administrativo e abre `/garcom/<slug>`; falhas de renderização têm recuperação visível.

`statusColors.ts` preserva os hex reais do kanban: aguardando vermelho, produção laranja, pronto/saiu roxo, entregue verde, cancelado cinza. Selos, cards, mapa, listas do garçom e acompanhamento do cliente usam os mesmos tokens. Conta pedida continua marrom e PIX pendente azul. `WaiterOrderSheet` contém composição de pedido, sem status de rodada para unificar.

Entrega usa RPC autenticada e atribuição/loja verificadas, com autor e horário no banco. O cliente pode informar “Não recebi” por cinco minutos, validado no servidor; a mesma sessão autenticada pode acompanhar a conta fechada, sem ampliar o acesso de sessões revogadas. Há uma disputa por pedido. Confirmar encerra a disputa; reenviar volta à produção. Uma fila também mantém reenvios de comandas fechadas visíveis até a nova entrega, sem reabrir a mesa nem alterar o pagamento. Novos eventos usam realtime e fallback de polling.

Migração/rollback B preservam `delivered_at`, que já existia, e restauram exatamente definições/ACL anteriores. UPDATE direto de `delivered_by` continua revogado, evitando falsificação do autor. Novas RPCs têm `search_path=''`, grants mínimos e RLS nas disputas. Avisos de disputa são revalidados na loja antes de aparecer; a referência de pedido abre Pedidos, enquanto reabertura continua abrindo a mesa. Textos de telefone nas telas de equipe alteradas ficam mascarados.

A revisão B também reproduziu um erro de renderização: `EstablishmentDashboard` retornava quando faltava loja antes dos hooks `topProducts`/`salesChartData`, alterando a contagem de hooks na hidratação de autenticação. As telas Dashboard/Pedidos agora montam conteúdo apenas com loja resolvida e chave por tenant. Testes cobrem loja ausente→resolvida→ausente, descarte de drawer/cadastros anteriores e conclusão atrasada sem toast da loja antiga. Regressões finais afetadas: 8 arquivos / 90 testes aprovados.

Validação B: TypeScript final sem erros. A execução completa Vitest percorreu 234 arquivos / 1.924 testes: 1.922 passaram; uma expectativa antiga de aceite e uma corrida de restauração da sacola falharam. A expectativa foi atualizada para PREPARING; o cardápio agora só fica interativo após restaurar a sacola do QR atual. Reexecução afetada: 4 arquivos / 36 testes aprovados, incluindo nova regressão de primeiro clique com sacola salva (1.925 testes únicos verificados em B). Tipos de mocks corrigidos e rechecados; nenhuma suíte completa foi repetida. SQL: 11/11 scripts aprovados; suíte Entrega1.1 com A+B: 98/98, rollback exato/reaplicação.
