'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getUpcomingRosterPeriod, getCurrentRosterPeriod, rosterPeriodLabel, datesInRange } from '@/lib/rosterPeriod'
import { todayLocalStr, localDateStr } from '@/lib/date'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

type OwnRequest = { id: string; requested_date: string; status: 'draft' | 'pending' | 'approved' | 'rejected'; rejection_reason: string | null; discipline_fee: number }

const MAX_PICKS = 4

export default function AjukanLiburPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [previewReadOnly, setPreviewReadOnly] = useState(false)
  const [ownRequests, setOwnRequests] = useState<OwnRequest[]>([])
  const [colleagueNames, setColleagueNames] = useState<Record<string, string>>({})
  const [rejectedByDate, setRejectedByDate] = useState<Record<string, string>>({})
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Periode yang ditampilkan BUKAN selalu "periode berikutnya" -- kalau periode yang SEDANG
  // BERJALAN masih kurang dari 4 tanggal (misal ada yang ditolak dan belum diganti, atau belum
  // sempat lengkapi 4/4 sebelum periode itu mulai), periode itu yang diprioritaskan supaya masih
  // bisa dilengkapi selama tanggal penggantinya belum lewat. Ditentukan di init() lewat cek
  // jumlah dulu, baru fetchData() penuh untuk periode yang benar-benar dipakai.
  const [period, setPeriod] = useState(() => getUpcomingRosterPeriod())
  const [isCurrentPeriod, setIsCurrentPeriod] = useState(false)
  const periodStartStr = localDateStr(period.start)
  const periodEndStr = localDateStr(period.end)
  const allDates = datesInRange(period.start, period.end)

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

    const currentPeriod = getCurrentRosterPeriod()
    const currentStartStr = localDateStr(currentPeriod.start)
    const { data: currentRows } = await supabase.from('roster_pick_requests')
      .select('status')
      .eq('employee_id', effectiveId).eq('period_start', currentStartStr).neq('status', 'rejected')
    const currentActiveCount = currentRows?.length ?? 0
    // Hitungan SAJA tidak cukup -- kalau salah satu dari 4 pick itu masih 'draft' (misal pengganti
    // tanggal yang baru ditolak), totalnya sudah 4 tapi draft itu belum pernah terkirim ke HR.
    // Tanpa cek ini, karyawan yang kebetulan SUDAH mengisi 4/4 periode depan juga akan langsung
    // dilempar ke periode depan itu (dianggap "selesai"), dan draft yang masih nyangkut di
    // periode sekarang jadi tidak pernah kelihatan lagi di halaman ini.
    const currentHasDraft = (currentRows ?? []).some(r => r.status === 'draft')
    const useCurrentPeriod = currentActiveCount < MAX_PICKS || currentHasDraft
    const activePeriod = useCurrentPeriod ? currentPeriod : getUpcomingRosterPeriod()
    setPeriod(activePeriod)
    setIsCurrentPeriod(useCurrentPeriod)

    await fetchData(effectiveId, localDateStr(activePeriod.start), localDateStr(activePeriod.end))
    setLoading(false)
  }

  async function fetchData(empId: string, startStr: string = periodStartStr, endStr: string = periodEndStr) {
    const [{ data: reqs }, { data: calRows }] = await Promise.all([
      supabase.from('roster_pick_requests')
        .select('id, requested_date, status, rejection_reason, discipline_fee')
        .eq('employee_id', empId)
        .eq('period_start', startStr)
        .neq('status', 'rejected')
        .order('requested_date'),
      supabase.rpc('get_company_dayoff_calendar', { p_from: startStr, p_to: endStr }),
    ])
    setOwnRequests((reqs as OwnRequest[]) || [])
    // Pilihan yang DITOLAK disembunyikan dari daftar aktif (tanggalnya boleh dipilih lagi), tapi
    // alasannya tetap ditampilkan supaya karyawan tahu kenapa ditolak.
    const { data: rej } = await supabase.from('roster_pick_requests')
      .select('requested_date, rejection_reason')
      .eq('employee_id', empId).eq('period_start', startStr).eq('status', 'rejected')
      .order('decided_at', { ascending: true })
    setRejectedByDate(Object.fromEntries(((rej || []) as { requested_date: string; rejection_reason: string | null }[])
      .map(r => [r.requested_date, r.rejection_reason || 'tanpa alasan'])))
    const map: Record<string, string> = {}
    ;(calRows as { off_date: string; employee_names: string }[] | null)?.forEach(r => { map[r.off_date] = r.employee_names })
    setColleagueNames(map)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const activeCount = ownRequests.filter(r => r.status !== 'rejected').length
  // Dipakai buat bedain "sudah terkirim ke HR" (pending/approved) dari "baru dipilih, belum
  // dikirim" (draft) -- activeCount sendiri sengaja menggabung keduanya (dipakai utk batas 4
  // pick & cek weekend), tapi gabungan itu bikin counter "4/4" terlihat sama antara kasus
  // normal (4 draft siap kirim) dan kasus campuran (misal 3 approved + 1 draft baru pengganti
  // yang ditolak) -- padahal yang kedua masih butuh klik "Ajukan ke HR" sebelum HR bisa lihat.
  const sentToHrCount = ownRequests.filter(r => r.status === 'pending' || r.status === 'approved').length
  const draftCount = ownRequests.filter(r => r.status === 'draft').length
  // Weekend (Sabtu/Minggu) jadi primadona karena toko buka tiap hari — SEMUA karyawan di SEMUA
  // cabang dibatasi cuma boleh 1 pilihan weekend per periode (aturan global, bukan cuma cabang
  // ramai), supaya tidak ada yang "menguasai" weekend terus-menerus tiap bulan.
  const isWeekend = (dateStr: string) => [0, 6].includes(new Date(dateStr + 'T00:00:00').getDay())
  const weekendCapActive = true
  const weekendPicksUsed = ownRequests.filter(r => r.status !== 'rejected' && isWeekend(r.requested_date)).length

  async function toggleDate(dateStr: string, own: OwnRequest | undefined) {
    if (previewReadOnly) return
    if (own) {
      if (own.status !== 'draft' && own.status !== 'pending') return // approved tidak bisa dibatalkan di sini
      const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long' })
      if (!confirm(`Batalkan pilihan libur tanggal ${dateLabel}?`)) return
    }
    setBusyDate(dateStr)
    if (own) {
      const { error } = await supabase.from('roster_pick_requests').delete().eq('id', own.id)
      if (error) showMessage('error', 'Gagal membatalkan: ' + error.message)
      else showMessage('success', 'Pilihan dibatalkan.')
    } else {
      if (activeCount >= MAX_PICKS) {
        showMessage('error', `Sudah mencapai maksimal ${MAX_PICKS} tanggal untuk periode ini.`)
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
        status: 'draft',
      })
      if (error) showMessage('error', 'Gagal memilih tanggal: ' + error.message)
      else showMessage('success', `Tanggal ${new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })} dipilih. Belum terkirim ke HR sampai keempat tanggal terisi dan Anda klik "Ajukan ke HR".`)
    }
    await fetchData(employeeId)
    setBusyDate(null)
  }

  // Wajib genap 4/4 dulu baru bisa dikirim ke HR sekaligus — sebelum itu semua pilihan
  // berstatus 'draft' dan tidak kelihatan sama sekali oleh HR.
  const hasDraft = ownRequests.some(r => r.status === 'draft')
  const readyToSubmit = activeCount === MAX_PICKS && hasDraft
  const alreadySubmitted = activeCount === MAX_PICKS && !hasDraft

  async function submitAll() {
    if (!readyToSubmit || previewReadOnly) return
    // isCurrentPeriod = periode ini sudah berjalan (bukan diajukan di muka utk periode mendatang)
    // -- sama persis dengan kondisi yang dipakai RPC submit_roster_picks utk kena denda disiplin,
    // jadi warning di sini harus selalu sinkron dengan yang benar-benar dipotong di payroll.
    const confirmMsg = isCurrentPeriod
      ? `Periode ini sudah berjalan — mengajukan libur sekarang (bukan di muka untuk periode mendatang) akan dikenai denda disiplin Rp10.000/tanggal (total Rp${(MAX_PICKS * 10000).toLocaleString('id-ID')} untuk ${MAX_PICKS} tanggal), dipotong otomatis dari gaji periode ini. Tetap lanjutkan?`
      : `Ajukan ${MAX_PICKS} tanggal libur ini ke HR/Owner? Tidak bisa diubah lagi kecuali dibatalkan satu-satu.`
    if (!confirm(confirmMsg)) return
    setSubmitting(true)
    const { error } = await supabase.rpc('submit_roster_picks', { p_period_start: periodStartStr })
    if (error) showMessage('error', 'Gagal mengajukan: ' + error.message)
    else showMessage('success', isCurrentPeriod
      ? `Berhasil diajukan ke HR/Owner — denda disiplin Rp${(MAX_PICKS * 10000).toLocaleString('id-ID')} akan terpotong otomatis di slip gaji periode ini.`
      : 'Berhasil diajukan ke HR/Owner, tinggal menunggu keputusan.')
    await fetchData(employeeId)
    setSubmitting(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  const ownByDate = Object.fromEntries(ownRequests.map(r => [r.requested_date, r]))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Ajukan Jadwal Libur</h1>
        <p className="text-sm text-slate-500">Wajib pilih tepat {MAX_PICKS} tanggal libur untuk periode <strong>{rosterPeriodLabel(period.start, period.end)}</strong> sebelum bisa diajukan ke HR/Owner — belum bisa diproses kalau belum genap {MAX_PICKS}/{MAX_PICKS}.</p>
      </div>

      {isCurrentPeriod && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-red-800">📌 Periode ini sedang berjalan sekarang — kena denda disiplin</p>
          <p className="text-sm text-red-700 mt-0.5">
            Jatah libur Anda untuk periode ini masih kurang dari {MAX_PICKS} (mungkin ada yang ditolak, atau belum sempat dilengkapi) — lengkapi dulu di sini sebelum bisa lanjut ke periode berikutnya. Tanggal yang sudah lewat otomatis terkunci.
            Karena diajukan setelah periodenya berjalan (bukan di muka), begitu diajukan ke HR akan kena <strong>denda disiplin Rp10.000/tanggal</strong>, dipotong otomatis dari gaji periode ini.
          </p>
        </div>
      )}

      {previewReadOnly && (
        <div className="bg-slate-100 border border-slate-200 text-slate-600 text-sm rounded-lg px-4 py-2.5 mb-6">
          🔒 Mode Preview — halaman ini baca-saja, tombol Pilih/Batalkan/Ajukan dinonaktifkan.
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex gap-3">
        <span className="text-xl leading-none">📅</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">Aturan Libur Weekend</p>
          <p className="text-sm text-amber-700 mt-0.5">Setiap orang di semua cabang cuma boleh pilih <strong>1 tanggal Sabtu/Minggu</strong> dari {MAX_PICKS} pengajuan libur per periode. Ini supaya weekend bisa bergantian dengan rekan sekantor, tidak dikuasai orang yang sama terus setiap bulan. Sisanya bebas pilih hari kerja biasa.</p>
        </div>
      </div>

      {message && (
        <div className={`p-3 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <span className="text-sm text-slate-600">Terpilih: <strong className={activeCount >= MAX_PICKS ? (draftCount > 0 ? 'text-amber-600' : 'text-green-600') : 'text-blue-600'}>{activeCount}</strong> / {MAX_PICKS}
            {weekendCapActive && <span className="ml-3 text-slate-400">· Weekend: <strong className={weekendPicksUsed >= 1 ? 'text-red-600' : 'text-blue-600'}>{weekendPicksUsed}</strong> / 1</span>}
          </span>
          {/* Status campuran (sebagian sudah diputuskan HR, sisanya baru dipilih lagi -- misal
              pengganti tanggal yang ditolak) -- tanpa ini, "Terpilih: 4/4" kelihatan sama persis
              dengan kondisi siap-kirim normal, padahal masih ada draft yang belum terkirim ke HR. */}
          {activeCount >= MAX_PICKS && draftCount > 0 && (
            <p className="text-xs font-medium text-amber-600 mt-0.5">
              ⚠️ {sentToHrCount} tanggal sudah diproses HR, {draftCount} tanggal lagi masih <strong>draft</strong> (belum terkirim) — klik tombol di samping untuk mengirimnya.
            </p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">Tanda kuning = ada rekan lain (cabang mana pun) yang juga libur/mengajukan di tanggal itu</p>
        </div>
        {alreadySubmitted ? (
          <span className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 font-medium whitespace-nowrap">✓ Sudah diajukan, menunggu HR/Owner</span>
        ) : (
          <button onClick={submitAll} disabled={!readyToSubmit || submitting || previewReadOnly}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
            {submitting ? 'Mengajukan...' : draftCount > 0 && draftCount < MAX_PICKS ? `Ajukan ke HR (${draftCount} tanggal baru)` : `Ajukan ke HR (${activeCount}/${MAX_PICKS})`}
          </button>
        )}
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
            const disabled = isPast || busyDate === dateStr || (own?.status === 'approved') || weekendCapBlocks || previewReadOnly
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
                  {rejectedByDate[dateStr] && !own && (
                    <p className="text-xs text-red-600 mt-0.5">❌ Sebelumnya ditolak: {rejectedByDate[dateStr]} — tanggal ini boleh dipilih lagi.</p>
                  )}
                  {weekendCapBlocks && (
                    <p className="text-xs text-slate-400 mt-0.5">Jatah weekend periode ini sudah terpakai.</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {own && own.discipline_fee > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium" title="Diajukan setelah periode berjalan">
                      Denda {own.discipline_fee.toLocaleString('id-ID')}
                    </span>
                  )}
                  {own?.status === 'approved' && (
                    <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">Disetujui</span>
                  )}
                  {own?.status === 'pending' && (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">Menunggu HR</span>
                  )}
                  {own?.status === 'draft' && (
                    <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-500 font-medium">Draf</span>
                  )}
                  <button
                    onClick={() => toggleDate(dateStr, own)}
                    disabled={disabled}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      own?.status === 'draft' || own?.status === 'pending'
                        ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                        : own
                        ? 'border-slate-200 text-slate-400'
                        : 'border-blue-200 text-blue-600 hover:bg-blue-50'
                    }`}>
                    {busyDate === dateStr ? '...' : own ? (own.status === 'approved' ? 'Terkunci' : 'Batalkan') : 'Pilih'}
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
