'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './sidebar'

export default function DashboardShell({ children, userEmail }: { children: React.ReactNode; userEmail: string }) {
  // null = belum disentuh user, ikuti perilaku bawaan (tampil di layar >=768px, sembunyi di bawahnya).
  // true/false = override manual dari tombol hamburger.
  const [forceOpen, setForceOpen] = useState<boolean | null>(null)
  const pathname = usePathname()

  // Tutup otomatis setelah pindah halaman, tapi cuma di layar kecil (di layar besar,
  // sidebar yang sengaja dibuka lagi jangan ikut tertutup tiap klik menu — mengganggu).
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) {
      setForceOpen(false)
    }
  }, [pathname])

  function toggleSidebar() {
    setForceOpen(prev => {
      if (prev !== null) return !prev
      const isDesktop = window.matchMedia('(min-width: 768px)').matches
      return !isDesktop
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 px-4 sm:px-6 z-30 sticky top-0">
        <div className="flex items-center justify-between h-16 w-full">
          {/* Toggle + Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={toggleSidebar}
              aria-label="Buka/tutup menu"
              className="p-2 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-3">
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
          </div>

          {/* Info User & Logout */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 hidden sm:block">
              {userEmail}
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
      <div className="flex flex-1 overflow-hidden relative">
        {forceOpen === true && (
          <div
            className="fixed inset-0 top-16 bg-slate-900/40 z-20 md:hidden"
            onClick={() => setForceOpen(false)}
          />
        )}
        <Sidebar forceOpen={forceOpen} onNavigate={() => setForceOpen(false)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
