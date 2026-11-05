# Outdoor do cardápio

Em **Marketing → Outdoor do cardápio**, donos e gerentes vinculados à loja podem enviar uma imagem/vídeo pelo fluxo governado de marketing ou escolher uma mídia já publicada. Cada banner tem título opcional (até 120 caracteres), produto opcional do mesmo catálogo, ordem, estado ativo e início/término opcionais. Os horários do editor são de Brasília. Pausar conserva o banner e a mídia; não altera os cards promocionais do aplicativo.

A migração `20261104000800_entrega2_menu_outdoor.sql` cria somente objetos novos. RLS e as RPCs de gestão verificam vínculo ativo de dono/gerente no tenant; não há escrita direta pelo cliente. `list_public_menu_outdoor` devolve apenas seis campos de apresentação, somente de lojas ativas, banners ativos dentro do período e mídias publicadas no caminho governado da própria loja. Produtos ou categorias inativos deixam de receber link. Nenhum dado de cliente é retornado.

Uma mídia despublicada some imediatamente da projeção pública. O painel mantém o banner disponível para edição/pausa sem mostrar o caminho privado; ativá-lo exige outra mídia publicada. O rollback correspondente em `supabase/rollback/` restaura o esquema anterior quando vazio e recusa a reversão se houver banners, preservando os dados. Testes locais: `sh supabase/tests/entrega2/run_b_regressions.sh strict` e `legacy`, em PostgreSQL descartável.
