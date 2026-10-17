# Procedimento: provisionar `n1n6_ip_hash_salt` no Vault de PRODUÇÃO (NÃO EXECUTADO, só preparado)
O valor é gerado DENTRO do banco e nunca é lido, impresso ou trafegado. Rodar como `postgres`, numa transação, em janela autorizada.

```sql
BEGIN;
-- PRE: não existe ainda (evita duplicar)
DO $pre$ BEGIN
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name='n1n6_ip_hash_salt') THEN
    RAISE EXCEPTION 'PRE: segredo já existe; não recriar';
  END IF;
END $pre$;
-- cria: 32 bytes aleatórios -> 64 caracteres hex; valor não retorna ao cliente (só o id)
SELECT vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'n1n6_ip_hash_salt',
                           'HMAC salt para hash diário de IP (N1 _request_ip_hash; N5 track_campaign_event; 0700 preview_driver_invite)') IS NOT NULL AS criado;
-- POST: verificação SÓ de comprimento, sem expor o valor
DO $post$ DECLARE ok boolean; BEGIN
  SELECT length(decrypted_secret) >= 32 INTO ok FROM vault.decrypted_secrets WHERE name='n1n6_ip_hash_salt';
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'POST: segredo ausente ou curto'; END IF;
  RAISE NOTICE 'POST OK: n1n6_ip_hash_salt presente e com 32 caracteres ou mais';
END $post$;
COMMIT;
```
- **Verificação isolada (somente leitura, pode repetir):**
  ```sql
  BEGIN READ ONLY;
  SELECT name, length(decrypted_secret) >= 32 AS ok FROM vault.decrypted_secrets WHERE name='n1n6_ip_hash_salt';
  ROLLBACK;
  ```
- **Proibido:** `SELECT decrypted_secret` sem `length()`, logar a saída da criação com o valor ou usar `\set` com o valor.
- **Rollback:** `DELETE FROM vault.secrets WHERE name='n1n6_ip_hash_salt';`. O efeito é voltar ao estado atual: rate limit por IP desligado e o 0700 bloqueado no PRE (f).
- **Efeito esperado:**
  - `_request_ip_hash()` passa a retornar o hash;
  - `track_campaign_event` passa a aplicar o limite por IP (600/min por loja);
  - `preview_driver_invite` deixa de responder sempre `valid:false`, depois do 0700.
