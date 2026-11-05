# Entrega 1.4 — validação

Base: `origin/main` em `77b68d97d12713d511a1507351f5c71688139c46`. Branch: `feat/entrega1-4`. Issue: #22. Um commit e push por item; autor David Rodrigues <dexterrodriguesoriginal@gmail.com>.

1. Mudança de mesa aguarda aprovação. O dono decide por padrão; a opção de garçom em Equipe & Permissões vem desligada e é protegida no servidor. Veja `aprovacao-mesa.md`.
2. Banner e toast de pedido no balcão usam `#DCFCE7` / `#0F172A`. A cor da mesa é preservada.
3. Código em destaque no cardápio, bolha, acompanhamento e conta, inclusive para pedidos de outros integrantes ou feitos pela equipe. Causa raiz e reprodução: `../entrega1-4-codigo-entrega.md`. Configuração, geração e projeção existentes foram exercitadas com pedidos reais em fixtures SQL. Nenhuma migração extra foi necessária para este item.
4. A mesa autorizada permanece marrom; só o selo interno “Garçom autorizado a fechar esta conta” é roxo. Fechamento e PIX mantêm suas regras anteriores.
5. Avisos do garçom de dinheiro/cartão recebido, PIX confirmado e liberação sem consumo usam o mesmo verde claro. Outras notificações mantêm seu comportamento.

## Verificações finais

- `npx tsc --noEmit`: sem erros.
- `npx vitest run`: **245 arquivos / 2.053 testes aprovados**, zero falhas ou pendências.
- **13 suítes SQL em strict e legacy**, todas aprovadas (26 execuções): as 12 anteriores e a nova Entrega1.4.
- Entrega1.4: **72 verificações** (51 de autorização + 21 do código), **5 de concorrência** e **163 regressões anteriores** por modo.
- Migration nova: `20261104000700_entrega1_4_move_approval.sql`; rollback correspondente em `supabase/rollback/`. Impressão exata de funções/ACL, RLS, colunas, constraints, triggers e índices em dois ciclos por modo.
- Duas conexões reais testam aprovação contra QR e revogação contra aprovação do garçom. Rollback usado recusa perda de histórico/configuração.
- Sem nova permissão para `anon`; só sessões aprovadas recebem códigos, e a validação no servidor conserva o limite de tentativas.
- Nenhuma alteração em `vite.config.*`, `tsconfig*` ou configurações Vitest. Nenhum `prompt_*.md` versionado. Sem merge, deploy ou acesso a dados de produção.

