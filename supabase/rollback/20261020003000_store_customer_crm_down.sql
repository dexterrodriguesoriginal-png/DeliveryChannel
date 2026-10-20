BEGIN;

DROP FUNCTION IF EXISTS public.crm_register_my_store_customer(uuid, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.crm_get_my_contact_consent(uuid);
DROP FUNCTION IF EXISTS public.crm_get_customer_contact_target(uuid, uuid);
DROP FUNCTION IF EXISTS public.crm_set_my_contact_consent(uuid, boolean);
DROP FUNCTION IF EXISTS public.crm_export_customers(uuid, text, text);
DROP FUNCTION IF EXISTS public.crm_hide_customer(uuid, uuid);
DROP FUNCTION IF EXISTS public.crm_save_customer_private_data(uuid, uuid, text, text[]);
DROP FUNCTION IF EXISTS public.crm_update_manual_customer(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.crm_create_manual_customer(uuid, text, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.crm_get_customer_orders(uuid, uuid);
DROP FUNCTION IF EXISTS public.crm_list_customers(uuid, text, text, integer, integer);
DROP FUNCTION IF EXISTS public._customer_crm_can_manage_tenant(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public._customer_crm_audit(uuid, uuid, text);
DROP TRIGGER IF EXISTS customer_crm_hide_deleted_account ON public.customer_account_deletion_requests;
DROP FUNCTION IF EXISTS public._customer_crm_hide_deleted_account();
DROP TRIGGER IF EXISTS customer_crm_protect_app_customer_fields ON public.customers;
DROP FUNCTION IF EXISTS public._customer_crm_protect_app_customer_fields();
DROP TRIGGER IF EXISTS customer_crm_seed_profile ON public.customers;
DROP FUNCTION IF EXISTS public._customer_crm_seed_profile();

DROP TABLE IF EXISTS public.customer_crm_audit;
DROP TABLE IF EXISTS public.customer_crm_profiles;

GRANT EXECUTE ON FUNCTION public.get_tenant_customers_summary(uuid, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_orders_history(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_customer_manual(uuid, character varying, character varying, character varying, character varying, boolean) TO authenticated;

COMMIT;
