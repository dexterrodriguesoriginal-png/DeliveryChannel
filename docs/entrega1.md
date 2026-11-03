# Entrega 1 — validação e revisão

Base: `7b9e2b8`. Branch: `feat/entrega1`. Esta entrega não aplica migrações remotas, não altera dados de produção e não faz deploy ou merge.

## Alterações

- Cadastro de garçom: diagnóstico seguro por etapa, recuperação de identidade sintética órfã da mesma loja, reativação da associação e erros acionáveis de Auth/foto. Compressão no navegador até 200 KB; limite do servidor de 256 KB.
- Primeiro acesso: convite validado antes de criar a conta, defesa no trigger do Auth, confirmação que retorna à rota da loja e senha visível por botão acessível. Equipe não aceita termos de lojista.
- Pedidos: detecção por ID em qualquer estado, primeira leitura silenciosa, fila de três cards e contador, aceitar/fechar e recuperação pelo polling de 15 segundos.
- Equipe: papéis agrupados, adição única, links/QR por área, ferramentas opcionais, permissões e auditoria. Cozinha usa o KDS mínimo; o banco limita leitura e transições.

## Revisão de segurança

- RLS e RPCs usam associação ativa e loja ativa. Permissões do navegador não concedem acesso no servidor.
- Cozinha não lê linhas completas de pedidos/clientes. O KDS retorna apenas dados necessários ao preparo; transições limitadas a Preparando/Pronto.
- Garçom, Cozinha e Entregador têm limites de permissões que o Dono não pode ampliar para áreas incompatíveis. Financeiro sensível e assinatura ficam reservados ao Dono.
- Configuração de provedores de pagamento e os caminhos HTTP com `service_role` também verificam o ator e suas permissões. O fallback do Salão restringe garçons às suas mesas.
- Reutilização de identidade recusa conta pessoal, membro privilegiado ou vínculo de outra loja. Falha posterior não exclui uma identidade reaproveitada.
- Checagem pública de convite responde somente booleanos, sem IDs ou dados de outras lojas, com cota de 10 consultas por 600 segundos e identificador com hash.
- As funções `SECURITY DEFINER` novas e alteradas usam `search_path=''`, sem execução por `PUBLIC`, e grants explícitos. Escritas de ferramentas/permissões ocorrem somente por RPC validada e auditada.
- Logs do cadastro usam vocabulário diagnóstico limitado; não registram senha, token, telefone, e-mail nem erro bruto. A troca de loja limpa filas e bloqueia dados/modais da loja anterior.

## Reprodução local

Requer PostgreSQL local com `psql`, `createdb` e `dropdb` no `PATH`. Os runners recusam `PGHOST` remoto e usam dados sintéticos descartáveis.

```sh
npx tsc --noEmit
npx vitest run
sh supabase/tests/entrega1/run_regressions.sh strict
sh supabase/tests/entrega1/run_regressions.sh legacy
```

O runner da Entrega 1 compara definições/ACLs de funções, policies completas, colunas, constraints, relações/grants, triggers e papéis antes/depois de dois ciclos de aplicação/rollback. Os modos strict e legacy exercitam também grants padrão permissivos do Supabase.

Rodada final única: TypeScript sem erros; Vitest com 1.796 testes em 216 arquivos, todos aprovados; Entrega 1 com 131 verificações SQL aprovadas e dois ciclos de rollback exato. No legado, N1–N6 cobriu 1.776 verificações nos dois modos, combinando a execução inicial e retestes direcionados das falhas; pagamentos e Kitchen 2300 passaram; o E2E de despacho passou nos 10 cenários da janela 1700. Garçom v2/v3, mesas, arquivamento, online payment gate, PR-B e driver ride offers também passaram em seus runners.

Os runners históricos de N1–N6 e pagamentos foram delimitados às suas migrações alvo, preservando os testes de rollback e acrescentando os pré-requisitos locais que faltavam. Suítes posteriores têm execução separada; não se alteram migrações históricas para satisfazer fixtures antigas.

O rollback histórico de Estoque 31 mantém variáveis locais `NUMERIC` em `adjust_inventory`, divergindo textualmente da definição anterior. O runner valida seu fluxo operacional separadamente do ensaio exato N1–N6; esta entrega não altera esse rollback antigo. O rollback da Entrega 1 é comparado sem normalização de definições.

## Pendências de homologação

O ambiente fornecido não tem credenciais de staging. Falhas de Auth/Storage foram reproduzidas com clientes fake e os fluxos SQL em PostgreSQL local; ainda é necessário confirmar no staging:

1. Cadastro com foto, telefone e e-mail; identidade órfã; bucket ausente e triggers reais do GoTrue.
2. Convite válido/inválido e confirmação de e-mail em dispositivo real, por papel e loja.
3. Um pedido delivery, três rodadas de mesa e dois delivery seguidos, com realtime e recuperação por polling.

O rollback recusa execução enquanto houver membros ou convites com papel `KITCHEN`, para não apagar pessoas nem converter papéis silenciosamente. Esses vínculos devem ser tratados explicitamente antes de uma reversão.

## Revisão de segurança do PR #18

- Cada substituição semântica de definição verifica que o texto mudou; divergências abortam a transação com função/etapa no diagnóstico. O `search_path` aceita somente os estados completos conhecidos. Helpers temporários são removidos ao concluir. Cinco fixtures de divergência verificam o aborto atômico.
- A busca de chamadas em `src`, `server`, funções Edge, scripts e SQL encontrou o servidor de pagamentos usando `_store_user_permission` com ator explícito. `has_tenant_permission` agora também aceita o JWT de `service_role` sem `auth.uid`, mantendo a verificação das permissões do ator; usuários autenticados continuam limitados ao próprio ID.
- Sem IP, a pré-checagem de convite usa uma única cota por loja, compartilhada entre os e-mails consultados. A pré-checagem generalizada também compartilha a cota entre os papéis.
- `entrega1_products_write` é permissiva intencionalmente, para permitir concessões por override que as policies antigas não contemplam. A policy restritiva de permissões/tenant e os triggers de colunas continuam obrigatórios.
- O gerenciamento de Auth exige conta sintética exclusiva, associação atual de Garçom e metadados confiáveis. Perfis antigos de contas promovidas, compartilhadas ou pessoais não autorizam redefinir senha, remover ban ou alterar o perfil global. A exclusão continua restrita ao vínculo da loja.

Validação final única desta revisão: TypeScript sem erros; 1.807 testes Vitest aprovados em 216 arquivos; 164 verificações SQL aprovadas; cinco baselines divergentes recusados sem alterar o schema; dois ciclos de rollback exato aprovados.
