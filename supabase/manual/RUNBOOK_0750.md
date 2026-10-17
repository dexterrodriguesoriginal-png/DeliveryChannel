# Runbook: hardening de privilégios 0750 (aplicação MANUAL, fora da sequência automática)
Decisão do CEO (R13, opção B): `20261014000750_prod_privilege_hardening.sql` NÃO entra em `supabase/migrations/`. Não renumerar e não afrouxar o PRE A5 do 0700.
- **Local sugerido no repo, quando houver autorização de commit:** `supabase/manual/20261014000750_prod_privilege_hardening.sql`, com o down ao lado.
- **Por que fora da sequência:** o 0700 aborta no estado atual de produção (PRE A5: anon/authenticated com SELECT em drivers), então o 0750 precisa rodar ANTES do 0700.

## Ordem na janela de produção (cada item precisa de autorização específica)
1. Backup novo (pg_dump -Fc com hash) até 1 h antes.
2. **Manual:** `psql -1 -v ON_ERROR_STOP=1 -f 20261014000750_prod_privilege_hardening.sql`. Exige `NOTICE 0750 POST OK`.
3. Salt do Vault (`SALT_PROCEDURE.md`), se autorizado; é pré-requisito do PRE (f) do 0700.
4. Delta N5 e reconciliação do histórico (decisão separada).
5. `0700 → 0800 → 0900 → 1000 → 1100 → 1200 → 1300`.
6. Smoke tests (checkout, PDV, convites, entregadores, mapa da frota).

## Parada e reversão
- Qualquer PRE/POST com erro faz ROLLBACK da transação e encerra a janela.
- O rollback do 0750 é `20261014000750_prod_privilege_hardening_down.sql`, por MERGE: nunca reconcede TRUNCATE, REFERENCES, TRIGGER ou MAINTAIN, escrita de anon nem setval. Ele deve rodar depois dos downs 0800 → 0700.
