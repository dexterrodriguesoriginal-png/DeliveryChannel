# Revisão das Partes B e C

Revisão dos commits `769be0b` e `110e8ed` do Antigravity na branch `feat/entrega1-3`. A Parte A (`606a503`) foi preservada. As correções são anteriores a qualquer implantação; não houve merge, deploy nem acesso a dados de produção.

Problemas confirmados durante a revisão:

- A migration C não aplicava sobre o predecessor real: a alteração textual de `enter_table` não encontrava o trecho esperado. A suíte C original abortava antes dos testes.
- Junções com pedidos esbarravam no guard de imutabilidade de `orders.tab_id`; o aceite de contas ocupadas e as permissões por mesa eram insuficientes. A separação liberava a mesa física sem devolver pessoas e dívida à origem.
- A ordem de bloqueio de operações simultâneas era inconsistente. A revisão cobre os pontos de entrada da mesa e as mutações de pedidos que concorrem com mudança/junção/separação.
- O código de entrega era exposto a sessões não aprovadas; geração concorrente podia repetir códigos. A configuração e os estados por rodada precisavam de validação independente do estado global atual.
- Os rollbacks B e C apagavam auditoria. Agora exigem preservar/arquivar registros usados antes de uma reversão incompatível, sem remoção silenciosa.
- A validação de email aceitava formatos fora de uma única caixa postal. A ausência de Resend consumia cota; recibos mistos mostravam apenas a última forma de pagamento. A autorização é checada antes do retorno de serviço não configurado e o limite permanece por conta.
- O painel podia reutilizar alertas financeiros após troca de usuário/papel, ressuscitar conta já reaberta por resposta atrasada e mostrar total falso de R$ 0,00 em erro de consulta. A preferência de balão era ignorada.
- O fechamento manual no app do garçom podia exibir sucesso após erro de pagamento; novas respostas de troca de mesa também precisavam respeitar a identidade/sessão atual.

As regressões usam dados sintéticos, PostgreSQL local e provedores de email simulados. Emails completos não são retornados aos clientes, gravados na auditoria de envios ou escritos em logs. O endereço alternativo continua permitido, como solicitado, com validação de destinatário único, equipe autorizada e limite transacional por conta.

O runner `supabase/tests/entrega1_3/run_regressions.sh` executa `a.sql`, `b.sql`, `c.sql` e regressões complementares. Além dos ciclos acumulados, cada migration é aplicada/revertida duas vezes contra seu predecessor imediato e comparada por fingerprint de funções/ACL, RLS, colunas, constraints, triggers e índices.

As migrations `20261104000500` e `20261104000600` mantêm arquivos de rollback correspondentes. Depois de uso real das funcionalidades, a reversão pode ser recusada para preservar dívidas, confirmações e histórico. A recusa e a preservação dos registros são verificadas em testes.

## Resultado final

- `npx tsc --noEmit`: sem erros.
- `npx vitest run`: 242 arquivos, **2.031 testes aprovados**, zero falhas ou pendências. A verificação final do painel de pagamento também passou nos 8 testes afetados após tornar síncrona a troca do contexto da conta.
- SQL: **12/12 suítes em strict e legacy** (24 execuções). A suíte integrada Entrega1.3 executou `b.sql`, `c.sql` e as regressões complementares: **166 verificações aprovadas por modo**.
- Rollbacks de `20261104000500` e `20261104000600`: comparação exata contra cada predecessor imediato em **dois ciclos por modo**, além da comparação acumulada A+B+C.
- Testes reais com duas conexões: troca de mesa versus leitura de QR; junção versus abertura por staff; junções em ordem inversa; quinta tentativa incorreta versus sexta tentativa com código correto.
- Reversões após uso: recibos, dívidas, sessões, códigos, tentativas e auditoria permanecem preservados. O rollback de C também detecta uso somente da configuração, sem pedidos.
- `npm run build`: aprovado, sem publicação.

O modo de contas individuais é recusado nas operações de grupo para impedir que uma única conta escolhida por `LIMIT 1` oculte as outras dívidas. Contas por mesa com taxas incompatíveis também precisam de conferência antes de serem juntadas. Emails reais dependem de `RESEND_API_KEY` e `RECEIPT_FROM` no servidor Node existente; nenhum email real foi enviado nem segredo configurado nesta revisão.

