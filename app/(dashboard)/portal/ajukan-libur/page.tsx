'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getUpcomingRosterPeriod, getCurrentRosterPeriod, rosterPeriodLabel, datesInRange, DAYOFF_PICK_QUOTA } from '@/lib/rosterPeriod'
import { todayLocalStr, localDateStr } from '@/lib/date'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

type OwnRequest = { id: string; requested_date: string; status: 'draft' | 'pending' | 'approved' | 'rejected'; rejection_reason: string | null; discipline_fee: number }
type CalendarEntry = { off_date: string; employee_id: string; full_name: string; branch_id: string | null; branch_name: string | null; status: 'pending' | 'approved' }

// MAX_OFF_PER_DAY = batas keras, HARUS sama dengan check_dayoff_pick_rules (migration 066).
// MIN_GAP_DAYS & libur barengan satu cabang cuma PERINGATAN -- tetap boleh diajukan, dan
// ditandai untuk Owner/HR di Persetujuan Libur (get_dayoff_pick_warnings).
const MAX_PICKS = DAYOFF_PICK_QUOTA
const MAX_OFF_PER_DAY = 3
const MIN_GAP_DAYS = 5
const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

const dayDiff = (a: string, b: string) => Math.round((new Date(a + 'T00:00:00').getTime() - new Date(b + 'T00:00:00').getTime()) / 86400000)
const shiftDate = (d: Date, days: number) => { const c = new Date(d); c.setDate(c.getDate() + days); return c }

export default function AjukanLiburPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [previewReadOnly, setPreviewReadOnly] = useState(false)
  const [ownRequests, setOwnRequests] = useState<OwnRequest[]>([])
  const [entriesByDate, setEntriesByDate] = useState<Record<string, CalendarEntry[]>>({})
  const [rejectedByDate, setRejectedByDate] = useState<Record<string, string>>({})
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Periode yang ditampilkan BUKAN selalu "periode berikutnya" -- kalau periode yang SEDANG
  // BERJALAN masih kurang dari jatah (misal ada yang ditolak dan belum diganti, atau belum
  // sempat dilengkapi sebelum periode itu mulai), periode itu yang diprioritaskan supaya masih
  // bisa dilengkapi selama tanggal penggantinya belum lewat. Ditentukan di init() lewat cek
  // jumlah dulu, baru fetchData() penuh untuk periode yang benar-benar dipakai.
  const [period, setPeriod] = useState(() => getUpcomingRosterPeriod())
  const [isCurrentPeriod, setIsCurrentPeriod] = useState(false)
  const periodStartStr = localDateStr(period.start)
  const periodEndStr = localDateStr(period.end)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
    if (!userData) return

    // Preview Tampilan Karyawan: tampilkan data Rahmat Saleh (contoh nyata), tapi baca-saja —
    // submit/pilih/batalkan dinonaktifkan karena RPC/insert di halaman ini tetap menyasar
    // employee_id akun admin yang login sungguhan, bukan Rahmat Saleh.
    const previewing = ['owner', 'hr', 'finance'].includes(userData.role) && isPreviewModeClient()
    setPreviewReadOnly(previewing)
    const effectiveId = previewing ? PREVIEW_EMPLOYEE_ID : userData.employee_id
    setEmployeeId(effectiveId)

    const { data: emp } = await supabase.from('employees').select('branch_id').eq('id', effectiveId).single()
    setMyBranchId(emp?.branch_id ?? null)

    const currentPeriod = getCurrentRosterPeriod()
    const currentStartStr = localDateStr(currentPeriod.start)
    const { data: currentRows } = await supabase.from('roster_pick_requests')
      .select('status')
      .eq('employee_id', effectiveId).eq('period_start', currentStartStr).neq('status', 'rejected')
    const currentActiveCount = currentRows?.length ?? 0
    // Hitungan SAJA tidak cukup -- kalau salah satu pick itu masih 'draft' (peninggalan alur
    // lama), totalnya sudah penuh tapi draft itu belum pernah terkirim ke HR. Tanpa cek ini,
    // karyawan langsung dilempar ke periode depan dan draft yang nyangkut tidak kelihatan lagi.
    const currentHasDraft = (currentRows ?? []).some(r => r.status === 'draft')
    const useCurrentPeriod = currentActiveCount < MAX_PICKS || currentHasDraft
    const activePeriod = useCurrentPeriod ? currentPeriod : getUpcomingRosterPeriod()
    setPeriod(activePeriod)
    setIsCurrentPeriod(useCurrentPeriod)

    await fetchData(effectiveId, activePeriod)
    setLoading(false)
  }

  async function fetchData(empId: string, p: { start: Date; end: Date } = period) {
    const startStr = localDateStr(p.start)
    // Kalender diambil sedikit melebar dari periode -- libur sendiri di akhir periode lalu / awal
    // periode depan tetap ikut aturan jarak 5 hari.
    const [{ data: reqs }, { data: calRows }, { data: rej }] = await Promise.all([
      supabase.from('roster_pick_requests')
        .select('id, requested_date, status, rejection_reason, discipline_fee')
        .eq('employee_id', empId)
        .eq('period_start', startStr)
        .neq('status', 'rejected')
        .order('requested_date'),
      supabase.rpc('get_dayoff_pick_calendar', {
        p_from: localDateStr(shiftDate(p.start, -(MIN_GAP_DAYS - 1))),
        p_to: localDateStr(shiftDate(p.end, MIN_GAP_DAYS - 1)),
      }),
      // Pilihan yang DITOLAK disembunyikan dari pilihan aktif (tanggalnya boleh dipilih lagi),
      // tapi alasannya tetap ditampilkan supaya karyawan tahu kenapa ditolak.
      supabase.from('roster_pick_requests')
        .select('requested_date, rejection_reason')
        .eq('employee_id', empId).eq('period_start', startStr).eq('status', 'rejected')
        .order('decided_at', { ascending: true }),
    ])
    setOwnRequests((reqs as OwnRequest[]) || [])
    setRejectedByDate(Object.fromEntries(((rej || []) as { requested_date: string; rejection_reason: string | null }[])
      .map(r => [r.requested_date, r.rejection_reason || 'tanpa alasan'])))
    const grouped: Record<string, CalendarEntry[]> = {}
    for (const r of (calRows || []) as CalendarEntry[]) (grouped[r.off_date] ||= []).push(r)
    setEntriesByDate(grouped)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const activeCount = ownRequests.filter(r => r.status !== 'rejected').length
  // Peninggalan dari alur draft lama -- sekarang pilih tanggal langsung jadi 'pending'. Baris
  // 'draft' yang masih tersisa cuma bisa dibereskan dengan dibatalkan lalu dipilih ulang.
  const legacyDraftCount = ownRequests.filter(r => r.status === 'draft').length
  // Weekend (Sabtu/Minggu) jadi primadona karena toko buka tiap hari — SEMUA karyawan dibatasi
  // cuma boleh 1 pilihan weekend per periode, supaya tidak ada yang "menguasai" weekend terus.
  const isWeekend = (dateStr: string) => [0, 6].includes(new Date(dateStr + 'T00:00:00').getDay())
  const weekendPicksUsed = ownRequests.filter(r => r.status !== 'rejected' && isWeekend(r.requested_date)).length
  const ownByDate = Object.fromEntries(ownRequests.map(r => [r.requested_date, r]))

  // Semua libur rutin milik sendiri (termasuk periode tetangga & libur yang diatur HR) -- dasar
  // peringatan jarak minimal 5 hari.
  const ownOffDates = new Set<string>(ownRequests.map(r => r.requested_date))
  Object.entries(entriesByDate).forEach(([d, list]) => { if (list.some(e => e.employee_id === employeeId)) ownOffDates.add(d) })

  // Alasan tanggal TIDAK BISA dipilih -- cerminan check_dayoff_pick_rules() + RLS di DB, supaya
  // karyawan langsung tahu sebelum klik. DB tetap jadi penentu akhir (misal kalau ada rekan yang
  // baru saja ambil tanggal yang sama sebelum halaman ini di-refresh).
  function blockReason(dateStr: string): string | null {
    if (dateStr <= todayLocalStr()) return 'Tanggal sudah lewat.'
    const others = (entriesByDate[dateStr] || []).filter(e => e.employee_id !== employeeId)
    if (others.length >= MAX_OFF_PER_DAY) return `Sudah penuh, maks. ${MAX_OFF_PER_DAY} orang libur per hari.`
    if (activeCount >= MAX_PICKS) return `Jatah ${MAX_PICKS} tanggal periode ini sudah penuh.`
    if (isWeekend(dateStr) && weekendPicksUsed >= 1) return 'Jatah 1 weekend (Sabtu/Minggu) periode ini sudah terpakai.'
    return null
  }

  // Tetap BOLEH dipilih, tapi ditandai untuk Owner/HR yang menyetujui.
  function pickWarnings(dateStr: string): string[] {
    const warnings: string[] = []
    const sameBranch = (entriesByDate[dateStr] || []).filter(e => e.employee_id !== employeeId && e.branch_id && e.branch_id === myBranchId)
    if (sameBranch.length) warnings.push(`Rekan satu cabang juga libur: ${sameBranch.map(e => e.full_name).join(', ')}.`)
    const near = [...ownOffDates].filter(d => d !== dateStr && Math.abs(dayDiff(d, dateStr)) < MIN_GAP_DAYS).sort()
    if (near.length) warnings.push(`Kurang dari ${MIN_GAP_DAYS} hari dari libur Anda tanggal ${near.map(d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })).join(', ')}.`)
    return warnings
  }

  async function handleCellClick(dateStr: string) {
    if (previewReadOnly || busyDate) return
    const own = ownByDate[dateStr]
    const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long' })

    // Batalkan pilihan yang sudah ada (pending, atau sisa 'draft' lama) -- approved terkunci.
    if (own) {
      if (own.status === 'approved') { showMessage('error', `Libur ${dateLabel} sudah disetujui HR — tidak bisa dibatalkan di sini, pakai menu Ganti Libur.`); return }
      if (!confirm(`Batalkan pilihan libur tanggal ${dateLabel}?`)) return
      setBusyDate(dateStr)
      const { error } = await supabase.from('roster_pick_requests').delete().eq('id', own.id)
      if (error) showMessage('error', 'Gagal membatalkan: ' + error.message)
      else showMessage('success', 'Pilihan dibatalkan.')
      await fetchData(employeeId)
      setBusyDate(null)
      return
    }

    const reason = blockReason(dateStr)
    if (reason) { showMessage('error', `${dateLabel}: ${reason}`); return }

    // isCurrentPeriod = periode ini sudah berjalan (bukan diajukan di muka) -- begitu dipilih,
    // langsung kena denda disiplin Rp10.000 (dihitung otomatis oleh trigger DB saat insert).
    const warnings = pickWarnings(dateStr)
    const warningText = warnings.length
      ? `⚠️ PERINGATAN:\n- ${warnings.join('\n- ')}\nTetap boleh diajukan, tapi akan ditandai untuk Owner/HR yang menyetujui (bisa saja ditolak).\n\n`
      : ''
    const confirmText = warningText + (isCurrentPeriod
      ? `Periode ini sudah berjalan. Tanggal ${dateLabel} akan langsung terkirim ke HR dan kena denda disiplin Rp10.000 (dipotong otomatis dari gaji periode ini). Lanjutkan?`
      : `Ajukan libur tanggal ${dateLabel}? Langsung terkirim ke HR.`)
    if (!confirm(confirmText)) return

    setBusyDate(dateStr)
    const { error } = await supabase.from('roster_pick_requests').insert({
      employee_id: employeeId,
      period_start: periodStartStr,
      period_end: periodEndStr,
      requested_date: dateStr,
      status: 'pending',
    })
    if (error) showMessage('error', 'Gagal mengajukan: ' + error.message)
    else showMessage('success', `Tanggal ${dateLabel} langsung diajukan ke HR.`)
    await fetchData(employeeId)
    setBusyDate(null)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  // Grid Minggu–Sabtu yang menutup seluruh periode 26–25 (melintasi 2 bulan); sel di luar
  // periode tetap digambar supaya minggu pertama/terakhir utuh, tapi tidak bisa dipilih.
  const gridStart = shiftDate(period.start, -period.start.getDay())
  const gridEnd = shiftDate(period.end, 6 - period.end.getDay())
  const gridDates = datesInRange(gridStart, gridEnd)
  const todayStr = todayLocalStr()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Ajukan Jadwal Libur</h1>
        <p className="text-sm text-slate-500">Klik tanggal di kalender untuk memilih maksimal {MAX_PICKS} tanggal libur periode <strong>{rosterPeriodLabel(period.start, period.end)}</strong>. Setiap tanggal yang dipilih <strong>langsung terkirim ke HR/Owner</strong>, dan masih bisa dibatalkan (klik lagi) selama belum diputuskan.</p>
      </div>

      {isCurrentPeriod && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-red-800">📌 Periode ini sedang berjalan sekarang — kena denda disiplin</p>
          <p className="text-sm text-red-700 mt-0.5">
            Jatah libur Anda untuk periode ini masih kurang dari {MAX_PICKS} (mungkin ada yang ditolak, atau belum sempat dilengkapi) — lengkapi dulu di sini sebelum bisa lanjut ke periode berikutnya. Tanggal yang sudah lewat otomatis terkunci.
            Karena dipilih setelah periodenya berjalan, setiap tanggal yang Anda pilih sekarang kena <strong>denda disiplin Rp10.000/tanggal</strong>, dipotong otomatis dari gaji periode ini.
          </p>
        </div>
      )}

      {legacyDraftCount > 0 && (
        <div className="bg-slate-100 border border-slate-200 text-slate-600 text-sm rounded-lg px-4 py-2.5 mb-6">
          ℹ️ Ada {legacyDraftCount} pilihan format lama yang belum sempat terkirim ke HR — klik tanggalnya untuk batalkan, lalu pilih ulang supaya otomatis terkirim ke HR.
        </div>
      )}

      {previewReadOnly && (
        <div className="bg-slate-100 border border-slate-200 text-slate-600 text-sm rounded-lg px-4 py-2.5 mb-6">
          🔒 Mode Preview — halaman ini baca-saja, kalender tidak bisa diklik.
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex gap-3">
        <span className="text-xl leading-none">📅</span>
        <div className="text-sm text-amber-700">
          <p className="font-semibold text-amber-800 mb-1">Aturan Libur</p>
          <ul className="list-disc ml-4 space-y-0.5">
            <li>Maksimal <strong>{MAX_PICKS} tanggal</strong> per periode, dan hanya <strong>1</strong> di antaranya boleh Sabtu/Minggu.</li>
            <li>Satu tanggal maksimal <strong>{MAX_OFF_PER_DAY} orang</strong> libur (semua cabang) — kalau sudah penuh tidak bisa dipilih.</li>
            <li>Usahakan <strong>tidak libur barengan</strong> rekan satu cabang, dan beri jarak minimal <strong>{MIN_GAP_DAYS} hari</strong> antar libur (misal libur Senin, paling cepat libur lagi Sabtu). Kalau terpaksa, tetap boleh diajukan, tapi ditandai ⚠️ untuk Owner/HR dan bisa ditolak.</li>
          </ul>
        </div>
      </div>

      {message && (
        <div className={`p-3 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <span className="text-sm text-slate-600">Terpilih: <strong className={activeCount >= MAX_PICKS ? 'text-green-600' : 'text-blue-600'}>{activeCount}</strong> / {MAX_PICKS}
            <span className="ml-3 text-slate-400">· Weekend: <strong className={weekendPicksUsed >= 1 ? 'text-red-600' : 'text-blue-600'}>{weekendPicksUsed}</strong> / 1</span>
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-500" /> Pilihan Anda (menunggu HR)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500" /> Pilihan Anda (disetujui)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-slate-300" /> Rekan libur</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300" /> Boleh, tapi ada peringatan</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-slate-100 border border-slate-200" /> Tidak bisa dipilih</span>
          </div>
        </div>
        {activeCount >= MAX_PICKS && (
          <span className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium whitespace-nowrap">✓ Jatah {MAX_PICKS} tanggal periode ini penuh</span>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`px-1 py-2 text-center text-xs font-semibold uppercase ${i === 0 || i === 6 ? 'text-red-400' : 'text-slate-500'}`}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDates.map(dateStr => {
            const d = new Date(dateStr + 'T00:00:00')
            const inPeriod = dateStr >= periodStartStr && dateStr <= periodEndStr
            const own = ownByDate[dateStr]
            const others = (entriesByDate[dateStr] || []).filter(e => e.employee_id !== employeeId)
            const reason = inPeriod && !own ? blockReason(dateStr) : null
            const warnings = inPeriod && !own && !reason ? pickWarnings(dateStr) : []
            const selectable = inPeriod && !previewReadOnly && (own ? own.status !== 'approved' : !reason)
            const showMonth = d.getDate() === 1 || dateStr === localDateStr(gridStart)
            // Sengaja tanpa opacity (/60 dll) -- override dark mode di globals.css cuma menyasar
            // kelas warna polos, varian ber-opacity akan tetap terang di dark mode.
            const cellBg = !inPeriod ? 'bg-slate-50'
              : own?.status === 'approved' ? 'bg-green-50'
              : own ? 'bg-blue-50'
              : reason ? 'bg-slate-100'
              : warnings.length ? 'bg-amber-50 hover:bg-amber-100'
              : 'hover:bg-blue-50'
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => inPeriod && handleCellClick(dateStr)}
                disabled={!inPeriod || previewReadOnly || busyDate === dateStr}
                title={reason ?? (warnings.length ? '⚠️ ' + warnings.join(' ') : own ? (own.status === 'approved' ? 'Disetujui HR' : 'Klik untuk batalkan') : inPeriod ? 'Klik untuk ajukan libur' : undefined)}
                className={`min-h-[84px] sm:min-h-[104px] border-b border-r border-slate-100 p-1 sm:p-1.5 text-left align-top flex flex-col transition ${cellBg} ${selectable ? 'cursor-pointer' : 'cursor-default'}`}>
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`text-xs font-semibold ${!inPeriod ? 'text-slate-300' : dateStr === todayStr ? 'text-blue-700' : reason ? 'text-slate-400' : 'text-slate-700'}`}>
                    {d.getDate()}{showMonth && <span className="font-normal text-[10px] ml-0.5">{d.toLocaleDateString('id-ID', { month: 'short' })}</span>}
                  </span>
                  {warnings.length > 0 && <span className="text-[10px] leading-none" aria-label="Ada peringatan">⚠️</span>}
                  {inPeriod && others.length > 0 && (
                    <span className={`text-[9px] font-bold ${others.length >= MAX_OFF_PER_DAY ? 'text-red-500' : 'text-slate-400'}`}>{others.length}/{MAX_OFF_PER_DAY}</span>
                  )}
                </div>
                <div className="space-y-0.5 w-full min-w-0">
                  {own && (
                    <div className={`text-[10px] px-1 py-0.5 rounded truncate font-semibold text-white ${own.status === 'approved' ? 'bg-green-500' : own.status === 'pending' ? 'bg-blue-500' : 'bg-slate-400'}`}>
                      {busyDate === dateStr ? '...' : own.status === 'approved' ? '✓ Anda' : own.status === 'pending' ? 'Anda' : 'Anda (lama)'}
                      {own.discipline_fee > 0 && <span className="font-normal"> · denda</span>}
                    </div>
                  )}
                  {!own && inPeriod && ownOffDates.has(dateStr) && (
                    <div className="text-[10px] px-1 py-0.5 rounded truncate font-semibold text-white bg-green-500" title="Libur yang diatur langsung oleh HR">✓ Anda (HR)</div>
                  )}
                  {others.map(e => (
                    <div key={e.employee_id}
                      className={`text-[10px] px-1 py-0.5 rounded truncate ${e.branch_id === myBranchId ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'} ${e.status === 'pending' ? 'border border-dashed border-slate-400' : ''}`}
                      title={`${e.full_name}${e.branch_name ? ' · ' + e.branch_name : ''}${e.status === 'pending' ? ' (menunggu HR)' : ''}`}>
                      {e.full_name.split(' ')[0]}
                    </div>
                  ))}
                  {inPeriod && !own && busyDate === dateStr && <div className="text-[10px] text-slate-400">...</div>}
                  {inPeriod && rejectedByDate[dateStr] && !own && (
                    <div className="text-[9px] text-red-500 truncate" title={`Sebelumnya ditolak: ${rejectedByDate[dateStr]}`}>❌ ditolak</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-2">Nama bergaris putus-putus = masih menunggu persetujuan HR. Nama kuning = rekan satu cabang. Tanggal ⚠️ boleh dipilih tapi ditandai untuk HR; klik tanggal abu-abu untuk melihat alasan tidak bisa dipilih.</p>
    </div>
  )
}
