# Stock phase 2 (proposal — NOT a migration)
Moved out of supabase/migrations on 2026-10-23 during review: written against a schema that does
not exist here (stock_balances, stock_movements, `StockUnit` type; stock_lots already exists with
different columns, so the index on expires_at fails) and it grants direct table writes that bypass
the append-only ledger RPCs. The frontend does not use these tables. Rewrite against
inventory_movements / stock_location_balances with SECURITY DEFINER RPCs before applying.
