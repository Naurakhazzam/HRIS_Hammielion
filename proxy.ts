/**
 * proxy.ts  (sebelumnya middleware.ts — diubah sesuai konvensi Next.js 16)
 * Proxy Next.js untuk mengelola session Supabase Auth secara otomatis.
 * Berjalan di setiap request sebelum halaman dirender.
 *
 * Fungsi utama:
 * - Refresh access token Supabase yang kedaluwarsa
 * - Redirect ke /login jika user belum terautentikasi (untuk route yang dilindungi)
 * - Redirect ke /dashboard jika user sudah login tapi mengakses /login
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Route yang tidak memerlukan autentikasi
const PUBLIC_ROUTES = ['/login', '/auth/callback']

// Route yang hanya bisa diakses sebelum login
const AUTH_ROUTES = ['/login']

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — JANGAN hapus baris ini
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Jika user belum login dan mengakses route yang dilindungi → redirect ke /login
  if (!user && !PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  // Jika user sudah login dan mengakses halaman auth → redirect ke /dashboard
  if (user && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    const dashboardUrl = request.nextUrl.clone()
    dashboardUrl.pathname = '/dashboard'
    return NextResponse.redirect(dashboardUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Jalankan proxy pada semua path KECUALI:
     * - _next/static  (file static Next.js)
     * - _next/image   (optimisasi gambar Next.js)
     * - favicon.ico   (icon browser)
     * - file dengan ekstensi (gambar, font, dll)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
