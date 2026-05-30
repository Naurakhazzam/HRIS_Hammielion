/**
 * lib/supabase/server.ts
 * Supabase client untuk digunakan di Server Components & Server Actions.
 * Menggunakan cookies() dari Next.js untuk membaca/menulis session.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll dipanggil dari Server Component — abaikan error ini.
            // Middleware akan menangani refresh session.
          }
        },
      },
    }
  )
}
