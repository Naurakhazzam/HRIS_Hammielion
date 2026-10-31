'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getUpcomingRosterPeriod, getCurrentRosterPeriod, rosterPeriodLabel, datesInRange, DAYOFF_PICK_QUOTA } from '@/lib/rosterPeriod'
import { todayLocalStr, localDateStr } from '@/lib/date'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

type OwnRequest = { id: string; requested_date: string; status: 'draft' | 'pending' | 'approved' | 'rejected' | 'moved'; rejection_reason: string | null; discipline_fee: number }
type CalendarEntry = { off_date: string; employee_id: string; full_name: string; branch_id: string | null; branch_name: string | null; status: 'pending' | 'approved'; counted: boolean }

// Semua aturan (jatah 4, 1 weekend, maks. orang libur per cabang per hari) dihitung di DB lewat
// dayoff_block_reason (migrasi 108) -- halaman ini cuma menampilkan hasil get_dayoff_block_reasons,
// supaya tidak ada lagi versi aturan yang beda antara tampilan dan database.
const MAX_PICKS = DAYOFF_PICK_QUOTA
const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

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
  const [blockedByDate, setBlockedByDate] = useState<Record<string, string>>({})
  // Maks. orang libur per hari di cabang sendiri (null = tidak dibatasi, mis. driver/gaji flat).
  const [branchCap, setBranchCap] = useState<number | null>(null)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Periode yang ditampilkan BUKAN selalu "periode berikutnya" -- kalau periode yang SEDANG
  // BERJALAN masih kurang dari jatah (misal ada yang ditolak dan belum diganti, atau belum
  // sempat dilengkapi sebelum periode itu mulai), periode itu yang diprioritaskan supaya masih
  // bisa dilengkapi selama tanggal penggantinya belum lewat. Ditentukan di init() lewat cek
  // jumlah dulu, baru fetchData() penuh untuk periode yang benar-benar dipakai.
  // Dua periode yang relevan: yang SEDANG berjalan (untuk melengkapi jatah yang belum penuh) dan
  // yang AKAN datang (pilihan normal di muka). Default tampilan = periode depan supaya karyawan
  // tidak pernah terjebak di periode berjalan yang tanggalnya sudah hampir habis.
  const [currentPeriod] = useState(() => getCurrentRosterPeriod())
  const [upcomingPeriod] = useState(() => getUpcomingRosterPeriod())
  const [view, setView] = useState<'upcoming' | 'current'>('upcoming')
  // Periode berjalan masih bisa dilengkapi? (belum penuh 4 / ada draft lama, DAN masih ada tanggal
  // di depan yang bisa dipilih). Kalau tidak, toggle ke periode berjalan tidak ditawarkan.
  const [currentCompletable, setCurrentCompletable] = useState(false)
  const period = view === 'current' ? currentPeriod : upcomingPeriod
  const isCurrentPeriod = view === 'current'
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

    const [{ data: emp }, { data: cap }] = await Promise.all([
      supabase.from('employees').select('branch_id').eq('id', effectiveId).single(),
      supabase.rpc('get_dayoff_branch_cap', { p_employee_id: effectiveId }),
    ])
    setMyBranchId(emp?.branch_id ?? null)
    setBranchCap(typeof cap === 'number' ? cap : null)

    const currentStartStr = localDateStr(currentPeriod.start)
    const { data: currentRows } = await supabase.from('roster_pick_requests')
      .select('status')
      .eq('employee_id', effectiveId).eq('period_start', currentStartStr).in('status', ['draft', 'pending', 'approved'])
    const currentActiveCount = currentRows?.length ?? 0
    // Hitungan SAJA tidak cukup -- kalau salah satu pick itu masih 'draft' (peninggalan alur
    // lama), totalnya sudah penuh tapi draft itu belum pernah terkirim ke HR. Tanpa cek ini,
    // draft yang nyangkut tidak pernah ditawarkan untuk dibereskan.
    const currentHasDraft = (currentRows ?? []).some(r => r.status === 'draft')
    // Periode berjalan hanya layak dilengkapi kalau (a) jatahnya memang belum penuh / masih ada
    // draft lama, DAN (b) masih tersisa tanggal di depan untuk dipilih (hari ini < akhir periode).
    // Tanpa syarat (b), karyawan terjebak di periode yang tanggalnya sudah lewat & tidak pernah
    // bisa pindah ke periode depan -- ini bug yang membuat mayoritas karyawan tidak bisa mengajukan.
    const hasFutureDate = todayLocalStr() < localDateStr(currentPeriod.end)
    setCurrentCompletable((currentActiveCount < MAX_PICKS || currentHasDraft) && hasFutureDate)

    // Default SELALU periode berikutnya; periode berjalan hanya dibuka lewat toggle (switchView).
    setView('upcoming')
    await fetchData(effectiveId, upcomingPeriod)
    setLoading(false)
  }

  async function fetchData(empId: string, p: { start: Date; end: Date } = period) {
    const startStr = localDateStr(p.start)
    const endStr = localDateStr(p.end)
    // 'moved' = sudah disetujui tapi kemudian dipindah (Ganti Libur / Tukar saat Absen / diedit HR)
    // -- tanggal barunya sudah ikut lewat kalender (employee_roster).
    const [{ data: reqs }, { data: calRows }, { data: rej }, { data: blocked }] = await Promise.all([
      supabase.from('roster_pick_requests')
        .select('id, requested_date, status, rejection_reason, discipline_fee')
        .eq('employee_id', empId)
        .eq('period_start', startStr)
        .in('status', ['draft', 'pending', 'approved'])
        .order('requested_date'),
      supabase.rpc('get_dayoff_pick_calendar', { p_from: startStr, p_to: endStr }),
      // Pilihan yang DITOLAK disembunyikan dari pilihan aktif (tanggalnya boleh dipilih lagi),
      // tapi alasannya tetap ditampilkan supaya karyawan tahu kenapa ditolak.
      supabase.from('roster_pick_requests')
        .select('requested_date, rejection_reason')
        .eq('employee_id', empId).eq('period_start', startStr).eq('status', 'rejected')
        .order('decided_at', { ascending: true }),
      supabase.rpc('get_dayoff_block_reasons', { p_employee_id: empId, p_from: startStr, p_to: endStr }),
    ])
    setOwnRequests((reqs as OwnRequest[]) || [])
    setRejectedByDate(Object.fromEntries(((rej || []) as { requested_date: string; rejection_reason: string | null }[])
      .map(r => [r.requested_date, r.rejection_reason || 'tanpa alasan'])))
    const grouped: Record<string, CalendarEntry[]> = {}
    for (const r of (calRows || []) as CalendarEntry[]) (grouped[r.off_date] ||= []).push(r)
    setEntriesByDate(grouped)
    setBlockedByDate(Object.fromEntries(((blocked || []) as { off_date: string; reason: string }[]).map(b => [b.off_date, b.reason])))
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  // Pindah antara tampilan periode berikutnya & periode berjalan (lengkapi jatah). fetchData
  // dipanggil dengan periode eksplisit karena state `view` baru berlaku di render berikutnya.
  async function switchView(next: 'upcoming' | 'current') {
    if (next === view || busyDate || previewReadOnly) return
    setView(next)
    setMessage(null)
    setLoading(true)
    await fetchData(employeeId, next === 'current' ? currentPeriod : upcomingPeriod)
    setLoading(false)
  }

  // Peninggalan dari alur draft lama -- sekarang pilih tanggal langsung jadi 'pending'. Baris
  // 'draft' yang masih tersisa cuma bisa dibereskan dengan dibatalkan lalu dipilih ulang.
  const legacyDraftCount = ownRequests.filter(r => r.status === 'draft').length
  const isWeekend = (dateStr: string) => [0, 6].includes(new Date(dateStr + 'T00:00:00').getDay())
  const ownByDate = Object.fromEntries(ownRequests.map(r => [r.requested_date, r]))

  // Libur sendiri yang berlaku di periode ini = pengajuan + jadwal (termasuk yang diatur HR atau
  // hasil Ganti Libur) -- sama dengan cara DB menghitung jatah & weekend.
  const ownOffDates = new Set<string>(ownRequests.map(r => r.requested_date))
  Object.entries(entriesByDate).forEach(([d, list]) => { if (list.some(e => e.employee_id === employeeId)) ownOffDates.add(d) })
  const activeCount = ownOffDates.size
  const weekendPicksUsed = [...ownOffDates].filter(isWeekend).length

  // Rekan SATU CABANG yang ikut dihitung batas per hari (driver & gaji flat tidak dihitung).
  const branchMates = (dateStr: string) => (entriesByDate[dateStr] || [])
    .filter(e => e.employee_id !== employeeId && e.branch_id && e.branch_id === myBranchId && e.counted)

  // Alasan tanggal TIDAK BISA dipilih -- dari DB (get_dayoff_block_reasons), ditambah cek tanggal
  // lewat. DB tetap jadi penentu akhir saat insert (misal ada rekan yang baru saja mengambil
  // tanggal yang sama sebelum halaman ini di-refresh).
  function blockReason(dateStr: string): string | null {
    if (dateStr <= todayLocalStr()) return 'Tanggal sudah lewat.'
    return blockedByDate[dateStr] ?? null
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
    const confirmText = (isCurrentPeriod
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

      {currentCompletable && (
        <div className="flex flex-col sm:flex-row gap-2 mb-6">
          <button
            type="button"
            onClick={() => switchView('upcoming')}
            className={`flex-1 text-left rounded-xl border px-4 py-3 transition ${view === 'upcoming' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <span className="block text-sm font-semibold text-slate-800">Periode Berikutnya</span>
            <span className="block text-xs text-slate-500">{rosterPeriodLabel(upcomingPeriod.start, upcomingPeriod.end)} · tanpa denda</span>
          </button>
          <button
            type="button"
            onClick={() => switchView('current')}
            className={`flex-1 text-left rounded-xl border px-4 py-3 transition ${view === 'current' ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <span className="block text-sm font-semibold text-slate-800">Lengkapi Periode Berjalan</span>
            <span className="block text-xs text-slate-500">{rosterPeriodLabel(currentPeriod.start, currentPeriod.end)} · kena denda Rp10.000/tanggal</span>
          </button>
        </div>
      )}

      {isCurrentPeriod && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-red-800">📌 Periode ini sedang berjalan sekarang — kena denda disiplin</p>
          <p className="text-sm text-red-700 mt-0.5">
            Jatah libur Anda untuk periode ini masih kurang dari {MAX_PICKS} (mungkin ada yang ditolak, atau belum sempat dilengkapi) — Anda boleh melengkapinya di sini (opsional), atau pakai tombol <strong>Periode Berikutnya</strong> di atas untuk mengajukan libur bulan depan tanpa denda. Tanggal yang sudah lewat otomatis terkunci.
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
            {branchCap !== null && (
              <li>Di cabang Anda, satu tanggal maksimal <strong>{branchCap} orang</strong> libur — kalau sudah penuh tidak bisa dipilih.</li>
            )}
            <li>Tanggal yang bisa diklik berarti <strong>sudah memenuhi semua aturan</strong>. Tanggal abu-abu tidak bisa dipilih — klik untuk melihat alasannya.</li>
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
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300" /> Rekan satu cabang libur</span>
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
            const others = branchMates(dateStr)
            const reason = inPeriod && !own && !ownOffDates.has(dateStr) ? blockReason(dateStr) : null
            const selectable = inPeriod && !previewReadOnly && (own ? own.status !== 'approved' : !reason)
            const showMonth = d.getDate() === 1 || dateStr === localDateStr(gridStart)
            // Sengaja tanpa opacity (/60 dll) -- override dark mode di globals.css cuma menyasar
            // kelas warna polos, varian ber-opacity akan tetap terang di dark mode.
            const cellBg = !inPeriod ? 'bg-slate-50'
              : own?.status === 'approved' ? 'bg-green-50'
              : own ? 'bg-blue-50'
              : reason ? 'bg-slate-100'
              : 'hover:bg-blue-50'
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => inPeriod && handleCellClick(dateStr)}
                disabled={!inPeriod || previewReadOnly || busyDate === dateStr}
                title={reason ?? (own ? (own.status === 'approved' ? 'Disetujui HR' : 'Klik untuk batalkan') : inPeriod ? 'Klik untuk ajukan libur' : undefined)}
                className={`min-h-[84px] sm:min-h-[104px] border-b border-r border-slate-100 p-1 sm:p-1.5 text-left align-top flex flex-col transition ${cellBg} ${selectable ? 'cursor-pointer' : 'cursor-default'}`}>
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`text-xs font-semibold ${!inPeriod ? 'text-slate-300' : dateStr === todayStr ? 'text-blue-700' : reason ? 'text-slate-400' : 'text-slate-700'}`}>
                    {d.getDate()}{showMonth && <span className="font-normal text-[10px] ml-0.5">{d.toLocaleDateString('id-ID', { month: 'short' })}</span>}
                  </span>
                  {inPeriod && others.length > 0 && branchCap !== null && (
                    <span className={`text-[9px] font-bold ${others.length >= branchCap ? 'text-red-500' : 'text-slate-400'}`}>{others.length}/{branchCap}</span>
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
                    <div className="text-[10px] px-1 py-0.5 rounded truncate font-semibold text-white bg-green-500" title="Libur di jadwal (diatur HR atau hasil ganti libur)">✓ Anda (jadwal)</div>
                  )}
                  {others.map(e => (
                    <div key={e.employee_id}
                      className={`text-[10px] px-1 py-0.5 rounded truncate bg-amber-100 text-amber-800 ${e.status === 'pending' ? 'border border-dashed border-slate-400' : ''}`}
                      title={`${e.full_name}${e.status === 'pending' ? ' (menunggu HR)' : ''}`}>
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
      <p className="text-xs text-slate-400 mt-2">Nama di kalender = rekan satu cabang yang libur (bergaris putus-putus = masih menunggu persetujuan HR). Klik tanggal abu-abu untuk melihat alasan tidak bisa dipilih.</p>
    </div>
  )
}
