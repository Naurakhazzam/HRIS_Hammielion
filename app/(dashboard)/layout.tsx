import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

import Sidebar from '@/components/sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verifikasi session di sisi server sebagai lapisan keamanan tambahan
  // (middleware sudah menjaga, ini adalah double-check)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 px-4 sm:px-6 z-10 sticky top-0">
        <div className="flex items-center justify-between h-16 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3 w-64 flex-shrink-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <span className="font-semibold text-slate-800 text-sm hidden sm:block">
              Hammielion HRIS
            </span>
          </div>

          {/* Info User & Logout */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 hidden sm:block">
              {user.email}
            </span>
            <form action="/auth/logout" method="POST">
              <button
                type="submit"
                id="btn-logout"
                className="text-xs text-slate-600 hover:text-red-600 font-medium
                           border border-slate-200 hover:border-red-200
                           px-3 py-1.5 rounded-lg transition"
              >
                Keluar
              </button>
            </form>
          </div>
        </div>
      </nav>

      {/* Konten Utama dengan Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
