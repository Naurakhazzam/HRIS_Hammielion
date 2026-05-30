'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type WorkSchedule = {
  id: string
  name: string
  check_in_time: string
  check_out_time: string
  detect_until: string | null
  allow_overtime: boolean
  departments: { name: string }
}

export default function ShiftInfoPage() {
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    supabase
      .from('work_schedules')
      .select('id, name, check_in_time, check_out_time, detect_until, allow_overtime, departments(name)')
      .order('applies_to_dept')
      .order('check_in_time')
      .then(({ data }) => {
        if (data) setSchedules(data as unknown as WorkSchedule[])
        setLoading(false)
      })
  }, [])

  const fmt = (t: string | null) => t ? t.substring(0, 5) : '-'

  const grouped = schedules.reduce((acc, s) => {
    const dept = s.departments?.name || 'Lainnya'
    if (!acc[dept]) acc[dept] = []
    acc[dept].push(s)
    return acc
  }, {} as Record<string, WorkSchedule[]>)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Penugasan Shift</h1>
          <p className="text-sm text-slate-500">Shift karyawan terdeteksi otomatis saat clock-in berdasarkan jadwal departemen.</p>
        </div>
        <Link href="/absensi/jadwal"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
          ⚙️ Setup Jadwal & Shift
        </Link>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-blue-800 mb-2">✅ Sistem Deteksi Shift Otomatis Aktif</h2>
        <p className="text-sm text-blue-700 mb-3">Tidak perlu assign shift manual. Saat karyawan clock-in, sistem mencocokkan jam masuk dengan aturan jadwal departemennya secara otomatis.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-blue-700">
          <div className="bg-white rounded-lg p-3 border border-blue-100">
            <p className="font-semibold mb-1">🕐 Deteksi Otomatis</p>
            <p>Jam masuk dicocokkan dengan batas deteksi jadwal di departemen karyawan.</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-blue-100">
            <p className="font-semibold mb-1">⚠️ Keterlambatan</p>
            <p>Setiap 1 menit lewat jam masuk jadwal dihitung terlambat, berlaku semua departemen.</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-blue-100">
            <p className="font-semibold mb-1">⏱️ Overtime</p>
            <p>Dihitung setelah 59 menit lewat jam pulang. Shift Siang tidak ada overtime.</p>
          </div>
        </div>
      </div>

      <h2 className="text-sm font-bold text-slate-700 mb-3">Aturan Shift yang Aktif</h2>

      {loading ? (
        <div className="flex justify-center items-center h-32 text-slate-400 text-sm">Memuat data...</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([deptName, deptSchedules]) => (
            <div key={deptName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-700">{deptName}</span>
                {deptSchedules.length > 1 && (
                  <span className="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-0.5 rounded-full">Multi Shift</span>
                )}
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {deptSchedules.map(s => (
                  <div key={s.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-slate-800">{s.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${s.allow_overtime ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {s.allow_overtime ? 'OT ✓' : 'No OT'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 space-y-1">
                      <p>Masuk: <span className="font-semibold text-emerald-600">{fmt(s.check_in_time)}</span></p>
                      <p>Pulang: <span className="font-semibold text-red-500">{fmt(s.check_out_time)}</span></p>
                      <p>Batas deteksi: <span className="font-semibold text-blue-600">{s.detect_until ? `≤ ${fmt(s.detect_until)}` : '— menangkap semua sisa'}</span></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
