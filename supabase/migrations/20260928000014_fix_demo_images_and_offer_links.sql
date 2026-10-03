-- ==============================================================================
-- MIGRATION 20260928000014: CORREÇÃO DAS IMAGENS DEMO E LINKS DE OFERTAS
-- ==============================================================================
-- 1. Corrige as 3 URLs de imagens externas de demonstração que retornavam 404
--    (Heineken, Corona, Água Mineral) na função pública seed_tenant_demo_catalog.
-- 2. Atualiza os registros existentes onde is_demo = true para os SKUs afetados.
-- 3. Não afeta produtos reais (is_demo = false).
-- ==============================================================================

-- A. Atualizar produtos demo já existentes no banco de dados
UPDATE public.products
SET image_url = 'https://images.unsplash.com/photo-1583258292688-d0213dc5a3a8?w=600&auto=format&fit=crop&q=80'
WHERE is_demo = true AND sku = 'DEMO-HEIN-330';

UPDATE public.products
SET image_url = 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600&auto=format&fit=crop&q=80'
WHERE is_demo = true AND sku = 'DEMO-CORONA-330';

UPDATE public.products
SET image_url = 'https://images.unsplash.com/photo-1560023907-5f339617ea30?w=600&auto=format&fit=crop&q=80'
WHERE is_demo = true AND sku = 'DEMO-AGUA-GAS';

-- B. Atualizar a função para novos estabelecimentos criados no futuro
CREATE OR REPLACE FUNCTION public.seed_tenant_demo_catalog(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_slug TEXT;

    -- Categorias (5 categorias)
    v_cat_cervejas UUID := gen_random_uuid();
    v_cat_vinhos UUID := gen_random_uuid();
    v_cat_destilados UUID := gen_random_uuid();
    v_cat_petiscos UUID := gen_random_uuid();
    v_cat_nao_alcoolicos UUID := gen_random_uuid();

    -- Produtos (12 produtos)
    v_prod_heineken UUID := gen_random_uuid();
    v_prod_corona UUID := gen_random_uuid();
    v_prod_ipa UUID := gen_random_uuid();
    v_prod_vinho_tinto UUID := gen_random_uuid();
    v_prod_vinho_branco UUID := gen_random_uuid();
    v_prod_whisky UUID := gen_random_uuid();
    v_prod_gin UUID := gen_random_uuid();
    v_prod_vodka UUID := gen_random_uuid();
    v_prod_batata UUID := gen_random_uuid();
    v_prod_calabresa UUID := gen_random_uuid();
    v_prod_refrigerante UUID := gen_random_uuid();
    v_prod_agua UUID := gen_random_uuid();
BEGIN
    -- Evita duplicidade se já houver conteúdo demo no tenant
    IF EXISTS (SELECT 1 FROM public.categories WHERE tenant_id = p_tenant_id AND is_demo = true) THEN
        RETURN;
    END IF;

    -- Obtém o slug do tenant para geração correta dos links internos
    SELECT slug INTO v_tenant_slug FROM public.tenants WHERE id = p_tenant_id;

    -- ==========================================================================
    -- 1. Inserir Categorias Demo (5 categorias com imagens, ordem e descrição)
    -- ==========================================================================
    INSERT INTO public.categories (id, tenant_id, name, description, image_url, display_order, is_active, is_demo)
    VALUES
        (v_cat_cervejas, p_tenant_id, 'Cervejas & Chopp', 'Cervejas artesanais, pilsen, IPAs e importadas estupidamente geladas.', 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=600&auto=format&fit=crop&q=80', 1, true, true),
        (v_cat_vinhos, p_tenant_id, 'Vinhos & Espumantes', 'Rótulos nacionais e importados selecionados para todas as ocasiões.', 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80', 2, true, true),
        (v_cat_destilados, p_tenant_id, 'Destilados & Whiskies', 'Whiskies clássicos, gins artesanais, vodkas e cachaças nobres.', 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=600&auto=format&fit=crop&q=80', 3, true, true),
        (v_cat_petiscos, p_tenant_id, 'Petiscos & Aperitivos', 'Acompanhamentos ideais, queijos, castanhas e porções preparadas na hora.', 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=600&auto=format&fit=crop&q=80', 4, true, true),
        (v_cat_nao_alcoolicos, p_tenant_id, 'Bebidas Sem Álcool', 'Refrigerantes, energéticos, sucos integrais e águas minerais.', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', 5, true, true);

    -- ==========================================================================
    -- 2. Inserir Produtos Demo (12 produtos com URLs testadas e válidas HTTP 200)
    -- ==========================================================================
    INSERT INTO public.products (
        id, tenant_id, category_id, name, description, image_url, price, promotional_price, 
        cost_price, sku, unit, stock_quantity, min_stock_alert, is_active, is_featured, is_demo
    ) VALUES
        -- Cervejas (unidade garrafa, preços com e sem promo, custo cadastrado)
        (v_prod_heineken, p_tenant_id, v_cat_cervejas, 'Cerveja Heineken Long Neck 330ml', 'Cerveja puro malte refrescante com sabor característico e lúpulo de qualidade.', 'https://images.unsplash.com/photo-1583258292688-d0213dc5a3a8?w=600&auto=format&fit=crop&q=80', 12.00, NULL, 6.80, 'DEMO-HEIN-330', 'garrafa', 120, 15, true, true, true),
        (v_prod_corona, p_tenant_id, v_cat_cervejas, 'Cerveja Corona Extra 330ml', 'Cerveja mexicana leve e refrescante, ideal para saborear com uma fatia de limão.', 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600&auto=format&fit=crop&q=80', 13.50, NULL, 7.50, 'DEMO-CORONA-330', 'garrafa', 95, 12, true, false, true),
        (v_prod_ipa, p_tenant_id, v_cat_cervejas, 'Cerveja Artesanal IPA Premium 500ml', 'India Pale Ale com aroma cítrico intenso, notas florais e amargor equilibrado.', 'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=600&auto=format&fit=crop&q=80', 24.90, 19.90, 12.90, 'DEMO-IPA-500', 'garrafa', 60, 8, true, true, true),
        
        -- Vinhos (promoção, custo, destaque)
        (v_prod_vinho_tinto, p_tenant_id, v_cat_vinhos, 'Vinho Tinto Cabernet Sauvignon 750ml', 'Vinho tinto fino seco com taninos maduros, notas de frutas vermelhas e carvalho.', 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=600&auto=format&fit=crop&q=80', 59.90, 49.90, 31.00, 'DEMO-CABERNET-750', 'garrafa', 40, 6, true, true, true),
        (v_prod_vinho_branco, p_tenant_id, v_cat_vinhos, 'Vinho Branco Sauvignon Blanc 750ml', 'Aromas frescos de frutas tropicais e acidez vibrante. Perfeito bem gelado.', 'https://images.unsplash.com/photo-1584916201218-f4242ceb4809?w=600&auto=format&fit=crop&q=80', 54.00, NULL, 28.50, 'DEMO-SAUVIGNON-750', 'garrafa', 35, 5, true, false, true),

        -- Destilados (alto valor, custo, alerta de estoque baixo)
        (v_prod_whisky, p_tenant_id, v_cat_destilados, 'Whisky Escocês 12 Anos 1L', 'Blended Scotch Whisky maturado por 12 anos em barris de carvalho nobre.', 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=600&auto=format&fit=crop&q=80', 149.90, 129.90, 89.00, 'DEMO-WHISKY-12A', 'garrafa', 25, 4, true, true, true),
        (v_prod_gin, p_tenant_id, v_cat_destilados, 'Gin London Dry Artesanal 750ml', 'Destilado com zimbro selvagem, sementes de coentro e toques cítricos de limão siciliano.', 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80', 98.00, NULL, 54.00, 'DEMO-GIN-750', 'garrafa', 30, 5, true, false, true),
        (v_prod_vodka, p_tenant_id, v_cat_destilados, 'Vodka Premium Importada 750ml', 'Tridestilada e filtrada em carvão ativado para máxima pureza e suavidade.', 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=600&auto=format&fit=crop&q=80', 85.00, NULL, NULL, 'DEMO-VODKA-750', 'garrafa', 45, 5, true, false, true),

        -- Petiscos (unidade 'porcao', gastronomia, margem de custo)
        (v_prod_batata, p_tenant_id, v_cat_petiscos, 'Porção de Batata Frita Rústica Especial', 'Batatas cortadas artesanalmente com casca, alecrim fresco e sal marinho.', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80', 32.00, NULL, 9.50, 'DEMO-BATATA-RUST', 'porcao', 50, 10, true, false, true),
        (v_prod_calabresa, p_tenant_id, v_cat_petiscos, 'Porção de Calabresa Acebolada Flambada', 'Fatias de calabresa defumada douradas com cebola roxa e fatias de pão francês.', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80', 38.00, NULL, 12.00, 'DEMO-CALABRESA', 'porcao', 50, 10, true, false, true),

        -- Não Alcoólicos (unidade 'lata' e 'garrafa', alto giro)
        (v_prod_refrigerante, p_tenant_id, v_cat_nao_alcoolicos, 'Refrigerante Coca-Cola Original Lata 350ml', 'Refrigerante de cola geladíssimo pronto para o consumo.', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', 6.00, NULL, 3.10, 'DEMO-COCA-350', 'lata', 150, 24, true, false, true),
        (v_prod_agua, p_tenant_id, v_cat_nao_alcoolicos, 'Água Mineral com Gás 500ml', 'Água mineral natural gaseificada na fonte, leve e refrescante.', 'https://images.unsplash.com/photo-1560023907-5f339617ea30?w=600&auto=format&fit=crop&q=80', 4.50, NULL, 1.40, 'DEMO-AGUA-GAS', 'garrafa', 200, 30, true, false, true);

    -- ==========================================================================
    -- 3. Inserir Ofertas Demo (3 ofertas completas com cores, vigência e links)
    -- ==========================================================================
    INSERT INTO public.offers (
        id, tenant_id, product_id, title, subtitle, description, badge, 
        discount_percentage, original_price, promotional_price, image_url,
        internal_link, display_order, start_date, end_date, background_color, 
        accent_color, is_active, is_demo
    ) VALUES
        -- Oferta 1: Desconto, preço De/Por, Badge, Vinculada ao produto IPA, Verde Esmeralda
        (
            gen_random_uuid(), p_tenant_id, v_prod_ipa,
            'Festival de Cervejas Artesanais',
            'IPA Premium com 20% de Desconto Especial',
            'Aproveite a seleção especial da semana para degustar os melhores lúpulos artesanais com desconto exclusivo.',
            'OFERTA DA SEMANA', 20, 24.90, 19.90,
            'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=1200&h=500&auto=format&fit=crop&q=80',
            CASE WHEN v_tenant_slug IS NOT NULL THEN '/app/' || v_tenant_slug || '?product=' || v_prod_ipa::text ELSE NULL END,
            1, CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '28 days',
            '#15803d', '#4ade80', true, true
        ),
        -- Oferta 2: Vigência estendida, Bordô/Dourado nobre, Vinho Cabernet
        (
            gen_random_uuid(), p_tenant_id, v_prod_vinho_tinto,
            'Adega Reserva Seleção',
            'Vinho Cabernet Sauvignon por apenas R$ 49,90',
            'Rótulo premiado perfeito para acompanhar carnes nobres e jantares memoráveis. Edição limitada da safra selecionada.',
            'DESTAQUE', 17, 59.90, 49.90,
            'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&h=500&auto=format&fit=crop&q=80',
            CASE WHEN v_tenant_slug IS NOT NULL THEN '/app/' || v_tenant_slug || '?product=' || v_prod_vinho_tinto::text ELSE NULL END,
            2, CURRENT_DATE, CURRENT_DATE + INTERVAL '45 days',
            '#4a0404', '#fbbf24', true, true
        ),
        -- Oferta 3: Visual Dark Premium, Azul Petróleo/Ciano, Whisky 12 Anos
        (
            gen_random_uuid(), p_tenant_id, v_prod_whisky,
            'Combo Destilados Premium',
            'Whisky 12 Anos com Preço Especial de Boas-Vindas',
            'Garanta sua garrafa de 1 litro com condição imperdível por tempo limitado para abastecer seu bar particular.',
            'IMPERDÍVEL', 13, 149.90, 129.90,
            'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=1200&h=500&auto=format&fit=crop&q=80',
            CASE WHEN v_tenant_slug IS NOT NULL THEN '/app/' || v_tenant_slug || '?product=' || v_prod_whisky::text ELSE NULL END,
            3, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '60 days',
            '#0f172a', '#38bdf8', true, true
        );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_tenant_demo_catalog(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_tenant_demo_catalog(UUID) TO authenticated;
