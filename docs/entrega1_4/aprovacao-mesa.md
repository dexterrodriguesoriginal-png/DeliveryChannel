# Aprovação de mudança de mesa

A solicitação do cliente não altera a mesa. `customer_move_table` registra uma solicitação pendente; a conta, os pedidos e as pessoas continuam na mesa atual até uma decisão autorizada.

O dono (`OWNER` do tenant) pode autorizar ou recusar no Salão. Em **Equipe & Permissões → Garçom**, a opção **Garçom pode autorizar mudança de mesa** vem desligada. Somente o dono pode alterá-la. Ligada, permite que garçons ativos responsáveis pela conta vejam e resolvam as solicitações; desligada, a interface oculta o painel e o servidor recusa tanto a leitura quanto a decisão do garçom. Gerente/caixa não recebem essa autorização implicitamente.

Na aprovação, o servidor verifica novamente a sessão aprovada do responsável, a conta aberta e sem cobrança/pagamento, a mesa de origem e a disponibilidade do destino na mesma loja. A solicitação não reserva uma mesa livre. Se ela for ocupada antes da decisão, a autorização falha sem mover a dívida. Recusar não altera a conta.

As decisões e substituições de solicitação são serializadas com as operações existentes de mesa. Um destino novo gera outro identificador de solicitação e cancela o anterior; uma decisão antiga não autoriza um destino alterado. A autorização do garçom é reavaliada no servidor, inclusive quando o dono a desliga durante uma decisão concorrente.

Migration: `supabase/migrations/20261104000700_entrega1_4_move_approval.sql`. Rollback: `supabase/rollback/20261104000700_entrega1_4_move_approval_down.sql`. O rollback restaura definições/ACL e a estrutura anterior, verificado em dois ciclos por perfil de privilégios. Solicitações registradas ou a permissão habilitada bloqueiam a reversão até preservação/arquivamento e desativação explícita; o histórico não é apagado silenciosamente.

Testes locais: `sh supabase/tests/entrega1_4/run_regressions.sh strict` e `legacy`. Nenhuma nova permissão é concedida a `anon`; os dados das solicitações são limitados à sessão solicitante e aos funcionários autorizados daquela conta/loja. Não são armazenados emails nas solicitações.
