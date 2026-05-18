import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// Accept either name. `VITE_SUPABASE_PUBLISHABLE_KEY` matches the parent
// inventory app; `VITE_SUPABASE_ANON_KEY` is the older Supabase convention.
// They hold the same value — both work.
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  (import.meta.env as Record<string, string | undefined>)['VITE_SUPABASE_ANON_KEY'];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) in .env.'
  );
}

/**
 * Single Supabase client shared with the parent inventory app
 * (`app.medstocksy.in`). Same project = same auth session = SSO.
 *
 * Auth tokens persist in localStorage with key `sb-<project-ref>-auth-token`.
 * If the user signs into the inventory app, opening medcrm in the same browser
 * picks up the session automatically — no second login.
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-application-name': 'medcrm-v1' },
  },
});

/** Type-safe table references — use throughout the app. */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type Inserts<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type Updates<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
