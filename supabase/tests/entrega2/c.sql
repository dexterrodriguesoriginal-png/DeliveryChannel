-- Design do Cardápio: escopo real no servidor e projeção pública independente do app.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MANAGER 'a0000000-0000-0000-0000-000000000002'
\set OPERATOR 'a0000000-0000-0000-0000-000000000003'
\set CLIENT 'a0000000-0000-0000-0000-000000000007'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set CEO 'c0000000-0000-0000-0000-000000000001'
\set WAITER 'e1310000-0000-0000-0000-000000000002'
RESET ROLE;
SELECT t.login(NULL);
SELECT public._menu_theme_default() AS default_theme \gset
SELECT (public._menu_theme_default()||'{"background":"#101113","surface":"#24252A","text":"#FAFAFA","accent":"#FACC15","accentText":"#18181B","categoryActiveBg":"#FACC15","fontFamily":"Montserrat","radius":12,"layout":"compact"}'::jsonb) AS dark_theme \gset
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.tenant_settings'::regclass) AND (SELECT relrowsecurity FROM pg_class WHERE oid='public._entrega2_menu_theme_restore'::regclass),'C: RLS permanece ativo inclusive na restauração privada');
SELECT t.ok(NOT has_table_privilege('anon','public._entrega2_menu_theme_restore','SELECT') AND NOT has_table_privilege('authenticated','public._entrega2_menu_theme_restore','SELECT') AND NOT has_table_privilege('service_role','public._entrega2_menu_theme_restore','SELECT'),'C: snapshot SQL/ACL não é exposto');
SELECT t.ok(NOT has_function_privilege('anon','public.get_menu_theme(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.set_menu_theme(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public._menu_theme_public(jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public._menu_theme_valid(jsonb)','EXECUTE'),'C: nenhuma permissão nova para anon');
SELECT t.is((SELECT menu_theme FROM public.tenant_settings WHERE tenant_id=:'A'),:'default_theme'::jsonb,'C: coluna aditiva preenche configuração pública padrão');
SELECT t.ok(public._menu_theme_valid(:'dark_theme'::jsonb),'C: configuração completa válida');
SELECT t.ok(NOT public._menu_theme_valid(NULL) AND NOT public._menu_theme_valid('[]') AND NOT public._menu_theme_valid('{}'),'C: JSON nulo, array e incompleto recusados');
SELECT t.ok(NOT public._menu_theme_valid(:'default_theme'::jsonb||'{"email":"cliente@test.local"}') AND NOT public._menu_theme_valid(:'default_theme'::jsonb||'{"background":"url(https://evil.test/a)"}'),'C: chaves privadas e CSS arbitrário não são aceitos');
SELECT t.ok(NOT public._menu_theme_valid(:'default_theme'::jsonb||'{"fontFamily":"Inter; background:url(https://evil.test)"}') AND NOT public._menu_theme_valid(:'default_theme'::jsonb||'{"radius":1.5}') AND NOT public._menu_theme_valid(:'default_theme'::jsonb||'{"radius":33}'),'C: fontes allowlist e raio inteiro limitado');
SELECT t.is(public._menu_theme_public(:'dark_theme'::jsonb||'{"email":"cliente@test.local"}'),:'default_theme'::jsonb,'C: projeção defensiva não retorna JSON desconhecido');
-- Comparação com a versão imediata anterior da função, capturada pelo runner.
SELECT t.ok((SELECT bool_and((public.get_public_store(b.slug)-'menuTheme')=b.payload) FROM t.c_public_before b),'C: remover só menuTheme produz payload idêntico ao predecessor');
SELECT t.ok(NOT (public.get_public_store('adega-a')->'settings' ? 'menu_theme'),'C: menu_theme não amplia configurações operacionais públicas');

SET ROLE anon;
SELECT t.is(public.get_public_store('adega-a')->'menuTheme',:'default_theme'::jsonb,'C: RPC pública existente retorna apenas tokens do cardápio');
SELECT t.throws($q$SELECT public.get_menu_theme('10000000-0000-0000-0000-00000000000a')$q$,'permission denied','C: anon não acessa getter administrativo');
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'permission denied','C: anon não escreve');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login(NULL);
SELECT t.throws($q$SELECT public.get_menu_theme('10000000-0000-0000-0000-00000000000a')$q$,'FORBIDDEN','C: papel autenticado sem identidade é recusado');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.get_menu_theme('10000000-0000-0000-0000-00000000000a')$q$,'FORBIDDEN','C: cliente não lê configuração administrativa');
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'FORBIDDEN','C: cliente não altera configuração');
SELECT t.login(:'OPERATOR'::uuid);
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'FORBIDDEN','C: operador da loja não escreve');
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'FORBIDDEN','C: garçom não escreve');
SELECT t.login(:'CEO'::uuid);
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'FORBIDDEN','C: papel global sem membership não ganha autorização');
SELECT t.throws(format('UPDATE public.tenant_settings SET menu_theme=%L::jsonb WHERE tenant_id=%L',:'dark_theme',:'A'),'FORBIDDEN|permission denied','C: escrita direta bloqueia papel global sem membership (privilégio ou trigger)');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.get_menu_theme('10000000-0000-0000-0000-00000000000a')$q$,'FORBIDDEN','C: dono de outra loja não lê configuração administrativa');
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'FORBIDDEN','C: dono de outra loja não altera configuração');
SELECT t.login(:'OWNER'::uuid);
SELECT t.is(public.get_menu_theme(:'A'),:'default_theme'::jsonb,'C: dono lê sua configuração');
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',(:'dark_theme'::jsonb||'{"fontFamily":"<style>"}')::text),'INVALID_MENU_THEME','C: servidor recusa injeção mesmo com dono autorizado');
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',(:'dark_theme'::jsonb-'accentText')::text),'INVALID_MENU_THEME','C: servidor recusa tema incompleto');
SELECT t.is(public.set_menu_theme(:'A',:'dark_theme'),:'dark_theme'::jsonb,'C: dono salva tema independente');
SELECT t.is(public.get_menu_theme(:'A'),:'dark_theme'::jsonb,'C: getter confirma tema persistido');
SELECT t.ok((public.get_public_store('adega-a')-'menuTheme')=(SELECT payload FROM t.c_public_before WHERE slug='adega-a'),'C: salvar cardápio não muda app, catálogo, banners nem configurações');
SELECT t.ok((SELECT bool_and(public.list_public_menu_outdoor(b.slug)=b.payload) FROM t.c_outdoor_before b),'C: salvar cardápio preserva outdoors de todas as lojas');
SELECT t.is(public.get_public_store('adega-b')->'menuTheme',:'default_theme'::jsonb,'C: salvar loja A não muda loja B');
SELECT t.login(:'MANAGER'::uuid);
SELECT t.is(public.set_menu_theme(:'A',(:'dark_theme'::jsonb||'{"radius":24}')),(:'dark_theme'::jsonb||'{"radius":24}'),'C: gerente ativo da própria loja salva');
SELECT t.is(public.get_menu_theme(:'A'),(:'dark_theme'::jsonb||'{"radius":24}'),'C: gerente lê a confirmação da própria loja');
RESET ROLE;
UPDATE public.tenant_users SET status='INACTIVE' WHERE user_id=:'MANAGER' AND tenant_id=:'A';
SET ROLE authenticated;
SELECT t.login(:'MANAGER'::uuid);
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'FORBIDDEN','C: revogação de membership é imediata');
RESET ROLE;
UPDATE public.tenant_users SET status='ACTIVE' WHERE user_id=:'MANAGER' AND tenant_id=:'A';
UPDATE public.tenants SET status='SUSPENDED' WHERE id=:'A';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.set_menu_theme(%L,%L::jsonb)',:'A',:'dark_theme'),'FORBIDDEN','C: tenant inativo bloqueia escrita');
RESET ROLE;
UPDATE public.tenants SET status='ACTIVE' WHERE id=:'A';
-- O tema do app ainda é alterável sem modificar o cardápio.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
UPDATE public.tenant_themes SET primary_color='#123456' WHERE tenant_id=:'A';
SELECT t.is(public.get_public_store('adega-a')->'theme'->>'primary_color','#123456','C: edição do app continua funcionando');
SELECT t.is(public.get_menu_theme(:'A'),(:'dark_theme'::jsonb||'{"radius":24}'),'C: editar Design do App preserva Design do Cardápio');
RESET ROLE;
SELECT t.login(NULL);
