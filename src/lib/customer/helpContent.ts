/** Conteúdo da Ajuda (FAQ) do app do cliente. Texto revisável; valores de taxa conforme migration 1700. */
export interface FaqItem { id: string; q: string; a: string }
export interface FaqSection { id: string; title: string; items: FaqItem[] }

export const FAQ_SECTIONS: FaqSection[] = [
  {
    id: 'pagamentos',
    title: 'Pagamentos',
    items: [
      { id: 'formas', q: 'Quais formas de pagamento posso usar?', a: 'Você escolhe na hora de finalizar: PIX, cartão de crédito ou débito (na entrega/retirada, na maquininha da loja) e dinheiro. As opções exatas dependem da loja.' },
      { id: 'troco', q: 'Como peço troco?', a: 'Escolha "Dinheiro" e informe para quanto precisa de troco. O valor aparece para a loja e para o entregador.' },
      { id: 'pix', q: 'Paguei com PIX e o pedido não mudou de status. E agora?', a: 'A confirmação do PIX pode levar alguns minutos. Se demorar, toque em "Ajuda com este pedido" e fale com a loja pelo WhatsApp com o comprovante.' },
    ],
  },
  {
    id: 'taxas',
    title: 'Taxas de entrega',
    items: [
      { id: 'quanto', q: 'Quanto custa a entrega?', a: 'A entrega tem um valor fixo de R$ 7,00, dividido assim: R$ 3,50 pagos por você e R$ 3,50 pagos pela loja. O entregador recebe os R$ 7,00 completos. Não existe taxa de serviço escondida.' },
      { id: 'gratis', q: 'Por que às vezes a entrega aparece grátis?', a: 'Quando a loja decide oferecer entrega grátis, ela paga os R$ 7,00 inteiros. Para você, a taxa fica R$ 0,00.' },
      { id: 'retirada', q: 'E se eu retirar na loja?', a: 'Na retirada não há taxa de entrega. Algumas lojas ainda dão um desconto extra para quem retira.' },
    ],
  },
  {
    id: 'cupons',
    title: 'Cupons',
    items: [
      { id: 'usar', q: 'Como uso um cupom?', a: 'Na sacola ou na tela de finalizar, digite o código no campo "Cupom de desconto" e toque em Aplicar. Em "Meus cupons" você vê os cupons disponíveis desta loja.' },
      { id: 'invalido', q: 'Meu cupom não funcionou.', a: 'Confira o pedido mínimo, a validade e se o cupom vale para itens em promoção. Alguns cupons valem só para a primeira compra ou têm quantidade limitada.' },
    ],
  },
  {
    id: 'codigo',
    title: 'Código de entrega',
    items: [
      { id: 'oque', q: 'O que é o código de entrega?', a: 'É um código de 4 dígitos que aparece no seu pedido quando ele sai para entrega. Você só informa ao entregador quando receber o pedido em mãos. Ele é novo a cada pedido, o que deixa a entrega mais segura.' },
      { id: 'naoapareceu', q: 'O código não apareceu.', a: 'O código aparece na aba Pedidos assim que o pedido sai para entrega. Atualize a tela ou fale com a loja.' },
    ],
  },
  {
    id: 'conta',
    title: 'Conta e dados',
    items: [
      { id: 'dados', q: 'Como altero meu nome, CPF ou telefone?', a: 'Vá em Perfil > Conta > Dados da conta. O telefone é usado pela loja para falar com você sobre o pedido.' },
      { id: 'excluir', q: 'Como excluo minha conta?', a: 'Em Perfil > Configurações > Excluir minha conta. Seus dados pessoais são anonimizados; o histórico fiscal dos pedidos é mantido pelo prazo exigido por lei.' },
    ],
  },
];

export const LEGAL_REVIEW_NOTE = 'Texto provisório, pendente de revisão jurídica.';

export const TERMS_OF_USE: Array<{ h: string; p: string }> = [
  { h: '1. Sobre o Delivery Channel', p: 'O Delivery Channel é uma plataforma que permite a estabelecimentos comerciais oferecerem seu próprio aplicativo de pedidos. O estabelecimento é o responsável pelos produtos, preços, preparo e atendimento do seu pedido.' },
  { h: '2. Sua conta', p: 'Você é responsável pelas informações que fornece e por manter seu acesso seguro. Uma conta Delivery Channel pode ser usada em diferentes estabelecimentos parceiros.' },
  { h: '3. Pedidos e pagamentos', p: 'Os valores exibidos são confirmados pelo servidor no momento do pedido. Pagamentos na entrega/retirada são feitos diretamente ao estabelecimento. Cupons e promoções seguem as regras definidas por cada loja.' },
  { h: '4. Entrega', p: 'A taxa de entrega é fixa e informada antes da confirmação. O código de entrega deve ser informado apenas quando você receber o pedido.' },
  { h: '5. Cancelamentos', p: 'Pedidos podem ser cancelados pela loja quando não puderem ser atendidos. Em caso de dúvidas, use a Ajuda do pedido para falar com o estabelecimento.' },
  { h: '6. Alterações', p: 'Estes termos podem ser atualizados. Avisaremos no aplicativo quando houver mudanças relevantes.' },
];

export const PRIVACY_POLICY: Array<{ h: string; p: string }> = [
  { h: '1. Dados que coletamos', p: 'Nome, e-mail, telefone/WhatsApp, CPF (opcional), endereços de entrega e localização aproximada quando você permite, além do histórico de pedidos.' },
  { h: '2. Para que usamos', p: 'Para processar e entregar seus pedidos, permitir que a loja fale com você, prevenir fraudes e melhorar o aplicativo. Não vendemos seus dados.' },
  { h: '3. Com quem compartilhamos', p: 'Com o estabelecimento do seu pedido e com o entregador (somente o necessário para a entrega, como nome, endereço e telefone).' },
  { h: '4. Dados no seu aparelho', p: 'Endereços salvos, favoritos e preferências podem ficar guardados no seu aparelho para agilizar seus próximos pedidos. Você pode apagá-los a qualquer momento.' },
  { h: '5. Seus direitos (LGPD)', p: 'Você pode acessar, corrigir e pedir a exclusão dos seus dados pessoais. Em Perfil > Configurações > Excluir minha conta você solicita a anonimização. Registros de pedidos podem ser mantidos pelo prazo exigido por lei, sem identificar você.' },
  { h: '6. Contato', p: 'Dúvidas sobre privacidade podem ser enviadas pelo canal de Ajuda do aplicativo.' },
];
