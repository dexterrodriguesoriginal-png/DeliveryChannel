BEGIN;
DROP FUNCTION IF EXISTS public.ceo_store_feedback_counts();
DROP FUNCTION IF EXISTS public.set_store_feedback_state(text,uuid,boolean,boolean);
DROP FUNCTION IF EXISTS public.list_store_feedback(text,text,text,date,date,text,integer);
DROP FUNCTION IF EXISTS public._feedback_my_store(text);
DROP FUNCTION IF EXISTS public.submit_store_feedback(text,text,text,text,integer,text,text,date);
DROP TABLE IF EXISTS public.store_feedback_limits;
DROP TABLE IF EXISTS public.store_feedback;
COMMIT;
