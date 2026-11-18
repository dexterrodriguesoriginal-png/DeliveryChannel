# Tela inicial personalizada (store presentation screen)

```sh
node supabase/tests/presentation_screen/run_pglite.mjs
```

Fixture mínima das N3/N6 (`marketing_media_assets`, `_public_media_json`, `get_public_store`, `is_tenant_owner_or_manager`)
e depois a migration `20261118000100_store_presentation_screen.sql`. Verifica: PRE aborta numa segunda aplicação; anon,
cliente, caixa e dono de outra loja não gravam; ninguém escreve direto na tabela (só RPC); RPC recusa mídia de outra loja,
não publicada, imagem > 3 MB, vídeo > 15 MB ou > 10 s e tempo fora de 1–5 s; leitura do painel isolada por loja;
`get_public_store` público só ganha `presentation` `{media{bucket,path,mediaType,width,height,durationSeconds}, imageSeconds,
oncePerDay}` (sem caminho privado, id de usuário ou id do asset); mídia despublicada some sem erro; rollback recusa com
dados, depois restaura a definição exata de `get_public_store` e permite reaplicar.

Rollback: `supabase/rollback/20261118000100_store_presentation_screen_down.sql` (recusa se alguma loja configurou a tela;
sem CASCADE).

Limitação conhecida: a duração do vídeo é medida no navegador (`confirm_marketing_upload` grava `duration_seconds` do
cliente); o servidor confere tamanho e tipo em `storage.objects` e recusa duração ausente ou > 10 s. O player também corta
em 10 s.
