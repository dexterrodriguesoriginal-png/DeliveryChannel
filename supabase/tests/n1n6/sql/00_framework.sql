-- Mini-framework de testes SQL (somente banco LOCAL de teste). Sem pgTAP.
CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE IF NOT EXISTS t.results (
    id      BIGSERIAL PRIMARY KEY,
    suite   TEXT NOT NULL DEFAULT COALESCE(current_setting('t.suite', true), '?'),
    name    TEXT NOT NULL,
    ok      BOOLEAN NOT NULL,
    detail  TEXT,
    at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
GRANT USAGE ON SCHEMA t TO PUBLIC;
GRANT ALL ON ALL TABLES IN SCHEMA t TO PUBLIC;
GRANT ALL ON ALL SEQUENCES IN SCHEMA t TO PUBLIC;

CREATE OR REPLACE FUNCTION t.ok(p_cond BOOLEAN, p_name TEXT, p_detail TEXT DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO t.results(name, ok, detail) VALUES (p_name, COALESCE(p_cond, false),
        CASE WHEN COALESCE(p_cond, false) THEN NULL ELSE COALESCE(p_detail, 'condição falsa/NULL') END);
    IF NOT COALESCE(p_cond, false) THEN
        RAISE WARNING 'FALHOU: % — %', p_name, COALESCE(p_detail, 'condição falsa/NULL');
    END IF;
    RETURN COALESCE(p_cond, false);
END $$;

CREATE OR REPLACE FUNCTION t.is(p_got ANYELEMENT, p_exp ANYELEMENT, p_name TEXT)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    RETURN t.ok(p_got IS NOT DISTINCT FROM p_exp, p_name, format('obtido=%s esperado=%s', p_got, p_exp));
END $$;

-- Executa SQL com o papel atual; passa se lançar erro cuja mensagem casa com p_pattern (regex, case-insensitive).
CREATE OR REPLACE FUNCTION t.throws(p_sql TEXT, p_pattern TEXT, p_name TEXT)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_msg TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        RETURN t.ok(v_msg ~* p_pattern, p_name, format('erro "%s" não casa com /%s/', v_msg, p_pattern));
    END;
    RETURN t.ok(false, p_name, format('esperava erro /%s/, mas executou sem erro', p_pattern));
END $$;

CREATE OR REPLACE FUNCTION t.lives(p_sql TEXT, p_name TEXT)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_msg TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        RETURN t.ok(false, p_name, 'erro inesperado: ' || v_msg);
    END;
    RETURN t.ok(true, p_name);
END $$;

-- Conta linhas visíveis para o papel atual (respeita RLS); -1 se sem privilégio.
CREATE OR REPLACE FUNCTION t.visible(p_sql TEXT)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v BIGINT;
BEGIN
    BEGIN
        EXECUTE 'SELECT count(*) FROM (' || p_sql || ') x' INTO v;
    EXCEPTION WHEN insufficient_privilege THEN
        RETURN -1;
    END;
    RETURN v;
END $$;

CREATE OR REPLACE FUNCTION t.scalar(p_sql TEXT)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
    EXECUTE p_sql INTO v;
    RETURN v;
END $$;

-- Simula a sessão do PostgREST: claims do JWT (o papel é trocado com SET ROLE no script).
CREATE OR REPLACE FUNCTION t.login(p_uid UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false);
    PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
