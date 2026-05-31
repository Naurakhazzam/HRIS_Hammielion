'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Attendance = {
  id: string
  date: string
  check_in: string | null
  check_out: string | null
  late_minutes: number
  overtime_hours: number
  status: string
  notes: string | null
}

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  present:    { label: 'Hadir',   color: 'bg-green-100 text-green-700' },
  absent:     { label: 'Absen',   color: 'bg-red-100 text-red-700' },
  leave:      { label: 'Cuti',    color: 'bg-blue-100 text-blue-700' },
  sick:       { label: 'Sakit',   color: 'bg-orange-100 text-orange-700' },
  permission: { label: 'Izin',    color: 'bg-purple-100 text-purple-700' },
}

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

export default function PortalAbsensiPage() {
  const supabase = createClient()
  const router = useRouter()
  const today = new Date()

  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [attendances, setAttendances] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])
  useEffect(() => { if (myEmployeeId) fetchAttendances() }, [myEmployeeId, filterMonth, filterYear])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users').select('role, employee_id, employees(full_name)').eq('id', user.id).single()
    if (!userData) return

    if (!['employee', 'supervisor'].includes(userData.role)) { router.push('/dashboard'); return }

    setMyEmployeeId(userData.employee_id)
    setMyName((userData as any).employees?.full_name || '')
  }

  async function fetchAttendances() {
    setLoading(true)
    const firstDay = `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`
    const lastDay = new Date(filterYear, filterMonth, 0).toISOString().split('T')[0]

    const { data } = await supabase
      .from('attendances')
      .select('*')
      .eq('employee_id', myEmployeeId)
      .gte('date', firstDay)
      .lte('date', lastDay)
      .order('date')

    setAttendances(data || [])
    setLoading(false)
  }

  // Summary
  const totalHadir     = attendances.filter(a => a.status === 'present').length
  const totalTerlambat = attendances.filter(a => a.late_minutes > 0).length
  const totalMenitLambat = attendances.reduce((s, a) => s + Number(a.late_minutes), 0)
  const totalLembur    = attendances.reduce((s, a) => s + Number(a.overtime_hours), 0)
  const totalAbsen     = attendances.filter(a => a.status === 'absent').length
  const totalCutiIzin  = attendances.filter(a => ['leave', 'sick', 'permission'].includes(a.status)).length

  const yearOptions = [today.getFullYear() - 1, today.getFullYear()]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Rekap Absensi Saya</h1>
        <p className="text-sm text-slate-500">Halo, <strong>{myName}</strong>. Rekap kehadiran Anda.</p>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Bulan:</label>
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Tahun:</label>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Hadir',        val: totalHadir,        color: 'bg-green-50 border-green-100', textColor: 'text-green-700' },
          { label: 'Absen',        val: totalAbsen,         color: 'bg-red-50 border-red-100',    textColor: 'text-red-700' },
          { label: 'Cuti/Izin',    val: totalCutiIzin,      color: 'bg-blue-50 border-blue-100',  textColor: 'text-blue-700' },
          { label: 'Hari Telat',   val: totalTerlambat,     color: 'bg-orange-50 border-orange-100', textColor: 'text-orange-700' },
          { label: 'Total Menit Telat', val: `${totalMenitLambat} mnt`, color: 'bg-amber-50 border-amber-100', textColor: 'text-amber-700' },
          { label: 'Total Lembur', val: `${totalLembur.toFixed(1)} jam`, color: 'bg-purple-50 border-purple-100', textColor: 'text-purple-700' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-3 ${card.color}`}>
            <p className="text-xs font-medium text-slate-500 mb-1">{card.label}</p>
            <p className={`text-lg font-bold ${card.textColor}`}>{card.val}</p>
          </div>
        ))}
      </div>

      {/* Tabel Absensi */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <span className="text-sm font-semibold text-slate-700">
            Detail Absensi — {MONTHS[filterMonth-1]} {filterYear}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white border-b border-slate-200">
              <tr>
                {['Tanggal','Status','Jam Masuk','Jam Keluar','Telat','Lembur','Keterangan'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Memuat data...</td></tr>
              ) : attendances.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Belum ada data absensi bulan ini.</td></tr>
              ) : (
                attendances.map(a => {
                  const cfg = STATUS_CONFIG[a.status] ?? { label: a.status, color: 'bg-slate-100 text-slate-600' }
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {new Date(a.date).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{fmtTime(a.check_in)}</td>
                      <td className="px-4 py-3 text-slate-600">{fmtTime(a.check_out)}</td>
                      <td className="px-4 py-3">
                        {a.late_minutes > 0
                          ? <span className="text-orange-600 font-medium">{a.late_minutes} mnt</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {Number(a.overtime_hours) > 0
                          ? <span className="text-purple-600 font-medium">{Number(a.overtime_hours).toFixed(1)} jam</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{a.notes || '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
