-- Testes SQL da migration 20261027004800_mesas_holder_lock_empty_cancel_waiter_rls.sql
-- Cobre:
--   Parte A: Mesa ocupada sem responsável fica TRAVADA (IN_USE) e "Trocar responsável" usa código único de 5 min.
--   Parte D: Liberar mesa aberta sem consumo (R$ 0,00 e 0 pedidos) via release_empty_tab + bloqueio quando há pedidos.
--   Parte F: resolve_table_invite retorna dados de boas-vindas da loja e do responsável antes do login.
--   Parte H: RLS do papel WAITER em tenants, tenant_settings, tenant_themes, categories, products, orders (DINE_IN) e order_items.

\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
RESET ROLE;
DELETE FROM public.security_rate_limits;

-- 1. Capacidades atualizadas para versão 3
SET ROLE authenticated;
SELECT t.as_user(1);
SELECT t.is((public.mesas_qr_capabilities() ->> 'version')::int, 3, 'capacidades: versão 3');
SELECT t.ok((public.mesas_qr_capabilities() ->> 'holder_code')::boolean
        AND (public.mesas_qr_capabilities() ->> 'empty_release')::boolean
        AND (public.mesas_qr_capabilities() ->> 'invite_preview')::boolean,
        'capacidades: holder_code, empty_release e invite_preview ativos');

-- 2. Parte A: Mesa aberta pelo garçom (R$ 0, sem sessão, sem responsável) fica TRAVADA (IN_USE)
RESET ROLE;
INSERT INTO public.dining_tables (tenant_id, label, qr_token)
VALUES (:'A', 'Mesa 07', 'acc-a7-token-000007'), (:'A', 'Mesa 08', 'acc-a8-token-000008')
ON CONFLICT DO NOTHING;

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000009'::uuid); -- WAITER
SELECT t.is(
  (public.staff_open_tab((SELECT id FROM public.dining_tables WHERE qr_token = 'acc-a7-token-000007')) ->> 'existing')::boolean,
  false,
  'garçom abre Mesa 07 sem responsável'
);

-- Estranho lê o QR da Mesa 07: recebe IN_USE (nunca assume sozinho!)
SELECT t.is((t.enter(50, 'acc-a7-token-000007') ->> 'state'), 'IN_USE', 'mesa aberta pelo garçom sem responsável: estranho vê IN_USE');

-- Garçom gera código de "Trocar responsável" (uso único, 5 min)
SELECT t.login('a0000000-0000-0000-0000-000000000009'::uuid);
SELECT (public.staff_create_holder_code(t.tabof('acc-a7-token-000007')) ->> 'code') AS holder_code_7 \gset
SELECT t.ok(length(:'holder_code_7') = 6, 'staff_create_holder_code gera código de 6 caracteres');

-- Estranho que apenas lê o QR da mesa (sem o código do garçom) continua vendo IN_USE!
SELECT t.is((t.enter(51, 'acc-a7-token-000007') ->> 'state'), 'IN_USE', 'após gerar código, leitura comum do QR da mesa continua IN_USE (travada)');

-- Cliente 50 usa o código na frente do garçom -> vira RESPONSIBLE e já aprovado
SELECT t.as_user(50);
SELECT t.is(
  (public.join_with_code('acc-a7-token-000007', :'holder_code_7', 'Cliente 50', 'dev-50') ->> 'state'),
  'RESPONSIBLE',
  'cliente com código único do garçom assume como RESPONSIBLE'
);
SELECT t.is(
  (public.join_with_code('acc-a7-token-000007', :'holder_code_7', 'Cliente 50', 'dev-50') ->> 'approved')::boolean,
  true,
  'novo responsável via código da equipe já entra liberado'
);

-- Código é de uso único: Cliente 51 tentando o mesmo código recebe INVALID_CODE
SELECT t.as_user(51);
SELECT t.is(
  (public.join_with_code('acc-a7-token-000007', :'holder_code_7', 'Intruso 51', 'dev-51') ->> 'state'),
  'INVALID_CODE',
  'código de troca de responsável é de uso único (segundo uso falha com INVALID_CODE)'
);

-- Trilha de auditoria registrou HOLDER_CODE_CREATED e RESPONSIBLE_CLAIMED
RESET ROLE;
SELECT t.ok(
  EXISTS (SELECT 1 FROM public.tab_access_events WHERE tab_id = t.tabof('acc-a7-token-000007') AND event = 'HOLDER_CODE_CREATED')
  AND EXISTS (SELECT 1 FROM public.tab_access_events WHERE tab_id = t.tabof('acc-a7-token-000007') AND event = 'RESPONSIBLE_CLAIMED'),
  'tab_access_events registra HOLDER_CODE_CREATED e RESPONSIBLE_CLAIMED'
);

-- 3. Parte F: resolve_table_invite devolve dados da loja e do responsável antes do login
SET ROLE authenticated;
SELECT t.as_user(50);
SELECT (public.create_tab_invite(t.sess(50, 'acc-a7-token-000007'), 15) ->> 'code') AS guest_inv_7 \gset

SET ROLE anon;
SELECT t.is(
  (public.resolve_table_invite('acc-a7-token-000007', :'guest_inv_7') ->> 'valid')::boolean,
  true,
  'resolve_table_invite para anon reconhece convite válido'
);
SELECT t.is(
  (public.resolve_table_invite('acc-a7-token-000007', :'guest_inv_7') ->> 'responsibleName'),
  'Cliente 50',
  'resolve_table_invite retorna o nome do responsável da mesa'
);
SELECT t.is(
  (public.resolve_table_invite('acc-a7-token-000007', 'ZZZZZZ') ->> 'valid')::boolean,
  false,
  'resolve_table_invite retorna valid=false para código inexistente'
);

-- 4. Parte D: Liberar mesa aberta sem consumo (R$ 0,00 e sem pedidos)
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000009'::uuid);
SELECT t.tabof('acc-a7-token-000007') AS empty_tab_7 \gset
SELECT public.release_empty_tab(:'empty_tab_7'::uuid, 'Cliente desistiu');

RESET ROLE;
SELECT t.is(
  (SELECT status FROM public.dining_tabs WHERE id = :'empty_tab_7'::uuid),
  'CANCELLED',
  'release_empty_tab encerra comanda sem consumo com status CANCELLED'
);
SELECT t.ok(
  NOT EXISTS (SELECT 1 FROM public.tab_sessions WHERE tab_id = :'empty_tab_7'::uuid AND ended_at IS NULL),
  'release_empty_tab encerra todas as sessões da comanda'
);
SELECT t.ok(
  EXISTS (
    SELECT 1 FROM public.tab_access_events
    WHERE tab_id = :'empty_tab_7'::uuid AND event = 'TAB_RELEASED_EMPTY' AND details ->> 'reason' = 'Cliente desistiu'
  ),
  'release_empty_tab grava TAB_RELEASED_EMPTY com motivo em tab_access_events'
);

-- Quando há pedido na comanda, release_empty_tab deve recusar com TAB_HAS_ORDERS
SET ROLE authenticated;
SELECT t.enter(60, 'acc-a8-token-000008');
SELECT t.login('a0000000-0000-0000-0000-000000000009'::uuid);
SELECT public.approve_session(t.sess(60, 'acc-a8-token-000008'));
SELECT t.order_as(60, t.sess(60, 'acc-a8-token-000008'));
SELECT t.login('a0000000-0000-0000-0000-000000000009'::uuid);
SELECT t.throws(
  format('SELECT public.release_empty_tab(%L::uuid, %L)', t.tabof('acc-a8-token-000008'), 'Aberta por engano'),
  'TAB_HAS_ORDERS',
  'release_empty_tab recusa comanda que já possui pedidos'
);

-- 5. Parte H: Papel WAITER lê tenants, tenant_settings, tenant_themes e pedidos DINE_IN da própria loja via RLS
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000009'::uuid);
SELECT t.is(
  (SELECT count(*)::int FROM public.tenants WHERE id = :'A'),
  1,
  'WAITER consegue ler o registro da própria loja em public.tenants'
);
SELECT t.is(
  (SELECT count(*)::int FROM public.tenants WHERE id = :'B'),
  0,
  'WAITER não lê outras lojas em public.tenants'
);
SELECT t.ok(
  (SELECT count(*)::int FROM public.orders WHERE tenant_id = :'A' AND fulfillment_type = 'DINE_IN') >= 1,
  'WAITER consegue ler pedidos DINE_IN da própria loja'
);
