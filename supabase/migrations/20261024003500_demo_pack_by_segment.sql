-- Pacote demo por segmento. Arquivo para revisão; não aplicar automaticamente.
-- Fonte canônica dos dados: src/lib/demoPacks/packs.json.
-- Nenhum UPDATE/DELETE de catálogo existente ocorre na migration.
BEGIN;

-- Estas colunas já existem desde 20260926000012; preservá-las também no rollback.
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenant_settings ADD COLUMN demo_pack_reviewed boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.tenant_settings.demo_pack_reviewed IS
    'Escolha do dono sobre o pacote demo concluída. Lojas preexistentes permanecem dispensadas.';

-- O trigger anterior inseria adega antes de existir OWNER. O novo create RPC
-- faz o seed do segmento escolhido depois do vínculo, na mesma transação.
DROP TRIGGER IF EXISTS trg_auto_seed_demo_catalog ON public.tenants;
REVOKE ALL ON FUNCTION public.seed_tenant_demo_catalog(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._seed_tenant_demo_catalog_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_seed_tenant_demo_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_demo_catalog_for_current_tenant(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._demo_pack_is_valid(p_segment text, p_pack jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_item jsonb;
    v_items jsonb;
    v_ids text[] := ARRAY[]::text[];
BEGIN
    IF pg_catalog.jsonb_typeof(p_pack) IS DISTINCT FROM 'object'
       OR p_pack->>'segment' IS DISTINCT FROM p_segment
       OR p_segment !~ '^[a-z]+(-[a-z]+)*$'
       OR pg_catalog.jsonb_typeof(p_pack->'categories') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_typeof(p_pack->'products') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_typeof(p_pack->'offers') IS DISTINCT FROM 'array' THEN
        RETURN false;
    END IF;
    IF pg_catalog.jsonb_array_length(p_pack->'categories') NOT BETWEEN 4 AND 8
       OR pg_catalog.jsonb_array_length(p_pack->'products') NOT BETWEEN 8 AND 20
       OR pg_catalog.jsonb_array_length(p_pack->'offers') NOT BETWEEN 2 AND 3 THEN
        RETURN false;
    END IF;
    v_items := (p_pack->'categories') || (p_pack->'products') || (p_pack->'offers');
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_items) LOOP
        IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object'
           OR COALESCE(v_item->>'id', '') = ''
           OR (v_item->>'id') = ANY(v_ids)
           OR COALESCE(v_item->>'image', '') NOT LIKE '/demo/' || p_segment || '/%'
           OR COALESCE(v_item->>'description', '') = '' THEN
            RETURN false;
        END IF;
        v_ids := pg_catalog.array_append(v_ids, v_item->>'id');
    END LOOP;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_pack->'categories') LOOP
        IF COALESCE(v_item->>'name', '') = '' THEN RETURN false; END IF;
    END LOOP;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_pack->'products') LOOP
        IF COALESCE(v_item->>'name', '') = ''
           OR pg_catalog.jsonb_typeof(v_item->'price') IS DISTINCT FROM 'number' THEN
            RETURN false;
        END IF;
        IF (v_item->>'price')::numeric <= 0 OR (v_item->>'price')::numeric > 100000
           OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_pack->'categories') c
                          WHERE c->>'id' = v_item->>'categoryId') THEN
            RETURN false;
        END IF;
    END LOOP;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_pack->'offers') LOOP
        IF COALESCE(v_item->>'title', '') = ''
           OR pg_catalog.jsonb_typeof(v_item->'originalPrice') IS DISTINCT FROM 'number'
           OR pg_catalog.jsonb_typeof(v_item->'promotionalPrice') IS DISTINCT FROM 'number' THEN
            RETURN false;
        END IF;
        IF (v_item->>'promotionalPrice')::numeric <= 0
           OR (v_item->>'originalPrice')::numeric < (v_item->>'promotionalPrice')::numeric
           OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_pack->'products') p
                          WHERE p->>'id' = v_item->>'productId'
                            AND (p->>'price')::numeric = (v_item->>'originalPrice')::numeric) THEN
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._demo_pack_is_valid(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Catálogo de referência global, somente leitura pela API. Payload nunca vem do cliente.
CREATE TABLE public.demo_pack_items (
    segment text PRIMARY KEY,
    payload jsonb NOT NULL,
    CONSTRAINT demo_pack_items_valid CHECK (public._demo_pack_is_valid(segment, payload))
);
ALTER TABLE public.demo_pack_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_pack_items_read ON public.demo_pack_items
    FOR SELECT TO authenticated USING (true);
REVOKE ALL ON TABLE public.demo_pack_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.demo_pack_items TO authenticated;

-- Ledger privado de elegibilidade/idempotência. Sem acesso direto pela API e sem
-- backfill: editar/remover um demo nunca permite que seed o recrie ou duplique.
CREATE TABLE public.demo_pack_onboardings (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    segment text NOT NULL REFERENCES public.demo_pack_items(segment) ON DELETE RESTRICT,
    seeded_at timestamptz
);
ALTER TABLE public.demo_pack_onboardings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.demo_pack_onboardings FROM PUBLIC, anon, authenticated;

-- Demos não representam estoque real: saldo zero, sem lançamento fictício no
-- ledger append-only. O guard depende do ledger PRIVADO ainda pendente, que só
-- existe dentro do create/seed atômico. is_demo do cliente, sozinho, jamais pula
-- o estoque. Saldo positivo sempre segue o lançamento original de fase 1.
CREATE FUNCTION public._demo_pack_product_opening_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.is_demo AND NEW.stock_quantity = 0 AND EXISTS (
        SELECT 1 FROM public.demo_pack_onboardings d
        WHERE d.tenant_id = NEW.tenant_id AND d.seeded_at IS NULL
    ) THEN
        RETURN NEW;
    END IF;
    -- Mesmo lançamento da função stock original, que permanece intocada.
    INSERT INTO public.inventory_movements
        (tenant_id, product_id, product_name, quantity, type, reason, previous_stock, new_stock,
         created_by_name, location_id, unit, actor_user_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.name, NEW.stock_quantity, 'OPENING_BALANCE',
            'Saldo inicial do produto', NEW.stock_quantity, NEW.stock_quantity,
            'Cadastro de produto', public._stock_default_location(NEW.tenant_id), NEW.stock_unit, auth.uid());
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._demo_pack_product_opening_balance() FROM PUBLIC, anon, authenticated;
DROP TRIGGER stock_product_opening_balance ON public.products;
CREATE TRIGGER stock_product_opening_balance AFTER INSERT ON public.products
    FOR EACH ROW EXECUTE FUNCTION public._demo_pack_product_opening_balance();

INSERT INTO public.demo_pack_items (segment, payload)
SELECT value->>'segment', value
FROM pg_catalog.jsonb_array_elements($demo_packs$
[{"segment":"adega","label":"Adega","categories":[{"id":"adega-category-1","name":"Cervejas","description":"Rótulos leves e artesanais para diferentes ocasiões.","image":"/demo/adega/placeholder.svg"},{"id":"adega-category-2","name":"Vinhos","description":"Vinhos tintos e brancos para apreciar e presentear.","image":"/demo/adega/placeholder.svg"},{"id":"adega-category-3","name":"Destilados","description":"Destilados para servir puros ou em coquetéis.","image":"/demo/adega/placeholder.svg"},{"id":"adega-category-4","name":"Bebidas sem álcool","description":"Opções refrescantes para acompanhar seu pedido.","image":"/demo/adega/placeholder.svg"}],"products":[{"id":"adega-product-1","categoryId":"adega-category-1","name":"Cerveja pilsen 350 ml","description":"Cerveja clara de sabor leve, em lata individual.","price":5.9,"image":"/demo/adega/placeholder.svg"},{"id":"adega-product-2","categoryId":"adega-category-1","name":"Cerveja artesanal IPA 500 ml","description":"Cerveja com notas cítricas e amargor marcante.","price":19.9,"image":"/demo/adega/placeholder.svg"},{"id":"adega-product-3","categoryId":"adega-category-2","name":"Vinho tinto seco 750 ml","description":"Vinho tinto com notas de frutas vermelhas.","price":44.9,"image":"/demo/adega/placeholder.svg"},{"id":"adega-product-4","categoryId":"adega-category-2","name":"Vinho branco seco 750 ml","description":"Vinho branco leve com aroma frutado.","price":42.9,"image":"/demo/adega/placeholder.svg"},{"id":"adega-product-5","categoryId":"adega-category-3","name":"Gin London Dry 750 ml","description":"Gin com zimbro e botânicos para seus coquetéis.","price":69.9,"image":"/demo/adega/placeholder.svg"},{"id":"adega-product-6","categoryId":"adega-category-3","name":"Whisky blended 1 L","description":"Whisky com notas de madeira e final suave.","price":99.9,"image":"/demo/adega/placeholder.svg"},{"id":"adega-product-7","categoryId":"adega-category-4","name":"Refrigerante de cola 2 L","description":"Refrigerante em garrafa para compartilhar.","price":11.9,"image":"/demo/adega/placeholder.svg"},{"id":"adega-product-8","categoryId":"adega-category-4","name":"Água mineral 500 ml","description":"Água mineral sem gás em garrafa individual.","price":3.5,"image":"/demo/adega/placeholder.svg"}],"offers":[{"id":"adega-offer-1","productId":"adega-product-1","title":"Oferta: Cerveja pilsen 350 ml","subtitle":"Experimente por R$ 5,31","description":"Conheça cerveja pilsen 350 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":5.9,"promotionalPrice":5.31,"image":"/demo/adega/placeholder.svg"},{"id":"adega-offer-2","productId":"adega-product-5","title":"Oferta: Gin London Dry 750 ml","subtitle":"Experimente por R$ 62,91","description":"Conheça gin london dry 750 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":69.9,"promotionalPrice":62.91,"image":"/demo/adega/placeholder.svg"}]},{"segment":"pizzaria","label":"Pizzaria","categories":[{"id":"pizzaria-category-1","name":"Pizzas tradicionais","description":"Sabores clássicos em pizzas grandes de oito fatias.","image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-category-2","name":"Pizzas especiais","description":"Combinações especiais com ingredientes selecionados.","image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-category-3","name":"Pizzas doces","description":"Pizzas para encerrar a refeição com uma sobremesa.","image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-category-4","name":"Bebidas","description":"Bebidas para acompanhar a pizza da família.","image":"/demo/pizzaria/placeholder.svg"}],"products":[{"id":"pizzaria-product-1","categoryId":"pizzaria-category-1","name":"Pizza de muçarela grande","description":"Molho de tomate, muçarela, tomate e orégano. Oito fatias.","price":49.9,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-product-2","categoryId":"pizzaria-category-1","name":"Pizza de calabresa grande","description":"Molho de tomate, calabresa fatiada, cebola e azeitonas. Oito fatias.","price":52.9,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-product-3","categoryId":"pizzaria-category-2","name":"Pizza de frango com requeijão","description":"Frango desfiado, requeijão cremoso e muçarela. Oito fatias.","price":59.9,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-product-4","categoryId":"pizzaria-category-2","name":"Pizza quatro queijos grande","description":"Muçarela, provolone, parmesão e requeijão. Oito fatias.","price":62.9,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-product-5","categoryId":"pizzaria-category-3","name":"Pizza de chocolate pequena","description":"Chocolate ao leite e granulado em massa fina. Quatro fatias.","price":29.9,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-product-6","categoryId":"pizzaria-category-3","name":"Pizza de banana com canela","description":"Banana, leite condensado e canela. Quatro fatias.","price":27.9,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-product-7","categoryId":"pizzaria-category-4","name":"Refrigerante de guaraná 2 L","description":"Garrafa de refrigerante de guaraná para compartilhar.","price":11.9,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-product-8","categoryId":"pizzaria-category-4","name":"Suco de uva integral 1 L","description":"Suco integral de uva sem adição de açúcar.","price":18.9,"image":"/demo/pizzaria/placeholder.svg"}],"offers":[{"id":"pizzaria-offer-1","productId":"pizzaria-product-1","title":"Oferta: Pizza de muçarela grande","subtitle":"Experimente por R$ 44,91","description":"Conheça pizza de muçarela grande com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":49.9,"promotionalPrice":44.91,"image":"/demo/pizzaria/placeholder.svg"},{"id":"pizzaria-offer-2","productId":"pizzaria-product-5","title":"Oferta: Pizza de chocolate pequena","subtitle":"Experimente por R$ 26,91","description":"Conheça pizza de chocolate pequena com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":29.9,"promotionalPrice":26.91,"image":"/demo/pizzaria/placeholder.svg"}]},{"segment":"padaria","label":"Padaria","categories":[{"id":"padaria-category-1","name":"Pães","description":"Pães para o café da manhã e os lanches do dia.","image":"/demo/padaria/placeholder.svg"},{"id":"padaria-category-2","name":"Salgados","description":"Salgados assados e fritos em porções individuais.","image":"/demo/padaria/placeholder.svg"},{"id":"padaria-category-3","name":"Bolos e doces","description":"Receitas doces para acompanhar seu café.","image":"/demo/padaria/placeholder.svg"},{"id":"padaria-category-4","name":"Café da manhã","description":"Bebidas e lanches preparados na hora.","image":"/demo/padaria/placeholder.svg"}],"products":[{"id":"padaria-product-1","categoryId":"padaria-category-1","name":"Pão francês — 5 unidades","description":"Pacote com cinco pães franceses de aproximadamente 50 g cada.","price":5.5,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-product-2","categoryId":"padaria-category-1","name":"Pão de forma artesanal 450 g","description":"Pão macio fatiado, preparado com fermentação lenta.","price":14.9,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-product-3","categoryId":"padaria-category-2","name":"Coxinha de frango","description":"Salgado individual com massa de batata e recheio de frango.","price":7.5,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-product-4","categoryId":"padaria-category-2","name":"Empada de palmito","description":"Massa amanteigada com recheio cremoso de palmito.","price":8.9,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-product-5","categoryId":"padaria-category-3","name":"Bolo de cenoura — fatia","description":"Fatia de bolo de cenoura com cobertura de chocolate.","price":8.5,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-product-6","categoryId":"padaria-category-3","name":"Sonho de creme","description":"Massa macia recheada com creme de confeiteiro.","price":7.9,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-product-7","categoryId":"padaria-category-4","name":"Café coado 180 ml","description":"Café coado na hora, servido em copo individual.","price":4.5,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-product-8","categoryId":"padaria-category-4","name":"Misto quente","description":"Pão de forma tostado com presunto e muçarela.","price":11.9,"image":"/demo/padaria/placeholder.svg"}],"offers":[{"id":"padaria-offer-1","productId":"padaria-product-1","title":"Oferta: Pão francês — 5 unidades","subtitle":"Experimente por R$ 4,95","description":"Conheça pão francês — 5 unidades com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":5.5,"promotionalPrice":4.95,"image":"/demo/padaria/placeholder.svg"},{"id":"padaria-offer-2","productId":"padaria-product-5","title":"Oferta: Bolo de cenoura — fatia","subtitle":"Experimente por R$ 7,65","description":"Conheça bolo de cenoura — fatia com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":8.5,"promotionalPrice":7.65,"image":"/demo/padaria/placeholder.svg"}]},{"segment":"mercado","label":"Mercado","categories":[{"id":"mercado-category-1","name":"Mercearia","description":"Itens essenciais para a despensa.","image":"/demo/mercado/placeholder.svg"},{"id":"mercado-category-2","name":"Hortifruti","description":"Frutas e verduras para o dia a dia.","image":"/demo/mercado/placeholder.svg"},{"id":"mercado-category-3","name":"Frios e laticínios","description":"Opções refrigeradas para refeições e lanches.","image":"/demo/mercado/placeholder.svg"},{"id":"mercado-category-4","name":"Limpeza","description":"Produtos para os cuidados com a casa.","image":"/demo/mercado/placeholder.svg"}],"products":[{"id":"mercado-product-1","categoryId":"mercado-category-1","name":"Arroz branco 5 kg","description":"Arroz branco tipo 1 em pacote de cinco quilos.","price":27.9,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-product-2","categoryId":"mercado-category-1","name":"Feijão carioca 1 kg","description":"Feijão carioca selecionado para o preparo diário.","price":8.9,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-product-3","categoryId":"mercado-category-2","name":"Banana-prata — bandeja 1 kg","description":"Bandeja de banana-prata com peso aproximado de um quilo.","price":7.9,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-product-4","categoryId":"mercado-category-2","name":"Tomate — bandeja 500 g","description":"Tomates selecionados em bandeja de aproximadamente 500 g.","price":4.9,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-product-5","categoryId":"mercado-category-3","name":"Leite integral 1 L","description":"Leite UHT integral em embalagem de um litro.","price":5.49,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-product-6","categoryId":"mercado-category-3","name":"Queijo muçarela fatiado 200 g","description":"Muçarela fatiada em embalagem de duzentos gramas.","price":12.9,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-product-7","categoryId":"mercado-category-4","name":"Detergente neutro 500 ml","description":"Detergente líquido para lavar louças e utensílios.","price":2.49,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-product-8","categoryId":"mercado-category-4","name":"Sabão em pó 800 g","description":"Sabão em pó para a lavagem de roupas.","price":11.9,"image":"/demo/mercado/placeholder.svg"}],"offers":[{"id":"mercado-offer-1","productId":"mercado-product-1","title":"Oferta: Arroz branco 5 kg","subtitle":"Experimente por R$ 25,11","description":"Conheça arroz branco 5 kg com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":27.9,"promotionalPrice":25.11,"image":"/demo/mercado/placeholder.svg"},{"id":"mercado-offer-2","productId":"mercado-product-5","title":"Oferta: Leite integral 1 L","subtitle":"Experimente por R$ 4,94","description":"Conheça leite integral 1 l com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":5.49,"promotionalPrice":4.94,"image":"/demo/mercado/placeholder.svg"}]},{"segment":"barbearia","label":"Barbearia","categories":[{"id":"barbearia-category-1","name":"Cortes","description":"Cortes masculinos para diferentes estilos.","image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-category-2","name":"Barba","description":"Serviços de cuidado e acabamento da barba.","image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-category-3","name":"Combos","description":"Serviços combinados para uma visita completa.","image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-category-4","name":"Finalizadores","description":"Produtos para manter o visual em casa.","image":"/demo/barbearia/placeholder.svg"}],"products":[{"id":"barbearia-product-1","categoryId":"barbearia-category-1","name":"Corte clássico","description":"Corte com tesoura e máquina, com acabamento na nuca.","price":40.0,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-product-2","categoryId":"barbearia-category-1","name":"Corte degradê","description":"Corte com transição gradual e acabamento detalhado.","price":45.0,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-product-3","categoryId":"barbearia-category-2","name":"Barba completa","description":"Modelagem da barba com toalha quente e finalização.","price":35.0,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-product-4","categoryId":"barbearia-category-2","name":"Acabamento de barba","description":"Alinhamento dos contornos e ajuste do comprimento.","price":20.0,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-product-5","categoryId":"barbearia-category-3","name":"Combo corte e barba","description":"Corte clássico e barba completa na mesma visita.","price":65.0,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-product-6","categoryId":"barbearia-category-3","name":"Combo degradê e sobrancelha","description":"Corte degradê com alinhamento das sobrancelhas.","price":55.0,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-product-7","categoryId":"barbearia-category-4","name":"Pomada modeladora 80 g","description":"Pomada de fixação média com acabamento fosco.","price":29.9,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-product-8","categoryId":"barbearia-category-4","name":"Óleo para barba 30 ml","description":"Óleo cosmético para hidratar os fios da barba.","price":24.9,"image":"/demo/barbearia/placeholder.svg"}],"offers":[{"id":"barbearia-offer-1","productId":"barbearia-product-1","title":"Oferta: Corte clássico","subtitle":"Experimente por R$ 36,00","description":"Conheça corte clássico com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":40.0,"promotionalPrice":36.0,"image":"/demo/barbearia/placeholder.svg"},{"id":"barbearia-offer-2","productId":"barbearia-product-5","title":"Oferta: Combo corte e barba","subtitle":"Experimente por R$ 58,50","description":"Conheça combo corte e barba com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":65.0,"promotionalPrice":58.5,"image":"/demo/barbearia/placeholder.svg"}]},{"segment":"salao-beleza","label":"Salão de beleza","categories":[{"id":"salao-beleza-category-1","name":"Cabelos","description":"Cortes e escovas para renovar o visual.","image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-category-2","name":"Tratamentos capilares","description":"Cuidados para diferentes necessidades dos fios.","image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-category-3","name":"Unhas","description":"Serviços de manicure e pedicure.","image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-category-4","name":"Beleza","description":"Serviços para destacar sua beleza.","image":"/demo/salao-beleza/placeholder.svg"}],"products":[{"id":"salao-beleza-product-1","categoryId":"salao-beleza-category-1","name":"Corte feminino","description":"Corte personalizado com lavagem e finalização simples.","price":65.0,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-product-2","categoryId":"salao-beleza-category-1","name":"Escova — cabelo médio","description":"Lavagem e escova modelada para cabelo de comprimento médio.","price":55.0,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-product-3","categoryId":"salao-beleza-category-2","name":"Hidratação capilar","description":"Lavagem e aplicação de máscara hidratante com finalização simples.","price":70.0,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-product-4","categoryId":"salao-beleza-category-2","name":"Nutrição capilar","description":"Tratamento nutritivo com máscara de óleos vegetais.","price":85.0,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-product-5","categoryId":"salao-beleza-category-3","name":"Manicure tradicional","description":"Cuidados com as unhas das mãos e esmaltação tradicional.","price":30.0,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-product-6","categoryId":"salao-beleza-category-3","name":"Pedicure tradicional","description":"Cuidados com as unhas dos pés e esmaltação tradicional.","price":35.0,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-product-7","categoryId":"salao-beleza-category-4","name":"Design de sobrancelhas","description":"Modelagem das sobrancelhas respeitando o formato do rosto.","price":35.0,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-product-8","categoryId":"salao-beleza-category-4","name":"Maquiagem social","description":"Preparação de pele e maquiagem para ocasiões especiais.","price":120.0,"image":"/demo/salao-beleza/placeholder.svg"}],"offers":[{"id":"salao-beleza-offer-1","productId":"salao-beleza-product-1","title":"Oferta: Corte feminino","subtitle":"Experimente por R$ 58,50","description":"Conheça corte feminino com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":65.0,"promotionalPrice":58.5,"image":"/demo/salao-beleza/placeholder.svg"},{"id":"salao-beleza-offer-2","productId":"salao-beleza-product-5","title":"Oferta: Manicure tradicional","subtitle":"Experimente por R$ 27,00","description":"Conheça manicure tradicional com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":30.0,"promotionalPrice":27.0,"image":"/demo/salao-beleza/placeholder.svg"}]},{"segment":"perfumaria","label":"Perfumaria","categories":[{"id":"perfumaria-category-1","name":"Perfumes","description":"Fragrâncias para o dia a dia e ocasiões especiais.","image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-category-2","name":"Cuidados com a pele","description":"Itens para a rotina de cuidados pessoais.","image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-category-3","name":"Cabelos","description":"Produtos para limpeza e cuidado dos cabelos.","image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-category-4","name":"Maquiagem","description":"Itens para compor sua maquiagem.","image":"/demo/perfumaria/placeholder.svg"}],"products":[{"id":"perfumaria-product-1","categoryId":"perfumaria-category-1","name":"Colônia floral 100 ml","description":"Colônia com notas florais leves e fundo adocicado.","price":69.9,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-product-2","categoryId":"perfumaria-category-1","name":"Colônia amadeirada 100 ml","description":"Colônia com notas amadeiradas e toque cítrico.","price":79.9,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-product-3","categoryId":"perfumaria-category-2","name":"Hidratante corporal 200 ml","description":"Loção corporal de uso diário com textura leve.","price":24.9,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-product-4","categoryId":"perfumaria-category-2","name":"Sabonete líquido facial 150 ml","description":"Sabonete suave para a limpeza diária do rosto.","price":22.9,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-product-5","categoryId":"perfumaria-category-3","name":"Shampoo hidratante 300 ml","description":"Shampoo para a limpeza suave dos fios.","price":19.9,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-product-6","categoryId":"perfumaria-category-3","name":"Condicionador nutritivo 300 ml","description":"Condicionador para desembaraçar e amaciar os cabelos.","price":21.9,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-product-7","categoryId":"perfumaria-category-4","name":"Batom cremoso nude","description":"Batom de acabamento cremoso em tom nude.","price":18.9,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-product-8","categoryId":"perfumaria-category-4","name":"Máscara para cílios preta","description":"Máscara preta para definição dos cílios.","price":29.9,"image":"/demo/perfumaria/placeholder.svg"}],"offers":[{"id":"perfumaria-offer-1","productId":"perfumaria-product-1","title":"Oferta: Colônia floral 100 ml","subtitle":"Experimente por R$ 62,91","description":"Conheça colônia floral 100 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":69.9,"promotionalPrice":62.91,"image":"/demo/perfumaria/placeholder.svg"},{"id":"perfumaria-offer-2","productId":"perfumaria-product-5","title":"Oferta: Shampoo hidratante 300 ml","subtitle":"Experimente por R$ 17,91","description":"Conheça shampoo hidratante 300 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":19.9,"promotionalPrice":17.91,"image":"/demo/perfumaria/placeholder.svg"}]},{"segment":"hot-dog","label":"Hot dog","categories":[{"id":"hot-dog-category-1","name":"Clássicos","description":"Cachorros-quentes tradicionais preparados na hora.","image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-category-2","name":"Especiais","description":"Receitas com recheios e coberturas especiais.","image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-category-3","name":"Acompanhamentos","description":"Porções para complementar seu lanche.","image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-category-4","name":"Bebidas","description":"Bebidas para acompanhar seu cachorro-quente.","image":"/demo/hot-dog/placeholder.svg"}],"products":[{"id":"hot-dog-product-1","categoryId":"hot-dog-category-1","name":"Hot dog tradicional","description":"Pão macio, salsicha, molho de tomate, milho e batata palha.","price":14.9,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-product-2","categoryId":"hot-dog-category-1","name":"Hot dog duplo","description":"Pão macio, duas salsichas, molho, milho e batata palha.","price":18.9,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-product-3","categoryId":"hot-dog-category-2","name":"Hot dog com cheddar e bacon","description":"Salsicha, cheddar cremoso, bacon e batata palha.","price":22.9,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-product-4","categoryId":"hot-dog-category-2","name":"Hot dog de frango","description":"Frango desfiado, requeijão, milho e batata palha.","price":21.9,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-product-5","categoryId":"hot-dog-category-3","name":"Batata frita pequena 150 g","description":"Porção de batata frita crocante com sal.","price":10.9,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-product-6","categoryId":"hot-dog-category-3","name":"Anéis de cebola — 8 unidades","description":"Porção de anéis de cebola empanados e fritos.","price":14.9,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-product-7","categoryId":"hot-dog-category-4","name":"Refrigerante de cola lata 350 ml","description":"Refrigerante de cola em lata individual.","price":6.0,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-product-8","categoryId":"hot-dog-category-4","name":"Suco de laranja 300 ml","description":"Suco de laranja preparado para acompanhar o lanche.","price":8.9,"image":"/demo/hot-dog/placeholder.svg"}],"offers":[{"id":"hot-dog-offer-1","productId":"hot-dog-product-1","title":"Oferta: Hot dog tradicional","subtitle":"Experimente por R$ 13,41","description":"Conheça hot dog tradicional com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":14.9,"promotionalPrice":13.41,"image":"/demo/hot-dog/placeholder.svg"},{"id":"hot-dog-offer-2","productId":"hot-dog-product-5","title":"Oferta: Batata frita pequena 150 g","subtitle":"Experimente por R$ 9,81","description":"Conheça batata frita pequena 150 g com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":10.9,"promotionalPrice":9.81,"image":"/demo/hot-dog/placeholder.svg"}]},{"segment":"espetinho","label":"Espetinho","categories":[{"id":"espetinho-category-1","name":"Espetos de carne","description":"Espetos de carne preparados na brasa.","image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-category-2","name":"Espetos especiais","description":"Opções especiais para variar seu pedido.","image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-category-3","name":"Acompanhamentos","description":"Porções para completar a refeição.","image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-category-4","name":"Bebidas","description":"Bebidas para acompanhar os espetos.","image":"/demo/espetinho/placeholder.svg"}],"products":[{"id":"espetinho-product-1","categoryId":"espetinho-category-1","name":"Espetinho bovino","description":"Cubos de carne bovina temperada e assada na brasa.","price":12.0,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-product-2","categoryId":"espetinho-category-1","name":"Espetinho de frango","description":"Cubos de peito de frango com tempero da casa.","price":10.0,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-product-3","categoryId":"espetinho-category-2","name":"Espetinho de queijo coalho","description":"Queijo coalho dourado na brasa com orégano.","price":10.0,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-product-4","categoryId":"espetinho-category-2","name":"Espetinho de kafta","description":"Carne moída temperada com ervas e especiarias.","price":12.0,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-product-5","categoryId":"espetinho-category-3","name":"Porção de mandioca 300 g","description":"Mandioca frita em porção para compartilhar.","price":19.9,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-product-6","categoryId":"espetinho-category-3","name":"Farofa da casa 150 g","description":"Farofa de mandioca com cebola e cheiro-verde.","price":7.0,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-product-7","categoryId":"espetinho-category-4","name":"Refrigerante de guaraná 350 ml","description":"Refrigerante de guaraná em lata individual.","price":6.0,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-product-8","categoryId":"espetinho-category-4","name":"Água mineral 500 ml","description":"Água mineral sem gás em garrafa individual.","price":3.5,"image":"/demo/espetinho/placeholder.svg"}],"offers":[{"id":"espetinho-offer-1","productId":"espetinho-product-1","title":"Oferta: Espetinho bovino","subtitle":"Experimente por R$ 10,80","description":"Conheça espetinho bovino com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":12.0,"promotionalPrice":10.8,"image":"/demo/espetinho/placeholder.svg"},{"id":"espetinho-offer-2","productId":"espetinho-product-5","title":"Oferta: Porção de mandioca 300 g","subtitle":"Experimente por R$ 17,91","description":"Conheça porção de mandioca 300 g com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":19.9,"promotionalPrice":17.91,"image":"/demo/espetinho/placeholder.svg"}]},{"segment":"tabacaria","label":"Tabacaria","categories":[{"id":"tabacaria-category-1","name":"Acessórios","description":"Acessórios de uso adulto para organização e transporte.","image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-category-2","name":"Isqueiros","description":"Isqueiros e itens de reposição.","image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-category-3","name":"Narguilé","description":"Acessórios de reposição para narguilé.","image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-category-4","name":"Cuidados e limpeza","description":"Itens para limpeza e conservação de acessórios.","image":"/demo/tabacaria/placeholder.svg"}],"products":[{"id":"tabacaria-product-1","categoryId":"tabacaria-category-1","name":"Porta-acessórios metálico","description":"Estojo metálico compacto para organizar pequenos acessórios.","price":29.9,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-product-2","categoryId":"tabacaria-category-1","name":"Bandeja organizadora pequena","description":"Bandeja metálica de apoio e organização, 18 por 14 cm.","price":24.9,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-product-3","categoryId":"tabacaria-category-2","name":"Isqueiro recarregável","description":"Isqueiro de bolso recarregável. Produto de uso adulto.","price":19.9,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-product-4","categoryId":"tabacaria-category-2","name":"Carga de gás para isqueiro 300 ml","description":"Refil de gás para isqueiros compatíveis. Uso adulto.","price":24.9,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-product-5","categoryId":"tabacaria-category-3","name":"Mangueira lavável para narguilé","description":"Mangueira de silicone lavável com ponteira removível.","price":49.9,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-product-6","categoryId":"tabacaria-category-3","name":"Piteiras descartáveis — 50 unidades","description":"Pacote com ponteiras individuais para narguilé.","price":14.9,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-product-7","categoryId":"tabacaria-category-4","name":"Escova de limpeza longa","description":"Escova flexível para higienizar tubos e acessórios.","price":12.9,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-product-8","categoryId":"tabacaria-category-4","name":"Kit de vedação de silicone","description":"Conjunto de anéis de silicone para acessórios compatíveis.","price":16.9,"image":"/demo/tabacaria/placeholder.svg"}],"offers":[{"id":"tabacaria-offer-1","productId":"tabacaria-product-1","title":"Oferta: Porta-acessórios metálico","subtitle":"Experimente por R$ 26,91","description":"Conheça porta-acessórios metálico com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":29.9,"promotionalPrice":26.91,"image":"/demo/tabacaria/placeholder.svg"},{"id":"tabacaria-offer-2","productId":"tabacaria-product-5","title":"Oferta: Mangueira lavável para narguilé","subtitle":"Experimente por R$ 44,91","description":"Conheça mangueira lavável para narguilé com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":49.9,"promotionalPrice":44.91,"image":"/demo/tabacaria/placeholder.svg"}]},{"segment":"hamburgueria","label":"Hamburgueria","categories":[{"id":"hamburgueria-category-1","name":"Hambúrgueres","description":"Hambúrgueres preparados na chapa com pão macio.","image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-category-2","name":"Especiais","description":"Receitas especiais com combinações da casa.","image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-category-3","name":"Acompanhamentos","description":"Porções para completar seu pedido.","image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-category-4","name":"Bebidas","description":"Bebidas e sobremesas para acompanhar seu lanche.","image":"/demo/hamburgueria/placeholder.svg"}],"products":[{"id":"hamburgueria-product-1","categoryId":"hamburgueria-category-1","name":"Cheeseburger clássico","description":"Pão brioche, hambúrguer bovino de 150 g, queijo e molho da casa.","price":24.9,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-product-2","categoryId":"hamburgueria-category-1","name":"Hambúrguer salada","description":"Pão brioche, carne de 150 g, queijo, alface e tomate.","price":27.9,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-product-3","categoryId":"hamburgueria-category-2","name":"Hambúrguer bacon","description":"Carne de 180 g, queijo, bacon crocante e maionese da casa.","price":34.9,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-product-4","categoryId":"hamburgueria-category-2","name":"Hambúrguer vegetariano","description":"Hambúrguer de grão-de-bico, queijo, alface e molho de ervas.","price":29.9,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-product-5","categoryId":"hamburgueria-category-3","name":"Batata frita 200 g","description":"Porção individual de batata frita com sal.","price":13.9,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-product-6","categoryId":"hamburgueria-category-3","name":"Batata com cheddar e bacon","description":"Batata frita coberta com cheddar cremoso e bacon. Porção de 300 g.","price":24.9,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-product-7","categoryId":"hamburgueria-category-4","name":"Milk-shake de chocolate 400 ml","description":"Bebida cremosa de sorvete com calda de chocolate.","price":19.9,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-product-8","categoryId":"hamburgueria-category-4","name":"Refrigerante de guaraná 350 ml","description":"Refrigerante de guaraná em lata individual.","price":6.0,"image":"/demo/hamburgueria/placeholder.svg"}],"offers":[{"id":"hamburgueria-offer-1","productId":"hamburgueria-product-1","title":"Oferta: Cheeseburger clássico","subtitle":"Experimente por R$ 22,41","description":"Conheça cheeseburger clássico com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":24.9,"promotionalPrice":22.41,"image":"/demo/hamburgueria/placeholder.svg"},{"id":"hamburgueria-offer-2","productId":"hamburgueria-product-5","title":"Oferta: Batata frita 200 g","subtitle":"Experimente por R$ 12,51","description":"Conheça batata frita 200 g com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":13.9,"promotionalPrice":12.51,"image":"/demo/hamburgueria/placeholder.svg"}]},{"segment":"acai","label":"Açaí","categories":[{"id":"acai-category-1","name":"Açaí no copo","description":"Açaí gelado em porções individuais.","image":"/demo/acai/placeholder.svg"},{"id":"acai-category-2","name":"Bowls especiais","description":"Tigelas com combinações de frutas e complementos.","image":"/demo/acai/placeholder.svg"},{"id":"acai-category-3","name":"Cremes","description":"Cremes gelados para variar seu pedido.","image":"/demo/acai/placeholder.svg"},{"id":"acai-category-4","name":"Bebidas naturais","description":"Bebidas de frutas preparadas na hora.","image":"/demo/acai/placeholder.svg"}],"products":[{"id":"acai-product-1","categoryId":"acai-category-1","name":"Açaí tradicional 300 ml","description":"Açaí batido com guaraná, banana e granola.","price":16.9,"image":"/demo/acai/placeholder.svg"},{"id":"acai-product-2","categoryId":"acai-category-1","name":"Açaí tradicional 500 ml","description":"Açaí batido com guaraná, banana e granola em copo grande.","price":22.9,"image":"/demo/acai/placeholder.svg"},{"id":"acai-product-3","categoryId":"acai-category-2","name":"Bowl de açaí com morango","description":"Açaí de 400 ml com morango, banana e leite em pó.","price":24.9,"image":"/demo/acai/placeholder.svg"},{"id":"acai-product-4","categoryId":"acai-category-2","name":"Bowl de açaí com pasta de amendoim","description":"Açaí de 400 ml com banana, granola e pasta de amendoim.","price":25.9,"image":"/demo/acai/placeholder.svg"},{"id":"acai-product-5","categoryId":"acai-category-3","name":"Creme de cupuaçu 300 ml","description":"Creme gelado de cupuaçu com sabor levemente cítrico.","price":17.9,"image":"/demo/acai/placeholder.svg"},{"id":"acai-product-6","categoryId":"acai-category-3","name":"Creme de pitaya 300 ml","description":"Creme gelado de pitaya com banana.","price":19.9,"image":"/demo/acai/placeholder.svg"},{"id":"acai-product-7","categoryId":"acai-category-4","name":"Suco de maracujá 300 ml","description":"Suco de polpa de maracujá preparado com água.","price":8.9,"image":"/demo/acai/placeholder.svg"},{"id":"acai-product-8","categoryId":"acai-category-4","name":"Vitamina de banana 400 ml","description":"Bebida de banana com leite e aveia.","price":12.9,"image":"/demo/acai/placeholder.svg"}],"offers":[{"id":"acai-offer-1","productId":"acai-product-1","title":"Oferta: Açaí tradicional 300 ml","subtitle":"Experimente por R$ 15,21","description":"Conheça açaí tradicional 300 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":16.9,"promotionalPrice":15.21,"image":"/demo/acai/placeholder.svg"},{"id":"acai-offer-2","productId":"acai-product-5","title":"Oferta: Creme de cupuaçu 300 ml","subtitle":"Experimente por R$ 16,11","description":"Conheça creme de cupuaçu 300 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":17.9,"promotionalPrice":16.11,"image":"/demo/acai/placeholder.svg"}]},{"segment":"japonesa","label":"Comida japonesa","categories":[{"id":"japonesa-category-1","name":"Sushis","description":"Seleção de peças tradicionais preparadas na hora.","image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-category-2","name":"Temakis","description":"Cones de alga com arroz e recheios variados.","image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-category-3","name":"Pratos quentes","description":"Pratos e porções quentes da cozinha japonesa.","image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-category-4","name":"Bebidas e sobremesas","description":"Opções para acompanhar e finalizar sua refeição.","image":"/demo/japonesa/placeholder.svg"}],"products":[{"id":"japonesa-product-1","categoryId":"japonesa-category-1","name":"Uramaki de salmão — 8 peças","description":"Arroz, alga, salmão e cream cheese com gergelim.","price":29.9,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-product-2","categoryId":"japonesa-category-1","name":"Niguiri de salmão — 4 peças","description":"Porções de arroz cobertas com fatias de salmão.","price":24.9,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-product-3","categoryId":"japonesa-category-2","name":"Temaki de salmão","description":"Cone de alga com arroz, salmão e cebolinha.","price":27.9,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-product-4","categoryId":"japonesa-category-2","name":"Temaki de shimeji","description":"Cone de alga com arroz e shimeji refogado.","price":24.9,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-product-5","categoryId":"japonesa-category-3","name":"Yakisoba de legumes","description":"Macarrão oriental com legumes e molho da casa. Porção de 400 g.","price":32.9,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-product-6","categoryId":"japonesa-category-3","name":"Guioza de frango — 6 unidades","description":"Pastéis orientais recheados com frango e legumes.","price":24.9,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-product-7","categoryId":"japonesa-category-4","name":"Chá gelado de limão 350 ml","description":"Chá preto gelado com limão em copo individual.","price":7.9,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-product-8","categoryId":"japonesa-category-4","name":"Harumaki doce — 2 unidades","description":"Rolinhos crocantes recheados com banana e canela.","price":14.9,"image":"/demo/japonesa/placeholder.svg"}],"offers":[{"id":"japonesa-offer-1","productId":"japonesa-product-1","title":"Oferta: Uramaki de salmão — 8 peças","subtitle":"Experimente por R$ 26,91","description":"Conheça uramaki de salmão — 8 peças com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":29.9,"promotionalPrice":26.91,"image":"/demo/japonesa/placeholder.svg"},{"id":"japonesa-offer-2","productId":"japonesa-product-5","title":"Oferta: Yakisoba de legumes","subtitle":"Experimente por R$ 29,61","description":"Conheça yakisoba de legumes com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":32.9,"promotionalPrice":29.61,"image":"/demo/japonesa/placeholder.svg"}]},{"segment":"farmacia","label":"Farmácia","categories":[{"id":"farmacia-category-1","name":"Higiene pessoal","description":"Itens para a higiene e os cuidados diários.","image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-category-2","name":"Cuidados com a pele","description":"Produtos cosméticos para uso diário.","image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-category-3","name":"Primeiros cuidados","description":"Itens básicos para pequenos cuidados.","image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-category-4","name":"Cuidados infantis","description":"Produtos de higiene para bebês e crianças.","image":"/demo/farmacia/placeholder.svg"}],"products":[{"id":"farmacia-product-1","categoryId":"farmacia-category-1","name":"Escova dental macia","description":"Escova com cerdas macias e cabo ergonômico.","price":8.9,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-product-2","categoryId":"farmacia-category-1","name":"Creme dental 90 g","description":"Creme dental com flúor para uso diário conforme o rótulo.","price":6.9,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-product-3","categoryId":"farmacia-category-2","name":"Protetor solar FPS 50 — 120 ml","description":"Protetor solar corporal FPS 50. Use conforme o rótulo.","price":49.9,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-product-4","categoryId":"farmacia-category-2","name":"Hidratante corporal 200 ml","description":"Loção cosmética para os cuidados diários com a pele.","price":24.9,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-product-5","categoryId":"farmacia-category-3","name":"Curativos adesivos — 10 unidades","description":"Curativos individuais para pequenos ferimentos superficiais.","price":7.9,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-product-6","categoryId":"farmacia-category-3","name":"Gaze estéril — 10 unidades","description":"Compressas de gaze em embalagem estéril.","price":5.9,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-product-7","categoryId":"farmacia-category-4","name":"Lenços umedecidos — 50 unidades","description":"Lenços para a higiene infantil, sem álcool etílico.","price":12.9,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-product-8","categoryId":"farmacia-category-4","name":"Sabonete infantil 200 ml","description":"Sabonete líquido suave para higiene de bebês.","price":18.9,"image":"/demo/farmacia/placeholder.svg"}],"offers":[{"id":"farmacia-offer-1","productId":"farmacia-product-1","title":"Oferta: Escova dental macia","subtitle":"Experimente por R$ 8,01","description":"Conheça escova dental macia com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":8.9,"promotionalPrice":8.01,"image":"/demo/farmacia/placeholder.svg"},{"id":"farmacia-offer-2","productId":"farmacia-product-5","title":"Oferta: Curativos adesivos — 10 unidades","subtitle":"Experimente por R$ 7,11","description":"Conheça curativos adesivos — 10 unidades com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":7.9,"promotionalPrice":7.11,"image":"/demo/farmacia/placeholder.svg"}]},{"segment":"pet","label":"Pet shop","categories":[{"id":"pet-category-1","name":"Alimentação","description":"Alimentos completos para cães e gatos.","image":"/demo/pet/placeholder.svg"},{"id":"pet-category-2","name":"Higiene","description":"Produtos para os cuidados dos animais.","image":"/demo/pet/placeholder.svg"},{"id":"pet-category-3","name":"Brinquedos","description":"Brinquedos para momentos de atividade e interação.","image":"/demo/pet/placeholder.svg"},{"id":"pet-category-4","name":"Acessórios","description":"Itens para passeio e alimentação.","image":"/demo/pet/placeholder.svg"}],"products":[{"id":"pet-product-1","categoryId":"pet-category-1","name":"Ração para cães adultos 1 kg","description":"Alimento seco sabor carne para cães adultos.","price":24.9,"image":"/demo/pet/placeholder.svg"},{"id":"pet-product-2","categoryId":"pet-category-1","name":"Ração para gatos adultos 1 kg","description":"Alimento seco sabor frango para gatos adultos.","price":29.9,"image":"/demo/pet/placeholder.svg"},{"id":"pet-product-3","categoryId":"pet-category-2","name":"Shampoo neutro para cães 500 ml","description":"Shampoo de uso veterinário externo para cães. Siga o rótulo.","price":24.9,"image":"/demo/pet/placeholder.svg"},{"id":"pet-product-4","categoryId":"pet-category-2","name":"Tapete higiênico — 7 unidades","description":"Tapetes descartáveis para auxiliar a higiene dos cães.","price":19.9,"image":"/demo/pet/placeholder.svg"},{"id":"pet-product-5","categoryId":"pet-category-3","name":"Bola de borracha para cães","description":"Brinquedo de borracha para interação supervisionada.","price":14.9,"image":"/demo/pet/placeholder.svg"},{"id":"pet-product-6","categoryId":"pet-category-3","name":"Varinha com penas para gatos","description":"Brinquedo de varinha para interação supervisionada com gatos.","price":18.9,"image":"/demo/pet/placeholder.svg"},{"id":"pet-product-7","categoryId":"pet-category-4","name":"Coleira ajustável tamanho M","description":"Coleira de nylon com fecho e ajuste de tamanho.","price":24.9,"image":"/demo/pet/placeholder.svg"},{"id":"pet-product-8","categoryId":"pet-category-4","name":"Comedouro de inox 500 ml","description":"Tigela de inox com base antiderrapante.","price":22.9,"image":"/demo/pet/placeholder.svg"}],"offers":[{"id":"pet-offer-1","productId":"pet-product-1","title":"Oferta: Ração para cães adultos 1 kg","subtitle":"Experimente por R$ 22,41","description":"Conheça ração para cães adultos 1 kg com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":24.9,"promotionalPrice":22.41,"image":"/demo/pet/placeholder.svg"},{"id":"pet-offer-2","productId":"pet-product-5","title":"Oferta: Bola de borracha para cães","subtitle":"Experimente por R$ 13,41","description":"Conheça bola de borracha para cães com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":14.9,"promotionalPrice":13.41,"image":"/demo/pet/placeholder.svg"}]},{"segment":"cafe-doceria","label":"Café e doceria","categories":[{"id":"cafe-doceria-category-1","name":"Cafés","description":"Cafés preparados na hora para diferentes paladares.","image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-category-2","name":"Bolos","description":"Fatias de bolo para uma pausa doce.","image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-category-3","name":"Doces","description":"Doces individuais preparados com cuidado.","image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-category-4","name":"Lanches","description":"Lanches para acompanhar seu café.","image":"/demo/cafe-doceria/placeholder.svg"}],"products":[{"id":"cafe-doceria-product-1","categoryId":"cafe-doceria-category-1","name":"Espresso 60 ml","description":"Dose dupla de café espresso com aroma intenso.","price":7.0,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-product-2","categoryId":"cafe-doceria-category-1","name":"Cappuccino 200 ml","description":"Café espresso com leite vaporizado e espuma cremosa.","price":12.9,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-product-3","categoryId":"cafe-doceria-category-2","name":"Bolo de chocolate — fatia","description":"Fatia de bolo de chocolate com cobertura de ganache.","price":13.9,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-product-4","categoryId":"cafe-doceria-category-2","name":"Bolo de laranja — fatia","description":"Fatia de bolo caseiro de laranja com calda cítrica.","price":9.9,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-product-5","categoryId":"cafe-doceria-category-3","name":"Brigadeiro tradicional","description":"Doce de chocolate com leite condensado e granulado.","price":4.5,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-product-6","categoryId":"cafe-doceria-category-3","name":"Brownie de chocolate","description":"Brownie individual de chocolate com casquinha crocante.","price":10.9,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-product-7","categoryId":"cafe-doceria-category-4","name":"Croissant de queijo","description":"Massa folhada amanteigada com recheio de queijo.","price":12.9,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-product-8","categoryId":"cafe-doceria-category-4","name":"Sanduíche de frango","description":"Pão integral com frango desfiado, cenoura e creme de ricota.","price":17.9,"image":"/demo/cafe-doceria/placeholder.svg"}],"offers":[{"id":"cafe-doceria-offer-1","productId":"cafe-doceria-product-1","title":"Oferta: Espresso 60 ml","subtitle":"Experimente por R$ 6,30","description":"Conheça espresso 60 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":7.0,"promotionalPrice":6.3,"image":"/demo/cafe-doceria/placeholder.svg"},{"id":"cafe-doceria-offer-2","productId":"cafe-doceria-product-5","title":"Oferta: Brigadeiro tradicional","subtitle":"Experimente por R$ 4,05","description":"Conheça brigadeiro tradicional com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":4.5,"promotionalPrice":4.05,"image":"/demo/cafe-doceria/placeholder.svg"}]},{"segment":"escritorio-servicos","label":"Escritório e serviços","categories":[{"id":"escritorio-servicos-category-1","name":"Impressão","description":"Impressões e cópias para o dia a dia.","image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-category-2","name":"Acabamento","description":"Serviços de apresentação e proteção de documentos.","image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-category-3","name":"Papelaria","description":"Itens essenciais para estudo e trabalho.","image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-category-4","name":"Serviços digitais","description":"Apoio para organizar e preparar documentos.","image":"/demo/escritorio-servicos/placeholder.svg"}],"products":[{"id":"escritorio-servicos-product-1","categoryId":"escritorio-servicos-category-1","name":"Impressão preto e branco A4","description":"Impressão de uma página A4 em papel sulfite 75 g.","price":1.0,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-product-2","categoryId":"escritorio-servicos-category-1","name":"Impressão colorida A4","description":"Impressão colorida de uma página A4 em papel sulfite 75 g.","price":3.0,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-product-3","categoryId":"escritorio-servicos-category-2","name":"Encadernação espiral até 100 folhas","description":"Encadernação em espiral com capa transparente e contracapa.","price":15.0,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-product-4","categoryId":"escritorio-servicos-category-2","name":"Plastificação A4","description":"Plastificação de uma folha A4 em película transparente.","price":8.0,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-product-5","categoryId":"escritorio-servicos-category-3","name":"Caderno universitário 80 folhas","description":"Caderno de uma matéria com capa dura e folhas pautadas.","price":16.9,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-product-6","categoryId":"escritorio-servicos-category-3","name":"Caneta esferográfica azul","description":"Caneta de ponta média com tinta azul.","price":2.5,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-product-7","categoryId":"escritorio-servicos-category-4","name":"Digitalização até 10 páginas","description":"Digitalização de até dez páginas para arquivo PDF.","price":10.0,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-product-8","categoryId":"escritorio-servicos-category-4","name":"Formatação de documento até 5 páginas","description":"Ajuste de margens, títulos e paginação de documento fornecido.","price":30.0,"image":"/demo/escritorio-servicos/placeholder.svg"}],"offers":[{"id":"escritorio-servicos-offer-1","productId":"escritorio-servicos-product-1","title":"Oferta: Impressão preto e branco A4","subtitle":"Experimente por R$ 0,90","description":"Conheça impressão preto e branco a4 com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":1.0,"promotionalPrice":0.9,"image":"/demo/escritorio-servicos/placeholder.svg"},{"id":"escritorio-servicos-offer-2","productId":"escritorio-servicos-product-5","title":"Oferta: Caderno universitário 80 folhas","subtitle":"Experimente por R$ 15,21","description":"Conheça caderno universitário 80 folhas com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":16.9,"promotionalPrice":15.21,"image":"/demo/escritorio-servicos/placeholder.svg"}]},{"segment":"generico","label":"Genérico","categories":[{"id":"generico-category-1","name":"Novidades","description":"Sugestões para demonstrar a apresentação do catálogo.","image":"/demo/generico/placeholder.svg"},{"id":"generico-category-2","name":"Utilidades","description":"Itens práticos para o dia a dia.","image":"/demo/generico/placeholder.svg"},{"id":"generico-category-3","name":"Presentes","description":"Opções simples para presentear.","image":"/demo/generico/placeholder.svg"},{"id":"generico-category-4","name":"Serviços","description":"Exemplos de serviços que podem ser personalizados.","image":"/demo/generico/placeholder.svg"}],"products":[{"id":"generico-product-1","categoryId":"generico-category-1","name":"Garrafa reutilizável 500 ml","description":"Garrafa com tampa de rosca para uso diário.","price":24.9,"image":"/demo/generico/placeholder.svg"},{"id":"generico-product-2","categoryId":"generico-category-1","name":"Ecobag de algodão","description":"Sacola reutilizável de algodão com alças reforçadas.","price":19.9,"image":"/demo/generico/placeholder.svg"},{"id":"generico-product-3","categoryId":"generico-category-2","name":"Organizador de mesa","description":"Organizador compacto com divisórias para pequenos objetos.","price":29.9,"image":"/demo/generico/placeholder.svg"},{"id":"generico-product-4","categoryId":"generico-category-2","name":"Bloco de anotações A5","description":"Bloco de cinquenta folhas para anotações e planejamento.","price":12.9,"image":"/demo/generico/placeholder.svg"},{"id":"generico-product-5","categoryId":"generico-category-3","name":"Caneca de cerâmica 300 ml","description":"Caneca de cerâmica lisa para bebidas quentes.","price":24.9,"image":"/demo/generico/placeholder.svg"},{"id":"generico-product-6","categoryId":"generico-category-3","name":"Kit de caderno e caneta","description":"Conjunto com caderno de bolso e caneta esferográfica.","price":29.9,"image":"/demo/generico/placeholder.svg"},{"id":"generico-product-7","categoryId":"generico-category-4","name":"Embalagem para presente","description":"Serviço de embalagem individual com papel e laço.","price":8.0,"image":"/demo/generico/placeholder.svg"},{"id":"generico-product-8","categoryId":"generico-category-4","name":"Personalização de etiqueta","description":"Criação e impressão de uma etiqueta simples para presente.","price":5.0,"image":"/demo/generico/placeholder.svg"}],"offers":[{"id":"generico-offer-1","productId":"generico-product-1","title":"Oferta: Garrafa reutilizável 500 ml","subtitle":"Experimente por R$ 22,41","description":"Conheça garrafa reutilizável 500 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":24.9,"promotionalPrice":22.41,"image":"/demo/generico/placeholder.svg"},{"id":"generico-offer-2","productId":"generico-product-5","title":"Oferta: Caneca de cerâmica 300 ml","subtitle":"Experimente por R$ 22,41","description":"Conheça caneca de cerâmica 300 ml com uma condição especial de demonstração.","badge":"DEMO • 10% OFF","originalPrice":24.9,"promotionalPrice":22.41,"image":"/demo/generico/placeholder.svg"}]}]
$demo_packs$::jsonb);

-- Sem tenant_id do cliente. Uma identidade com mais de uma loja OWNER precisa
-- de um fluxo explícito de contexto autenticado; nunca escolher LIMIT 1 ao acaso.
CREATE FUNCTION public._demo_pack_owner_tenant()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_tenant_id uuid;
    v_tenants uuid[];
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
    END IF;
    SELECT pg_catalog.array_agg(tu.tenant_id ORDER BY tu.tenant_id) INTO v_tenants
    FROM public.tenant_users tu
    WHERE tu.user_id = v_user_id AND tu.role_id = 'OWNER' AND tu.status = 'ACTIVE'
      AND tu.tenant_id IS NOT NULL;
    IF COALESCE(pg_catalog.cardinality(v_tenants), 0) <> 1 THEN
        RAISE EXCEPTION 'É necessário um único vínculo ativo de proprietário para revisar o catálogo demo.'
            USING ERRCODE = '42501';
    END IF;
    v_tenant_id := v_tenants[1];
    RETURN v_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public._demo_pack_owner_tenant() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.seed_demo_pack(p_segment text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id uuid := public._demo_pack_owner_tenant();
    v_onboarding public.demo_pack_onboardings%ROWTYPE;
    v_pack jsonb;
    v_item jsonb;
    v_id uuid;
    v_product_id uuid;
    v_categories jsonb := '{}'::jsonb;
    v_products jsonb := '{}'::jsonb;
    v_order integer;
    v_slug text;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(42036, pg_catalog.hashtext(v_tenant_id::text));
    SELECT d.* INTO v_onboarding FROM public.demo_pack_onboardings d
    WHERE d.tenant_id = v_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'O pacote demo está disponível apenas no cadastro de uma nova loja.'
            USING ERRCODE = '42501';
    END IF;
    IF p_segment IS DISTINCT FROM v_onboarding.segment THEN
        RAISE EXCEPTION 'O segmento deve corresponder ao escolhido no cadastro.' USING ERRCODE = '22023';
    END IF;
    IF v_onboarding.seeded_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('tenantId', v_tenant_id, 'segment', p_segment, 'seeded', false);
    END IF;
    SELECT d.payload INTO STRICT v_pack FROM public.demo_pack_items d WHERE d.segment = p_segment;
    IF NOT public._demo_pack_is_valid(p_segment, v_pack) THEN
        RAISE EXCEPTION 'Pacote demo inválido.' USING ERRCODE = '22023';
    END IF;
    SELECT t.slug INTO STRICT v_slug FROM public.tenants t WHERE t.id = v_tenant_id;
    v_order := 0;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_pack->'categories') LOOP
        v_id := pg_catalog.gen_random_uuid();
        v_order := v_order + 1;
        INSERT INTO public.categories (id, tenant_id, name, description, image_url, display_order, is_active, is_demo)
        VALUES (v_id, v_tenant_id, v_item->>'name', v_item->>'description', v_item->>'image', v_order, true, true);
        v_categories := v_categories || pg_catalog.jsonb_build_object(v_item->>'id', v_id);
    END LOOP;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_pack->'products') LOOP
        v_id := pg_catalog.gen_random_uuid();
        INSERT INTO public.products (id, tenant_id, category_id, name, description, image_url, price,
                                     sku, unit, stock_quantity, is_active, is_featured, is_demo)
        VALUES (v_id, v_tenant_id, (v_categories->>(v_item->>'categoryId'))::uuid,
                v_item->>'name', v_item->>'description', v_item->>'image', (v_item->>'price')::numeric,
                'DEMO-' || (v_item->>'id'), 'un', 0, true, false, true);
        v_products := v_products || pg_catalog.jsonb_build_object(v_item->>'id', v_id);
    END LOOP;
    v_order := 0;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_pack->'offers') LOOP
        v_order := v_order + 1;
        v_product_id := (v_products->>(v_item->>'productId'))::uuid;
        INSERT INTO public.offers (tenant_id, product_id, title, subtitle, description, badge,
                                   original_price, promotional_price, discount_percentage, image_url,
                                   internal_link, display_order, is_active, is_demo)
        VALUES (v_tenant_id, v_product_id, v_item->>'title', v_item->>'subtitle',
                v_item->>'description', v_item->>'badge', (v_item->>'originalPrice')::numeric,
                (v_item->>'promotionalPrice')::numeric,
                pg_catalog.round(100 * (1 - (v_item->>'promotionalPrice')::numeric /
                                               (v_item->>'originalPrice')::numeric))::integer,
                v_item->>'image', '/app/' || v_slug || '?product=' || v_product_id::text,
                v_order, true, true);
    END LOOP;
    UPDATE public.demo_pack_onboardings SET seeded_at = pg_catalog.now() WHERE tenant_id = v_tenant_id;
    RETURN pg_catalog.jsonb_build_object('tenantId', v_tenant_id, 'segment', p_segment, 'seeded', true);
END;
$$;
REVOKE ALL ON FUNCTION public.seed_demo_pack(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_pack(text) TO authenticated;

CREATE FUNCTION public.get_demo_pack_review()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id uuid := public._demo_pack_owner_tenant();
    v_reviewed boolean;
    v_items jsonb;
BEGIN
    SELECT s.demo_pack_reviewed INTO v_reviewed FROM public.tenant_settings s
    WHERE s.tenant_id = v_tenant_id;
    SELECT COALESCE(pg_catalog.jsonb_agg(i.item ORDER BY i.kind, i.item->>'name'), '[]'::jsonb)
    INTO v_items FROM (
        SELECT 'category' AS kind, pg_catalog.jsonb_build_object('id', c.id, 'kind', 'category', 'name', c.name) AS item
        FROM public.categories c WHERE c.tenant_id = v_tenant_id AND c.is_demo = true
        UNION ALL
        SELECT 'product', pg_catalog.jsonb_build_object('id', p.id, 'kind', 'product', 'name', p.name, 'categoryId', p.category_id)
        FROM public.products p WHERE p.tenant_id = v_tenant_id AND p.is_demo = true
        UNION ALL
        SELECT 'offer', pg_catalog.jsonb_build_object('id', o.id, 'kind', 'offer', 'name', o.title, 'productId', o.product_id)
        FROM public.offers o WHERE o.tenant_id = v_tenant_id AND o.is_demo = true
    ) i;
    RETURN pg_catalog.jsonb_build_object('tenantId', v_tenant_id, 'reviewed', COALESCE(v_reviewed, true), 'items', v_items);
END;
$$;
REVOKE ALL ON FUNCTION public.get_demo_pack_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_demo_pack_review() TO authenticated;

CREATE FUNCTION public.keep_demo_items()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id uuid := public._demo_pack_owner_tenant();
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(42036, pg_catalog.hashtext(v_tenant_id::text));
    UPDATE public.tenant_settings SET demo_pack_reviewed = true WHERE tenant_id = v_tenant_id;
    RETURN pg_catalog.jsonb_build_object('tenantId', v_tenant_id, 'reviewed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.keep_demo_items() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.keep_demo_items() TO authenticated;

-- Verifica TODAS as FKs (inclusive compostas e ON DELETE CASCADE/SET NULL).
-- Assim remover um demo não apaga nem desassocia pedidos, ofertas reais,
-- histórico de estoque, campanhas ou extensões futuras. Sem GRANT pela API.
CREATE FUNCTION public._demo_item_is_referenced(p_table regclass, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_constraint record;
    v_predicate text;
    v_referenced boolean;
BEGIN
    FOR v_constraint IN
        SELECT c.conrelid, c.conkey, c.confkey FROM pg_catalog.pg_constraint c
        WHERE c.confrelid = p_table AND c.contype = 'f'
    LOOP
        SELECT pg_catalog.string_agg(pg_catalog.format('reference_row.%I = target_row.%I', a.attname, b.attname),
                                     ' AND ' ORDER BY k.ordinality)
        INTO v_predicate
        FROM pg_catalog.generate_subscripts(v_constraint.conkey, 1) AS k(ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = v_constraint.conrelid
            AND a.attnum = v_constraint.conkey[k.ordinality]
        JOIN pg_catalog.pg_attribute b ON b.attrelid = p_table
            AND b.attnum = v_constraint.confkey[k.ordinality];
        EXECUTE pg_catalog.format(
            'SELECT EXISTS (SELECT 1 FROM %s reference_row JOIN %s target_row ON %s WHERE target_row.id = $1)',
            v_constraint.conrelid::regclass, p_table, v_predicate)
        INTO v_referenced USING p_id;
        IF v_referenced THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public._demo_item_is_referenced(regclass, uuid) FROM PUBLIC, anon, authenticated;

-- p_ids são IDs A REMOVER: NULL remove todos; array vazio só conclui a escolha.
-- Todo DELETE repete tenant_id + is_demo=true, inclusive após o lock de linha.
CREATE FUNCTION public.remove_demo_items(p_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id uuid := public._demo_pack_owner_tenant();
    v_item record;
    v_offers integer := 0;
    v_products integer := 0;
    v_categories integer := 0;
    v_skipped integer := 0;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(42036, pg_catalog.hashtext(v_tenant_id::text));
    FOR v_item IN
        SELECT o.id FROM public.offers o WHERE o.tenant_id = v_tenant_id AND o.is_demo = true
            AND (p_ids IS NULL OR o.id = ANY(p_ids)) ORDER BY o.id FOR UPDATE OF o
    LOOP
        IF public._demo_item_is_referenced('public.offers'::regclass, v_item.id) THEN
            v_skipped := v_skipped + 1;
        ELSE
            DELETE FROM public.offers WHERE id = v_item.id AND tenant_id = v_tenant_id AND is_demo = true;
            v_offers := v_offers + 1;
        END IF;
    END LOOP;
    FOR v_item IN
        SELECT p.id FROM public.products p WHERE p.tenant_id = v_tenant_id AND p.is_demo = true
            AND (p_ids IS NULL OR p.id = ANY(p_ids)) ORDER BY p.id FOR UPDATE OF p
    LOOP
        IF public._demo_item_is_referenced('public.products'::regclass, v_item.id) THEN
            v_skipped := v_skipped + 1;
        ELSE
            DELETE FROM public.products WHERE id = v_item.id AND tenant_id = v_tenant_id AND is_demo = true;
            v_products := v_products + 1;
        END IF;
    END LOOP;
    FOR v_item IN
        SELECT c.id FROM public.categories c WHERE c.tenant_id = v_tenant_id AND c.is_demo = true
            AND (p_ids IS NULL OR c.id = ANY(p_ids)) ORDER BY c.id FOR UPDATE OF c
    LOOP
        IF public._demo_item_is_referenced('public.categories'::regclass, v_item.id) THEN
            v_skipped := v_skipped + 1;
        ELSE
            DELETE FROM public.categories WHERE id = v_item.id AND tenant_id = v_tenant_id AND is_demo = true;
            v_categories := v_categories + 1;
        END IF;
    END LOOP;
    UPDATE public.tenant_settings SET demo_pack_reviewed = true WHERE tenant_id = v_tenant_id;
    RETURN pg_catalog.jsonb_build_object('success', true, 'tenantId', v_tenant_id, 'reviewed', true,
        'deletedOffers', v_offers, 'deletedProducts', v_products, 'deletedCategories', v_categories, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_demo_items(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_demo_items(uuid[]) TO authenticated;

-- Remover a assinatura antiga evita ambiguidade de overload no PostgREST; os nove
-- parâmetros antigos continuam aceitos pelo DEFAULT generico do décimo parâmetro.
DROP FUNCTION public.create_tenant_for_current_user(text, text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_tenant_for_current_user(
    p_name pg_catalog.text,
    p_slug pg_catalog.text,
    p_document pg_catalog.text,
    p_phone pg_catalog.text,
    p_email pg_catalog.text,
    p_category pg_catalog.text,
    p_address pg_catalog.text,
    p_city pg_catalog.text,
    p_phone_whatsapp pg_catalog.text,
    p_demo_segment pg_catalog.text DEFAULT 'generico'
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id pg_catalog.uuid := auth.uid();
    v_slug pg_catalog.varchar(64);
    v_base_slug pg_catalog.varchar(64);
    v_suffix pg_catalog.int4 := 2;
    v_tenant_id pg_catalog.uuid;
    v_user_exists pg_catalog.bool;
    v_has_existing_membership pg_catalog.bool;
    v_clean_email pg_catalog.varchar(255);
    v_auth_email pg_catalog.varchar(255);
BEGIN
    -- 1. Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- 2. Proteção contra Concorrência (Advisory Lock transacional por usuário)
    PERFORM pg_catalog.pg_advisory_xact_lock(
        42015,
        pg_catalog.hashtext(v_user_id::pg_catalog.text)
    );

    -- 3. Validação de existência do perfil em public.users e captura segura do e-mail da CONTA AUTENTICADA
    SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt()->>'email', u.email)))
    INTO v_auth_email
    FROM public.users u
    WHERE u.id = v_user_id;

    IF v_auth_email IS NULL OR v_auth_email = '' THEN
        v_auth_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt()->>'email', '')));
    END IF;

    IF v_auth_email IS NULL OR v_auth_email = '' THEN
        RAISE EXCEPTION 'Não foi possível identificar o e-mail da conta autenticada para confirmação.';
    END IF;

    -- 4. Regra de Primeiro Onboarding: bloqueia se o usuário possuir QUALQUER vínculo prévio
    SELECT EXISTS(
        SELECT 1 FROM public.tenant_users WHERE user_id = v_user_id
    ) INTO v_has_existing_membership;

    IF v_has_existing_membership THEN
        RAISE EXCEPTION 'Usuário já possui vínculo com estabelecimento. Utilize o fluxo apropriado para gerenciamento de estabelecimentos.';
    END IF;

    -- 5. Validação dos dados obrigatórios
    IF pg_catalog.btrim(COALESCE(p_name, '')) = '' THEN
        RAISE EXCEPTION 'Nome do estabelecimento é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_document, '')) = '' THEN
        RAISE EXCEPTION 'CPF ou CNPJ é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_phone, '')) = '' THEN
        RAISE EXCEPTION 'Telefone de contato é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_email, '')) = '' THEN
        RAISE EXCEPTION 'E-mail do estabelecimento é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_address, '')) = '' THEN
        RAISE EXCEPTION 'Endereço é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_phone_whatsapp, '')) = '' THEN
        RAISE EXCEPTION 'WhatsApp para atendimento é obrigatório.';
    END IF;

    -- 6. Validação estrita do Slug
    v_slug := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_slug, '')));

    IF v_slug = '' THEN
        RAISE EXCEPTION 'Slug do estabelecimento é obrigatório.';
    END IF;

    IF pg_catalog.length(v_slug) < 3 OR pg_catalog.length(v_slug) > 64 THEN
        RAISE EXCEPTION 'O slug deve conter entre 3 e 64 caracteres.';
    END IF;

    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
        RAISE EXCEPTION 'O slug deve conter apenas letras minúsculas, números e hífens válidos (ex: adega-do-bairro).';
    END IF;

    -- Resolução determinística de colisão de slug (ex: churrasco-grego -> churrasco-grego-2 -> churrasco-grego-3)
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
        v_base_slug := v_slug;
        v_suffix := 2;
        WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = (v_base_slug || '-' || v_suffix::pg_catalog.text)) LOOP
            v_suffix := v_suffix + 1;
        END LOOP;
        v_slug := pg_catalog.substr((v_base_slug || '-' || v_suffix::pg_catalog.text), 1, 64)::pg_catalog.varchar(64);
    END IF;

    v_clean_email := pg_catalog.lower(pg_catalog.btrim(p_email));

    -- 7. Criação do Estabelecimento em public.tenants com STATUS = 'PENDING'
    INSERT INTO public.tenants (
        name,
        slug,
        legal_name,
        document,
        phone,
        email,
        category,
        status,
        plan_tier,
        created_at,
        updated_at
    ) VALUES (
        pg_catalog.btrim(p_name),
        v_slug,
        NULL,
        pg_catalog.btrim(p_document),
        pg_catalog.btrim(p_phone),
        v_clean_email,
        COALESCE(NULLIF(pg_catalog.btrim(p_category), ''), 'ADEGA'),
        'PENDING',
        'FREE',
        pg_catalog.now(),
        pg_catalog.now()
    ) RETURNING id INTO v_tenant_id;

    -- 8. Criação das configurações operacionais em public.tenant_settings
    INSERT INTO public.tenant_settings (
        tenant_id,
        is_open,
        min_order_value,
        delivery_fee,
        free_delivery_threshold,
        estimated_delivery_time,
        address,
        city,
        phone_whatsapp,
        pix_key,
        created_at,
        updated_at
    ) VALUES (
        v_tenant_id,
        true,
        0.00,
        0.00,
        NULL,
        '30-45 min',
        pg_catalog.btrim(p_address),
        COALESCE(NULLIF(pg_catalog.btrim(p_city), ''), 'São Paulo'),
        pg_catalog.btrim(p_phone_whatsapp),
        NULL,
        pg_catalog.now(),
        pg_catalog.now()
    );

    -- 9. Criação do tema visual padrão em public.tenant_themes
    INSERT INTO public.tenant_themes (
        tenant_id,
        store_name,
        tagline,
        logo_url,
        banner_url,
        primary_color,
        secondary_color,
        background_color,
        card_color,
        button_color,
        text_color,
        border_radius,
        font_family,
        updated_at
    ) VALUES (
        v_tenant_id,
        pg_catalog.btrim(p_name),
        NULL,
        NULL,
        NULL,
        '#15803d',
        '#166534',
        '#f8fafc',
        '#ffffff',
        '#15803d',
        '#0f172a',
        '1rem',
        'Inter',
        pg_catalog.now()
    );

    -- 10. Criação do vínculo de OWNER em public.tenant_users
    INSERT INTO public.tenant_users (
        user_id,
        tenant_id,
        role_id,
        status,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        v_tenant_id,
        'OWNER',
        'ACTIVE',
        pg_catalog.now(),
        pg_catalog.now()
    );

    -- Elegibilidade privada: somente este onboarding insere o registro. Não pode
    -- ser fabricada pelo cliente via UPDATE de tenant_settings. Nenhuma loja antiga
    -- recebe registro nem catálogo por efeito da migration.
    INSERT INTO public.demo_pack_onboardings (tenant_id, segment)
    VALUES (v_tenant_id, p_demo_segment);
    UPDATE public.tenant_settings SET demo_pack_reviewed = false
    WHERE tenant_id = v_tenant_id;
    -- O OWNER já existe; seed e criação pertencem à mesma transação.
    PERFORM public.seed_demo_pack(p_demo_segment);

    -- 11. Registro do estado da solicitação de confirmação de e-mail
    INSERT INTO public.tenant_email_confirmations (
        tenant_id,
        user_id,
        email,
        status,
        requested_at,
        expires_at,
        created_at,
        updated_at
    ) VALUES (
        v_tenant_id,
        v_user_id,
        v_auth_email,
        'PENDING',
        pg_catalog.now(),
        pg_catalog.now() + interval '24 hours',
        pg_catalog.now(),
        pg_catalog.now()
    );

    -- 12. Registro forense de auditoria
    PERFORM public.log_audit_event(
        'TENANT_EMAIL_CONFIRMATION_REQUESTED'::pg_catalog.varchar,
        'tenants'::pg_catalog.varchar,
        ('Estabelecimento "' || p_name || '" criado com status PENDING. Slug atribuído: ' || v_slug || '. Confirmação solicitada para ' || v_auth_email)::pg_catalog.text,
        v_tenant_id::pg_catalog.varchar,
        NULL::pg_catalog.text,
        pg_catalog.jsonb_build_object(
            'tenantId', v_tenant_id,
            'name', p_name,
            'slug', v_slug,
            'role', 'OWNER',
            'status', 'PENDING',
            'authAccountEmail', v_auth_email,
            'commercialEmail', v_clean_email
        )::pg_catalog.text,
        v_tenant_id
    );

    -- 13. Retorno com o slug resolvido
    RETURN pg_catalog.jsonb_build_object(
        'tenantId', v_tenant_id,
        'slug', v_slug,
        'name', p_name,
        'role', 'OWNER',
        'status', 'PENDING',
        'confirmationEmail', v_auth_email,
        'commercialEmail', v_clean_email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_for_current_user(
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_tenant_for_current_user(
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text
) TO authenticated;

COMMIT;
