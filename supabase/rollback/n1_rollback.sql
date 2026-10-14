-- ============================================================================
-- ROLLBACK MANUAL DA N1 — NÃO É MIGRATION. NUNCA É EXECUTADO AUTOMATICAMENTE.
-- Uso (somente após decisão do fundador, em staging primeiro):
--   BEGIN; SET LOCAL n1n6.rollback_confirm = 'N1'; \i supabase/rollback/n1_rollback.sql; COMMIT;
-- Pré-requisito: N2–N6 já revertidas (o script aborta se objetos delas existirem).
-- Efeito: restaura policies/funções de 001/012/014/020 e os privilégios de 010 em tenant_settings.
-- PERDA DE DADOS (por isso exige confirmação): remove tenant_payment_settings (chaves PIX
-- cadastradas após a N1 — a coluna legada tenant_settings.pix_key continua com o valor ORIGINAL),
-- security_rate_limits e as colunas orders.prep_time_minutes, orders.idempotency_key,
-- tenant_settings.default_prep_time_minutes. Nenhum pedido/cliente/oferta é apagado.
-- ============================================================================
DO $rb$
BEGIN
    IF current_setting('n1n6.rollback_confirm', true) IS DISTINCT FROM 'N1' THEN
        RAISE EXCEPTION 'Rollback N1 não confirmado: execute SET LOCAL n1n6.rollback_confirm = ''N1'' na mesma transação.';
    END IF;
    IF to_regclass('public.coupons') IS NOT NULL THEN
        RAISE EXCEPTION 'Rollback N1 abortado: N2 (coupons) ainda existe. Reverta N6..N2 antes.';
    END IF;
    IF to_regclass('public.tenant_payment_settings') IS NULL THEN
        RAISE EXCEPTION 'Rollback N1 abortado: N1 não está aplicada.';
    END IF;
END
$rb$;

DROP TRIGGER IF EXISTS trg_orders_protect_columns ON public.orders;
DROP TRIGGER IF EXISTS trg_order_items_protect ON public.order_items;
DROP TRIGGER IF EXISTS trg_orders_before_delete_guard ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_audit_changes ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_total_consistency ON public.orders;

DROP FUNCTION IF EXISTS public.update_order_status(uuid,text,text);
DROP FUNCTION IF EXISTS public.update_order_payment_status(uuid,text,text);
DROP FUNCTION IF EXISTS public.get_order_pix_payload(uuid);
DROP FUNCTION IF EXISTS public.upsert_tenant_payment_settings(uuid,boolean,text,text,text,text);
DROP FUNCTION IF EXISTS public._orders_protect_columns();
DROP FUNCTION IF EXISTS public._order_items_protect();
DROP FUNCTION IF EXISTS public._orders_before_delete_guard();
DROP FUNCTION IF EXISTS public._orders_audit_changes();
DROP FUNCTION IF EXISTS public._orders_total_consistency_check();
DROP FUNCTION IF EXISTS public._restock_order_items(uuid,text);
DROP FUNCTION IF EXISTS public._status_rank(text);
DROP FUNCTION IF EXISTS public._pix_brcode(text,text,text,numeric,text);
DROP FUNCTION IF EXISTS public._emv(text,text);
DROP FUNCTION IF EXISTS public._crc16_ccitt(text);
DROP FUNCTION IF EXISTS public._validate_pix_key(text,text);
DROP FUNCTION IF EXISTS public._pix_ascii(text,integer);
DROP FUNCTION IF EXISTS public._mask_pix_key(text);

-- Funções originais (texto literal de 014, 012 e 020)
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

CREATE OR REPLACE FUNCTION public.get_customer_order_by_id(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_order RECORD;
    v_items JSONB;
    v_history JSONB;
    v_result JSONB;
BEGIN
    -- 1. Validação estrita de autenticação: auth.uid() é obrigatório
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- 2. Localiza o pedido garantindo isolamento total por customer e tenant
    -- O pedido deve pertencer a um customer vinculado diretamente ao auth.uid()
    SELECT 
        o.id,
        o.order_number,
        o.tenant_id,
        o.customer_id,
        o.customer_name,
        o.customer_phone,
        o.customer_email,
        o.delivery_address,
        o.address_details,
        o.subtotal,
        o.delivery_fee,
        o.discount,
        o.total_amount,
        o.payment_method,
        o.payment_status,
        o.fulfillment_type,
        o.status,
        o.notes,
        o.origin,
        o.created_at,
        o.updated_at
    INTO v_order
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    WHERE o.id = p_order_id
      AND c.user_id = v_user_id;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado ou acesso não autorizado.';
    END IF;

    -- 3. Recupera itens oficiais do pedido com valores reais do banco
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'productId', oi.product_id,
                'productName', oi.product_name,
                'quantity', oi.quantity,
                'unitPrice', oi.unit_price,
                'totalPrice', oi.total_price,
                'notes', oi.notes,
                'unit', oi.unit
            )
            ORDER BY oi.id ASC
        ),
        '[]'::jsonb
    )
    INTO v_items
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

    -- 4. Recupera histórico oficial de status do pedido
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'status', osh.status,
                'timestamp', osh.created_at,
                'note', osh.note,
                'changedBy', osh.changed_by
            )
            ORDER BY osh.created_at ASC
        ),
        '[]'::jsonb
    )
    INTO v_history
    FROM public.order_status_history osh
    WHERE osh.order_id = v_order.id;

    -- 5. Monta o objeto oficial estruturado
    v_result := jsonb_build_object(
        'id', v_order.id,
        'orderNumber', v_order.order_number,
        'tenantId', v_order.tenant_id,
        'customerId', v_order.customer_id,
        'customerName', v_order.customer_name,
        'customerPhone', v_order.customer_phone,
        'customerEmail', v_order.customer_email,
        'deliveryAddress', v_order.delivery_address,
        'addressDetails', v_order.address_details,
        'subtotal', v_order.subtotal,
        'deliveryFee', v_order.delivery_fee,
        'discount', v_order.discount,
        'totalAmount', v_order.total_amount,
        'paymentMethod', v_order.payment_method,
        'paymentStatus', v_order.payment_status,
        'fulfillmentType', v_order.fulfillment_type,
        'status', v_order.status,
        'notes', v_order.notes,
        'origin', v_order.origin,
        'items', v_items,
        'statusHistory', v_history,
        'createdAt', v_order.created_at,
        'updatedAt', v_order.updated_at
    );

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_order_by_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_by_id(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public._seed_tenant_demo_catalog_internal(uuid);

-- Policies originais da 001
CREATE POLICY "orders_staff_update" ON public.orders
    FOR UPDATE USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'])
    );
CREATE POLICY "order_items_staff_manage" ON public.order_items
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = public.order_items.order_id 
              AND public.has_tenant_role(auth.uid(), o.tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR'])
        )
    );

-- Constraints/índices/colunas da N1
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_product_same_tenant;
DROP INDEX IF EXISTS public.idx_offers_tenant_product;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_total_consistency;  -- só existe se N1.V rodou
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_tenant_id_id_key;
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_tenant_id_id_key;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_tenant_id_id_key;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_tenant_id_id_key;
DROP INDEX IF EXISTS public.uq_orders_tenant_idempotency;
ALTER TABLE public.orders DROP COLUMN IF EXISTS prep_time_minutes, DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE public.tenant_settings DROP COLUMN IF EXISTS default_prep_time_minutes;
COMMENT ON COLUMN public.tenant_settings.pix_key IS NULL;

-- Privilégios de tenant_settings como na 010 (tabela inteira)
REVOKE ALL ON public.tenant_settings FROM anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.tenant_settings TO authenticated;

DROP TABLE IF EXISTS public.tenant_payment_settings;
DROP FUNCTION IF EXISTS public._request_ip_hash();
DROP FUNCTION IF EXISTS public._rate_limit_hit(text,text,uuid,integer,integer);
DROP FUNCTION IF EXISTS public._sha256_hex(text);
DROP TABLE IF EXISTS public.security_rate_limits;
DROP FUNCTION IF EXISTS public._tenant_role_of_caller(uuid);
DROP FUNCTION IF EXISTS public.is_tenant_owner_or_manager(uuid);
DROP FUNCTION IF EXISTS public.has_tenant_scoped_role(uuid,text[]);
DROP FUNCTION IF EXISTS public.set_updated_at();

-- Restauração EXATA dos privilégios de 001–020 (anon, authenticated e PUBLIC) a partir da
-- fotografia feita pela N1 em public.n1n6_privileges_backup. Só mexe em objetos cuja ACL mudou.
-- Atenção: se a produção tinha grants amplos (default privileges legados), eles VOLTAM.
DO $acl$
DECLARE
    b RECORD;
    g RECORD;
    v_cur aclitem[];
    v_cols TEXT;
BEGIN
    IF to_regclass('public.n1n6_privileges_backup') IS NULL THEN
        RAISE NOTICE 'Rollback N1: sem backup de privilégios; ACLs não restauradas.';
        RETURN;
    END IF;
    -- Tabelas (nível tabela) e colunas
    FOR b IN SELECT * FROM public.n1n6_privileges_backup WHERE object_type = 'table' AND to_regclass(object_name) IS NOT NULL LOOP
        SELECT relacl INTO v_cur FROM pg_class WHERE oid = b.object_name::regclass;
        SELECT string_agg(quote_ident(a.attname), ', ') INTO v_cols FROM pg_attribute a
        WHERE a.attrelid = b.object_name::regclass AND a.attnum > 0 AND NOT a.attisdropped;
        IF v_cur IS DISTINCT FROM b.acl OR EXISTS (
               SELECT 1 FROM pg_attribute a WHERE a.attrelid = b.object_name::regclass AND a.attnum > 0 AND NOT a.attisdropped
                 AND a.attacl IS DISTINCT FROM (SELECT x.acl FROM public.n1n6_privileges_backup x WHERE x.object_type = 'column'
                                                AND x.object_name = b.object_name AND x.column_name = a.attname)) THEN
            EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', b.object_name);
            EXECUTE format('REVOKE ALL (%s) ON TABLE %s FROM PUBLIC, anon, authenticated', v_cols, b.object_name);
            FOR g IN SELECT CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS who, e.privilege_type
                     FROM aclexplode(b.acl) e LEFT JOIN pg_roles r ON r.oid = e.grantee
                     WHERE b.acl IS NOT NULL AND cardinality(b.acl) > 0 AND (e.grantee = 0 OR r.rolname IN ('anon','authenticated')) LOOP
                EXECUTE format('GRANT %s ON TABLE %s TO %s', g.privilege_type, b.object_name, g.who);
            END LOOP;
            FOR g IN SELECT x.column_name, CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS who, e.privilege_type
                     FROM public.n1n6_privileges_backup x
                     CROSS JOIN LATERAL aclexplode(x.acl) e LEFT JOIN pg_roles r ON r.oid = e.grantee
                     WHERE x.object_type = 'column' AND x.object_name = b.object_name AND cardinality(x.acl) > 0
                       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = b.object_name::regclass AND a.attname = x.column_name AND NOT a.attisdropped)
                       AND (e.grantee = 0 OR r.rolname IN ('anon','authenticated')) LOOP
                EXECUTE format('GRANT %s (%I) ON TABLE %s TO %s', g.privilege_type, g.column_name, b.object_name, g.who);
            END LOOP;
        END IF;
    END LOOP;
    -- Funções (proacl NULL = default: EXECUTE para PUBLIC)
    FOR b IN SELECT * FROM public.n1n6_privileges_backup WHERE object_type = 'function' AND to_regprocedure(object_name) IS NOT NULL LOOP
        SELECT proacl INTO v_cur FROM pg_proc WHERE oid = b.object_name::regprocedure;
        IF v_cur IS DISTINCT FROM b.acl THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', b.object_name);
            IF b.acl IS NULL THEN
                EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', b.object_name);
            ELSIF cardinality(b.acl) > 0 THEN
                FOR g IN SELECT CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS who
                         FROM aclexplode(b.acl) e LEFT JOIN pg_roles r ON r.oid = e.grantee
                         WHERE e.privilege_type = 'EXECUTE' AND (e.grantee = 0 OR r.rolname IN ('anon','authenticated')) LOOP
                    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', b.object_name, g.who);
                END LOOP;
            END IF;
        END IF;
    END LOOP;
END
$acl$;
DROP TABLE IF EXISTS public.n1n6_privileges_backup;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000100';
