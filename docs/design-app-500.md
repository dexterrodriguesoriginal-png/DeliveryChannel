# Design do App: 500 composições

A galeria usa os 150 modelos existentes e 350 composições adicionais: exatamente 20 em cada um dos 25 segmentos, com 10 claros e 10 escuros. Os 40 presets legados permanecem para compatibilidade e não são somados à contagem. Variantes recoloridas continuam recuperáveis e favoritáveis, mas não contam como novos modelos oficiais.

## Reprodução e distinção

Execute `npx tsx scripts/generateDesignCatalog.ts`. A semente 500 reproduz o conteúdo completo de `src/lib/theme/templates/expandedPalettes.ts`. A geração é offline; o navegador recebe os dados prontos.

Cada candidato recebe primária, secundária, acento, fundo, superfície e texto. Layout, tipografia e acabamento variam por índice e segmento. As seis opções anteriores por segmento são a referência comercial inicial, com alternativas de várias famílias cromáticas. Nomes e IDs não entram na decisão de distinção visual.

Critérios anteriores preservados:

- Primárias do mesmo segmento mantêm ΔE2000 ≥ 12.
- Nenhum par global pode ter simultaneamente ΔE2000 da primária < 10 e do fundo < 4.
- Permanecem as verificações semânticas de família cromática e fundos claros/escuros.

Critérios adicionais:

- Assinatura canônica de todos os tokens visuais: paleta completa, fundos, gradientes, tipografia, layout, bordas, raios, sombras e demais componentes. Metadados, nomes, IDs e ordem das propriedades não disfarçam aliases.
- Comparação perceptual da paleta completa e dos eixos principais de composição. Alterar apenas uma borda em 1 px não cria um tema novo.
- IDs e nomes únicos, sem tokens idênticos ou composições quase iguais.
- Pelo menos cinco famílias cromáticas por segmento, além de diversidade de fontes, layouts e raios.
- Contraste AA de textos, botões, preços e categorias selecionadas. Textos auxiliares também são ajustados para cabeçalho, menu, fundo geral e paradas de gradientes. A normalização se aplica ao catálogo, nunca silenciosamente às escolhas manuais do dono.

## Editor e prévias

A busca aceita nome, segmento, família, tom, estilo e modo sem distinguir acentos. Claro/escuro tem filtro próprio. Favoritos, comparação, recomendação pela logo e aplicação no rascunho permanecem; o carregamento continua em lotes de 24. A busca também restringe variantes recoloridas para impedir resultados incompatíveis.

No desktop, o modelo explorado aparece na coluna de prévia sem fechar a galeria. No celular, o modelo usa diálogo e o editor mantém a seção Prévia acessível. Celular, tablet e computador usam a própria página do cliente e o contrato de mensagens existente.

As cores ficam agrupadas por finalidade. Fundos estruturais e cartões têm um único local de edição, com atalhos da aba Cores para a superfície correspondente na aba Fundos. Os avisos de contraste informam razão e sugestão sem alterar o rascunho. Gradientes usam as cores do tema ao adicionar paradas.

A prévia do cardápio renderiza o próprio `DineInPremiumMenu` em iframe isolado, recebendo tema, catálogo, capa, modo de categorias e produtos por fileira. O viewport é 390×844 ou 1024×768, com os mesmos media queries do cliente. Callbacks de pedido não gravam e a prévia não consulta mais vendidos. App e cardápio mantêm temas independentes. Na vitrine, cards promocionais, busca, categorias e badges seguem os tokens correspondentes.

Cada painel continua salvando seu contrato. O estado geral do cardápio considera aparência, capa/menu e opções, inclusive carregamento com erro. Os três registram pendências na proteção de navegação e fechamento. Alternar abas preserva componentes montados e rascunhos.

## Validação e limites

Testes cobrem catálogo, distâncias, assinatura visual, contraste, busca/filtros/favoritos/paginação, prévia, persistência, salvamentos separados e proteção de navegação. A revisão visual no Chromium incluiu 1440×1000, 1440×900 e 390×844: galeria, personalização, prévia do app e cardápio em celular/tablet.

Este ambiente não possui configuração de Supabase. O app foi revisado com o modo de edição e catálogo local existentes. Os testes visuais de salvar o cardápio substituíram repositórios apenas na memória do navegador, sem backend externo. Persistência de produção, upload remoto e dispositivos físicos precisam de homologação com a configuração do estabelecimento.

`npm run build` recusa produção sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`; essa proteção foi mantida. A compilação foi verificada com `vite build --mode development` e os três bundles de servidor definidos no script de build. Nenhum deploy foi executado.
