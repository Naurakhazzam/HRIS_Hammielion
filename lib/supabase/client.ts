/**
 * lib/supabase/client.ts
 * Supabase client untuk digunakan di Client Components (browser-side).
 * Gunakan file ini di komponen dengan directive 'use client'.
 */

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
