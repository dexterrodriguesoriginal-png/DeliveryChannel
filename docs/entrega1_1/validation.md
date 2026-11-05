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

## Parte C

Equipe & Permissões agora tem abas Todos, Gerente, Caixa, Cozinha, Garçom, Estoque, Coordenador e Entregador, com contagem de membros ACTIVE e convites PENDING. Garçom/Cozinha acompanham `store_tools`. A causa da ausência de convidados aceitos estava na tela: `list_team_directory` já incluía todos os papéis e `accept_team_invite` já ativava o vínculo, mas a tela só enriquecia os resultados da consulta direta, descartando os membros presentes apenas no diretório autorizado. O diretório passa a ser a fonte principal; fallback direto somente em bancos antigos sem a RPC, com erro/repetição explícitos para falhas reais.

Convites são mascarados no RPC e na interface. Reenviar renova a validade por UUID com permissão de equipe, ferramenta ativa e limites, registra auditoria sem endereço e abre o compartilhamento do QR/link. O fluxo de convite existente não tem envio automático de e-mail; a interface informa isso e não afirma ter enviado uma mensagem. Aceites de todos os sete papéis de equipe são cobertos em SQL.

Movimento do salão mostra pedidos, visitas encerradas, faturamento confirmado, ticket médio, permanência, chamados atendidos, resposta média e todas as contas abertas. A RPC agrega sem dados pessoais e verifica vínculo/loja/módulo. Não havia data histórica de abertura confiável: `salon_opened_at` passa a registrar a abertura real no banco, sem backfill inventado. Janela desde a abertura de hoje em America/Sao_Paulo; sem esse evento, últimas 12 horas. Médias sem amostra são “—”. Abertas antigas continuam no contador; pagamento pendente não entra em receita. Troco não é subtraído novamente do valor líquido do livro de pagamentos.

Cards, abas e listas compartilham rolagem para continuar acessíveis em telas baixas. A interface mantém polling e realtime com descarte de respostas da loja anterior. Migração/rollback C: `20261104000300_entrega1_1`.

Regressão adicional final: Salão do dono conserva confirmação/valor/comprovante quando o refresh remove a comanda paga, até “Concluir” (15 testes do mapa aprovados). O aviso acima do PIX usa texto neutro para não declarar a conta aberta depois do pagamento.

Validação final C (todas as partes): TypeScript sem erros; Vitest completo **237 arquivos / 1.958 testes aprovados, zero falhas e zero pendentes**. Todas as **11/11** suítes SQL aprovadas; suíte `entrega1_1` **169/169** asserções e fingerprint exato de A+B+C em apply → rollback → apply → rollback. A execução completa final também confirmou as correções das duas falhas encontradas no primeiro passe da Parte B. Verificações afetadas C1: 5 arquivos / 61 testes; C2: 4 arquivos / 17 testes. PWA/instalação/totem/PDV/cobrança não alterados; `prompt_*.md` não versionados.

Pendências operacionais: configurar `RESEND_API_KEY` e remetente verificado em `RECEIPT_FROM` antes do envio real de comprovantes. Convites continuam no mecanismo existente de QR/link, com renovação explícita e sem alegação de e-mail enviado. Histórico de abertura anterior à migração usa a janela de 12 horas. Nenhuma migração aplicada a staging remoto/produção, nenhum deploy e nenhum merge.

## Ajustes médios da revisão do PR #19

`tab_receipt_sends.actor_id` aceita NULL e usa `ON DELETE SET NULL`: excluir a identidade/perfil do ator conserva o histórico de envio, cobrança, horário e resultado. A FK composta `(tenant_id, order_id)` de `order_delivery_disputes` usa `ON DELETE CASCADE`, removendo a disputa na exclusão administrativa de seu pedido, sem alcançar pedidos/disputas de outras lojas.

Os downs removem essas tabelas e suas FKs, sem tentar restaurar NOT NULL em históricos cujo ator já foi excluído nem recriar RESTRICT antes de remover a tabela. A proteção existente que bloqueia exclusão normal de pedidos continua intacta; somente a fixture local suspende temporariamente esse trigger para testar a cascata e o reativa em seguida.

Validação da revisão: TypeScript sem erros; Vitest completo com 237 arquivos / 1.958 testes aprovados; regressão SQL de entrega1_1 com 180/180 asserções aprovadas (11 novas), além de apply → rollback exato → apply → rollback exato. Nenhum acesso a produção, deploy ou merge.

