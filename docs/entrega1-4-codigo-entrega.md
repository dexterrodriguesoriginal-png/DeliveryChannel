# Código de entrega — revisão 1.4

A configuração persistida é `tenant_modules.config.require_delivery_code`,
desligada por padrão e lida apenas quando `dine_in` está habilitado.
`set_salon_delivery_code_required` permite alteração somente pelo proprietário.
O trigger `salon_order_create_delivery_code` gera um código por nova rodada;
ligar a opção não cria códigos retroativos para pedidos feitos quando desligada.

A falha reproduzida estava na apresentação: `get_my_tab` devolve os códigos das
rodadas da conta para a sessão aprovada, mas o acompanhamento filtrava somente
`mine !== false`. Pedidos feitos por outro integrante ou pela equipe ficavam
fora da bolha. Além disso, a bolha mostrava somente o primeiro pedido em
andamento, que pode ser uma rodada anterior sem código. O código das demais
rodadas ficava escondido em “Minha conta”.

O cardápio agora destaca os códigos ativos imediatamente abaixo do cabeçalho,
com o pedido e a rodada correspondentes. A bolha, o acompanhamento e a conta
usam “Seu código de entrega: 1234 - informe ao garçom”. A interface exige sessão
aprovada antes de mostrar códigos em qualquer desses locais; a autorização
definitiva continua em `get_my_tab`, sem leitura direta da tabela privada.

Sem alteração no banco ou nova permissão: o servidor continua validando código
por pedido, liberação pelo balcão e limite persistente de cinco tentativas.
O campo do garçom depende da exigência da própria rodada, mesmo após desligar
a opção; confirmação com código bloqueia “Não recebi”.

`supabase/tests/entrega1_4/delivery_codes.sql` cobre o caminho real
setter → `submit_round` → trigger → projeção aprovada, rodadas de outro
integrante (`mine=false`), ausência de códigos retroativos, isolamento,
confirmação e bloqueio após cinco erros.
