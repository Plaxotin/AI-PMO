import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { isSupabaseConfigured } from '@/lib/config';

export type AuthResult =
  | { mode: 'disabled'; userId: null }
  | { mode: 'authenticated'; userId: string }
  | { mode: 'unauthenticated' };

/**
 * BL1-0: auth skeleton. When Supabase env is set, requires a session.
 * When not configured, returns mode `disabled` (see X-Auth-Status header in routes).
 */
export async function getAuthResult(): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { mode: 'disabled', userId: null };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    return { mode: 'disabled', userId: null };
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from Server Component without mutable cookies — ignore.
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { mode: 'unauthenticated' };
  }

  return { mode: 'authenticated', userId: user.id };
}

export function authHeaders(auth: AuthResult): Record<string, string> {
  if (auth.mode === 'disabled') {
    return { 'X-Auth-Status': 'todo-supabase-not-configured' };
  }
  if (auth.mode === 'unauthenticated') {
    return { 'X-Auth-Status': 'unauthenticated' };
  }
  return { 'X-Auth-Status': 'authenticated' };
}
