-- ==============================================================================
-- ADEGAFOOD — MIGRATION 012: MULTI-TENANT STORAGE, POLICIES & DEMO CATALOG
-- ==============================================================================

-- 1. ADICIONAR CAMPO is_demo NAS TABELAS DE CATÁLOGO
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_categories_demo ON public.categories(tenant_id, is_demo);
CREATE INDEX IF NOT EXISTS idx_products_demo ON public.products(tenant_id, is_demo);
CREATE INDEX IF NOT EXISTS idx_offers_demo ON public.offers(tenant_id, is_demo);

-- 2. CRIAÇÃO DO BUCKET 'catalog' NO SUPABASE STORAGE
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'catalog',
    'catalog',
    true,
    5242880, -- 5 MB
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 3. FUNÇÃO AUXILIAR DE SEGURANÇA PARA STORAGE MULTI-TENANT
-- Valida se o usuário autenticado possui permissão de OWNER ou MANAGER no tenant
-- especificado no primeiro segmento do caminho do arquivo: {tenant_id}/{entity_type}/{filename}
CREATE OR REPLACE FUNCTION public.can_manage_catalog_storage(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_first_segment TEXT;
    v_tenant_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Extrai o primeiro segmento do caminho
    v_first_segment := split_part(p_name, '/', 1);

    -- Valida formato UUID padrão
    IF v_first_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;

    v_tenant_id := v_first_segment::uuid;

    -- Valida permissão estrita na tabela tenant_users
    RETURN public.has_tenant_role(v_user_id, v_tenant_id, ARRAY['OWNER', 'MANAGER']);
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_catalog_storage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_catalog_storage(TEXT) TO authenticated;

-- 4. POLICIES DE RLS PARA storage.objects
-- Leitura pública das imagens do catálogo
DROP POLICY IF EXISTS "catalog_public_read" ON storage.objects;
CREATE POLICY "catalog_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'catalog');

-- Inserção restrita a OWNER/MANAGER do tenant proprietário
DROP POLICY IF EXISTS "catalog_owner_manager_insert" ON storage.objects;
CREATE POLICY "catalog_owner_manager_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'catalog'
    AND public.can_manage_catalog_storage(name)
);

-- Atualização restrita ao tenant proprietário
DROP POLICY IF EXISTS "catalog_owner_manager_update" ON storage.objects;
CREATE POLICY "catalog_owner_manager_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'catalog'
    AND public.can_manage_catalog_storage(name)
)
WITH CHECK (
    bucket_id = 'catalog'
    AND public.can_manage_catalog_storage(name)
);

-- Exclusão restrita ao tenant proprietário
DROP POLICY IF EXISTS "catalog_owner_manager_delete" ON storage.objects;
CREATE POLICY "catalog_owner_manager_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'catalog'
    AND public.can_manage_catalog_storage(name)
);

-- 5. FUNÇÃO PARA GERAR CATÁLOGO DE DEMONSTRAÇÃO
CREATE OR REPLACE FUNCTION public.seed_tenant_demo_catalog(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cat_cervejas UUID := gen_random_uuid();
    v_cat_vinhos UUID := gen_random_uuid();
    v_cat_destilados UUID := gen_random_uuid();
    v_cat_petiscos UUID := gen_random_uuid();
    v_cat_nao_alcoolicos UUID := gen_random_uuid();

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

    -- A. Inserir Categorias Demo
    INSERT INTO public.categories (id, tenant_id, name, description, image_url, display_order, is_active, is_demo)
    VALUES
        (v_cat_cervejas, p_tenant_id, 'Cervejas & Chopp', 'Cervejas artesanais, pilsen, IPAs e importadas estupidamente geladas.', 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=600&auto=format&fit=crop&q=80', 1, true, true),
        (v_cat_vinhos, p_tenant_id, 'Vinhos & Espumantes', 'Rótulos nacionais e importados selecionados para todas as ocasiões.', 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80', 2, true, true),
        (v_cat_destilados, p_tenant_id, 'Destilados & Whiskies', 'Whiskies clássicos, gins artesanais, vodkas e cachaças nobres.', 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=600&auto=format&fit=crop&q=80', 3, true, true),
        (v_cat_petiscos, p_tenant_id, 'Petiscos & Aperitivos', 'Acompanhamentos ideais, queijos, castanhas e porções preparadas na hora.', 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=600&auto=format&fit=crop&q=80', 4, true, true),
        (v_cat_nao_alcoolicos, p_tenant_id, 'Bebidas Sem Álcool', 'Refrigerantes, energéticos, sucos integrais e águas minerais.', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', 5, true, true);

    -- B. Inserir Produtos Demo
    INSERT INTO public.products (
        id, tenant_id, category_id, name, description, image_url, price, promotional_price, 
        sku, unit, stock_quantity, min_stock_alert, is_active, is_featured, is_demo
    ) VALUES
        -- Cervejas
        (v_prod_heineken, p_tenant_id, v_cat_cervejas, 'Cerveja Heineken Long Neck 330ml', 'Cerveja puro malte refrescante com sabor característico e lúpulo de qualidade.', 'https://images.unsplash.com/photo-1618886614638-80e3c153d31a?w=600&auto=format&fit=crop&q=80', 12.00, NULL, 'DEMO-HEIN', 'un', 120, 10, true, true, true),
        (v_prod_corona, p_tenant_id, v_cat_cervejas, 'Cerveja Corona Extra 330ml', 'Cerveja mexicana leve e refrescante, ideal para saborear com uma fatia de limão.', 'https://images.unsplash.com/photo-1608270199042-32b0a68d0ee5?w=600&auto=format&fit=crop&q=80', 13.50, NULL, 'DEMO-CORONA', 'un', 95, 10, true, false, true),
        (v_prod_ipa, p_tenant_id, v_cat_cervejas, 'Cerveja Artesanal IPA Premium 500ml', 'India Pale Ale com aroma cítrico intenso, notas florais e amargor equilibrado.', 'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=600&auto=format&fit=crop&q=80', 24.90, 19.90, 'DEMO-IPA', 'un', 60, 5, true, true, true),
        
        -- Vinhos
        (v_prod_vinho_tinto, p_tenant_id, v_cat_vinhos, 'Vinho Tinto Cabernet Sauvignon 750ml', 'Vinho tinto fino seco com taninos maduros, notas de frutas vermelhas e carvalho.', 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=600&auto=format&fit=crop&q=80', 59.90, 49.90, 'DEMO-VTINTO', 'un', 40, 5, true, true, true),
        (v_prod_vinho_branco, p_tenant_id, v_cat_vinhos, 'Vinho Branco Sauvignon Blanc 750ml', 'Aromas frescos de frutas tropicais e acidez vibrante. Perfeito bem gelado.', 'https://images.unsplash.com/photo-1584916201218-f4242ceb4809?w=600&auto=format&fit=crop&q=80', 54.00, NULL, 'DEMO-VBRANCO', 'un', 35, 5, true, false, true),

        -- Destilados
        (v_prod_whisky, p_tenant_id, v_cat_destilados, 'Whisky Escocês 12 Anos 1L', 'Blended Scotch Whisky maturado por 12 anos em barris de carvalho nobre.', 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=600&auto=format&fit=crop&q=80', 149.90, 129.90, 'DEMO-WHISKY', 'un', 25, 3, true, true, true),
        (v_prod_gin, p_tenant_id, v_cat_destilados, 'Gin London Dry Artesanal 750ml', 'Destilado com zimbro selvagem, sementes de coentro e toques cítricos de limão siciliano.', 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80', 98.00, NULL, 'DEMO-GIN', 'un', 30, 5, true, false, true),
        (v_prod_vodka, p_tenant_id, v_cat_destilados, 'Vodka Premium Importada 750ml', 'Tridestilada e filtrada em carvão ativado para máxima pureza e suavidade.', 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=600&auto=format&fit=crop&q=80', 85.00, NULL, 'DEMO-VODKA', 'un', 45, 5, true, false, true),

        -- Petiscos
        (v_prod_batata, p_tenant_id, v_cat_petiscos, 'Porção de Batata Frita Rústica Especial', 'Batatas cortadas artesanalmente com casca, alecrim fresco e sal marinho.', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80', 32.00, NULL, 'DEMO-BATATA', 'un', 50, 10, true, false, true),
        (v_prod_calabresa, p_tenant_id, v_cat_petiscos, 'Porção de Calabresa Acebolada Flambada', 'Fatias de calabresa defumada douradas com cebola roxa e fatias de pão francês.', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80', 38.00, NULL, 'DEMO-CALAB', 'un', 50, 10, true, false, true),

        -- Não Alcoólicos
        (v_prod_refrigerante, p_tenant_id, v_cat_nao_alcoolicos, 'Refrigerante Coca-Cola Original Lata 350ml', 'Refrigerante de cola geladíssimo pronto para o consumo.', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', 6.00, NULL, 'DEMO-COCA', 'un', 150, 20, true, false, true),
        (v_prod_agua, p_tenant_id, v_cat_nao_alcoolicos, 'Água Mineral com Gás 500ml', 'Água mineral natural gaseificada na fonte, leve e refrescante.', 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=600&auto=format&fit=crop&q=80', 4.50, NULL, 'DEMO-AGUA', 'un', 200, 25, true, false, true);

    -- C. Inserir Ofertas Demo
    INSERT INTO public.offers (
        id, tenant_id, product_id, title, subtitle, description, badge, 
        discount_percentage, original_price, promotional_price, image_url, 
        display_order, is_active, is_demo
    ) VALUES
        (
            gen_random_uuid(), p_tenant_id, v_prod_ipa,
            'Festival de Cervejas Artesanais',
            'IPA Premium com 20% de Desconto Especial',
            'Aproveite a seleção especial da semana para degustar os melhores lúpulos artesanais.',
            'OFERTA DA SEMANA', 20, 24.90, 19.90,
            'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=1200&h=500&auto=format&fit=crop&q=80',
            1, true, true
        ),
        (
            gen_random_uuid(), p_tenant_id, v_prod_vinho_tinto,
            'Adega Reserva Seleção',
            'Vinho Cabernet Sauvignon por apenas R$ 49,90',
            'Rótulo premiado perfeito para acompanhar carnes nobres e jantares memoráveis.',
            'DESTAQUE', 17, 59.90, 49.90,
            'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&h=500&auto=format&fit=crop&q=80',
            2, true, true
        ),
        (
            gen_random_uuid(), p_tenant_id, v_prod_whisky,
            'Combo Destilados Premium',
            'Whisky 12 Anos com Preço Promocional de Inauguração',
            'Garanta sua garrafa de 1 litro com condição imperdível por tempo limitado.',
            'IMPERDÍVEL', 13, 149.90, 129.90,
            'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=1200&h=500&auto=format&fit=crop&q=80',
            3, true, true
        );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_tenant_demo_catalog(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_tenant_demo_catalog(UUID) TO authenticated;

-- 6. TRIGGER PARA CRIAR CATÁLOGO DEMO AUTOMATICAMENTE EM NOVOS ESTABELECIMENTOS
CREATE OR REPLACE FUNCTION public.trg_seed_tenant_demo_catalog()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.seed_tenant_demo_catalog(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_seed_demo_catalog ON public.tenants;
CREATE TRIGGER trg_auto_seed_demo_catalog
    AFTER INSERT ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_seed_tenant_demo_catalog();

-- 7. RPC SEGURA PARA O PROPRIETÁRIO REMOVER SOMENTE O CATÁLOGO DEMO DO SEU ESTABELECIMENTO
CREATE OR REPLACE FUNCTION public.remove_demo_catalog_for_current_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_target_tenant_id UUID;
    v_deleted_offers INT := 0;
    v_deleted_products INT := 0;
    v_deleted_categories INT := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- Se o tenant_id foi fornecido, valida se o usuário possui cargo de OWNER ou MANAGER
    IF p_tenant_id IS NOT NULL THEN
        IF NOT public.has_tenant_role(v_user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
            RAISE EXCEPTION 'Permissão negada para gerenciar catálogo de demonstração deste estabelecimento.';
        END IF;
        v_target_tenant_id := p_tenant_id;
    ELSE
        -- Busca tenant ativo onde o usuário possui papel de OWNER
        SELECT tenant_id INTO v_target_tenant_id
        FROM public.tenant_users
        WHERE user_id = v_user_id AND role_id = 'OWNER' AND status = 'ACTIVE'
        LIMIT 1;

        IF v_target_tenant_id IS NULL THEN
            RAISE EXCEPTION 'Nenhum estabelecimento comercial ativo encontrado para este usuário.';
        END IF;
    END IF;

    -- 1. Excluir ofertas de demonstração
    WITH deleted_o AS (
        DELETE FROM public.offers
        WHERE tenant_id = v_target_tenant_id AND is_demo = true
        RETURNING id
    )
    SELECT count(*) INTO v_deleted_offers FROM deleted_o;

    -- 2. Excluir produtos de demonstração (preserva se houver vínculo com pedidos de teste)
    WITH deleted_p AS (
        DELETE FROM public.products
        WHERE tenant_id = v_target_tenant_id 
          AND is_demo = true
          AND id NOT IN (SELECT product_id FROM public.order_items WHERE product_id IS NOT NULL)
        RETURNING id
    )
    SELECT count(*) INTO v_deleted_products FROM deleted_p;

    -- 3. Excluir categorias de demonstração (somente se não houver produtos reais remanescentes nela)
    WITH deleted_c AS (
        DELETE FROM public.categories
        WHERE tenant_id = v_target_tenant_id 
          AND is_demo = true
          AND id NOT IN (SELECT category_id FROM public.products WHERE category_id IS NOT NULL)
        RETURNING id
    )
    SELECT count(*) INTO v_deleted_categories FROM deleted_c;

    RETURN jsonb_build_object(
        'success', true,
        'tenantId', v_target_tenant_id,
        'deletedOffers', v_deleted_offers,
        'deletedProducts', v_deleted_products,
        'deletedCategories', v_deleted_categories
    );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_demo_catalog_for_current_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_demo_catalog_for_current_tenant(UUID) TO authenticated;
