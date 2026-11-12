BEGIN;
DO $$ DECLARE f record; BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
   PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='antibot-cleanup';
 END IF;
 -- Restore full original functions before removing the private copies they replace.
 FOR f IN SELECT * FROM private.antibot_originals LOOP
   EXECUTE f.definition;
   EXECUTE 'DROP FUNCTION ' || f.private_signature;
 END LOOP;
END $$;
DROP FUNCTION private.antibot_guard(text,text,boolean);
DROP FUNCTION private.antibot_cleanup();
DROP TABLE private.antibot_originals,private.antibot_config,public.antibot_counters,public.antibot_audit;
NOTIFY pgrst,'reload schema';
COMMIT;
