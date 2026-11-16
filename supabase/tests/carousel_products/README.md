# Carousel promotional products

Run locally from the repository root:

```sh
node supabase/tests/carousel_products/run_pglite.mjs
npm run lint
npx vitest run --maxWorkers=2 --testTimeout=30000
```

The PGlite fixture executes the production pricing, checkout core, order-line writer, restock writer, phase-1 reservation triggers, current alternate totem writer and online-payment expiry function, then the new migration. Authentication/rate-limit services and coupon lookup use fixture boundaries; coupon arithmetic and client pricing use their real implementations. It checks exact function/ACL restoration in down/up, existing catalogue rows, authoritative prices, rejected client prices, windows, quotas, transactional failure, promotional order lines, kit inventory, cancellation after confirmation, failed online-payment restock, repeated restock without double returns, coupon exclusion without a reference price, equality of client and server totals, rejection of forged campaign origins by the totem before any order/quota/stock write, normal catalogue purchases through the same totem writer, discovery isolation, and tenant/role authorization.

`20261115000100_carousel_promotional_products.sql` is an additive migration. Existing products default to `carousel_only = false`; existing carousel items keep their data and have no unit limit. Exclusive SKUs use the existing product/order/inventory ledger, but are filtered from normal catalogue discovery, table menus, totem, recommendations, reorder history and the panel's product list. A server-validated campaign reference is mandatory to order them. The totem explicitly rejects campaign origins and campaign item references, so its alternate direct writer cannot bypass quotas or component consumption. Limited catalogue promotions also require that reference, preventing a client from bypassing the quota by dropping it.

Kit components are immutable recipes created atomically with the promotional SKU. Each sale debits both the kit SKU and its component quantities, with inventory movement records. The immutable `carousel_kit_order_consumptions` ledger records the actual component quantities per order. Cancellation and the shared `_restock_order_items` path restore that snapshot once, protected by an order lock and `restored_at`, including failed online payments. Component returns use `CANCEL_RELEASE` so they do not suppress the legacy SKU restock marker. Quotas, consumption snapshots and inventory updates occur in the same order transaction. Validated campaign origins are always promotional for coupon eligibility, even when the optional reference price is absent. The storefront refreshes carousel availability with its existing polling and filters validity against the server clock.

Rollback: `supabase/rollback/20261115000100_carousel_promotional_products_down.sql`. It restores the exact original function definitions and refuses to run if promotional SKUs, kit recipes, consumption history or quota data have been stored. That failure rolls back atomically and preserves all data; export/migrate those records before a downgrade. No cascade is used in rollback.

This PR does not apply migrations to a remote database or deploy the application.
