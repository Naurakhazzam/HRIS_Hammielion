'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getUpcomingRosterPeriod, rosterPeriodLabel } from '@/lib/rosterPeriod'
import { localDateStr } from '@/lib/date'

const DAYOFF_QUOTA = 4
type QuotaRow = { employee_id: string; full_name: string; branch_name: string | null; approved_count: number; pending_count: number; draft_count: number }

type DayOffEntry = { employee_id: string; full_name: string; branch_name: string | null; source_type: string }
type Holiday = { id: string; holiday_date: string; name: string }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

const SOURCE_STYLE: Record<string, { label: string; className: string }> = {
  jadwal: { label: 'Libur', className: 'bg-slate-100 text-slate-600' },
  cuti: { label: 'Cuti', className: 'bg-blue-100 text-blue-700' },
  sakit: { label: 'Sakit', className: 'bg-red-100 text-red-700' },
  izin: { label: 'Izin', className: 'bg-amber-100 text-amber-700' },
}

// Format tanggal lokal manual (bukan toISOString) — kalau pakai toISOString, Date jam 00:00
// lokal di zona WIB (UTC+7) akan mundur ke tanggal sebelumnya saat dikonversi ke UTC, jadi
// SETIAP tanggal di grid kalender salah geser satu hari.
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function KalenderLiburPage() {
  const supabase = createClient()
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [loading, setLoading] = useState(true)
  const [entriesByDate, setEntriesByDate] = useState<Record<string, DayOffEntry[]>>({})
  const [holidaysByDate, setHolidaysByDate] = useState<Record<string, Holiday>>({})
  const [canManage, setCanManage] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  // Peringatan level Owner: karyawan yang belum mengajukan jatah libur (4 tanggal) untuk
  // periode roster BERIKUTNYA -- sama dengan periode yang dipilih di halaman Ajukan Libur.
  const [isOwner, setIsOwner] = useState(false)
  const [quotaRows, setQuotaRows] = useState<QuotaRow[]>([])
  const upcomingPeriod = getUpcomingRosterPeriod()
  const periodStartStr = localDateStr(upcomingPeriod.start)
  const daysUntilPeriod = Math.ceil((upcomingPeriod.start.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
  const notCompliant = quotaRows
    .map(r => ({ ...r, submitted: r.approved_count + r.pending_count }))
    .filter(r => r.submitted < DAYOFF_QUOTA)
    .sort((a, b) => a.submitted - b.submitted || a.full_name.localeCompare(b.full_name))

  const [showHolidayForm, setShowHolidayForm] = useState(false)
  const [holidayDate, setHolidayDate] = useState('')
  const [holidayName, setHolidayName] = useState('')
  const [submittingHoliday, setSubmittingHoliday] = useState(false)

  useEffect(() => { init() }, [])
  useEffect(() => { fetchMonth() }, [viewYear, viewMonth])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
      if (data) {
        setCanManage(['owner', 'hr'].includes(data.role))
        if (data.role === 'owner') {
          setIsOwner(true)
          const { data: rows } = await supabase.rpc('get_dayoff_quota_status', { p_period_start: periodStartStr })
          setQuotaRows((rows as QuotaRow[]) || [])
        }
      }
    }
  }

  function monthRange() {
    const from = new Date(viewYear, viewMonth, 1)
    const to = new Date(viewYear, viewMonth + 1, 0)
    return { from: toLocalDateStr(from), to: toLocalDateStr(to) }
  }

  async function fetchMonth() {
    setLoading(true)
    const { from, to } = monthRange()
    const [{ data: rows, error }, { data: hols }] = await Promise.all([
      supabase.rpc('get_universal_dayoff_calendar', { p_from: from, p_to: to }),
      supabase.from('company_holidays').select('id, holiday_date, name').gte('holiday_date', from).lte('holiday_date', to),
    ])
    if (error) {
      showMessage('error', 'Gagal memuat data libur: ' + error.message)
    } else {
      const grouped: Record<string, DayOffEntry[]> = {}
      for (const r of (rows || []) as any[]) {
        if (!grouped[r.off_date]) grouped[r.off_date] = []
        grouped[r.off_date].push({ employee_id: r.employee_id, full_name: r.full_name, branch_name: r.branch_name, source_type: r.source_type })
      }
      Object.values(grouped).forEach(list => list.sort((a, b) => a.full_name.localeCompare(b.full_name)))
      setEntriesByDate(grouped)
    }
    setHolidaysByDate(Object.fromEntries((hols || []).map((h: any) => [h.holiday_date, h])))
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  function changeMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setViewMonth(m); setViewYear(y)
  }

  function goToday() {
    setViewMonth(today.getMonth())
    setViewYear(today.getFullYear())
  }

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault()
    if (!holidayDate || !holidayName.trim()) return
    setSubmittingHoliday(true)
    const { error } = await supabase.from('company_holidays').insert({ holiday_date: holidayDate, name: holidayName.trim() })
    if (error) {
      showMessage('error', 'Gagal menambah hari libur: ' + error.message)
    } else {
      showMessage('success', 'Hari libur berhasil ditambahkan.')
      setHolidayDate(''); setHolidayName(''); setShowHolidayForm(false)
      fetchMonth()
    }
    setSubmittingHoliday(false)
  }

  async function handleDeleteHoliday(h: Holiday) {
    if (!confirm(`Hapus hari libur "${h.name}" (${h.holiday_date})?`)) return
    const { error } = await supabase.from('company_holidays').delete().eq('id', h.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Hari libur dihapus.'); fetchMonth() }
  }

  // Grid kalender: leading blank cells sejumlah hari sebelum tanggal 1 (0=Minggu), lalu
  // tanggal 1..akhir bulan, digenapkan ke kelipatan 7 dengan trailing blank cells.
  const gridCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1)
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const leading = firstDay.getDay()
    const cells: (Date | null)[] = Array.from({ length: leading }, () => null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [viewYear, viewMonth])

  const todayStr = toLocalDateStr(today)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Kalender Libur</h1>
          <p className="text-sm text-slate-500">Siapa saja yang libur, cuti, izin, atau sakit tiap tanggal — bisa dilihat semua orang.</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowHolidayForm(!showHolidayForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm"
          >
            {showHolidayForm ? 'Batal' : '+ Hari Libur Nasional'}
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {isOwner && quotaRows.length > 0 && (
        notCompliant.length > 0 ? (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-6">
            <p className="text-sm font-bold text-amber-800">
              ⚠️ {notCompliant.length} dari {quotaRows.length} karyawan belum mengambil jatah libur ({DAYOFF_QUOTA} tanggal) untuk periode {rosterPeriodLabel(upcomingPeriod.start, upcomingPeriod.end)}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {daysUntilPeriod > 0 ? `Periode mulai ${daysUntilPeriod} hari lagi.` : 'Periode sudah dimulai.'} Yang masih draf (belum dikirim ke HR) dihitung belum mengambil.
            </p>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {notCompliant.map(r => (
                <div key={r.employee_id} className="flex items-center justify-between bg-white rounded-lg px-3 py-1.5 text-sm border border-amber-100">
                  <span className="text-slate-700 truncate">{r.full_name}{r.branch_name ? <span className="text-slate-400"> · {r.branch_name}</span> : null}</span>
                  <span className={`text-xs font-semibold shrink-0 ml-2 ${r.submitted === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {r.submitted}/{DAYOFF_QUOTA}{r.draft_count > 0 ? ` (+${r.draft_count} draf)` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 mb-6">
            ✅ Semua karyawan sudah mengambil jatah libur ({DAYOFF_QUOTA} tanggal) untuk periode {rosterPeriodLabel(upcomingPeriod.start, upcomingPeriod.end)}.
          </div>
        )
      )}

      {showHolidayForm && canManage && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mb-6">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Tambah Hari Libur Nasional / Toko Tutup</h2>
          <form onSubmit={handleAddHoliday} className="flex flex-col sm:flex-row gap-3">
            <input type="date" required value={holidayDate} onChange={e => setHolidayDate(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <input type="text" required value={holidayName} onChange={e => setHolidayName(e.target.value)}
              placeholder="Misal: Hari Kemerdekaan"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <button type="submit" disabled={submittingHoliday}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
              {submittingHoliday ? 'Menyimpan...' : 'Simpan'}
            </button>
          </form>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(SOURCE_STYLE).map(([key, s]) => (
          <span key={key} className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
        ))}
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200">🎌 Libur Nasional</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <button onClick={() => changeMonth(-1)} aria-label="Bulan sebelumnya"
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">‹</button>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-800">{MONTHS[viewMonth]} {viewYear}</h2>
          <button onClick={goToday} className="text-xs font-medium text-blue-600 hover:underline">Hari ini</button>
        </div>
        <button onClick={() => changeMonth(1)} aria-label="Bulan berikutnya"
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">›</button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
          {WEEKDAYS.map(w => (
            <div key={w} className="px-2 py-2 text-center text-xs font-semibold text-slate-500 uppercase">{w}</div>
          ))}
        </div>
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Memuat kalender...</div>
        ) : (
          <div className="grid grid-cols-7">
            {gridCells.map((date, i) => {
              if (!date) return <div key={i} className="min-h-[110px] border-b border-r border-slate-100 bg-slate-50/40" />
              const dateStr = toLocalDateStr(date)
              const isToday = dateStr === todayStr
              const holiday = holidaysByDate[dateStr]
              const entries = entriesByDate[dateStr] || []
              const shown = entries.slice(0, 3)
              const restCount = entries.length - shown.length
              return (
                <div key={i} className={`min-h-[110px] border-b border-r border-slate-100 p-1.5 ${isToday ? 'bg-blue-50/60' : holiday ? 'bg-red-50/50' : ''}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold ${isToday ? 'text-blue-700' : 'text-slate-600'}`}>{date.getDate()}</span>
                    {isToday && <span className="text-[9px] font-bold text-blue-600">Hari ini</span>}
                  </div>
                  {holiday && (
                    <div className="mb-1">
                      <span className="block text-[10px] font-semibold text-red-600 truncate" title={holiday.name}>🎌 {holiday.name}</span>
                      {canManage && (
                        <button onClick={() => handleDeleteHoliday(holiday)} className="text-[9px] text-red-400 hover:text-red-600 hover:underline">hapus</button>
                      )}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {shown.map(en => (
                      <div key={en.employee_id}
                        className={`text-[10px] px-1 py-0.5 rounded truncate ${SOURCE_STYLE[en.source_type]?.className ?? 'bg-slate-100 text-slate-600'}`}
                        title={`${en.full_name} (${SOURCE_STYLE[en.source_type]?.label ?? en.source_type})${en.branch_name ? ' - ' + en.branch_name : ''}`}>
                        {en.full_name}
                      </div>
                    ))}
                    {restCount > 0 && (
                      <button onClick={() => setExpandedDate(dateStr)} className="text-[10px] text-blue-600 hover:underline font-medium">
                        +{restCount} lagi
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {expandedDate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setExpandedDate(null)}>
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-slate-800">
                {new Date(expandedDate).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </h3>
              <button onClick={() => setExpandedDate(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {(entriesByDate[expandedDate] || []).map(en => (
                <div key={en.employee_id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {en.full_name}
                    {en.branch_name ? <span className="text-slate-400"> · {en.branch_name}</span> : null}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${SOURCE_STYLE[en.source_type]?.className ?? 'bg-slate-100 text-slate-600'}`}>
                    {SOURCE_STYLE[en.source_type]?.label ?? en.source_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
