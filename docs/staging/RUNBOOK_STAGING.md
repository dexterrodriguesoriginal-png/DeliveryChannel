# Runbook — Staging isolado para validar N1–N6

Objetivo: um projeto Supabase **separado** (não Branching), só para testes, com
**001–020 → N1 → N1.V (manual) → N2 → N3 → N4 → N5 → N6**, dados **sintéticos**, e o frontend do `main`
em build `VITE_BACKEND_SCHEMA=n1n6` apontando **só** para ele.

Produção (`qjmhlbipmwobnuctzpft`) nunca é tocada: todos os scripts recusam qualquer valor que contenha esse ref.
021–027 continuam em `supabase/migrations_quarantine/` e **não** são aplicadas.

## 0. Arquivos

| Arquivo | Papel |
|---|---|
| `scripts/staging/lib_guard.sh` | guardas anti-produção (ref obrigatório, URL precisa conter o ref, recusa ref de prod, confirmação) |
| `scripts/staging/apply_staging.sh` | aplica a sequência por etapas; **dry-run por padrão** |
| `scripts/staging/sql/verify_empty.sql` | estado real antes: projeto Supabase novo e vazio (somente leitura) |
| `scripts/staging/sql/verify_post.sql` | pós: 26 versões, RLS em todas as tabelas, SECURITY DEFINER com `search_path`, RPCs, buckets |
| `scripts/staging/seed_synthetic.sh` + `sql/seed_synthetic.sql` | lojas/papéis/produtos/cupons/PIX **sintéticos** (idempotente, não apaga nada) |
| `supabase/manual/n1v_validate_constraints.sql` | N1.V (manual) |
| `supabase/rollback/n*_rollback.sql` | rollbacks (ensaiados localmente; exigem `SET LOCAL n1n6.rollback_confirm`) |
| `supabase/staging/*` | F6 opcional: import de catálogo/ofertas exportado pelo fundador (sem PII) |
| `.env.staging.example` | modelo do build de staging (sem valores) |
| `src/lib/deployGuard.ts` | guarda no `vite.config.ts`: o build falha se a configuração apontar staging/n1n6 para produção |
| `tests/staging/test_staging_guards.sh` | testes das guardas e bloqueios de estado (PostgreSQL local) |
| `tests/staging/staging.e2e.ts` | E2E **real** contra o staging (login real por papel) |
| `docs/staging/PLANO_TESTES_E2E_STAGING.md` | plano completo (API + navegador) |

## 1. O que o FUNDADOR faz na conta Supabase (única ação manual)

1. Acesse https://supabase.com/dashboard → **New project**.
2. Organization: a mesma da produção (ou outra, se preferir isolar cobrança).
3. **Project name**: sugestão `deliverychannel-staging` (é só sugestão; qualquer nome serve).
4. **Database Password**: clique em *Generate a password* e guarde no seu gerenciador de senhas. Não envie em chat.
5. **Region**: a mesma da produção (veja na produção em *Project Settings → General*), para latência parecida.
6. **Create new project**. **Não** use *Branching*. Não importe backup da produção.
7. Quando o projeto ficar pronto, anote:
   - *Project Settings → General → Reference ID* → `STAGING_PROJECT_REF` (20 letras);
   - botão **Connect** → *Session pooler* (porta 5432) → copie a URI e troque `[YOUR-PASSWORD]` pela senha → `STAGING_DB_URL`
     (não use o *Transaction pooler* 6543: as migrations precisam de sessão);
   - *Project Settings → API Keys* → **anon / publishable** → `STAGING_ANON_KEY` (nunca a `service_role`/secret).
8. Usuários de teste (depois da etapa 3 abaixo): *Authentication → Users → Add user → Create new user*, marcando
   **Auto Confirm User**, com a **mesma senha de teste** (diferente da senha do banco) para os 8 e-mails sintéticos:
   `stg.owner.a@example.com`, `stg.manager.a@example.com`, `stg.cashier.a@example.com`, `stg.driver.a@example.com`,
   `stg.operator.a@example.com`, `stg.owner.b@example.com`, `stg.cliente1@example.com`, `stg.cliente2@example.com`.
   (Criar **depois** das migrations para o gatilho da 002 provisionar `public.users`.)

### Como entregar os valores ao bot sem expor

No desktop do box (terminal), crie um arquivo fora do repositório, legível só por você/bot:

```bash
mkdir -p ~/secure && chmod 700 ~/secure
cat > ~/secure/staging.env <<'X'
STAGING_PROJECT_REF=<ref de 20 letras>
STAGING_SUPABASE_URL=https://<ref>.supabase.co
STAGING_DB_URL=<URI do Session pooler com a senha>
STAGING_ANON_KEY=<anon/publishable key do staging>
STAGING_TEST_PASSWORD=<senha dos usuários de teste>
X
chmod 600 ~/secure/staging.env
```

Depois só avise "staging.env pronto". O bot carrega com `set -a; . ~/secure/staging.env; set +a` e nunca imprime os valores.
(Se colar no chat, os valores ficam no histórico; nesse caso troque a senha do banco ao fim dos testes.)

## 2. Sequência de execução (bot, depois do passo 1)

```bash
cd /workspace/dev/DeliveryChannel-desempenho && git pull --ff-only
set -a; . ~/secure/staging.env; set +a
export STAGING_CONFIRM="$STAGING_PROJECT_REF"          # confirmação explícita

bash tests/staging/test_staging_guards.sh              # guardas OK (local)
scripts/staging/apply_staging.sh all                   # DRY-RUN: mostra o plano, não conecta
scripts/staging/apply_staging.sh verify --execute      # estado real: projeto vazio (somente leitura) — PARA aqui se falhar
scripts/staging/apply_staging.sh base   --execute      # 001–020 (cada uma em transação + registro)
# (opcional F6) import de catálogo exportado pelo fundador — tem de ser AQUI, antes da N1:
#   STAGING_DB_URL=$STAGING_DB_URL supabase/staging/import_catalog_offers.sh <dir_csv> --i-confirm-staging
scripts/staging/apply_staging.sh n1     --execute      # N1 (prechecks PC1–PC7 abortam se o estado não for 001–020)
scripts/staging/apply_staging.sh n1v    --execute      # N1.V manual (decisão do fundador; não altera linhas)
scripts/staging/apply_staging.sh n2n6   --execute      # N2…N6, cada uma com seus prechecks
scripts/staging/apply_staging.sh post   --execute      # verificação pós (somente leitura)
```

Cada etapa confere a **última versão registrada** antes de rodar e aborta se o estado não for o esperado
(ex.: `n1` em banco vazio, `base` reaplicada, 021 registrada). Toda migration roda em transação única: erro = nada aplicado.

Depois: fundador cria os 8 usuários (passo 1.8) e então:

```bash
scripts/staging/seed_synthetic.sh --execute            # aborta se faltar algum usuário
```

## 3. Frontend de staging

```bash
cp .env.staging.example .env.staging   # .env.staging é ignorado pelo git
# preencher: VITE_STAGING_PROJECT_REF, VITE_SUPABASE_URL=https://<ref>.supabase.co, VITE_SUPABASE_PUBLISHABLE_KEY
npx vite build --mode staging          # falha se URL/ref/chave forem de produção ou não baterem com o ref
npx vite preview --mode staging --port 4173
```

A guarda (`src/lib/deployGuard.ts`, chamada no `vite.config.ts`) recusa: `n1n6` + URL de produção (sem
`VITE_N1N6_PRODUCTION_APPROVED=yes`), staging com URL ≠ `https://<ref>.supabase.co`, ref de produção, chave JWT
de outro projeto, `service_role`/`sb_secret_`. O build padrão do AI Studio (sem `VITE_DEPLOY_TARGET`, `legacy-020`)
não muda. Em *Authentication → URL Configuration* do staging, o fundador adiciona `http://localhost:4173` como Site URL/Redirect.

## 4. Testes no staging

```bash
set -a; . ~/secure/staging.env; set +a
npx vitest run -c tests/staging/vitest.staging.config.ts      # E2E real por API (E1–E7)
```
Navegador: checklist em `PLANO_TESTES_E2E_STAGING.md` §B.

## 5. Rollback no staging (se precisar ensaiar)

Ordem inversa, uma por vez, com confirmação explícita (o script do rollback recusa sem ela):

```bash
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 <<'X'
BEGIN; SET LOCAL n1n6.rollback_confirm='N6'; SET LOCAL n1n6.rollback_export_done='yes';
\i supabase/rollback/n6_rollback.sql
COMMIT;
X
# depois N5, N4, N3, N2, (n1v_rollback), N1 — e remover a versão de supabase_migrations é feito pelo próprio rollback
```
Em staging o descarte mais simples é **apagar o projeto de staging inteiro** (ação do fundador no dashboard) e recriar.

## 6. Critério para avançar à produção

Tudo verde em §2 (verify/post), `staging.e2e.ts`, checklist de navegador, C1–C9 do design e
**aprovação escrita do fundador**. Só então a mesma sequência em produção, e só depois o build `n1n6`.
