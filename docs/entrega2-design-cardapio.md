# Design do Cardápio

Em **Design → Design do Cardápio**, o dono ou gerente da própria loja pode escolher entre oito modelos, personalizar seis cores, fonte, arredondamento e espaçamento e conferir a prévia no celular ou tablet antes de salvar. A seção fica junto do Design do App para manter as ferramentas visuais no mesmo lugar. Os editores reutilizam os estilos e recursos de prévia existentes, mas mantêm rascunhos e persistência independentes.

O cardápio usa `tenant_settings.menu_theme`; o aplicativo continua usando sua configuração de tema existente. As RPCs `get_menu_theme` e `set_menu_theme` verificam o vínculo ativo de dono/gerente no servidor. Cores aceitam somente hexadecimal, fontes usam uma lista permitida e o JSON não aceita propriedades extras. A RPC pública `get_public_store` ganha apenas `menuTheme`, com projeção explícita de tokens visuais, sem dados de clientes. O restante do catálogo público e o Outdoor permanecem iguais.

As fontes disponíveis já são carregadas pelo aplicativo. Os modelos têm contraste AA para texto e botões; personalizações de contraste insuficiente geram orientação na prévia. Cores, fonte, cantos e espaçamento são aplicados no atendimento pelo adaptador `DineInTotemMenu`, que integra o componente `TotemMenuView`, mantido separadamente.

A migração `20261104000900_entrega2_menu_theme.sql` adiciona a coluna e preserva a definição e as permissões anteriores de `get_public_store` em uma tabela interna com RLS, sem acesso dos clientes. O rollback em `supabase/rollback/20261104000900_entrega2_menu_theme_down.sql` restaura o estado anterior e recusa a reversão quando existe tema personalizado, evitando perda de configuração.

Para validar em PostgreSQL local descartável: `sh supabase/tests/entrega2/run_c_regressions.sh strict` e `legacy`. A suíte inclui as regressões do salão, do Outdoor, a independência dos designs e dois ciclos de aplicação/reversão exata.
