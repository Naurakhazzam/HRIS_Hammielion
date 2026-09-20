'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getUpcomingRosterPeriod, rosterPeriodLabel, datesInRange } from '@/lib/rosterPeriod'
import { todayLocalStr, localDateStr } from '@/lib/date'

type OwnRequest = { id: string; requested_date: string; status: 'pending' | 'approved' | 'rejected'; rejection_reason: string | null }

const MAX_PICKS = 4

export default function AjukanLiburPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [ownRequests, setOwnRequests] = useState<OwnRequest[]>([])
  const [colleagueNames, setColleagueNames] = useState<Record<string, string>>({})
  const [branchEmployeeCount, setBranchEmployeeCount] = useState<number | null>(null)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const period = getUpcomingRosterPeriod()
  const periodStartStr = localDateStr(period.start)
  const periodEndStr = localDateStr(period.end)
  const allDates = datesInRange(period.start, period.end)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: userData } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
    if (!userData) return
    setEmployeeId(userData.employee_id)
    const [, { data: count }] = await Promise.all([
      fetchData(userData.employee_id),
      supabase.rpc('get_my_branch_employee_count'),
    ])
    setBranchEmployeeCount(typeof count === 'number' ? count : null)
    setLoading(false)
  }

  async function fetchData(empId: string) {
    const [{ data: reqs }, { data: calRows }] = await Promise.all([
      supabase.from('roster_pick_requests')
        .select('id, requested_date, status, rejection_reason')
        .eq('employee_id', empId)
        .eq('period_start', periodStartStr)
        .neq('status', 'rejected')
        .order('requested_date'),
      supabase.rpc('get_company_dayoff_calendar', { p_from: periodStartStr, p_to: periodEndStr }),
    ])
    setOwnRequests((reqs as OwnRequest[]) || [])
    const map: Record<string, string> = {}
    ;(calRows as { off_date: string; employee_names: string }[] | null)?.forEach(r => { map[r.off_date] = r.employee_names })
    setColleagueNames(map)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const activeCount = ownRequests.filter(r => r.status !== 'rejected').length
  // Weekend (Sabtu/Minggu) jadi primadona karena toko buka tiap hari — cabang dengan LEBIH DARI
  // 2 karyawan aktif dibatasi cuma boleh 1 pilihan weekend per periode, supaya tidak ada yang
  // "menguasai" weekend terus-menerus tiap bulan. Cabang kecil (<=2 orang) dikecualikan.
  const isWeekend = (dateStr: string) => [0, 6].includes(new Date(dateStr + 'T00:00:00').getDay())
  const weekendCapActive = (branchEmployeeCount ?? 0) > 2
  const weekendPicksUsed = ownRequests.filter(r => r.status !== 'rejected' && isWeekend(r.requested_date)).length

  async function toggleDate(dateStr: string, own: OwnRequest | undefined) {
    if (own) {
      if (own.status !== 'pending') return // approved tidak bisa dibatalkan di sini
      const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long' })
      if (!confirm(`Batalkan pengajuan libur tanggal ${dateLabel}?`)) return
    }
    setBusyDate(dateStr)
    if (own) {
      const { error } = await supabase.from('roster_pick_requests').delete().eq('id', own.id)
      if (error) showMessage('error', 'Gagal membatalkan: ' + error.message)
      else showMessage('success', 'Pengajuan dibatalkan.')
    } else {
      if (activeCount >= MAX_PICKS) {
        showMessage('error', `Sudah mencapai maksimal ${MAX_PICKS} pengajuan untuk periode ini.`)
        setBusyDate(null)
        return
      }
      if (weekendCapActive && isWeekend(dateStr) && weekendPicksUsed >= 1) {
        showMessage('error', 'Maksimal 1 tanggal weekend (Sabtu/Minggu) per periode — supaya weekend bisa bergantian dengan rekan sekantor.')
        setBusyDate(null)
        return
      }
      const { error } = await supabase.from('roster_pick_requests').insert({
        employee_id: employeeId,
        period_start: periodStartStr,
        period_end: periodEndStr,
        requested_date: dateStr,
        status: 'pending',
      })
      if (error) showMessage('error', 'Gagal mengajukan: ' + error.message)
      else showMessage('success', `Tanggal ${new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })} diajukan sebagai libur.`)
    }
    await fetchData(employeeId)
    setBusyDate(null)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  const ownByDate = Object.fromEntries(ownRequests.map(r => [r.requested_date, r]))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Ajukan Jadwal Libur</h1>
        <p className="text-sm text-slate-500">Pilih maksimal {MAX_PICKS} tanggal libur untuk periode <strong>{rosterPeriodLabel(period.start, period.end)}</strong>. Perlu disetujui HR/Owner sebelum resmi.</p>
      </div>

      {weekendCapActive && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex gap-3">
          <span className="text-xl leading-none">📅</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Aturan Libur Weekend</p>
            <p className="text-sm text-amber-700 mt-0.5">Cabang Anda ramai (lebih dari 2 karyawan), jadi setiap orang cuma boleh pilih <strong>1 tanggal Sabtu/Minggu</strong> dari {MAX_PICKS} pengajuan libur per periode. Ini supaya weekend bisa bergantian dengan rekan sekantor, tidak dikuasai orang yang sama terus setiap bulan. Sisanya bebas pilih hari kerja biasa.</p>
          </div>
        </div>
      )}

      {message && (
        <div className={`p-3 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span className="text-sm text-slate-600">Terpakai: <strong className={activeCount >= MAX_PICKS ? 'text-red-600' : 'text-blue-600'}>{activeCount}</strong> / {MAX_PICKS}
          {weekendCapActive && <span className="ml-3 text-slate-400">· Weekend: <strong className={weekendPicksUsed >= 1 ? 'text-red-600' : 'text-blue-600'}>{weekendPicksUsed}</strong> / 1</span>}
        </span>
        <span className="text-xs text-slate-400">Tanda kuning = ada rekan lain (cabang mana pun) yang juga libur/mengajukan di tanggal itu</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="divide-y divide-slate-100">
          {allDates.map(dateStr => {
            const own = ownByDate[dateStr]
            const names = colleagueNames[dateStr]
            const d = new Date(dateStr + 'T00:00:00')
            const isPast = dateStr <= todayLocalStr()
            const isWeekendDay = isWeekend(dateStr)
            const weekendCapBlocks = weekendCapActive && isWeekendDay && !own && weekendPicksUsed >= 1
            const disabled = isPast || busyDate === dateStr || (own?.status === 'approved') || weekendCapBlocks
            return (
              <div key={dateStr} className={`flex items-center justify-between px-4 py-2.5 ${own ? (own.status === 'approved' ? 'bg-green-50/50' : 'bg-blue-50/50') : ''}`}>
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {d.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long' })}
                    {isWeekendDay && weekendCapActive && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium align-middle">Weekend</span>
                    )}
                  </p>
                  {names && (
                    <p className="text-xs text-amber-600 mt-0.5">⚠️ Rekan juga libur: {names} — koordinasi dulu, atau tetap lanjut kalau tidak masalah.</p>
                  )}
                  {weekendCapBlocks && (
                    <p className="text-xs text-slate-400 mt-0.5">Jatah weekend periode ini sudah terpakai.</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {own?.status === 'approved' && (
                    <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">Disetujui</span>
                  )}
                  {own?.status === 'pending' && (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">Menunggu HR</span>
                  )}
                  <button
                    onClick={() => toggleDate(dateStr, own)}
                    disabled={disabled}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      own
                        ? 'border-red-200 text-red-600 hover:bg-red-50'
                        : 'border-blue-200 text-blue-600 hover:bg-blue-50'
                    }`}>
                    {busyDate === dateStr ? '...' : own ? (own.status === 'approved' ? 'Terkunci' : 'Batalkan') : 'Ajukan Libur'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
