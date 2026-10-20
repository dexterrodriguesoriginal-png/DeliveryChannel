SELECT t.ok(
  (SELECT count(*) = 2 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'waiter_calls'
     AND column_name IN ('payment_choice', 'cash_tendered_cents')),
  'campos de pagamento adicionados aos chamados'
);
SELECT t.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
          WHERE conrelid = 'public.waiter_calls'::pg_catalog.regclass
            AND conname = 'waiter_calls_payment_choice_check'),
  'forma de pagamento limitada aos valores suportados'
);
SELECT t.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
   WHERE oid = 'public.request_bill(uuid,text,integer)'::regprocedure)
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
       WHERE oid = 'public.request_bill(uuid)'::regprocedure),
  'overloads de request_bill usam SECURITY DEFINER com search_path vazio'
);
SELECT t.ok(
  has_function_privilege('anon', 'public.request_bill(uuid,text,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.request_bill(uuid)', 'EXECUTE')
  AND (SELECT pronargdefaults = 2 FROM pg_catalog.pg_proc
       WHERE oid = 'public.request_bill(uuid,text,integer)'::regprocedure),
  'clientes podem executar ambos os overloads de request_bill'
);
SELECT t.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
   WHERE oid = 'public.handle_waiter_call(uuid)'::regprocedure)
  AND has_function_privilege('authenticated', 'public.handle_waiter_call(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.handle_waiter_call(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.handle_waiter_call(uuid)', 'EXECUTE'),
  'helper de atendimento é SECURITY DEFINER e executável apenas por authenticated'
);

INSERT INTO public.dining_tables (tenant_id, label, qr_token)
VALUES ('10000000-0000-0000-0000-00000000000a', 'Mesa pagamento', 'dine-in-payment-test');
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config) VALUES
  ('10000000-0000-0000-0000-00000000000a', 'dine_in', true,
   '{"mode":"TABLE","salon_open":true,"release_required":false}'),
  ('10000000-0000-0000-0000-00000000000a', 'service_fee', false, '{}')
ON CONFLICT (tenant_id, module_key) DO UPDATE
SET enabled = EXCLUDED.enabled, config = EXCLUDED.config;

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives($$SELECT public.configure_dine_in(
  '10000000-0000-0000-0000-00000000000a',
  '{"mode":"TABLE","release_required":true,"round_limit":400,"salon_open":true,"close_roles":["OWNER","MANAGER","CASHIER"]}'::jsonb,
  false,
  '{"percent":10}'::jsonb
)$$, 'gerente autorizado altera apenas a configuração do salão');
SELECT t.is(
  (SELECT config ->> 'round_limit' FROM public.tenant_modules
   WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND module_key = 'dine_in'),
  '400',
  'configuração salva pelo gerente fica no tenant correto'
);
SELECT t.throws($$SELECT public.configure_dine_in(
  '10000000-0000-0000-0000-00000000000a',
  '{"mode":"TABLE","release_required":true,"round_limit":400,"salon_open":true,"close_roles":["OWNER","MANAGER","CASHIER"]}'::jsonb,
  true,
  '{"percent":10}'::jsonb
)$$, 'MODULE_OWNER_REQUIRED', 'gerente não ativa módulos opcionais');
SELECT t.throws($$SELECT public.configure_dine_in(
  '10000000-0000-0000-0000-00000000000b',
  '{"mode":"TABLE","release_required":true,"round_limit":300,"salon_open":true,"close_roles":[]}'::jsonb,
  false,
  '{"percent":10}'::jsonb
)$$, 'FORBIDDEN', 'gerente não configura o salão de outro tenant');
SELECT t.throws($$SELECT public.set_tenant_module(
  '10000000-0000-0000-0000-00000000000a', 'dine_in', false, '{}'::jsonb
)$$, 'MODULE_OWNER_REQUIRED', 'gerente não pode ativar ou desativar módulos');
RESET ROLE;

DELETE FROM public.security_rate_limits;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.payment_session',
  public.open_or_join_tab('dine-in-payment-test', 'Cliente', 'payment-test-device') ->> 'sessionId', false);
SELECT public.submit_round(
  '[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]',
  gen_random_uuid(), current_setting('t.payment_session')::uuid
);
SELECT t.throws(
  format($$SELECT public.request_bill(%L, 'CASH', 999)$$, current_setting('t.payment_session')),
  'CASH_TENDER_TOO_LOW',
  'servidor rejeita valor em dinheiro abaixo do total atual'
);
RESET ROLE;
SELECT t.is(
  (SELECT status FROM public.dining_tabs WHERE id = (
    SELECT tab_id FROM public.tab_sessions WHERE id = current_setting('t.payment_session')::uuid
  )),
  'OPEN',
  'tentativa com valor insuficiente não altera o estado da comanda'
);
SET ROLE authenticated;
SELECT set_config('t.payment_call',
  public.request_bill(current_setting('t.payment_session')::uuid, 'CASH', 1000)::text, false);
RESET ROLE;
SELECT t.is(
  (SELECT payment_choice FROM public.waiter_calls WHERE id = current_setting('t.payment_call')::uuid),
  'CASH',
  'nova assinatura armazena a forma de pagamento escolhida'
);
SELECT t.is(
  (SELECT cash_tendered_cents FROM public.waiter_calls WHERE id = current_setting('t.payment_call')::uuid),
  1000,
  'nova assinatura armazena o valor entregue em dinheiro'
);
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws(
  format($$SELECT public.handle_waiter_call(%L)$$, current_setting('t.payment_call')),
  'FORBIDDEN',
  'cliente sem papel de equipe não pode atender chamado'
);
RESET ROLE;
UPDATE public.tenant_modules SET enabled = false
WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND module_key = 'dine_in';
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws(
  format($$SELECT public.handle_waiter_call(%L)$$, current_setting('t.payment_call')),
  'MODULE_DISABLED',
  'helper recusa atendimento quando o módulo de salão está desativado'
);
RESET ROLE;
UPDATE public.tenant_modules SET enabled = true
WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND module_key = 'dine_in';
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(
  format($$SELECT public.handle_waiter_call(%L)$$, current_setting('t.payment_call')),
  'equipe autorizada marca o chamado como atendido'
);
RESET ROLE;
SELECT t.is(
  (SELECT status FROM public.waiter_calls WHERE id = current_setting('t.payment_call')::uuid),
  'HANDLED',
  'helper atualiza o estado do chamado'
);
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws(
  format($$SELECT public.handle_waiter_call(%L)$$, current_setting('t.payment_call')),
  'WAITER_CALL_NOT_OPEN',
  'helper não processa um chamado já atendido'
);
SELECT t.throws(
  format($$SELECT public.request_bill(%L, 'BITCOIN', NULL)$$, current_setting('t.payment_session')),
  'INVALID_PAYMENT_CHOICE',
  'servidor rejeita formas de pagamento não suportadas'
);
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.legacy_payment_call',
  public.request_bill(current_setting('t.payment_session')::uuid)::text, false);
RESET ROLE;
SELECT t.is(
  (SELECT payment_choice IS NULL AND cash_tendered_cents IS NULL
   FROM public.waiter_calls WHERE id = current_setting('t.legacy_payment_call')::uuid),
  true,
  'assinatura de um argumento mantém o comportamento anterior'
);
