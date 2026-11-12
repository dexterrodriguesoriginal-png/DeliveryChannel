# Pedir de novo e Mais pedido da casa

Branch criada da main `5f2b7d1178d68eb29b38941203c65cf061449628`.

## Comportamento

- Mesa via QR: `get_session_reorder_items` exige usuário autenticado, sessão aprovada e vigente e comanda aberta. Busca somente pedidos feitos por essa sessão, inclusive quando o responsável pode consultar pedidos de convidados pela conta existente.
- Totem: histórico somente em memória durante o atendimento atual. Após pagar, “Continuar pedindo” volta ao cardápio. “Novo pedido”, troca de loja e inatividade invalidam o histórico. Não consulta pedidos anteriores do dispositivo.
- “Pedir de novo” no produto repete sua última configuração. Em “Seus pedidos”, cada linha permite escolher a configuração anterior, com adicionais e observações. O item vai ao carrinho para confirmar.
- Cada repetição consulta novamente o catálogo e os adicionais, rejeita item ausente/inativo/esgotado ou quantidade sem estoque e mantém observações em linha separada. O checkout recalcula no servidor. O totem passa a enviar adicionais no formato do salão e usar `_price_items`, preservando snapshots e preço vigente.
- Ranking: soma quantidades nos últimos 30 dias, exclui cancelamentos e estornos, aceita pedidos pagos ou entregues. Empates são resolvidos pelo UUID. Consulta por tenant com índices de pedidos/data e itens; frontend atualiza a cada minuto. RPC pública retorna exclusivamente `product_id` e `position`.
- Painel: Design do Cardápio → Mais pedido da casa. Ligado por padrão; pode desligar ou escolher até três produtos próprios na ordem desejada. Sem seleção manual, usa o ranking automático.

## Arquivos principais

- `src/pages/client/DineInClientApp.tsx`, `TotemSalaoApp.tsx`: sessão e carrinho.
- `src/components/client/dinein/ReorderList.tsx`, componentes premium de cardápio e CSS: botões, lista e selo com cores do tema; preserva três colunas.
- `src/lib/customer/dineInReorder.ts`, `src/repositories/reorderRepository.ts`: repetição com catálogo atual.
- `src/hooks/useMenuBestSellers.ts`: consulta pública e atualização do ranking.
- `src/pages/establishment/theme/menu/BestSellersPanel.tsx`, `MenuThemeEditor.tsx`: configuração do dono/gerente.
- `src/repositories/totemAccessRepository.ts`: contrato dos adicionais.
- `supabase/migrations/20261112000100_reorder_best_sellers.sql`: funções, configuração e índices.
- `supabase/rollback/20261112000100_reorder_best_sellers.sql`: remove apenas objetos novos e restaura a definição completa anterior de `create_totem_order`; preserva pedidos e itens. As escolhas de destaque deixam de existir após rollback.
- `src/components/client/totem/__tests__/ReorderBestSellers.test.tsx` e `supabase/tests/reorder_best_sellers/run_pglite.mjs`: regressões novas.

## Validação local

```sh
npx tsc --noEmit
npx vitest run src/components/client/totem/__tests__/ReorderBestSellers.test.tsx src/components/client/totem/__tests__/DineInPremiumMenu.test.tsx src/pages/client/__tests__/TotemSalaoApp.test.tsx src/pages/client/__tests__/DineInClientApp.qr.test.tsx src/pages/client/__tests__/DineInClientApp.access.test.tsx src/lib/customer/__tests__/dineInCart.test.ts src/lib/customer/__tests__/reorder.test.ts
node supabase/tests/reorder_best_sellers/run_pglite.mjs
```

PGlite usa fixtures locais: verifica ranking por quantidade/período, isolamento entre lojas e sessões do mesmo usuário, formato sem dados pessoais/valores, permissões, adicionais e observações, pinos, desligamento, rollback sem perda de pedidos, restauração da RPC anterior e reaplicação.

## Conferência manual em ambiente de teste

1. Aplicar a migração nova após a baseline existente.
2. Em uma mesa liberada, pedir produto com adicionais e observação. Repetir pelo card e pela lista; conferir o carrinho antes de enviar. Alterar preço no painel e conferir preço vigente; esgotar produto/adicional e verificar aviso sem inclusão.
3. Acessar com outro usuário/dispositivo ou convidado da mesma mesa. Seus botões de repetição não devem oferecer itens da sessão anterior.
4. No totem, pagar um pedido e usar “Continuar pedindo”. Repetir e conferir adicionais, observação e preço no carrinho. Usar “Novo pedido” ou aguardar inatividade e confirmar que o histórico desapareceu.
5. Popular pedidos pagos/entregues em duas lojas. Confirmar até três selos próprios e três cards por linha. Desligar no painel, aguardar até um minuto e verificar ocultação; testar seleção manual e retorno ao automático.
6. Executar rollback em banco de teste e conferir preservação dos pedidos existentes.

Nenhuma migração foi aplicada a banco remoto; sem merge ou deploy.
