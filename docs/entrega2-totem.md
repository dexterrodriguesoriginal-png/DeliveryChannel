# Cardápio da mesa no totem

O bloco **Cardápio** do início do QR abre o `TotemMenuView` com categorias à esquerda, fotos grandes e Outdoor no topo. O adaptador `DineInTotemMenu` recebe o catálogo e o tema público já carregados pelo aplicativo da mesa, compartilhados com a hidratação da sacola e os adicionais. Ele busca os destaques pela RPC pública usando exclusivamente o slug resolvido pelo token do QR. Falha no Outdoor permite continuar consultando e pedindo pelo catálogo; a tela oferece uma nova tentativa.

Produtos com adicionais usam o seletor existente e só entram na sacola depois de uma seleção válida. Tocar na foto ou no destaque abre os detalhes/personalização; o botão Adicionar inclui diretamente os produtos simples. A sacola continua acessível pela barra e pelo botão do totem, com **Adicionar mais itens** voltando ao cardápio. O subtotal estimado considera o preço promocional válido e os adicionais. O pedido envia apenas IDs, quantidades, observações e opções; o servidor calcula e valida os valores e a autorização da sessão.

O Design do Cardápio fica separado do Design do App. O adaptador aplica os tokens públicos, o espaçamento escolhido e o contraste do texto da categoria selecionada. A altura acompanha a área disponível em celular, tablet e totem, preservando as ações da mesa. Códigos de entrega, acompanhamento flutuante e convite para pedir de casa continuam no aplicativo da mesa; os códigos permanecem condicionados à sessão aprovada.

Não há migração adicional na Parte D. Ela usa as migrações `20261104000800` (Outdoor) e `20261104000900` (tema), com as respectivas reversões. Nenhum dos três arquivos reservados de apresentação do totem foi alterado pela integração.

Validação: `npx tsc --noEmit`, `npx vitest run` e `sh supabase/tests/entrega2/run_c_regressions.sh strict` / `legacy` em PostgreSQL local descartável. Os testes incluem o componente real, opções obrigatórias, promoções, checkout da mesa, falhas e troca de loja no Outdoor, bloqueios após pedir a conta, isolamento do tema e exibição dos códigos somente à sessão aprovada.
