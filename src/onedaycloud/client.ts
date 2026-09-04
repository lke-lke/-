import { createClient as sdkCreateClient } from '@ali/oneday-frontend-sdk';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { DATA_MODE } from '@/services/db';

interface OneDayClientShape {
  supabase: any;
  [key: string]: any;
}

function tryCreateClient(): OneDayClientShape | null {
  if (DATA_MODE === 'supabase') {
    const url = process.env.APP_SUPABASE_URL;
    const anonKey = process.env.APP_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error('[supabase] 缺少 APP_SUPABASE_URL 或 APP_SUPABASE_ANON_KEY');
      return null;
    }
    return { supabase: createSupabaseClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }) };
  }
  if (DATA_MODE !== 'oneday') return null;
  try {
    const client = sdkCreateClient();
    if (client?.supabase) {
      console.log('[oneday] SDK client created successfully');
      return client as unknown as OneDayClientShape;
    }
    console.warn('[oneday] SDK createClient returned no supabase');
    return null;
  } catch (err: any) {
    console.warn('[oneday] SDK init failed:', err.message);
    return null;
  }
}

export let oneday: OneDayClientShape | null = tryCreateClient();

if (!oneday && DATA_MODE === 'oneday') {
  setTimeout(() => {
    if (!oneday) {
      oneday = tryCreateClient();
      if (oneday) console.log('[oneday] SDK delayed retry succeeded');
    }
  }, 2000);
}

export function ensureOnedayClient(): OneDayClientShape | null {
  if (!oneday) oneday = tryCreateClient();
  return oneday;
}
