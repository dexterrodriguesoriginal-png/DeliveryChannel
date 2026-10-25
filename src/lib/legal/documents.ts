export const LEGAL_VERSION = '2026-10-24.1';
export const LEGAL_DATE = '24/10/2026';
export type LegalAudience = 'owner' | 'customer';
export type LegalDocument =
  | 'terms-owner'
  | 'terms-customer'
  | 'privacy'
  | 'cookies';
export const legalDocuments: Record<
  LegalDocument,
  { title: string; sections: { h: string; p: string }[] }
> = {
  'terms-owner': {
    title: 'Termos de Uso — Lojista',
    sections: [
      {
        h: 'Serviço e acesso',
        p: 'O Delivery Channel oferece catálogo, pedidos e gestão para sua loja, conforme plano contratado e módulos habilitados. Proteja suas credenciais e conceda à equipe somente o acesso necessário. É proibido acessar dados de outras lojas ou usar o serviço para fins ilícitos.',
      },
      {
        h: 'Responsabilidades da loja',
        p: 'O lojista responde pela legalidade, qualidade, disponibilidade e descrição dos produtos, preços, tributos, atendimento, entregas, cancelamentos e reembolsos de suas vendas, respeitando os direitos do consumidor. Valores e condições devem ser apresentados antes da compra.',
      },
      {
        h: 'Dados e comunicação',
        p: 'Use os dados dos clientes somente para as finalidades informadas, com acesso restrito. Marketing exige autorização separada e revogável; o aceite destes termos não autoriza publicidade. Não tente identificar autores dos relatos de Voz do cliente.',
      },
      {
        h: 'Pagamentos online e proteção de dados',
        p: 'Ao conectar Mercado Pago, PagBank ou InfinitePay, a loja recebe diretamente em sua própria conta. Esses prestadores processam pagamentos como operadores quando agem sob instruções e como controladores independentes nas atividades que determinam, como prevenção a fraude e obrigações regulatórias, conforme seus contratos e avisos de privacidade. A finalidade é cobrar e confirmar a compra; a base legal é a execução de contrato (LGPD, art. 7º, V). Enviamos somente os dados necessários: nome e e-mail quando exigidos, e CPF/CNPJ apenas se o provedor exigir para PIX. Cartões são informados exclusivamente no checkout hospedado do provedor; a plataforma não guarda número, CVV ou validade.',
      },
      {
        h: 'Retenção financeira e desconexão',
        p: 'Registros mínimos de pagamento são conservados por 5 anos para cumprimento de obrigações fiscais (LGPD, art. 7º, II), contados da confirmação do pagamento ou da criação quando não confirmado; depois o vínculo identificável é removido. Na exclusão efetiva da conta do cliente, o vínculo pessoal é anonimizado, preservando valor e data. Tokens OAuth, de renovação, autorizações pendentes e credenciais de webhook são apagados imediatamente na transação de desconexão ou exclusão da loja. A desconexão interrompe a confirmação automática de cobranças pendentes; confira-as no provedor. Os prestadores têm seus próprios prazos e canais para direitos do titular.',
      },
      {
        h: 'Planos e encerramento',
        p: 'Preços e limites seguem a oferta contratada. Solicitações sobre assinatura, suporte e encerramento devem ser feitas pelos canais da plataforma disponíveis no painel. Obrigações legais e direitos de acesso aos dados continuam aplicáveis ao encerrar o serviço.',
      },
      {
        h: 'Atualizações',
        p: 'Uma nova versão será apresentada para reaceite antes de continuar o uso autenticado. A versão aceita e a data/hora são registradas no servidor.',
      },
    ],
  },
  'terms-customer': {
    title: 'Termos de Uso — Cliente',
    sections: [
      {
        h: 'Conta e serviço',
        p: 'O Delivery Channel conecta você à loja responsável pelo catálogo e atendimento. Informe dados corretos e proteja sua conta. O catálogo e o envio de sugestões, elogios e reclamações podem ser acessados sem login; comprar exige autenticação.',
      },
      {
        h: 'Compra, entrega e pagamento',
        p: 'Confira itens, valores, descontos, taxa, endereço e forma de pagamento antes de confirmar. A loja é responsável pelos produtos e cumprimento da oferta. Códigos de entrega devem ser compartilhados somente ao receber o pedido.',
      },
      {
        h: 'Atendimento e cancelamento',
        p: 'Use a Ajuda do pedido ou o contato público da loja para solicitar suporte, cancelamento, troca ou reembolso, conforme a legislação de consumo aplicável. Estes termos não limitam seus direitos legais.',
      },
      {
        h: 'Voz do cliente',
        p: 'Os relatos são exibidos à loja sem identificação do remetente e apenas com o dia do envio. Não inclua nome, telefone, email, número de pedido ou outros detalhes que permitam reconhecer você. O limite de envios é de cinco por dia por loja, por usuário e rede, para prevenir spam.',
      },
      {
        h: 'Atualizações',
        p: 'Mudanças de versão exigem novo aceite. Marketing é uma escolha separada e opcional, que pode ser revogada no perfil.',
      },
    ],
  },
  privacy: {
    title: 'Política de Privacidade',
    sections: [
      {
        h: 'Dados e finalidades',
        p: 'Tratamos dados cadastrais, de autenticação, contato, endereço, pedidos e preferências para executar o serviço e cumprir obrigações legais. CPF e localização são utilizados quando fornecidos e necessários ao recurso. Registros de segurança ajudam a prevenir fraude e abuso.',
      },
      {
        h: 'Responsáveis e compartilhamento',
        p: 'A plataforma trata os dados necessários à operação e segurança do serviço. Cada loja responde pelo tratamento ligado às suas vendas e atendimento. Compartilhamos com a loja, entregadores e fornecedores de infraestrutura apenas o necessário às respectivas funções. O contato da loja está disponível em Sobre a loja; questões da plataforma podem ser encaminhadas ao suporte no painel.',
      },
      {
        h: 'Pagamentos e prestadores',
        p: 'Mercado Pago, PagBank e InfinitePay recebem apenas os dados necessários à cobrança e confirmação da compra, com base na execução de contrato (LGPD, art. 7º, V). Nome e e-mail são enviados somente quando necessários; CPF/CNPJ é encaminhado apenas se exigido para PIX. Eles atuam como operadores quando seguem instruções e como controladores independentes para tratamentos próprios, incluindo segurança, prevenção a fraude e obrigações regulatórias, segundo seus avisos de privacidade. Os dados do cartão são preenchidos somente no checkout hospedado pelo provedor: a plataforma nunca armazena número, CVV ou validade. Não persistimos o payload bruto de webhooks; apenas identificadores técnicos, status, valor e método necessários à conciliação. Os logs do fluxo de pagamentos não contêm dados pessoais, documentos, tokens ou corpos de requisição.',
      },
      {
        h: 'Retenção de pagamentos e exclusão',
        p: 'Conservamos registros financeiros mínimos por 5 anos para obrigação fiscal, com base no cumprimento de obrigação legal (LGPD, art. 7º, II). O prazo conta da confirmação do pagamento ou da criação se não confirmado. Após esse prazo, removemos os vínculos com pedido, loja e provedor e os dados de acesso ao pagamento, mantendo registros financeiros anonimizados. A exclusão efetiva da conta do cliente anonimiza antes disso seu vínculo pessoal em pagamentos, mantendo valor e data. Tokens OAuth e de renovação são eliminados imediatamente ao desconectar a conta de pagamentos ou excluir a loja. Pedidos de exclusão não eliminam a obrigação de manter os registros financeiros; os prestadores respondem pelos dados sob seu próprio controle.',
      },
      {
        h: 'Feedback e anonimato',
        p: 'Não vinculamos o feedback a cadastro, pedido ou dados de contato. O servidor usa hashes com chave secreta, separados por loja e dia, para controlar spam por conta e rede; IP e identidade não são armazenados no feedback. Donos e gerentes recebem conteúdo e dia, sem hashes ou horários. A diretoria recebe apenas contagens por loja. Evite se identificar no texto livre.',
      },
      {
        h: 'Marketing',
        p: 'O aceite dos termos não inclui publicidade. Mensagens promocionais da loja exigem opt-in separado em Perfil > Permissão para contato; a escolha pode ser revogada a qualquer momento.',
      },
      {
        h: 'Retenção e proteção',
        p: 'Restringimos o acesso por função e loja. Dados de conta são mantidos durante a prestação do serviço e pelo prazo necessário a obrigações legais, defesa de direitos e segurança. Pedidos de exclusão são avaliados para apagar ou anonimizar dados, preservando registros exigidos por lei. Contadores diários de spam expiram; os hashes do feedback não permitem recuperar o remetente sem a chave secreta.',
      },
      {
        h: 'Seus direitos',
        p: 'Em Perfil > Meus dados, baixe seus dados em JSON ou solicite exclusão pelo fluxo existente. Corrija seu cadastro em Dados da conta. Você também pode solicitar informações, oposição, revisão e revogação de consentimentos pelo suporte. A exclusão pode exigir validação da identidade e respeita a retenção legal.',
      },
      {
        h: 'Versões',
        p: 'Registramos a versão e o horário do aceite no servidor. Uma alteração da versão exige reaceite. A exportação inclui os seus registros de aceite e consentimentos.',
      },
    ],
  },
  cookies: {
    title: 'Política de Cookies',
    sections: [
      {
        h: 'Essenciais',
        p: 'Cookies e armazenamento local essenciais mantêm a sessão segura, a sacola, os endereços, favoritos, preferências e sua escolha de cookies. São necessários para os recursos solicitados e não são usados para autorizar marketing.',
      },
      {
        h: 'Analíticos opcionais',
        p: 'Recursos analíticos opcionais permanecem desativados até você aceitar. É possível usar o aplicativo apenas com os essenciais. Nenhum rastreador analítico adicional é carregado por este banner.',
      },
      {
        h: 'Alterar escolha',
        p: 'Use Preferências de cookies no rodapé para aceitar ou revogar os analíticos. A preferência fica neste navegador; limpe os dados do site para removê-la. A escolha de cookies é independente da permissão para contato da loja.',
      },
    ],
  },
};
export function legalSignupMetadata(
  accepted: boolean,
  audience: LegalAudience,
) {
  if (!accepted)
    throw new Error(
      'Aceite os Termos de Uso e a Política de Privacidade para criar sua conta.',
    );
  return {
    legal_accepted: true,
    legal_version: LEGAL_VERSION,
    legal_audience: audience,
  };
}
