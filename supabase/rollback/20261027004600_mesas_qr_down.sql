-- Reverts 20261027004600_mesas_qr.sql. Removes only objects created by it.
-- Data loss: PIX charge history (tab_pix_charges) and QR pauses. Orders, tabs, payments (tab_payments) and sessions are preserved.
-- Any tab already closed by a PIX keeps its tab_payments row (method PIX) and its TAB_CLOSED event.
BEGIN;
DROP FUNCTION IF EXISTS public.mesas_qr_capabilities();
DROP FUNCTION IF EXISTS public.anonymize_old_tab_sessions(integer);
DROP FUNCTION IF EXISTS public.cancel_tab_pix(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_tab_pix_charge(uuid, uuid);
DROP FUNCTION IF EXISTS public.confirm_tab_pix(uuid, jsonb);
DROP FUNCTION IF EXISTS public.fail_tab_pix_charge(uuid);
DROP FUNCTION IF EXISTS public.save_tab_pix_charge(uuid, jsonb);
DROP FUNCTION IF EXISTS public.reserve_tab_pix(uuid, uuid);
DROP TRIGGER IF EXISTS orders_dine_in_guard ON public.orders;
DROP FUNCTION IF EXISTS public._orders_dine_in_guard();
DROP TRIGGER IF EXISTS dining_tables_rotate_guard ON public.dining_tables;
DROP FUNCTION IF EXISTS public._dining_tables_rotate_guard();
DROP TRIGGER IF EXISTS dining_tables_name_guard ON public.dining_tables;
DROP FUNCTION IF EXISTS public._dining_tables_name_guard();
DROP TRIGGER IF EXISTS waiter_calls_guard ON public.waiter_calls;
DROP FUNCTION IF EXISTS public._waiter_calls_guard();
DROP TRIGGER IF EXISTS tab_sessions_guard ON public.tab_sessions;
DROP FUNCTION IF EXISTS public._tab_sessions_guard();
DROP FUNCTION IF EXISTS public._tab_pix_staff(uuid, uuid);
DROP FUNCTION IF EXISTS public._tab_total_cents(uuid, uuid);
DROP TABLE IF EXISTS public.tab_pix_charges;
DROP FUNCTION IF EXISTS public.get_table_qr_status(text);
DROP FUNCTION IF EXISTS public.set_dining_qr_pause(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public._qr_paused(uuid, uuid);
DROP TABLE IF EXISTS public.dining_qr_pauses;
COMMIT;
