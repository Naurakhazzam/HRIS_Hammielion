import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Dashboard — Hammielion HRIS',
  description: 'Dashboard utama sistem HRIS Hammielion Management',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div>
      {/* Header Halaman */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">
          Selamat datang di sistem HRIS Hammielion Management.
        </p>
      </div>

      {/* Kartu Selamat Datang */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Login Berhasil</p>
            <p className="text-sm text-slate-500">
              Anda masuk sebagai <span className="font-medium text-slate-700">{user?.email}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Placeholder Modul */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: 'Karyawan', desc: 'Manajemen data karyawan', icon: '👥' },
          { label: 'Absensi', desc: 'Rekap kehadiran harian', icon: '📋' },
          { label: 'Penggajian', desc: 'Slip gaji bulanan', icon: '💰' },
          { label: 'Cuti & Izin', desc: 'Pengajuan dan approval', icon: '🗓️' },
          { label: 'KPI', desc: 'Penilaian kinerja', icon: '📊' },
          { label: 'Kasbon', desc: 'Pengajuan dan limit', icon: '🏦' },
        ].map((modul) => (
          <div
            key={modul.label}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm
                       opacity-50 cursor-not-allowed"
          >
            <div className="text-2xl mb-2">{modul.icon}</div>
            <p className="font-medium text-slate-700 text-sm">{modul.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{modul.desc}</p>
            <span className="inline-block mt-3 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              Segera hadir
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
