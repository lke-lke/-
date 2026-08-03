import { createClient as sdkCreateClient } from '@ali/oneday-frontend-sdk';

interface OneDayClientShape {
  supabase: any;
  [key: string]: any;
}

function tryCreateClient(): OneDayClientShape | null {
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

if (!oneday) {
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
