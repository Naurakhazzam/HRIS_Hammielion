'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ANNUAL_LEAVE_QUOTA_DAYS, MIN_TENURE_DAYS_FOR_ANNUAL_LEAVE, tenureDays, isEligibleForAnnualLeave, getCurrentLeaveYear, toDateStr } from '@/lib/leaveQuota'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

type RosterRow = {
  id: string
  date: string
  is_day_off: boolean
  work_schedules: { name: string; check_in_time: string; check_out_time: string } | null
}

const DAYS_AHEAD = 14
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

function fmtTime(t: string) { return t?.substring(0, 5) ?? '-' }

export default function PortalJadwalPage() {
  const supabase = createClient()
  const router = useRouter()

  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')
  const [loading, setLoading] = useState(true)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [leaveInfo, setLeaveInfo] = useState<{ joinDate: string | null; usedDays: number }>({ joinDate: null, usedDays: 0 })

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users')
      .select('role, employee_id, employees(full_name, join_date)')
      .eq('id', user.id).single()
    if (!userData) return

    // Preview Tampilan Karyawan: tampilkan data Rahmat Saleh (contoh nyata), bukan akun admin sendiri.
    const previewing = ['owner', 'hr', 'finance'].includes(userData.role) && isPreviewModeClient()
    const emp = previewing
      ? (await supabase.from('employees').select('full_name, join_date').eq('id', PREVIEW_EMPLOYEE_ID).single()).data
      : (userData as any).employees
    const effectiveId = previewing ? PREVIEW_EMPLOYEE_ID : userData.employee_id
    setMyEmployeeId(effectiveId)
    setMyName(emp?.full_name || '')

    await Promise.all([
      fetchRoster(effectiveId),
      emp?.join_date ? fetchLeaveInfo(effectiveId, emp.join_date) : Promise.resolve(),
    ])
    setLoading(false)
  }

  async function fetchRoster(employeeId: string) {
    const today = new Date()
    const end = new Date(today)
    end.setDate(end.getDate() + DAYS_AHEAD - 1)

    const { data } = await supabase
      .from('employee_roster')
      .select('id, date, is_day_off, work_schedules(name, check_in_time, check_out_time)')
      .eq('employee_id', employeeId)
      .gte('date', toDateStr(today))
      .lte('date', toDateStr(end))
      .order('date')

    setRoster((data as unknown as RosterRow[]) || [])
  }

  async function fetchLeaveInfo(employeeId: string, joinDate: string) {
    const { start, end } = getCurrentLeaveYear(joinDate)
    const { data: reqs } = await supabase
      .from('leave_requests')
      .select('total_days')
      .eq('employee_id', employeeId)
      .eq('leave_type', 'annual')
      .in('status', ['pending', 'approved'])
      .gte('start_date', toDateStr(start))
      .lte('start_date', toDateStr(end))

    const usedDays = (reqs || []).reduce((s, r) => s + Number(r.total_days), 0)
    setLeaveInfo({ joinDate, usedDays })
  }

  // Bangun daftar tanggal berurutan DAYS_AHEAD hari ke depan, gabungkan dengan data roster
  // (kalau ada) — supaya hari yang belum dijadwalkan HR tetap kelihatan sebagai baris tersendiri,
  // bukan cuma hilang dari daftar.
  const rosterByDate = Object.fromEntries(roster.map(r => [r.date, r]))
  const upcoming = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const dateStr = toDateStr(d)
    return { date: d, dateStr, entry: rosterByDate[dateStr] ?? null }
  })

  const eligible = leaveInfo.joinDate ? isEligibleForAnnualLeave(leaveInfo.joinDate) : false
  const remaining = Math.max(0, ANNUAL_LEAVE_QUOTA_DAYS - leaveInfo.usedDays)

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat jadwal...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Jadwal Saya</h1>
        <p className="text-sm text-slate-500">Halo, <strong>{myName}</strong>. Jadwal shift & hari libur {DAYS_AHEAD} hari ke depan.</p>
      </div>

      {/* Kartu Jatah Cuti */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
        <h2 className="text-sm font-bold text-slate-700 mb-2">Jatah Cuti Tahunan</h2>
        {!leaveInfo.joinDate ? (
          <p className="text-sm text-slate-400">Data masa kerja belum tersedia.</p>
        ) : !eligible ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Masa kerja ±{Math.floor(tenureDays(leaveInfo.joinDate) / 30)} bulan. Cuti Tahunan bisa diajukan setelah genap {MIN_TENURE_DAYS_FOR_ANNUAL_LEAVE} hari (1 tahun) masa kerja.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold text-blue-600">{remaining}</span>
            <span className="text-sm text-slate-500">dari {ANNUAL_LEAVE_QUOTA_DAYS} hari/tahun masa kerja tersisa</span>
          </div>
        )}
      </div>

      {/* Jadwal ke depan */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <span className="text-sm font-semibold text-slate-700">Jadwal {DAYS_AHEAD} Hari ke Depan</span>
        </div>
        <div className="divide-y divide-slate-100">
          {upcoming.map(({ date, dateStr, entry }) => {
            const isToday = dateStr === toDateStr(new Date())
            return (
              <div key={dateStr} className={`flex items-center justify-between px-5 py-3 ${isToday ? 'bg-blue-50/50' : ''}`}>
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {date.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit' })} {MONTHS[date.getMonth()]}
                    {isToday && <span className="ml-2 text-xs text-blue-600 font-semibold">Hari ini</span>}
                  </p>
                </div>
                <div>
                  {!entry ? (
                    <span className="text-xs text-slate-400 italic">Belum dijadwalkan</span>
                  ) : entry.is_day_off ? (
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">Libur</span>
                  ) : (
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                      {entry.work_schedules?.name} · {fmtTime(entry.work_schedules?.check_in_time || '')}–{fmtTime(entry.work_schedules?.check_out_time || '')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
