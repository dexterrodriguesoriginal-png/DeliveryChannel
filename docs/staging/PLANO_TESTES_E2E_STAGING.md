# Plano de testes E2E REAIS no staging (N1–N6)

Regras: só no projeto de **staging**; dados **sintéticos** (`seed_synthetic.sql`, e-mails `stg.*@example.com`,
chave PIX EVP fictícia); nenhum dado de produção. Testes com mock/PostgREST local **não** contam como estes.
Status de cada item: `PENDENTE` até rodar no staging.

Lojas: `stg-adega-a` (A) e `stg-adega-b` (B). Papéis A: OWNER, MANAGER, CASHIER, DRIVER, OPERATOR; B: OWNER. Clientes: cliente1, cliente2.

## A. Automatizado por API (`tests/staging/staging.e2e.ts`, login real)

| ID | Fluxo | Verificação |
|---|---|---|
| E1 | Login e papéis | 8 logins reais; anônimo não lê pedidos; DRIVER/OPERATOR/CASHIER não criam cupom; CASHIER sem campanhas |
| E2 | Isolamento | OWNER A não lê pedidos/produtos/campanhas de B nem insere em B; cliente 2 não lê pedido/PIX do cliente 1 |
| E3 | Produtos/estoque | OWNER cria produto; MANAGER consulta |
| E4 | Checkout/cupom/PIX/cancelamento/estorno | anônimo não compra; totais do servidor; STGDEZ 10%; idempotência; cupom de B recusado em A; BR Code só do próprio pedido; estoque 1 recusa 2ª unidade; cancelar devolve estoque; cancelado não reabre; CASHIER marca PAGO e não estorna; OWNER estorna com motivo; cupom de uso único consumido 1x |
| E5 | PDV/status | `process_pos_sale_atomic` com cupom e idempotência (3×10 −10% = 27); status CONFIRMED pelo servidor |
| E6 | Upload real | OWNER envia PNG pelo fluxo N3 (`register_marketing_asset` → Storage `marketing` → `confirm_marketing_upload`); CASHIER e anônimo não listam `marketing` |
| E7 | Cards/campanhas/vitrine/Desempenho | campanha + card ATIVO aparece em `get_public_store` N6 sem PIX/e-mail; evento CARD_CLICK; compra pelo card (R$ 8); métricas ≥ 1 pedido; oferta com checkout promocional → pedido `storefront_promo` → aparece em `get_promo_offer_performance`; CASHIER sem acesso |

## B. Navegador (build `--mode staging`, Chrome)

| ID | Passos | Esperado |
|---|---|---|
| B1 | Login com cada papel | menu conforme papel; sem "acessar sem login"; CEO/SUPER_ADMIN sem tabelas novas |
| B2 | OWNER A troca a URL para dados de B | nada de B aparece |
| B3 | Produtos: criar, editar estoque, inativar | refletido na vitrine `/stg-adega-a` |
| B4 | Cliente compra na vitrine (normal) com STGDEZ e PIX | total do servidor; QR/BR Code do pedido; status visível ao cliente |
| B5 | Painel: confirmar → preparar → sair → entregar; outro pedido cancelar com motivo | histórico; estoque devolvido; botão de reabrir ausente e servidor recusa |
| B6 | Estorno (OWNER) e tentativa pelo CASHIER | CASHIER recebe erro do servidor |
| B7 | PDV (CASHIER) com cupom, clique duplo no finalizar | um único pedido |
| B8 | Marketing: enviar imagem/vídeo, publicar, despublicar com motivo | arquivo em `marketing` (privado); publicado em `marketing-public`; despublicado some da vitrine; log de publicação |
| B9 | Card promocional com checkout próprio; comprar pela vitrine | pedido `storefront_promo` atribuído |
| B10 | Marketing → Desempenho & Vendas | KPIs reais do card/oferta (não "—"), filtros de período sem race |
| B11 | Campanha: criar, ativar, ver na vitrine N6, pausar/encerrar | some da vitrine ao encerrar; métricas |
| B12 | Vitrine anônima: ver HTML/rede | sem PIX, e-mail, financeiro ou PII em `get_public_store` |

## C. Banco (já automatizado)

`apply_staging.sh post` (RLS/SECURITY DEFINER/RPCs/buckets). C1–C9 do design: rodar as consultas de paridade após o F6 opcional.

## D. Registro

Para cada execução: data/hora (BRT), SHA do `main`, ref do staging (não a senha), saída do vitest, prints do navegador.
