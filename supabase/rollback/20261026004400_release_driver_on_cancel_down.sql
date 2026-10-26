-- Remove o gatilho; status de entregadores já liberados permanece (não é revertido para ON_DELIVERY).
BEGIN;
DROP TRIGGER orders_release_driver ON public.orders;
DROP FUNCTION public._orders_release_driver();
DROP FUNCTION public._release_driver_if_idle(uuid, uuid);
COMMIT;
