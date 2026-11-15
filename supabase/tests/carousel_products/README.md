# Carousel promotional products

Run locally from the repository root:

```sh
node supabase/tests/carousel_products/run_pglite.mjs
npm run lint
npx vitest run --maxWorkers=2 --testTimeout=30000
```

The PGlite fixture executes the production pricing and order-line writer, then the new migration. It checks exact function/ACL restoration in down/up, existing catalogue rows, authoritative prices, rejected client prices, windows, quotas, transactional failure, promotional order lines, kit inventory, discovery isolation, and tenant/role authorization.

`20261115000100_carousel_promotional_products.sql` is an additive migration. Existing products default to `carousel_only = false`; existing carousel items keep their data and have no unit limit. Exclusive SKUs use the existing product/order/inventory ledger, but are filtered from normal catalogue discovery, table menus, totem, recommendations, reorder history and the panel's product list. A server-validated campaign reference is mandatory to order them. Limited catalogue promotions also require that reference, preventing a client from bypassing the quota by dropping it.

Kit components are immutable recipes created atomically with the promotional SKU. Each sale debits both the kit SKU and its component quantities, with inventory movement records. Quotas and inventory updates occur in the same order transaction. The storefront refreshes carousel availability with its existing polling and filters validity against the server clock.

Rollback: `supabase/rollback/20261115000100_carousel_promotional_products_down.sql`. It restores the exact original function definitions and refuses to run if promotional SKUs, kit recipes or quota data have been stored. That failure rolls back atomically and preserves all data; export/migrate those records before a downgrade. No cascade is used in rollback.

This PR does not apply migrations to a remote database or deploy the application.
