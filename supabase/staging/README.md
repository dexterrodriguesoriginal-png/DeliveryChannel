# F6 — Cópia controlada de catálogo/ofertas reais para STAGING

Autorizado pelo fundador (F6). Nesta etapa existe **só o procedimento e o script**. Ninguém do
time técnico conecta em produção: o export é feito pelo fundador.

## O que é copiado (e o que não é)

| Copiado | Nunca copiado |
|---|---|
| `categories` (id, nome, descrição, imagem, ordem, ativo) | clientes, pedidos, itens, histórico, endereços, telefones, e-mails |
| `products` (id, nome, descrição, imagem, preço, preço promocional, unidade, estoque, ativo, destaque, sku) | `cost_price` (vai NULL), `tenant_settings.pix_key`, usuários, auth |
| `offers` (todas as colunas da 001, **inclusive os vínculos inválidos entre tenants**, para reproduzir F1) | tenants (documento, e-mail, telefone): os tenants de staging são criados no próprio staging com o **mesmo slug** |

O vínculo `tenant_id` é remapeado **por slug** (o tenant precisa existir em staging). Os UUIDs de
categorias, produtos e ofertas são preservados, para manter os vínculos (inclusive os inválidos).

## Ordem obrigatória

1. Staging criado do zero e no estado **001–020** (mesmas migrations da produção), **antes** de N1–N6.
   O import recusa um banco onde a N1 já foi aplicada: a FK `offers_product_same_tenant`
   (NOT VALID) bloquearia a cópia dos vínculos inválidos, e o objetivo é ensaiar N1–N6 sobre dados reais.
2. Tenants criados em staging com os slugs desejados (o auto-seed demo da F3 roda; é esperado).
3. Fundador exporta os CSVs (passo abaixo) e entrega os arquivos.
4. Import: `supabase/staging/import_catalog_offers.sh <dir_dos_csv>` com `STAGING_DB_URL` apontando
   para o banco de **staging** e `--i-confirm-staging`.
5. Só então aplicar N1–N6 em staging e rodar a checagem de paridade (C1–C9 do design).

## Export (executado pelo FUNDADOR, somente leitura)

No SQL Editor do projeto de produção, ou `psql` com usuário somente leitura, rode
`export_catalog_offers.sql` trocando a lista de slugs. São três `COPY (SELECT ...) TO STDOUT`
somente leitura, sem PII. Salve as saídas como `categories.csv`, `products.csv` e `offers.csv`.

## Proteções do script de import

- Recusa URL que contenha o ref de produção `qjmhlbipmwobnuctzpft`, e recusa qualquer
  `*.supabase.co`/`pooler.supabase.com` se `STAGING_PROJECT_REF` não estiver definido e presente na URL.
- Exige a flag `--i-confirm-staging`.
- Transação única: qualquer erro desfaz tudo.
- Aborta se o banco não estiver em exatamente 001–020, se algum slug não existir, ou se algum UUID
  já existir com outro tenant.
- `ON CONFLICT (id) DO NOTHING`: reexecutar não duplica.
- Nada é apagado nem atualizado no destino.
