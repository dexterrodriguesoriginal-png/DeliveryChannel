// JWT is verified with Auth.getUser in the handler, including ES256 signing keys.
// The service role is used only after validating OWNER/MANAGER in the requested store.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createWaiterAdminHandler } from './handler.ts';

Deno.serve(createWaiterAdminHandler(createClient, {
  url: Deno.env.get('SUPABASE_URL') ?? '',
  anon: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  service: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
}));
