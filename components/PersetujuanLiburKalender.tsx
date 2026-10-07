'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getUpcomingRosterPeriod, rosterPeriodLabel, datesInRange } from '@/lib/rosterPeriod'
import { localDateStr, todayLocalStr } from '@/lib/date'

// Mode kalender tab "Jadwal Libur Awal" di Persetujuan Libur -- Owner/HR lihat siapa saja yang
// libur per tanggal dalam satu periode 26–25, lalu setujui/tolak langsung dari kotak tanggalnya.
// Batas & peringatan HARUS sama dengan migration 066 (check_dayoff_pick_rules, get_dayoff_pick_warnings).
const MAX_OFF_PER_DAY = 3
const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

type CalendarEntry = { off_date: string; employee_id: string; full_name: string; branch_id: string | null; branch_name: string | null; status: 'pending' | 'approved' }
type PendingRow = { id: string; employee_id: string; requested_date: string }
type PickWarning = { request_id: string; same_branch_names: string | null; near_dates: string | null }

const shiftDate = (d: Date, days: number) => { const c = new Date(d); c.setDate(c.getDate() + days); return c }
const periodFrom = (start: Date) => ({ start, end: new Date(start.getFullYear(), start.getMonth() + 1, 25) })

export default function PersetujuanLiburKalender({ onChanged }: { onChanged?: () => void }) {
  const supabase = createClient()
  const [period, setPeriod] = useState(() => getUpcomingRosterPeriod())
  const [loading, setLoading] = useState(true)
  const [entriesByDate, setEntriesByDate] = useState<Record<string, CalendarEntry[]>>({})
  const [pendingIdByKey, setPendingIdByKey] = useState<Record<string, string>>({})
  const [warningsById, setWarningsById] = useState<Record<string, PickWarning>>({})
  const [pendingByPeriod, setPendingByPeriod] = useState<Record<string, number>>({})
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fromStr = localDateStr(period.start)
  const toStr = localDateStr(period.end)

  // `loading` cuma untuk muat pertama -- saat ganti periode, kalender lama tetap tampil sampai data
  // baru datang (tanpa setLoading(true) sinkron di dalam effect).
  async function fetchData() {
    const [{ data: cal }, { data: pend }, { data: allPend }] = await Promise.all([
      supabase.rpc('get_dayoff_pick_calendar', { p_from: fromStr, p_to: toStr }),
      supabase.from('roster_pick_requests').select('id, employee_id, requested_date')
        .eq('status', 'pending').gte('requested_date', fromStr).lte('requested_date', toStr),
      // Jumlah pengajuan menunggu per periode -- supaya HR tahu kalau ada yang nyangkut di
      // periode lain selain yang sedang dibuka.
      supabase.from('roster_pick_requests').select('period_start').eq('status', 'pending'),
    ])
    const grouped: Record<string, CalendarEntry[]> = {}
    for (const r of (cal || []) as CalendarEntry[]) (grouped[r.off_date] ||= []).push(r)
    Object.values(grouped).forEach(list => list.sort((a, b) => a.status.localeCompare(b.status) || a.full_name.localeCompare(b.full_name)))
    setEntriesByDate(grouped)

    const pendRows = (pend || []) as PendingRow[]
    setPendingIdByKey(Object.fromEntries(pendRows.map(r => [`${r.employee_id}|${r.requested_date}`, r.id])))
    if (pendRows.length) {
      const { data: warns } = await supabase.rpc('get_dayoff_pick_warnings', { p_request_ids: pendRows.map(r => r.id) })
      setWarningsById(Object.fromEntries(((warns || []) as PickWarning[]).map(w => [w.request_id, w])))
    } else {
      setWarningsById({})
    }

    const counts: Record<string, number> = {}
    for (const r of (allPend || []) as { period_start: string }[]) counts[r.period_start] = (counts[r.period_start] || 0) + 1
    setPendingByPeriod(counts)
    setLoading(false)
  }

  // setState di fetchData semuanya terjadi SESUDAH await (bukan sinkron), jadi aman.
  useEffect(() => { fetchData() }, [fromStr]) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  function changePeriod(delta: number) {
    setPeriod(p => periodFrom(new Date(p.start.getFullYear(), p.start.getMonth() + delta, 26)))
  }

  function warningLines(requestId: string | undefined): string[] {
    const w = requestId ? warningsById[requestId] : undefined
    if (!w) return []
    const lines: string[] = []
    if (w.same_branch_names) lines.push(`Libur barengan rekan satu cabang: ${w.same_branch_names}`)
    if (w.near_dates) lines.push(`Kurang dari 5 hari dari libur dia yang lain: ${w.near_dates}`)
    return lines
  }

  async function decide(requestId: string, approve: boolean, reason: string | null = null) {
    if (approve) {
      const warnings = warningLines(requestId)
      if (warnings.length && !confirm(`⚠️ Pengajuan ini melanggar aturan libur:\n- ${warnings.join('\n- ')}\n\nTetap setujui?`)) return
    } else if (!reason?.trim()) {
      showMsg('error', 'Penolakan wajib disertai alasan.')
      return
    }
    setBusyId(requestId)
    const { error } = await supabase.rpc('decide_roster_pick_request', { p_request_id: requestId, p_approve: approve, p_reason: reason })
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else showMsg('success', approve ? 'Pengajuan disetujui, sudah masuk ke jadwal.' : 'Pengajuan ditolak.')
    setRejectingId(null)
    setRejectReason('')
    await fetchData()
    onChanged?.()
    setBusyId(null)
  }

  // Grid Minggu–Sabtu yang menutup seluruh periode 26–25 (melintasi 2 bulan).
  const gridStart = shiftDate(period.start, -period.start.getDay())
  const gridEnd = shiftDate(period.end, 6 - period.end.getDay())
  const gridDates = datesInRange(gridStart, gridEnd)
  const todayStr = todayLocalStr()
  const pendingHere = pendingByPeriod[fromStr] || 0
  const pendingElsewhere = Object.entries(pendingByPeriod).filter(([p]) => p !== fromStr)
  const openEntries = openDate ? entriesByDate[openDate] || [] : []

  return (
    <div>
      {message && (
        <div className={`p-3 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="flex items-center justify-between mb-3 gap-2">
        <button onClick={() => changePeriod(-1)} aria-label="Periode sebelumnya"
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">‹</button>
        <div className="text-center">
          <h2 className="text-base sm:text-lg font-bold text-slate-800">{rosterPeriodLabel(period.start, period.end)}</h2>
          <p className="text-xs text-slate-500">{pendingHere > 0 ? `${pendingHere} pengajuan menunggu keputusan di periode ini` : 'Tidak ada pengajuan menunggu di periode ini'}</p>
        </div>
        <button onClick={() => changePeriod(1)} aria-label="Periode berikutnya"
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">›</button>
      </div>

      {pendingElsewhere.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {pendingElsewhere.map(([p, n]) => (
            <button key={p} onClick={() => setPeriod(periodFrom(new Date(p + 'T00:00:00')))}
              className="text-xs px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300 font-medium hover:underline">
              {n} menunggu di periode {new Date(p + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} →
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-100 border border-green-300" /> Disetujui</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-100 border border-dashed border-yellow-400" /> Menunggu keputusan</span>
        <span className="flex items-center gap-1.5">⚠️ Bentrok satu cabang / jarak &lt; 5 hari</span>
        <span className="flex items-center gap-1.5"><strong className="text-red-600">3/3</strong> Tanggal penuh</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`px-1 py-2 text-center text-xs font-semibold uppercase ${i === 0 || i === 6 ? 'text-red-500' : 'text-slate-500'}`}>{w}</div>
          ))}
        </div>
        {loading && Object.keys(entriesByDate).length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">Memuat kalender...</div>
        ) : (
          <div className="grid grid-cols-7">
            {gridDates.map(dateStr => {
              const d = new Date(dateStr + 'T00:00:00')
              const inPeriod = dateStr >= fromStr && dateStr <= toStr
              const entries = inPeriod ? entriesByDate[dateStr] || [] : []
              const hasPending = entries.some(e => e.status === 'pending')
              const showMonth = d.getDate() === 1 || d.getDate() === 26 || dateStr === localDateStr(gridStart)
              return (
                <button key={dateStr} type="button" disabled={!inPeriod || entries.length === 0}
                  onClick={() => { setOpenDate(dateStr); setRejectingId(null) }}
                  className={`min-h-[92px] sm:min-h-[118px] border-b border-r border-slate-100 p-1 sm:p-1.5 text-left flex flex-col transition
                    ${!inPeriod ? 'bg-slate-50' : hasPending ? 'bg-yellow-50 hover:bg-yellow-100 cursor-pointer' : entries.length ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'}`}>
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className={`text-xs font-semibold ${!inPeriod ? 'text-slate-300' : dateStr === todayStr ? 'text-blue-600' : 'text-slate-700'}`}>
                      {d.getDate()}{showMonth && <span className="font-normal text-[10px] ml-0.5">{d.toLocaleDateString('id-ID', { month: 'short' })}</span>}
                    </span>
                    {entries.length > 0 && (
                      <span className={`text-[10px] font-bold ${entries.length >= MAX_OFF_PER_DAY ? 'text-red-600' : 'text-slate-400'}`}>{entries.length}/{MAX_OFF_PER_DAY}</span>
                    )}
                  </div>
                  <div className="space-y-0.5 w-full min-w-0">
                    {entries.map(e => {
                      const reqId = e.status === 'pending' ? pendingIdByKey[`${e.employee_id}|${dateStr}`] : undefined
                      const warn = warningLines(reqId).length > 0
                      return (
                        <div key={e.employee_id}
                          title={`${e.full_name}${e.branch_name ? ' · ' + e.branch_name : ''} — ${e.status === 'pending' ? 'menunggu keputusan' : 'disetujui'}`}
                          className={`text-[10px] sm:text-[11px] px-1 py-0.5 rounded truncate border ${e.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-800 border-dashed border-yellow-400 font-semibold'
                            : 'bg-green-100 text-green-800 border-green-300'}`}>
                          {warn && '⚠️ '}{e.full_name.split(' ')[0]}
                        </div>
                      )
                    })}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-2">Klik kotak tanggal untuk melihat detail dan menyetujui/menolak pengajuan di tanggal itu.</p>

      {openDate && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => setOpenDate(null)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-base font-bold text-slate-800">
                  {new Date(openDate + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                </h3>
                <button onClick={() => setOpenDate(null)} className="text-slate-400 hover:text-slate-600 px-1" aria-label="Tutup">✕</button>
              </div>
              <p className={`text-xs mb-4 ${openEntries.length >= MAX_OFF_PER_DAY ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                {openEntries.length} dari maks. {MAX_OFF_PER_DAY} orang libur
              </p>
              <div className="space-y-3">
                {openEntries.map(e => {
                  const reqId = e.status === 'pending' ? pendingIdByKey[`${e.employee_id}|${openDate}`] : undefined
                  const warnings = warningLines(reqId)
                  return (
                    <div key={e.employee_id} className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{e.full_name}</p>
                          <p className="text-xs text-slate-400">{e.branch_name ?? '—'}</p>
                        </div>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${e.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                          {e.status === 'pending' ? 'Menunggu' : 'Disetujui'}
                        </span>
                      </div>
                      {warnings.map(line => (
                        <p key={line} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 mt-2">⚠️ {line}</p>
                      ))}
                      {reqId && (
                        rejectingId === reqId ? (
                          <div className="mt-3">
                            <textarea value={rejectReason} onChange={ev => setRejectReason(ev.target.value)} rows={2} autoFocus
                              placeholder="Alasan menolak (wajib)"
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500" />
                            <div className="flex justify-end gap-2 mt-2">
                              <button onClick={() => { setRejectingId(null); setRejectReason('') }}
                                className="text-xs px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100">Batal</button>
                              <button onClick={() => decide(reqId, false, rejectReason)} disabled={!rejectReason.trim() || busyId === reqId}
                                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50">
                                {busyId === reqId ? 'Memproses...' : 'Tolak Pengajuan'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2 mt-3">
                            <button onClick={() => { setRejectingId(reqId); setRejectReason('') }} disabled={busyId === reqId}
                              className="text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50">
                              Tolak
                            </button>
                            <button onClick={() => decide(reqId, true)} disabled={busyId === reqId}
                              className="text-xs bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50">
                              {busyId === reqId ? 'Memproses...' : warnings.length ? 'Tetap Setujui' : 'Setujui'}
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )
                })}
                {openEntries.length === 0 && <p className="text-sm text-slate-500">Tidak ada yang libur di tanggal ini.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
