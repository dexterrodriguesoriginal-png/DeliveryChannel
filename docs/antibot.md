# Proteção contra robôs — ativação pelo David

Este PR não aplica migração, não altera configurações remotas e não faz deploy.
Sem `VITE_TURNSTILE_SITE_KEY` não há widget nem carregamento do script. Sem o secret
no servidor não há consulta ao Turnstile no checkout. Os limites das RPCs passam
a valer quando a migração for aplicada, independentemente do captcha.

## Criar as chaves gratuitas

1. Entre em https://dash.cloudflare.com/ e abra **Turnstile → Add widget**.
2. Dê o nome **Delivery Channel**, cadastre os hostnames reais do aplicativo
   (sem protocolo/caminho) e escolha o tipo **Invisible**. Não é necessário
   transferir o DNS do site para a Cloudflare; o plano gratuito atende este uso.
3. Copie a **Site key** para `VITE_TURNSTILE_SITE_KEY` no ambiente do frontend.
   Ela é pública. Use widget/chaves separados para staging e produção.
4. Guarde a **Secret key** somente nas configurações do Supabase descritas abaixo.
   Nunca coloque o secret em variável `VITE_*`, Git, prints ou conversa.

## Configurar o Supabase e o frontend

Em staging primeiro, depois em uma janela de ativação controlada:

1. Revise/aplique `supabase/migrations/20261112000200_antibot.sql` pelo processo
   habitual de migrações, seguida de `20261114000100_antibot_ip_limits.sql`.
   A instalação não exige Turnstile, Vault, http ou cron habilitados
   para funcionar com captcha desligado.
2. No Supabase **Database → Extensions**, habilite `http` no schema `extensions`.
   O checkout usa uma RPC com chamada síncrona ao `siteverify`, limitada a 5 s;
   nenhuma Edge Function precisa ser publicada. O segredo fica no **Vault**, no
   servidor, em vez de uma variável de Edge Function.
3. Prepare o frontend com a site key e valide os fluxos antes de exigir captcha no
   servidor. Ainda com Auth captcha desligado e Vault sem secret, os tokens são
   ignorados pelo servidor. Não ative o servidor com clientes antigos abertos:
   publique/atualize o cliente na janela de ativação antes dos próximos passos.
4. No SQL Editor do Supabase, configure apenas os hostnames autorizados:

   ```sql
   UPDATE private.antibot_config
   SET allowed_hostnames = ARRAY['deliverychannel.ai.studio'];
   ```

   Inclua domínios personalizados realmente usados; use os de staging no projeto
   de staging. O servidor exige `success`, hostname autorizado e ação `checkout`.
5. Em **Vault**, crie o secret com nome **`delivery_turnstile_secret`** e valor da
   Secret key. A existência de valor não vazio ativa a verificação no checkout.
   Token ausente, inválido, reutilizado/expirado ou indisponibilidade do provedor
   bloqueiam a criação do pedido com mensagem em português. O token não é salvo.
6. Em **Authentication → Attack Protection → CAPTCHA protection**, selecione
   **Cloudflare Turnstile**, informe a mesma Secret key e habilite a proteção.
   O frontend envia `options.captchaToken` em cadastro/login e `captchaToken` em
   recuperação de senha usando a integração nativa do Supabase Auth. Confira
   também os limites de Auth em **Rate Limits**; não os desative.
7. Se `pg_cron` já estiver habilitado ao aplicar a migração, ela agenda limpeza
   horária. Se habilitá-lo depois, agende uma vez como administrador:

   ```sql
   SELECT cron.schedule('antibot-cleanup', '17 * * * *',
                        'SELECT private.antibot_cleanup()');
   ```

   Cada requisição protegida também limpa registros vencidos, inclusive sem cron.

**Sessões de mesa e dispositivos pareados:** `create_totem_order` e as RPCs de
mesa/QR não carregam captcha, não recebem token e não são encapsuladas pela
migração. O pareamento próprio continua com a proteção existente. A proteção
nativa de Auth é global: autenticar uma pessoa por e-mail/senha, inclusive uma
pessoa que abre a área de mesa, exige captcha quando Auth estiver habilitado;
a navegação e os pedidos com sessão de mesa existente não exigem outro captcha.
Os logins administrativos alternativos nas telas de ativação de TV e totem
também enviam o token nativo de Auth; trata-se da autenticação inicial da pessoa
responsável. O pareamento próprio por usuário/código segue sem captcha.
Dispositivos já pareados não são afetados.

## Limites e auditoria

As assinaturas, defaults e permissões públicas existentes são preservados, com
cópias privadas das implementações completas. Os quatro checkouts públicos
(`process_checkout_atomic`, `_v2`, `_v3` e `process_promotional_checkout_atomic`)
compartilham os contadores por tipo de sujeito, em janelas de **10 minutos**:

| Sujeito | Checkout | Cupom (`validate_coupon`) |
| --- | ---: | ---: |
| IP compartilhado | 300 | 600 |
| Telefone normalizado / e-mail da sessão assinada | 20 | 60 |
| Usuário autenticado | 20 | 60 |

O checkout usa telefone normalizado; a prévia de cupom usa e-mail da sessão
assinada e não recebe telefone ou identificador anônimo. Checkout anônimo, se
permitido pelas regras existentes, recebe os limites de IP e telefone acima.
Os quatro limites ficam nas constantes no topo de `private.antibot_guard` na
migração `20261114000100_antibot_ip_limits.sql`. Ajustá-los exige redefinir a
função como owner; anon/authenticated não podem alterá-los nem executar a função
privada diretamente. A migração não muda as exigências de login.
As RPCs internas de cupom/PDV continuam com suas permissões atuais.

Bloqueios retornam HTTP 429 e a mensagem **“Muitas tentativas em pouco tempo.
Aguarde alguns minutos e tente novamente.”** Os erros das regras de negócio
continuam sendo erros HTTP, com sua mensagem original. Contadores e bloqueios
persistem inclusive quando a regra de negócio rejeita a tentativa; os efeitos
parciais da operação são revertidos em subtransação. Chamadas internas não
consomem outro token nem contam duas vezes.

`antibot_counters` não permite acesso direto anon/authenticated. IP, telefone e
usuário aparecem somente como hashes com segredo aleatório privado. A origem usa
os headers do ingresso (cf-connecting-ip/x-real-ip ou último salto de
x-forwarded-for), conforme o padrão já adotado pelo projeto. Não exponha o
PostgREST por proxy que preserve esses headers de clientes sem sobrescrevê-los.
Bloqueios repetidos do mesmo IP/operação/motivo são agregados por janela de
10 minutos, com contagem, para limitar o crescimento da auditoria.
Contadores vencidos há mais de um dia são removidos; auditoria dura 30 dias.
O limite de IP é verificado antes dos identificadores: um IP já bloqueado não
consegue criar novos contadores variando o telefone. A função
`private.antibot_guard` usa `SECURITY DEFINER` e
`SET search_path = public, pg_temp`; as demais funções privadas mantêm
`search_path` vazio; os objetos novos revogam inclusive grants herdados por
privilégios padrão. O schema `private`, se já existir, mantém suas permissões.

`public.antibot_audit` registra operação, motivo, hash do IP e horário, sem token,
e-mail, telefone ou conteúdo do pedido. Somente CEO/SUPER_ADMIN ativo consegue
ler pela API, com RLS; lojistas comuns não veem bloqueios de outras lojas.
O administrador também pode consultar no SQL Editor:

```sql
SELECT operation, reason, ip_hash, created_at
FROM public.antibot_audit ORDER BY created_at DESC LIMIT 100;
```

Bloqueios de Auth são verificados nos logs nativos do Supabase Auth; não passam
pelas RPCs de pedidos. A tabela nova audita os bloqueios de checkout/cupom.

## Como testar

```sh
bun install
npx tsc --noEmit
npx vitest run --maxWorkers=4 --testTimeout=30000
node supabase/tests/antibot/run_pglite.mjs
node supabase/tests/entrega3/run_pglite.mjs
node supabase/tests/totem_access/run_pglite.mjs
node supabase/tests/tv_access/run_pglite.mjs
```

A configuração Vitest mantém iframes e `contentWindow`, mas impede a navegação
dos frames e requisições externas. Isso evita os erros de iframe desabilitado do
Happy DOM 21 sem ocultar erros de aplicação. O carregador Turnstile tem timeout
próprio de 15 segundos e permite nova tentativa quando o script fica sem resposta.

O PGlite usa funções de negócio e HTTP isoladas como doubles: valida instalação,
limites, falhas atômicas, persistência, limpeza, RLS, bypass direto, host/ação e
rollback exato das definições. Cobre 21 checkouts do mesmo IP com telefones
diferentes, bloqueio no 301º por IP e no 21º por telefone/usuário, 600 cupons por
IP e 60 por e-mail/usuário, além do retorno aos limites anteriores no rollback
incremental. Não acessa Cloudflare ou produção. Faça também a
verificação de integração em staging com chaves reais: cadastro, login,
recuperação, entrega, retirada, promoções, rejeição sem token, repetição de token
e navegação/pedido no totem/mesa já pareados. Confira no Network que não há script
Turnstile sem site key e que um pedido bloqueado não gerou ordem nem pagamento.

## Desligar / rollback

Para desligar só captcha, primeiro desabilite CAPTCHA em Auth e remova o secret
`delivery_turnstile_secret` do Vault; depois remova a site key do frontend na
próxima publicação. Os limites continuam ativos. Não desabilite apenas o cliente
enquanto o servidor exigir tokens.

Para reverter apenas os limites por IP, revise/execute
`supabase/rollback/20261114000100_antibot_ip_limits.sql`: restaura exatamente a
função anterior (inclusive `search_path` e ACL), voltando a 20 checkouts/60 cupons
por IP em 10 minutos. Contadores, auditoria e RLS são preservados.

Para rollback estrutural, revise/execute
`supabase/rollback/20261112000200_antibot.sql`: restaura todas as definições
originais completas, remove as tabelas e funções deste recurso e cancela o cron.
Não faça rollback após outra migração redefinir as mesmas RPCs sem conciliar as
definições primeiro. A extensão `http` e o secret Vault não são apagados pelo
rollback (podem ser compartilhados); remova o secret separadamente se necessário.
