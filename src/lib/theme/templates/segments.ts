/**
 * 25 Segmentos Comerciais do Ecossistema DeliveryChannel
 * Cada segmento inclui metadados, ícone e 4 produtos de demonstração contextuais.
 */

export interface SampleProduct {
  name: string;
  description: string;
  price: string;
  emoji: string;
}

export interface SegmentDefinition {
  id: string;
  label: string;
  icon: string;
  sampleProducts: [SampleProduct, SampleProduct, SampleProduct, SampleProduct];
}

export const SEGMENTS: SegmentDefinition[] = [
  {
    id: 'adega',
    label: 'Adega e Vinhos',
    icon: 'Wine',
    sampleProducts: [
      { name: 'Vinho Tinto Cabernet Sauvignon Reserva', description: 'Safra especial maturada 12 meses em barricas de carvalho francês.', price: 'R$ 89,90', emoji: '🍷' },
      { name: 'Espumante Brut Tradicional 750ml', description: 'Perlage fina e persistente com notas cítricas e florais refrescantes.', price: 'R$ 64,50', emoji: '🍾' },
      { name: 'Cerveja Artesanal IPA Puro Malte', description: 'Lupulada e aromática com amargor equilibrado e notas tropicais.', price: 'R$ 18,90', emoji: '🍺' },
      { name: 'Tábua de Queijos Selecionados e Frios', description: 'Gouda, brie, salame italiano e castanhas nobres para harmonização.', price: 'R$ 52,00', emoji: '🧀' },
    ],
  },
  {
    id: 'padaria',
    label: 'Padaria e Confeitaria',
    icon: 'Croissant',
    sampleProducts: [
      { name: 'Pão Francês Tradicional (kg)', description: 'Crocante por fora, miolo macio e quentinho a qualquer hora do dia.', price: 'R$ 19,90', emoji: '🥖' },
      { name: 'Croissant Francês com Manteiga', description: 'Massa folhada artesanal com manteiga de primeira e textura perfeita.', price: 'R$ 12,50', emoji: '🥐' },
      { name: 'Bolo Caseiro de Cenoura com Chocolate', description: 'Massa fofinha coberta com calda cremosa de chocolate meio amargo.', price: 'R$ 28,00', emoji: '🍰' },
      { name: 'Café com Leite Pingado 300ml', description: 'Café coado na hora combinado com leite vaporizado cremoso.', price: 'R$ 7,50', emoji: '☕' },
    ],
  },
  {
    id: 'hamburgueria',
    label: 'Hamburgueria Artesanal',
    icon: 'Utensils',
    sampleProducts: [
      { name: 'Smash Burger Duplo Cheddar & Bacon', description: 'Dois blends 100g prensados na chapa, queijo cheddar inglês e fatias crocantes de bacon.', price: 'R$ 36,90', emoji: '🍔' },
      { name: 'Burger Clássico com Brioche Dourado', description: 'Blend 160g bovino, queijo prato derretido, alface fresca, tomate e maionese da casa.', price: 'R$ 32,50', emoji: '🍔' },
      { name: 'Batata Rústica com Alecrim e Páprica', description: 'Batatas selecionadas crocantes acompanhadas de maionese verde artesanal.', price: 'R$ 18,90', emoji: '🍟' },
      { name: 'Milk-shake Cremoso de Nutella 400ml', description: 'Sorvete de baunilha batido com creme de avelã autêntico e chantilly.', price: 'R$ 22,00', emoji: '🥤' },
    ],
  },
  {
    id: 'pizzaria',
    label: 'Pizzaria Forno a Lenha',
    icon: 'Pizza',
    sampleProducts: [
      { name: 'Pizza Calabresa Especial com Cebola Roxa', description: 'Molho pelati artesanal, calabresa fatiada fina, cebola roxa e azeitonas pretas.', price: 'R$ 58,90', emoji: '🍕' },
      { name: 'Pizza Margherita DOC com Manjericão', description: 'Mussarela de búfala fresca, fatias de tomate caipira e folhas frescas de manjericão.', price: 'R$ 64,00', emoji: '🍕' },
      { name: 'Pizza Quatro Queijos Gratinada', description: 'Mussarela, gorgonzola cremoso, provolone defumado e catupiry original.', price: 'R$ 68,90', emoji: '🧀' },
      { name: 'Calzone Recheado com Ricota e Presunto', description: 'Massa crocante assada na lenha com recheio cremoso e generoso.', price: 'R$ 44,50', emoji: '🥟' },
    ],
  },
  {
    id: 'acai',
    label: 'Açaí e Sorvetes',
    icon: 'IceCream',
    sampleProducts: [
      { name: 'Tigela Açaí Puro Especial 500ml', description: 'Açaí cremoso batido com guaraná natural, granola crocante e fatias de banana.', price: 'R$ 24,90', emoji: '🍧' },
      { name: 'Copo Açaí Turbinado com Leite Ninho 400ml', description: 'Camadas generosas de açaí, morango picado, leite condensado e leite em pó.', price: 'R$ 26,50', emoji: '🍓' },
      { name: 'Smoothie Energético Açaí & Blueberry', description: 'Bebida refrescante batida na hora com iogurte desnatado e mel puro.', price: 'R$ 16,90', emoji: '🥤' },
      { name: 'Barca de Açaí para Compartilhar 1L', description: 'Serve até 3 pessoas com 6 complementos inclusos à sua escolha.', price: 'R$ 59,90', emoji: '🍨' },
    ],
  },
  {
    id: 'mercado',
    label: 'Mercado e Hortifrúti',
    icon: 'ShoppingBasket',
    sampleProducts: [
      { name: 'Cesta Hortifrúti Orgânica da Semana', description: 'Mix de legumes, verduras e frutas frescas colhidas diretamente do produtor.', price: 'R$ 49,90', emoji: '🍎' },
      { name: 'Banana Prata Selecionada (kg)', description: 'Frutas maduras no ponto certo, perfeitas para lanches saudáveis diários.', price: 'R$ 8,99', emoji: '🍌' },
      { name: 'Arroz Integral Grão Nobre Tipo 1 (1kg)', description: 'Rico em fibras e nutrientes para uma alimentação equilibrada.', price: 'R$ 9,49', emoji: '🌾' },
      { name: 'Azeite de Oliva Extra Virgem 500ml', description: 'Prensado a frio com acidez máxima de 0,2%, importado e aromático.', price: 'R$ 38,90', emoji: '🫒' },
    ],
  },
  {
    id: 'doceria',
    label: 'Doceria e Bolos',
    icon: 'Cake',
    sampleProducts: [
      { name: 'Torta Red Velvet com Cream Cheese', description: 'Massa aveludada vermelha intercalada com recheio cremoso de baunilha.', price: 'R$ 78,00', emoji: '🎂' },
      { name: 'Brigadeiro Gourmet Belga (Caixa com 6)', description: 'Confeccionados à mão com chocolate Callebaut 54% cacau.', price: 'R$ 24,00', emoji: '🍫' },
      { name: 'Fatia Bolo Vulcão Ninho com Nutella', description: 'Bolo de chocolate macio com cascata transbordante de leite ninho.', price: 'R$ 16,90', emoji: '🍰' },
      { name: 'Macarons Franceses Sortidos (4 un)', description: 'Docinhos crocantes com ganaches de pistache, frutas vermelhas e caramelo.', price: 'R$ 22,50', emoji: '🍬' },
    ],
  },
  {
    id: 'peixaria',
    label: 'Peixaria e Frutos do Mar',
    icon: 'Fish',
    sampleProducts: [
      { name: 'Filé de Salmão Fresco Premium (500g)', description: 'Corte nobre com pele limpa, ideal para grelhar ou preparar sashimi.', price: 'R$ 59,90', emoji: '🐟' },
      { name: 'Camarão Rosa Limpo e Descascado (400g)', description: 'Camarões selecionados tamanho médio, prontos para frigideira ou moqueca.', price: 'R$ 48,00', emoji: '🦐' },
      { name: 'Filé de Tilápia Congelada Rápida (1kg)', description: 'Carne branca tenra e suave com garantia de frescor e congelamento IQF.', price: 'R$ 39,90', emoji: '🐠' },
      { name: 'Lula em Anéis Limpa para Empanar (500g)', description: 'Textura macia garantida para petiscos e pratos à beira-mar.', price: 'R$ 34,50', emoji: '🦑' },
    ],
  },
  {
    id: 'japonesa',
    label: 'Culinária Japonesa',
    icon: 'Soup',
    sampleProducts: [
      { name: 'Combo Sushi & Sashimi Especial (24 peças)', description: 'Variedade de lâminas de salmão, atum, niguiris maçaricados e uramakis.', price: 'R$ 79,90', emoji: '🍣' },
      { name: 'Hot Roll de Salmão com Cream Cheese (8 un)', description: 'Rolinho empanado crocante servido quente com molho teriyaki especial.', price: 'R$ 28,00', emoji: '🍱' },
      { name: 'Temaki Especial Salmão Completo', description: 'Cone de alga nori crocante recheado com cubos de salmão fresco e cebolinha.', price: 'R$ 29,90', emoji: '🍙' },
      { name: 'Yakisoba Misto Tradicional Individual', description: 'Macarrão oriental com tiras de filé mignon, peito de frango e legumes salteados.', price: 'R$ 38,50', emoji: '🍜' },
    ],
  },
  {
    id: 'cafeteria',
    label: 'Cafeteria Especial',
    icon: 'Coffee',
    sampleProducts: [
      { name: 'Espresso Duplo Grãos Bourbon Amarelo', description: 'Extração curta com crema aveludada, notas de caramelo e acidez equilibrada.', price: 'R$ 9,50', emoji: '☕' },
      { name: 'Cappuccino Italiano com Canela e Cacau', description: 'Dose de espresso, leite vaporizado aveludado e polvilhado aromático.', price: 'R$ 13,90', emoji: '☕' },
      { name: 'Toast de Pão de Fermentação com Avocado', description: 'Fatia rústica tostada, pasta de avocado temperada, tomate cereja e sementes.', price: 'R$ 24,00', emoji: '🥑' },
      { name: 'Cookie Quentinho com Gotas de Chocolate', description: 'Assado diariamente com manteiga noisette e recheio cremoso.', price: 'R$ 11,00', emoji: '🍪' },
    ],
  },
  {
    id: 'churrascaria',
    label: 'Churrascaria e Espetaria',
    icon: 'Flame',
    sampleProducts: [
      { name: 'Picanha Bovina Fatiada na Brasa (500g)', description: 'Carne macia com capa de gordura dourada no fogo forte e sal grosso.', price: 'R$ 84,90', emoji: '🥩' },
      { name: 'Espeto Tradicional de Alcatra com Bacon', description: 'Cubos suculentos grelhados no ponto certo acompanhados de farofa crocante.', price: 'R$ 14,90', emoji: '🍢' },
      { name: 'Costela Suína com Barbecue Defumado', description: 'Assada lentamente por 6 horas até soltar do osso com facilidade.', price: 'R$ 56,00', emoji: '🍖' },
      { name: 'Pão de Alho Cremoso com Quatro Queijos', description: 'Grelhado na brasa até ficar dourado e com recheio borbulhante.', price: 'R$ 11,50', emoji: '🥖' },
    ],
  },
  {
    id: 'lanchonete',
    label: 'Lanchonete e Hot Dog',
    icon: 'Sandwich',
    sampleProducts: [
      { name: 'Hot Dog Prensado Especial Completo', description: 'Duas salsichas, purê de batata caseiro, milho, vinagrete, batata palha e queijo.', price: 'R$ 19,90', emoji: '🌭' },
      { name: 'X-Salada Tradicional de Lanchonete', description: 'Hambúrguer, queijo derretido, presunto, alface americana, tomate e maionese.', price: 'R$ 22,00', emoji: '🍔' },
      { name: 'Coxinha Dourada com Frango e Catupiry', description: 'Massa cremosa de caldo de galinha com recheio farto e casquinha estaladiça.', price: 'R$ 9,50', emoji: '🍗' },
      { name: 'Suco Natural de Laranja Espremido 500ml', description: 'Fruta fresca espremida na hora sem adição de água ou conservantes.', price: 'R$ 11,00', emoji: '🍊' },
    ],
  },
  {
    id: 'sorveteria',
    label: 'Sorveteria Artesanal',
    icon: 'IceCream2',
    sampleProducts: [
      { name: 'Gelato Italiano Pistache di Bronte (Pote 500ml)', description: 'Textura ultracremosa feita com pasta pura de pistache e leite integral.', price: 'R$ 44,90', emoji: '🍨' },
      { name: 'Picolé Frutas Tropicais Manga com Maracujá', description: 'Produzido 100% à base de fruta pura fresca sem corantes artificiais.', price: 'R$ 8,00', emoji: '🍦' },
      { name: 'Taça Sundae com Calda Quente de Fudge', description: 'Duas bolas de sorvete, castanhas tostadas, chantilly e cereja.', price: 'R$ 23,50', emoji: '🍧' },
      { name: 'Milk-shake Maltado Ovomaltine Crocante', description: 'Batido cremoso com pedaços crocantes e borda de chocolate.', price: 'R$ 21,90', emoji: '🥤' },
    ],
  },
  {
    id: 'marmitaria',
    label: 'Marmitaria e Comida Caseira',
    icon: 'Soup',
    sampleProducts: [
      { name: 'Marmita Executiva Bife a Cavalo e Fritas', description: 'Arroz soltinho, feijão carioquinha caseiro, bife acebolado com ovo frito e batata.', price: 'R$ 24,90', emoji: '🍲' },
      { name: 'Feijoada Completa Individual com Couve e Farofa', description: 'Feijão preto com carnes nobres defumadas, vinagrete fresco e laranja fatiada.', price: 'R$ 32,00', emoji: '🍛' },
      { name: 'Frango Ensopado com Polenta Cremosa', description: 'Cozimento lento com tempero de mãe e molho encorpado aromatizado.', price: 'R$ 22,50', emoji: '🍗' },
      { name: 'Filé de Tilápia Grelhada com Legumes ao Vapor', description: 'Opção leve e nutritiva com cenoura, brócolis e arroz integral.', price: 'R$ 27,00', emoji: '🥗' },
    ],
  },
  {
    id: 'saudavel',
    label: 'Comida Saudável e Fit',
    icon: 'Salad',
    sampleProducts: [
      { name: 'Bowl Tropical Salmão Poke com Edamame', description: 'Arroz japonês, salmão fresco em cubos, manga, gergelim e molho ponzu.', price: 'R$ 42,90', emoji: '🥗' },
      { name: 'Salada Caesar com Tiras de Frango Grelhado', description: 'Mix de folhas verdes crocantes, croutons integrais, parmesão e molho leve.', price: 'R$ 29,90', emoji: '🥬' },
      { name: 'Wrap Integral Frango com Ricota e Rúcula', description: 'Massa fina integral tostada na chapa com recheio leve e suculento.', price: 'R$ 21,50', emoji: '🌯' },
      { name: 'Suco Verde Detox Antioxidante 400ml', description: 'Couve orgânica, maçã verde, gengibre, limão e água de coco natural.', price: 'R$ 13,00', emoji: '🍏' },
    ],
  },
  {
    id: 'mexicana',
    label: 'Culinária Mexicana',
    icon: 'UtensilsCrossed',
    sampleProducts: [
      { name: 'Combo Tacos Crocantes de Carne Louca (3 un)', description: 'Tortilhas de milho recheadas com carne desfiada temperada, cheddar e pico de gallo.', price: 'R$ 38,90', emoji: '🌮' },
      { name: 'Burrito San Diego com Guacamole e Feijão', description: 'Tortilha de trigo macia enrolada com frango marinado, sour cream e arroz mexicano.', price: 'R$ 34,00', emoji: '🌯' },
      { name: 'Nachos Supremos com Molho Cheddar e Jalapeño', description: 'Tortilhas crocantes cobertas com queijo fundido cremoso e pimenta suave.', price: 'R$ 32,50', emoji: '🧀' },
      { name: 'Quesadilla Queijo Monterey Jack e Cogumelos', description: 'Chapa quente dobrada até o queijo esticar generosamente.', price: 'R$ 26,90', emoji: '🫓' },
    ],
  },
  {
    id: 'conveniencia',
    label: 'Conveniência e Bebidas',
    icon: 'Package',
    sampleProducts: [
      { name: 'Pack Cerveja Pilsen Lata 350ml (6 unidades)', description: 'Lata trincando de gelada com entrega expressa imediata.', price: 'R$ 27,90', emoji: '🍺' },
      { name: 'Energético Regular Lata 473ml', description: 'Bebida funcional revigorante com taurina e cafeína para o seu dia.', price: 'R$ 11,50', emoji: '⚡' },
      { name: 'Snack de Batata Frita Tubo 100g', description: 'Batatas crocantes temperadas perfeitas para acompanhar qualquer momento.', price: 'R$ 13,90', emoji: '🥔' },
      { name: 'Saco de Gelo Filtrado em Cubos (5kg)', description: 'Cubos sólidos transparentes para manter suas bebidas sempre resfriadas.', price: 'R$ 14,00', emoji: '🧊' },
    ],
  },
  {
    id: 'distribuidora',
    label: 'Distribuidora (Bebidas, Gás e Água)',
    icon: 'Truck',
    sampleProducts: [
      { name: 'Galão de Água Mineral Mineralizada 20L', description: 'Água pura e límpida de fonte natural com retorno de embalagem limpa.', price: 'R$ 16,00', emoji: '💧' },
      { name: 'Botijão de Gás GLP P13 (Recarga)', description: 'Gás de cozinha certificado com lacre de segurança e entrega ágil.', price: 'R$ 108,00', emoji: '🔥' },
      { name: 'Fardo de Refrigerante Guaraná 2L (6 garrafas)', description: 'Ideal para abastecer festas, reuniões de família ou comércio.', price: 'R$ 48,90', emoji: '🥤' },
      { name: 'Carvão Vegetal Ecológico para Churrasco (3kg)', description: 'Acendimento rápido, brasas duradouras e baixa emissão de fumaça.', price: 'R$ 19,50', emoji: '🪵' },
    ],
  },
  {
    id: 'farmacia',
    label: 'Farmácia e Drogaria',
    icon: 'Cross',
    sampleProducts: [
      { name: 'Protetor Solar Facial Toque Seco FPS 60', description: 'Fórmula dermatológica não oleosa com alta proteção UVA/UVB.', price: 'R$ 54,90', emoji: '🧴' },
      { name: 'Kit Primeiros Socorros e Curativos (20 un)', description: 'Curativos adesivos respiráveis e flexíveis com ação antisséptica.', price: 'R$ 12,90', emoji: '🩹' },
      { name: 'Suplemento Vitamínico C + Zinco Efervescente', description: 'Reforço para a imunidade diária em comprimidos de dissolução rápida.', price: 'R$ 18,50', emoji: '💊' },
      { name: 'Sabonete Líquido Neutro Hipoalergênico 400ml', description: 'Limpeza suave para peles sensíveis com extrato natural de camomila.', price: 'R$ 22,00', emoji: '🧼' },
    ],
  },
  {
    id: 'pet',
    label: 'Pet Shop e Agropecuária',
    icon: 'Dog',
    sampleProducts: [
      { name: 'Ração Super Premium Cães Adultos Frango (3kg)', description: 'Nutrição completa balanceada para pelagem brilhante e saúde digestiva.', price: 'R$ 79,90', emoji: '🐕' },
      { name: 'Sachê Alimento Úmido Gatos Salmão (85g)', description: 'Pedaços suculentos em molho irresistível para hidratação felina.', price: 'R$ 4,50', emoji: '🐈' },
      { name: 'Shampoo Hipoalergênico Pet Pelos Claros 500ml', description: 'Deixa os pelos macios, desembaraçados e com suave perfume duradouro.', price: 'R$ 29,90', emoji: '🛁' },
      { name: 'Brinquedo Mordedor Resistente com Apito', description: 'Borracha atóxica durável que auxilia na limpeza dos dentes do animal.', price: 'R$ 19,00', emoji: '🦴' },
    ],
  },
  {
    id: 'perfumaria',
    label: 'Perfumaria e Cosméticos',
    icon: 'Sparkles',
    sampleProducts: [
      { name: 'Eau de Parfum Floral Marcante 100ml', description: 'Fragrância sofisticada com notas de jasmin, bergamota e baunilha sedosa.', price: 'R$ 149,00', emoji: '✨' },
      { name: 'Sérum Facial Ácido Hialurônico Concentrado', description: 'Hidratação profunda antissinais com textura leve de rápida absorção.', price: 'R$ 68,00', emoji: '💧' },
      { name: 'Batom Líquido Matte Longa Duração', description: 'Pigmentação intensa com acabamento aveludado que não resseca os lábios.', price: 'R$ 34,90', emoji: '💄' },
      { name: 'Máscara Capilar Nutritiva Óleo de Argan 250g', description: 'Tratamento reparador profundo para cabelos ressecados e quebradiços.', price: 'R$ 42,00', emoji: '🧴' },
    ],
  },
  {
    id: 'tabacaria',
    label: 'Tabacaria e Headshop',
    icon: 'Flame',
    sampleProducts: [
      { name: 'Charuto Nacional Premium Feito à Mão', description: 'Envelhecido em cedro com aroma amadeirado suave e fumo selecionado.', price: 'R$ 38,00', emoji: '🍂' },
      { name: 'Seda Brown Papel Ultrafino Sem Cloro (50 folhas)', description: 'Combustão lenta e queima uniforme com goma natural arábica.', price: 'R$ 7,50', emoji: '📄' },
      { name: 'Isqueiro Recarregável Maçarico com Trava', description: 'Chama resistente ao vento ideal para acendimento homogêneo e seguro.', price: 'R$ 22,00', emoji: '🔥' },
      { name: 'Cinzeiro Decorativo de Vidro Temperado', description: 'Design elegante e fácil de higienizar com ranhuras de apoio.', price: 'R$ 25,00', emoji: '🏺' },
    ],
  },
  {
    id: 'floricultura',
    label: 'Floricultura e Plantas',
    icon: 'Flower',
    sampleProducts: [
      { name: 'Buquê Luxo 12 Rosas Vermelhas Nacionais', description: 'Arranjo com folhas de eucalipto frescas e embalagem em papel kraft.', price: 'R$ 89,00', emoji: '🌹' },
      { name: 'Orquídea Phalaenopsis Branca em Vaso Cerâmica', description: 'Planta de alta durabilidade com flores exuberantes para presentear.', price: 'R$ 65,00', emoji: '🌸' },
      { name: 'Vaso com Suculenta e Cacto Decorativo', description: 'Espécie rústica de baixa manutenção ideal para mesas e escritórios.', price: 'R$ 22,00', emoji: '🌵' },
      { name: 'Adubo Orgânico Líquido Concentrado 500ml', description: 'Nutrientes equilibrados para estimular a floração e o verde das folhas.', price: 'R$ 19,90', emoji: '🌿' },
    ],
  },
  {
    id: 'barbearia',
    label: 'Barbearia Clássica',
    icon: 'Scissors',
    sampleProducts: [
      { name: 'Corte de Cabelo Masculino Degradê Navalhado', description: 'Atendimento com visagismo, acabamento a navalha e lavagem completa.', price: 'R$ 45,00', emoji: '✂️' },
      { name: 'Barba Terapia com Toalha Quente e Óleos', description: 'Tratamento relaxante com esfoliação, alinhamento de fios e loção pós-barba.', price: 'R$ 38,00', emoji: '🪒' },
      { name: 'Pomada Modeladora Efeito Matte Seco 80g', description: 'Fixação forte o dia todo sem brilho para penteados estruturados.', price: 'R$ 32,00', emoji: '💈' },
      { name: 'Óleo Hidratante para Barba Amadeirado 30ml', description: 'Amacia os fios, reduz o frizz e hidrata a pele embaixo da barba.', price: 'R$ 28,50', emoji: '🧔' },
    ],
  },
  {
    id: 'salao',
    label: 'Salão de Beleza e Estética',
    icon: 'Sparkle',
    sampleProducts: [
      { name: 'Escova Modelada com Tratamento de Brilho', description: 'Lavagem nutritiva, massagem capilar e finalização polida com protetor térmico.', price: 'R$ 55,00', emoji: '💇‍♀️' },
      { name: 'Manicure e Pedicure Spa com Esfoliação', description: 'Cutilagem cuidadosa, hidratação profunda e esmaltação impecável.', price: 'R$ 48,00', emoji: '💅' },
      { name: 'Design de Sobrancelhas com Aplicação de Henna', description: 'Alinhamento dos fios respeitando o desenho natural do rosto.', price: 'R$ 35,00', emoji: '👁️' },
      { name: 'Limpeza de Pele Profunda com Extração', description: 'Remoção de impurezas, vapor de ozônio e máscara calmante regeneradora.', price: 'R$ 95,00', emoji: '💆‍♀️' },
    ],
  },
];
