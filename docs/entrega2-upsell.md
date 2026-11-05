# Leve também

Ative as sugestões em **Marketing → Leve também**. O padrão é desligado. Em **Produtos → Sugerir junto**, dono ou gerente pode escolher até três complementos prioritários para cada produto. A gestão e as estatísticas exigem vínculo ativo com a própria loja, verificado no servidor.

A RPC `recommend_upsell` calcula a classificação na loja: combinações fixadas, coocorrência em pedidos pagos/entregues dos últimos 90 dias (suporte mínimo de três pedidos, confiança e lift), categoria complementar, vendas por horário/dia/canal e preferência anterior do próprio usuário autenticado. Sem histórico, usa a popularidade das categorias complementares e as escolhas da casa. Sugestões repetidamente ignoradas perdem pontos. Produtos já na sacola, indisponíveis, inativos, sem saldo vendável ou de outra loja são excluídos. O preço é consultado no servidor: itens até aproximadamente 40% da sacola recebem preferência; itens acima do valor total da sacola não são sugeridos.

O cache guarda somente agregados de 90 dias, com validade de 15 minutos. Conclusões e reversões invalidam o cache; atualizações consecutivas são agrupadas por um intervalo mínimo de 60 segundos. Disponibilidade, estoque bloqueado, preços e a autorização do usuário são conferidos ao vivo. Nenhum dado pessoal de cliente aparece no retorno público.

Loja, QR e totem usam a mesma pequena janela opcional, com até três sugestões. Adicionais obrigatórios seguem o fluxo existente. Não há sugestões em cascata nem repetição consecutiva do produto de origem, e a janela não aparece durante o checkout. O totem também pode oferecer **Que tal completar?** uma vez antes da revisão do pedido. Respostas antigas são descartadas após troca de loja, mesa ou identidade.

Impressões e aceites são idempotentes por oferta opaca, expiram e são agregados por produto/dia. Aceitar um item ainda não conta como venda. A atribuição exige um pedido real do usuário/sessão aprovada, feito depois do aceite e contendo os produtos; uma oferta não pode ser reutilizada entre pedidos. Itens vendidos e receita vêm dos itens reais de pedidos concluídos, excluindo cancelamentos e reembolsos. Preços e regras do checkout permanecem sob validação do servidor.

A migração é `supabase/migrations/20261104001000_entrega2_upsell.sql`, com reversão em `supabase/rollback/20261104001000_entrega2_upsell_down.sql`. As novas tabelas têm RLS e permissões explícitas. O rollback restaura o estado anterior quando a função ainda não foi usada e recusa descartar configurações, ofertas ou estatísticas em uso.

Para validar somente E1 em PostgreSQL local descartável, use `E1_ONLY=1 sh supabase/tests/entrega2/run_e1_regressions.sh strict` (ou `legacy`). O schema anterior é aplicado como dependência, sem executar os testes anteriores. Sem `E1_ONLY`, o runner também inclui as regressões anteriores para validação completa. Nesta entrega reduzida, TypeScript e os arquivos de teste de E1 foram executados; a suíte completa ficou para validação do dono.
