'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import { fetchDeliveryCandidates, type DeliveryCandidate } from '@/components/DeliveryAssigneePicker'

// Menu "Kirim Barang" -- kiriman Laporan Muat jalur "Diantar Sendiri" (4 cabang toko).
// Alur 3 foto (semua waktu dari jam SERVER, lihat migrasi 067 & 068):
//   FOTO 1 ambil barang (hanya pengantar yang DITUGASKAN, yang foto = PJ) -> FOTO 2 sampai di
//   tiap toko tujuan -> FOTO 3 kembali di cabang asal PJ. Tiap tahap minimal 2 menit; selisih
//   lama berangkat vs lama kembali >= 20 menit wajib alasan. Bonus PJ = 50% ongkir, hanya kalau
//   trip selesai lengkap s/d foto 3.

const MIN_STEP_MS = 2 * 60000
const REASON_DIFF_MIN = 20
const STALE_MS = 6 * 3600000
// Foto dari jalur cadangan kamera bawaan HP yang lebih tua dari ini dianggap dari galeri.
const MAX_FILE_AGE_MS = 2 * 60000

const REASONS: { value: string; label: string; needNote?: boolean }[] = [
  { value: 'macet', label: 'Macet / jalan ditutup' },
  { value: 'bensin', label: 'Isi bensin' },
  { value: 'istirahat', label: 'Istirahat / makan / sholat' },
  { value: 'menunggu_toko', label: 'Menunggu di toko tujuan (bongkar / serah terima)' },
  { value: 'tugas_lain', label: 'Mampir tugas lain', needNote: true },
  { value: 'lainnya', label: 'Lainnya', needNote: true },
]
const reasonLabel = (v: string | null) => REASONS.find(r => r.value === v)?.label ?? v ?? ''

type StoreRel = { name: string; address: string | null; phone: string | null } | null

type WaitingLoading = {
  id: string
  ongkir: number
  nota_amount: number | null
  assigned_to: string | null
  completed_at: string | null
  logistics_stores: StoreRel
  origin: { name: string } | null
  completer: { full_name: string } | null
  assignee: { full_name: string } | null
  packages: { id: string; photo_url: string; caption: string }[]
}

// Order grooming yang ikut di trip / menunggu dijemput-diantar (migrasi 071).
type GroomRel = {
  id: string
  nota_number: string
  status: string
  pickup_ongkir: number | null
  delivery_ongkir: number | null
  customer: StoreRel
  groom_branch: { name: string } | null
}

type StopKind = 'barang' | 'antar_kucing' | 'jemput_kucing' | 'serah_kucing'

type TripStop = {
  id: string
  kind: StopKind
  loading_id: string | null
  grooming_order_id: string | null
  auto_on_return: boolean
  arrived_at: string | null
  arrived_photo_url: string | null
  arrival_order: number | null
  cancelled_at: string | null
  cancel_reason: string | null
  logistics_central_loadings: { ongkir: number; logistics_stores: StoreRel } | null
  grooming_orders: GroomRel | null
}

type GroomTask = {
  key: string
  leg: 'jemput' | 'antar'
  assignee: string | null
  order: GroomRel & {
    created_at: string; ready_at: string | null; branch: { name: string } | null
    assignee_emp: { full_name: string } | null; cats: { id: string }[]
  }
}

type Trip = {
  id: string
  pj_id: string
  status: 'berjalan' | 'selesai' | 'batal' | 'tutup_paksa'
  pickup_photo_url: string
  pickup_at: string
  return_photo_url: string | null
  return_at: string | null
  depart_minutes: number | null
  return_minutes: number | null
  reason_category: string | null
  reason_note: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  forced_at: string | null
  forced_reason: string | null
  reassigned_at: string | null
  reassign_reason: string | null
  pj: { full_name: string; branches: { name: string } | null } | null
  prev_pj: { full_name: string } | null
  logistics_tp_trip_stops: TripStop[]
}

const fmtDateTime = (s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const ms = (s: string) => new Date(s).getTime()

function fmtDur(msVal: number) {
  const totalMin = Math.max(0, Math.floor(msVal / 60000))
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60
  if (d > 0) return `${d} hari${h > 0 ? ` ${h} jam` : ''}`
  if (h > 0) return `${h} jam${m > 0 ? ` ${m} menit` : ''}`
  return `${m} menit`
}
const fmtMin = (min: number | null) => (min == null ? '-' : fmtDur(min * 60000))

function waitingTone(msVal: number) {
  const h = msVal / 3600000
  if (h >= 24) return 'bg-red-50 border-red-200 text-red-700'
  if (h >= 6) return 'bg-orange-50 border-orange-200 text-orange-700'
  return 'bg-amber-50 border-amber-200 text-amber-700'
}

const liveStops = (t: Trip) => t.logistics_tp_trip_stops.filter(s => !s.cancelled_at)
const arrivedStops = (t: Trip) => liveStops(t).filter(s => s.arrived_at).sort((a, b) => ms(a.arrived_at!) - ms(b.arrived_at!))
function lastEventAt(t: Trip) {
  // Serah kucing yang otomatis tercatat oleh foto 3 bukan foto tersendiri.
  const arr = arrivedStops(t).filter(s => !s.auto_on_return)
  return arr.length > 0 ? ms(arr[arr.length - 1].arrived_at!) : ms(t.pickup_at)
}
// Ongkir yang jadi dasar bonus PJ per tujuan (serah kucing = bagian dari jemput, 0).
function stopOngkir(s: TripStop) {
  if (s.kind === 'barang') return Number(s.logistics_central_loadings?.ongkir ?? 0)
  if (s.kind === 'jemput_kucing') return Number(s.grooming_orders?.pickup_ongkir ?? 0)
  if (s.kind === 'antar_kucing') return Number(s.grooming_orders?.delivery_ongkir ?? 0)
  return 0
}
// Bonus perjalanan grooming baru cair kalau order grooming SELESAI total.
const stopBonusReady = (s: TripStop) => s.kind === 'barang' || s.grooming_orders?.status === 'selesai'
function tripBonus(t: Trip) {
  if (t.status !== 'selesai') return 0
  return arrivedStops(t).filter(stopBonusReady).reduce((s, st) => s + Math.floor(stopOngkir(st) * 0.5), 0)
}
function tripBonusPending(t: Trip) {
  if (t.status !== 'selesai') return 0
  return arrivedStops(t).filter(s => !stopBonusReady(s) && s.grooming_orders?.status !== 'batal')
    .reduce((s, st) => s + Math.floor(stopOngkir(st) * 0.5), 0)
}
function stopTitle(s: TripStop) {
  const g = s.grooming_orders
  if (s.kind === 'barang') return s.logistics_central_loadings?.logistics_stores?.name ?? 'toko'
  if (s.kind === 'antar_kucing') return `🐱 Antar kucing ke ${g?.customer?.name ?? 'pelanggan'} (nota ${g?.nota_number ?? '-'})`
  if (s.kind === 'jemput_kucing') return `🐱 Jemput kucing di ${g?.customer?.name ?? 'pelanggan'} (nota ${g?.nota_number ?? '-'})`
  return `🐱 Serahkan kucing di ${g?.groom_branch?.name ?? 'cabang grooming'} (nota ${g?.nota_number ?? '-'})`
}
function stopPlace(s: TripStop): StoreRel {
  if (s.kind === 'barang') return s.logistics_central_loadings?.logistics_stores ?? null
  if (s.kind === 'serah_kucing') return null
  return s.grooming_orders?.customer ?? null
}
const GROOM_REL = `id, nota_number, status, pickup_ongkir, delivery_ongkir,
  customer:logistics_stores!grooming_orders_customer_id_fkey(name, address, phone),
  groom_branch:branches!grooming_orders_groom_branch_id_fkey(name)`
// Folder foto di storage: kiriman barang = <loading_id>/, grooming = grooming/<order_id>/.
const stopFolder = (s: TripStop) => s.loading_id ?? `grooming/${s.grooming_order_id}`

// Periode gaji: 26 bulan lalu s/d 25 bulan ini.
function periodRange(month: number, year: number) {
  const start = new Date(year, month - 2, 26)
  const end = new Date(year, month - 1, 26)
  return { start, end }
}
function currentPeriod() {
  const d = new Date()
  const m = d.getDate() >= 26 ? d.getMonth() + 2 : d.getMonth() + 1
  return m === 13 ? { month: 1, year: d.getFullYear() + 1 } : { month: m, year: d.getFullYear() }
}
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

export default function KirimBarangPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')
  const [isOwner, setIsOwner] = useState(false)
  // Cabang asal saya (foto 3 = kembali di cabang ini).
  const [myBranchName, setMyBranchName] = useState('')
  const [canView, setCanView] = useState(false)
  const [canSeeAll, setCanSeeAll] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [waiting, setWaiting] = useState<WaitingLoading[]>([])
  const [groomTasks, setGroomTasks] = useState<GroomTask[]>([])
  const [activeTrips, setActiveTrips] = useState<Trip[]>([])
  const [historyTrips, setHistoryTrips] = useState<Trip[]>([])
  const [candidates, setCandidates] = useState<DeliveryCandidate[]>([])

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  // Foto yang sudah diambil tapi gagal terkirim (sinyal jelek) -- disimpan supaya bisa dicoba
  // lagi tanpa foto ulang.
  const [pending, setPending] = useState<{ kind: 'start' | 'arrive' | 'finish'; blob: Blob; url?: string; stopId?: string; loadingIds?: string[]; groomKeys?: string[] } | null>(null)

  const [reasonCategory, setReasonCategory] = useState('')
  const [reasonNote, setReasonNote] = useState('')
  const [reasonForced, setReasonForced] = useState(false)

  const [period, setPeriod] = useState(currentPeriod)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 8000)
  }

  const tripSelect = `
    id, pj_id, status, pickup_photo_url, pickup_at, return_photo_url, return_at, depart_minutes, return_minutes,
    reason_category, reason_note, cancelled_at, cancel_reason, forced_at, forced_reason, reassigned_at, reassign_reason,
    pj:employees!logistics_tp_trips_pj_id_fkey(full_name, branches(name)),
    prev_pj:employees!logistics_tp_trips_reassigned_from_fkey(full_name),
    logistics_tp_trip_stops(id, kind, loading_id, grooming_order_id, auto_on_return, arrived_at, arrived_photo_url, arrival_order, cancelled_at, cancel_reason,
      logistics_central_loadings(ongkir, logistics_stores(name, address, phone)),
      grooming_orders(${GROOM_REL}))
  `

  const fetchAll = useCallback(async (empId: string, seeAll: boolean, p: { month: number; year: number }) => {
    // Menunggu Diambil: hanya tugas yang ditugaskan ke saya; Owner/Kepala Gudang/HR/Finance
    // melihat semua (pantau saja -- yang bisa foto 1 tetap cuma pengantar yang ditugaskan).
    let lq = supabase.from('logistics_central_loadings')
      .select(`id, ongkir, nota_amount, assigned_to, completed_at, logistics_stores(name, address, phone),
        origin:branches!logistics_central_loadings_origin_branch_id_fkey(name),
        completer:employees!logistics_central_loadings_completed_by_fkey(full_name),
        assignee:employees!logistics_central_loadings_assigned_to_fkey(full_name),
        packages:logistics_central_loading_packages(id, photo_url, caption)`)
      .eq('status', 'selesai').eq('delivery_method', 'antar_sendiri')
      .order('completed_at', { ascending: true })
    if (!seeAll) lq = lq.eq('assigned_to', empId || '00000000-0000-0000-0000-000000000000')
    const { data: loadRows, error: loadErr } = await lq
    if (loadErr) { showMessage('error', 'Gagal memuat kiriman: ' + loadErr.message); return }
    const rows = (loadRows as unknown as WaitingLoading[]) || []
    let taken = new Set<string>()
    if (rows.length > 0) {
      const { data: stopRows } = await supabase.from('logistics_tp_trip_stops').select('loading_id')
        .in('loading_id', rows.map(r => r.id)).is('cancelled_at', null)
      taken = new Set(((stopRows as { loading_id: string }[]) || []).map(s => s.loading_id))
    }
    setWaiting(rows.filter(r => !taken.has(r.id)))

    // Tugas jemput (order menunggu) & antar (order siap) kucing grooming.
    const me = empId || '00000000-0000-0000-0000-000000000000'
    const legSelect = (fk: string) => `${GROOM_REL}, created_at, ready_at,
      branch:branches!grooming_orders_branch_id_fkey(name),
      assignee_emp:employees!${fk}(full_name), cats:grooming_order_cats(id)`
    let jq = supabase.from('grooming_orders').select(`${legSelect('grooming_orders_pickup_assignee_fkey')}, assignee:pickup_assignee`)
      .eq('status', 'menunggu').eq('arrival_mode', 'jemput').order('created_at')
    let aq = supabase.from('grooming_orders').select(`${legSelect('grooming_orders_delivery_assignee_fkey')}, assignee:delivery_assignee`)
      .eq('status', 'siap').eq('return_mode', 'antar').order('ready_at')
    if (!seeAll) { jq = jq.eq('pickup_assignee', me); aq = aq.eq('delivery_assignee', me) }
    const [{ data: jRows }, { data: aRows }] = await Promise.all([jq, aq])
    type LegRow = GroomTask['order'] & { assignee: string | null }
    const legs: GroomTask[] = [
      ...((jRows as unknown as LegRow[]) || []).map(o => ({ key: `g:${o.id}:jemput`, leg: 'jemput' as const, assignee: o.assignee, order: o })),
      ...((aRows as unknown as LegRow[]) || []).map(o => ({ key: `g:${o.id}:antar`, leg: 'antar' as const, assignee: o.assignee, order: o })),
    ]
    let gTaken = new Set<string>()
    if (legs.length > 0) {
      const { data: gStops } = await supabase.from('logistics_tp_trip_stops').select('grooming_order_id, kind')
        .in('grooming_order_id', legs.map(l => l.order.id)).in('kind', ['jemput_kucing', 'antar_kucing']).is('cancelled_at', null)
      gTaken = new Set(((gStops as { grooming_order_id: string; kind: string }[]) || [])
        .map(s => `g:${s.grooming_order_id}:${s.kind === 'jemput_kucing' ? 'jemput' : 'antar'}`))
    }
    setGroomTasks(legs.filter(l => !gTaken.has(l.key)))

    const { data: act } = await supabase.from('logistics_tp_trips').select(tripSelect)
      .eq('status', 'berjalan').order('pickup_at')
    setActiveTrips((act as unknown as Trip[]) || [])

    const { start, end } = periodRange(p.month, p.year)
    let q = supabase.from('logistics_tp_trips').select(tripSelect)
      .neq('status', 'berjalan')
      .gte('pickup_at', start.toISOString()).lt('pickup_at', end.toISOString())
      .order('pickup_at', { ascending: false })
    if (!seeAll) q = q.eq('pj_id', empId)
    const { data: hist } = await q
    setHistoryTrips((hist as unknown as Trip[]) || [])
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      let empId = '', seeAll = false
      if (user) {
        const { data: userData } = await supabase.from('users').select('role, employee_id, employees(full_name)').eq('id', user.id).single()
        if (userData) {
          empId = userData.employee_id || ''
          setMyEmployeeId(empId)
          const me = userData.employees as unknown as { full_name: string } | { full_name: string }[] | null
          setMyName((Array.isArray(me) ? me[0]?.full_name : me?.full_name) || '')
          if (userData.role === 'owner') { setIsOwner(true); seeAll = true }
          if (['hr', 'finance'].includes(userData.role)) seeAll = true
          let storeStaff = false, kg = false
          if (empId) {
            const { data: emp } = await supabase.from('employees').select('branch_id, positions(name), branches(name)').eq('id', empId).single()
            type NameRel = { name: string } | { name: string }[] | null
            const pos = emp?.positions as NameRel
            const br = emp?.branches as NameRel
            setMyBranchName((Array.isArray(br) ? br[0]?.name : br?.name) || '')
            kg = (Array.isArray(pos) ? pos[0]?.name : pos?.name) === 'Kepala Gudang'
            if (emp?.branch_id) {
              const { data: sb } = await supabase.from('logistics_store_branches').select('branch_id').eq('branch_id', emp.branch_id).maybeSingle()
              storeStaff = !!sb
            }
          }
          if (kg) seeAll = true
          setCanView(storeStaff || seeAll)
          if (userData.role === 'owner') setCandidates(await fetchDeliveryCandidates(supabase))
        }
      }
      setCanSeeAll(seeAll)
      await fetchAll(empId, seeAll, period)
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    await fetchAll(myEmployeeId, canSeeAll, period)
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
  }, [fetchAll, myEmployeeId, canSeeAll, period])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (loading) return
    const t = setInterval(() => { fetchAll(myEmployeeId, canSeeAll, period) }, 60000)
    return () => clearInterval(t)
  }, [loading, fetchAll, myEmployeeId, canSeeAll, period])
  function changePeriod(next: { month: number; year: number }) {
    setPeriod(next)
    fetchAll(myEmployeeId, canSeeAll, next)
  }

  const myTrip = useMemo(() => activeTrips.find(t => t.pj_id === myEmployeeId) || null, [activeTrips, myEmployeeId])
  const otherActive = activeTrips.filter(t => t.pj_id !== myEmployeeId)
  const myWaiting = waiting.filter(w => w.assigned_to === myEmployeeId)
  const myGroomTasks = groomTasks.filter(g => g.assignee === myEmployeeId)
  const selectedIds = Object.keys(selected).filter(k => selected[k] && myWaiting.some(w => w.id === k))
  const selectedGroomKeys = Object.keys(selected).filter(k => selected[k] && myGroomTasks.some(g => g.key === k))
  const selectedCount = selectedIds.length + selectedGroomKeys.length
  const waitingCount = waiting.length + groomTasks.length
  // Foto 3 = kembali di cabang asal PJ.
  const homeOf = (t: Trip) => t.pj?.branches?.name ?? 'cabang'

  async function upload(folder: string, blob: Blob, tag: string): Promise<string | null> {
    const path = `${folder}/tp-${tag}-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('logistics-photos').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) return null
    return supabase.storage.from('logistics-photos').getPublicUrl(path).data.publicUrl
  }

  // ── FOTO 1 ── (kiriman barang + tugas jemput/antar kucing boleh sekaligus)
  async function doStart(blob: Blob, loadingIds: string[], groomKeys: string[], existingUrl?: string) {
    setBusy(true)
    const folder = loadingIds[0] ?? `grooming/${groomKeys[0].split(':')[1]}`
    const url = existingUrl ?? await upload(folder, blob, 'ambil')
    if (!url) { setBusy(false); setPending({ kind: 'start', blob, loadingIds, groomKeys }); showMessage('error', 'Foto gagal terkirim (cek sinyal). Tekan "Coba Kirim Lagi" — tidak perlu foto ulang.'); return }
    const grooming = groomKeys.map(k => { const [, orderId, leg] = k.split(':'); return { order_id: orderId, leg } })
    const { error } = await supabase.rpc('start_tp_trip', { p_loading_ids: loadingIds, p_photo_url: url, p_grooming: grooming })
    setBusy(false)
    if (error) {
      if (/fetch|network/i.test(error.message)) { setPending({ kind: 'start', blob, url, loadingIds, groomKeys }); showMessage('error', 'Gagal terhubung ke server. Tekan "Coba Kirim Lagi".'); return }
      setPending(null); showMessage('error', error.message); await refresh(); return
    }
    setPending(null)
    setSelected({})
    showMessage('success', 'Tugas diambil — Anda PJ. Foto lagi di tiap tujuan.')
    await refresh()
  }

  // ── FOTO 2 ──
  async function doArrive(blob: Blob, stop: TripStop, existingUrl?: string) {
    setBusy(true)
    const url = existingUrl ?? await upload(stopFolder(stop), blob, 'sampai')
    if (!url) { setBusy(false); setPending({ kind: 'arrive', blob, stopId: stop.id }); showMessage('error', 'Foto gagal terkirim (cek sinyal). Tekan "Coba Kirim Lagi" — tidak perlu foto ulang.'); return }
    const { error } = await supabase.rpc('arrive_tp_stop', { p_stop_id: stop.id, p_photo_url: url })
    setBusy(false)
    if (error) {
      if (/fetch|network/i.test(error.message)) { setPending({ kind: 'arrive', blob, url, stopId: stop.id }); showMessage('error', 'Gagal terhubung ke server. Tekan "Coba Kirim Lagi".'); return }
      setPending(null); showMessage('error', error.message); await refresh(); return
    }
    setPending(null)
    showMessage('success', stop.kind === 'barang' ? `Sampai di ${stopTitle(stop)} tercatat.` : `${stopTitle(stop).replace('🐱 ', '')} — tercatat.`)
    await refresh()
  }

  // ── FOTO 3 ──
  async function doFinish(blob: Blob, trip: Trip, existingUrl?: string) {
    setBusy(true)
    const url = existingUrl ?? await upload(stopFolder(trip.logistics_tp_trip_stops[0]), blob, 'kembali')
    if (!url) { setBusy(false); setPending({ kind: 'finish', blob }); showMessage('error', 'Foto gagal terkirim (cek sinyal). Tekan "Coba Kirim Lagi" — tidak perlu foto ulang.'); return }
    const { error } = await supabase.rpc('finish_tp_trip', {
      p_trip_id: trip.id, p_photo_url: url,
      p_reason_category: reasonCategory || null, p_reason_note: reasonNote || null,
    })
    setBusy(false)
    if (error) {
      if (error.message.includes('ALASAN_WAJIB')) {
        // Hitungan server (jam server) bilang wajib alasan -- foto sudah terkirim, simpan URL-nya
        // supaya karyawan cukup isi alasan lalu kirim ulang, tanpa foto ulang.
        setReasonForced(true)
        setPending({ kind: 'finish', blob, url })
        showMessage('error', error.message.replace('ALASAN_WAJIB: ', '') + ' Isi alasan di bawah lalu tekan "Kirim Ulang".')
        return
      }
      if (/fetch|network/i.test(error.message)) { setPending({ kind: 'finish', blob, url }); showMessage('error', 'Gagal terhubung ke server. Tekan "Coba Kirim Lagi".'); return }
      setPending(null); showMessage('error', error.message); await refresh(); return
    }
    setPending(null)
    setReasonCategory(''); setReasonNote(''); setReasonForced(false)
    showMessage('success', 'Tugas antar selesai. Terima kasih!')
    await refresh()
  }

  async function retryPending() {
    if (!pending) return
    if (pending.kind === 'start' && pending.loadingIds) return doStart(pending.blob, pending.loadingIds, pending.groomKeys ?? [], pending.url)
    if (pending.kind === 'arrive' && myTrip) {
      const stop = myTrip.logistics_tp_trip_stops.find(s => s.id === pending.stopId)
      if (stop) return doArrive(pending.blob, stop, pending.url)
    }
    if (pending.kind === 'finish' && myTrip) return doFinish(pending.blob, myTrip, pending.url)
    setPending(null)
  }

  async function rpcWithReason(fn: string, args: Record<string, unknown>, promptText: string, okText: string) {
    const reason = window.prompt(promptText)
    if (reason === null) return
    if (reason.trim().length < 3) { showMessage('error', 'Alasan wajib diisi (minimal 3 huruf).'); return }
    setBusy(true)
    const { error } = await supabase.rpc(fn, { ...args, p_reason: reason.trim() })
    setBusy(false)
    if (error) { showMessage('error', error.message); return }
    showMessage('success', okText)
    await refresh()
  }

  // Grooming ikut berubah (status order / tugas jemput-antar) -- segarkan badge-nya juga.
  useEffect(() => {
    const h = () => window.dispatchEvent(new Event('grooming-badge-refresh'))
    window.addEventListener('kirim-barang-badge-refresh', h)
    return () => window.removeEventListener('kirim-barang-badge-refresh', h)
  }, [])

  async function handleReassign(trip: Trip, newPj: string) {
    if (!newPj) return
    const name = candidates.find(e => e.id === newPj)?.full_name
    await rpcWithReason('reassign_tp_trip', { p_trip_id: trip.id, p_new_pj: newPj },
      `Alihkan PJ dari ${trip.pj?.full_name} ke ${name}. Alasan:`, `PJ dialihkan ke ${name}.`)
  }

  // Rekap per karyawan (periode terpilih).
  const recap = useMemo(() => {
    const map: Record<string, { name: string; trips: number; done: number; forced: number; flagged: number; depSum: number; retSum: number; n: number; bonus: number }> = {}
    historyTrips.forEach(t => {
      const r = map[t.pj_id] ??= { name: t.pj?.full_name ?? '-', trips: 0, done: 0, forced: 0, flagged: 0, depSum: 0, retSum: 0, n: 0, bonus: 0 }
      r.trips++
      if (t.status === 'selesai') {
        r.done++
        if (t.depart_minutes != null && t.return_minutes != null) {
          r.depSum += Number(t.depart_minutes); r.retSum += Number(t.return_minutes); r.n++
          if (Math.abs(Number(t.return_minutes) - Number(t.depart_minutes)) >= REASON_DIFF_MIN) r.flagged++
        }
        r.bonus += tripBonus(t)
      }
      if (t.status === 'tutup_paksa') r.forced++
    })
    return Object.values(map).sort((a, b) => b.trips - a.trips)
  }, [historyTrips])

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  if (!canView) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kirim Barang</h1>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mt-4">
          Cuma staf cabang toko (Toko Pusat, Toko Depan, Markas, Raja), Kepala Gudang, atau Owner yang bisa membuka halaman ini.
        </div>
      </div>
    )
  }

  // ── Render helpers ──
  function renderStopsTimeline(t: Trip) {
    const arr = arrivedStops(t)
    return (
      <div className="space-y-2">
        <PhotoRow label="📸 Foto 1 — Barang/kucing diambil" url={t.pickup_photo_url} at={t.pickup_at} onOpen={openLightbox} />
        {liveStops(t).sort((a, b) => (a.arrival_order ?? 99) - (b.arrival_order ?? 99)).map(s => {
          const idx = arr.findIndex(x => x.id === s.id)
          const prevAt = idx <= 0 ? ms(t.pickup_at) : ms(arr[idx - 1].arrived_at!)
          return s.arrived_at ? (
            s.auto_on_return ? (
              <div key={s.id} className="text-xs text-slate-600 pl-1">✓ {stopTitle(s)} — tercatat dengan foto kembali</div>
            ) : (
              <PhotoRow key={s.id} label={`📸 Foto 2 — ${s.kind === 'barang' ? 'Sampai ' : ''}${stopTitle(s)}`} url={s.arrived_photo_url!} at={s.arrived_at}
                extra={`${idx === 0 ? 'Lama berangkat' : 'Dari tujuan sebelumnya'}: ${fmtDur(ms(s.arrived_at) - prevAt)}`} onOpen={openLightbox} />
            )
          ) : (
            <div key={s.id} className="text-xs text-slate-500 pl-1">⏳ {stopTitle(s)} — belum</div>
          )
        })}
        {t.logistics_tp_trip_stops.filter(s => s.cancelled_at).map(s => (
          <div key={s.id} className="text-xs text-slate-400 pl-1 line-through">
            {stopTitle(s)} — dilepas: {s.cancel_reason}
          </div>
        ))}
        {t.return_photo_url && t.return_at && (
          <PhotoRow label={`📸 Foto 3 — Kembali di ${homeOf(t)}`} url={t.return_photo_url} at={t.return_at}
            extra={`Lama kembali: ${fmtMin(t.return_minutes)}`} onOpen={openLightbox} />
        )}
      </div>
    )
  }

  function renderTripSummary(t: Trip) {
    const diff = t.depart_minutes != null && t.return_minutes != null ? Math.abs(Number(t.return_minutes) - Number(t.depart_minutes)) : 0
    const flagged = t.status === 'selesai' && diff >= REASON_DIFF_MIN
    const total = t.return_at ? ms(t.return_at) - ms(t.pickup_at) : null
    const stores = liveStops(t).filter(s => s.kind !== 'serah_kucing')
      .map(s => s.kind === 'barang' ? s.logistics_central_loadings?.logistics_stores?.name : `🐱 ${s.grooming_orders?.customer?.name ?? ''}`)
      .filter(Boolean).join(', ')
    const bonus = tripBonus(t)
    const bonusPending = tripBonusPending(t)
    return (
      <details key={t.id} className={`bg-white border rounded-xl overflow-hidden ${flagged ? 'border-red-300' : 'border-slate-200'}`}>
        <summary className="px-4 py-3 cursor-pointer list-none">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-800 text-sm">🛵 {t.pj?.full_name} <span className="font-normal text-slate-500">· {stores || '-'}</span></p>
              <p className="text-xs text-slate-400">{fmtDateTime(t.pickup_at)}</p>
            </div>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold ${
              t.status === 'selesai' ? 'bg-green-100 text-green-700' : t.status === 'batal' ? 'bg-slate-100 text-slate-500' : 'bg-red-100 text-red-700'
            }`}>
              {t.status === 'selesai' ? 'Selesai' : t.status === 'batal' ? 'Batal' : 'Tutup Paksa'}
            </span>
          </div>
          {t.status === 'selesai' && (
            <p className={`text-xs mt-1.5 ${flagged ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
              Berangkat: <b>{fmtMin(t.depart_minutes)}</b> · Kembali: <b>{fmtMin(t.return_minutes)}</b>
              {total != null && <> · Total: <b>{fmtDur(total)}</b></>}{flagged && ' ⚠️'}
            </p>
          )}
          {t.reason_category && <p className="text-xs text-red-700 mt-0.5">Alasan: {reasonLabel(t.reason_category)}{t.reason_note ? ` — "${t.reason_note}"` : ''}</p>}
          {t.status === 'selesai' && <p className="text-xs text-green-700 mt-0.5">Bonus ongkir PJ: {bonus > 0 ? fmtRp(bonus) : '—'}
            {bonusPending > 0 && <span className="text-amber-700"> · {fmtRp(bonusPending)} menunggu order grooming selesai</span>}</p>}
          {t.status === 'batal' && <p className="text-xs text-slate-500 mt-0.5">Dibatalkan: {t.cancel_reason}</p>}
          {t.status === 'tutup_paksa' && <p className="text-xs text-red-700 mt-0.5">Ditutup paksa Owner: {t.forced_reason} (tanpa bonus)</p>}
          {t.reassigned_at && <p className="text-xs text-slate-500 mt-0.5">PJ dialihkan dari {t.prev_pj?.full_name}: {t.reassign_reason}</p>}
        </summary>
        <div className="border-t border-slate-100 px-4 py-3">{renderStopsTimeline(t)}</div>
      </details>
    )
  }

  // ── Trip aktif saya ──
  function renderMyTrip(t: Trip) {
    const live = liveStops(t)
    // Serah kucing di cabang asal PJ ikut tercatat oleh foto 3 -- tidak wajib foto tersendiri.
    const serahAtHome = (s: TripStop) => s.kind === 'serah_kucing' && !!s.grooming_orders?.groom_branch?.name && s.grooming_orders.groom_branch.name === homeOf(t)
    const jemputDone = (s: TripStop) => live.some(x => x.kind === 'jemput_kucing' && x.grooming_order_id === s.grooming_order_id && x.arrived_at)
    const notArrived = live.filter(s => !s.arrived_at && !serahAtHome(s))
    const autoSerah = live.filter(s => !s.arrived_at && serahAtHome(s))
    const arr = arrivedStops(t)
    const sinceLast = now - lastEventAt(t)
    const waitLeft = Math.max(0, MIN_STEP_MS - sinceLast)
    const allArrived = live.length > 0 && notArrived.length === 0 && autoSerah.every(jemputDone)
    const estDep = arr.length > 0 ? (ms(arr[0].arrived_at!) - ms(t.pickup_at)) / 60000 : 0
    const estRet = sinceLast / 60000
    const needReason = allArrived && (reasonForced || Math.abs(estRet - estDep) >= REASON_DIFF_MIN)
    const reasonOk = !needReason || (reasonCategory && (!REASONS.find(r => r.value === reasonCategory)?.needNote || reasonNote.trim().length >= 5))
    const stale = sinceLast > STALE_MS

    return (
      <div className="bg-white border-2 border-purple-300 rounded-xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-purple-800">🛵 Tugas Antar Saya (PJ)</p>
            <p className="text-xs text-slate-500">Diambil {fmtDateTime(t.pickup_at)} · sudah {fmtDur(now - ms(t.pickup_at))}</p>
          </div>
          {arr.length === 0 && (
            <button disabled={busy} onClick={() => rpcWithReason('cancel_tp_trip', { p_trip_id: t.id }, 'Batal antar semua kiriman ini. Alasan:', 'Antar dibatalkan — kiriman kembali ke daftar menunggu.')}
              className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">Batal Antar</button>
          )}
        </div>
        {stale && <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 font-semibold">⚠️ Sudah lebih dari 6 jam sejak foto terakhir — segera selesaikan. Tugas ini sudah muncul di Owner.</p>}

        {renderStopsTimeline(t)}

        {notArrived.length > 0 && (
          <div className="space-y-3">
            {notArrived.map(s => {
              const place = stopPlace(s)
              const blocked = s.kind === 'serah_kucing' && !jemputDone(s)
              const title = stopTitle(s)
              return (
                <div key={s.id} className={`border rounded-lg p-3 space-y-2 ${s.kind === 'barang' ? 'bg-purple-50 border-purple-200' : 'bg-pink-50 border-pink-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">📍 {title}</p>
                      {place?.address && <p className="text-xs text-slate-500">{place.address}</p>}
                      {place?.phone && <a href={`tel:${place.phone}`} className="text-xs text-blue-600">📞 {place.phone}</a>}
                    </div>
                    {s.kind !== 'serah_kucing' && (
                      <button disabled={busy} onClick={() => rpcWithReason('release_tp_stop', { p_stop_id: s.id }, `Lepas "${title}" dari tugas ini (kembali ke daftar menunggu). Alasan:`, 'Tujuan dilepas dari tugas.')}
                        className="shrink-0 text-[11px] px-2 py-1 border border-slate-300 bg-white rounded-lg text-slate-600 disabled:opacity-50">Lepas</button>
                    )}
                  </div>
                  {blocked ? (
                    <p className="text-xs text-slate-500 text-center py-2">Foto jemput kucing di pelanggan dulu.</p>
                  ) : waitLeft > 0 ? (
                    <p className="text-xs text-slate-500 text-center py-2">⏳ Foto sampai bisa diambil {Math.ceil(waitLeft / 60000)} menit lagi (minimal 2 menit per tahap).</p>
                  ) : busy ? (
                    <p className="text-xs text-slate-500 text-center py-2">Mengirim...</p>
                  ) : (
                    <LogisticsCameraCapture label={s.kind === 'barang' ? `Foto Sampai — ${title}` : title.replace('🐱 ', 'Foto ')} employeeName={myName}
                      maxFileAgeMs={MAX_FILE_AGE_MS} onCaptured={blob => doArrive(blob, s)} />
                  )}
                </div>
              )
            })}
          </div>
        )}
        {autoSerah.length > 0 && (
          <p className="text-xs bg-pink-50 border border-pink-200 text-pink-800 rounded-lg px-3 py-2">
            🐱 {autoSerah.length} kucing dijemput untuk {homeOf(t)} — otomatis tercatat sampai saat Anda foto kembali di {homeOf(t)}.
            {autoSerah.some(s => !jemputDone(s)) && ' (Foto jemput di pelanggan dulu.)'}
          </p>
        )}

        {allArrived && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-semibold text-green-800">🏪 Sudah kembali di {myBranchName || homeOf(t)}? Foto sebagai tanda tugas selesai.</p>
            <p className="text-xs text-slate-600">Lama berangkat: <b>{fmtDur(estDep * 60000)}</b> · Sejak foto terakhir: <b>{fmtDur(sinceLast)}</b></p>
            {needReason && (
              <div className="bg-white border border-red-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-red-700">Selisih lama berangkat & lama kembali {REASON_DIFF_MIN} menit atau lebih — wajib isi alasan:</p>
                <select value={reasonCategory} onChange={e => setReasonCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                  <option value="">— Pilih alasan —</option>
                  {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <input type="text" value={reasonNote} onChange={e => setReasonNote(e.target.value)}
                  placeholder={REASONS.find(r => r.value === reasonCategory)?.needNote ? 'Jelaskan (wajib)' : 'Keterangan tambahan (opsional)'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            )}
            {waitLeft > 0 ? (
              <p className="text-xs text-slate-500 text-center py-2">⏳ Foto kembali bisa diambil {Math.ceil(waitLeft / 60000)} menit lagi (minimal 2 menit per tahap).</p>
            ) : busy ? (
              <p className="text-xs text-slate-500 text-center py-2">Mengirim...</p>
            ) : pending?.kind === 'finish' && pending.url ? (
              <button disabled={!reasonOk} onClick={() => retryPending()}
                className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">Kirim Ulang (foto sudah tersimpan)</button>
            ) : reasonOk ? (
              <LogisticsCameraCapture label={`Foto Kembali di ${myBranchName || homeOf(t)}`} employeeName={myName}
                maxFileAgeMs={MAX_FILE_AGE_MS} onCaptured={blob => doFinish(blob, t)} />
            ) : (
              <p className="text-xs text-red-600 text-center py-2">Isi alasan dulu sebelum foto kembali.</p>
            )}
          </div>
        )}
      </div>
    )
  }

  const { start: pStart, end: pEnd } = periodRange(period.month, period.year)
  const pEndShown = new Date(pEnd.getTime() - 86400000)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kirim Barang</h1>
        <p className="text-sm text-slate-500">Kiriman Laporan Muat jalur &quot;Diantar Sendiri&quot; + jemput/antar kucing grooming — tugas muncul ke pengantar yang ditugaskan. Boleh diambil sekaligus dalam satu perjalanan.</p>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {pending && !(pending.kind === 'finish' && pending.url) && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-center justify-between gap-2">
          <p className="text-sm text-amber-800">Ada foto yang belum terkirim.</p>
          <button disabled={busy} onClick={retryPending} className="px-3 py-1.5 bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {busy ? 'Mengirim...' : 'Coba Kirim Lagi'}
          </button>
        </div>
      )}

      {myTrip && renderMyTrip(myTrip)}

      {/* Menunggu diambil */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-700">📦 Menunggu Diambil {canSeeAll ? '' : 'oleh Saya '}({waitingCount})</h2>
        {waitingCount === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-500 text-sm">
            {canSeeAll ? 'Tidak ada kiriman yang menunggu.' : 'Tidak ada tugas antar untuk Anda.'}
          </div>
        ) : (
          <>
            {waiting.map(w => {
              const waitMs = w.completed_at ? now - ms(w.completed_at) : 0
              const mine = w.assigned_to === myEmployeeId
              const selectable = mine && !myTrip
              return (
                <label key={w.id} className={`block bg-white border rounded-xl p-4 ${selected[w.id] ? 'border-purple-400 ring-2 ring-purple-200' : 'border-slate-200'} ${selectable ? 'cursor-pointer' : ''}`}>
                  <div className="flex items-start gap-3">
                    {selectable && (
                      <input type="checkbox" checked={!!selected[w.id]} onChange={e => setSelected(s => ({ ...s, [w.id]: e.target.checked }))}
                        className="mt-1 w-5 h-5 accent-purple-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">{w.logistics_stores?.name}</p>
                      {w.logistics_stores?.address && <p className="text-xs text-slate-500">{w.logistics_stores.address}</p>}
                      <p className="text-xs text-slate-600 mt-0.5">
                        📍 Ambil di <b>{w.origin?.name ?? '-'}</b>
                        {!mine && <> · Pengantar: <b>{w.assignee?.full_name ?? '-'}</b></>}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {w.packages.length} paket · Ongkir {w.ongkir > 0 ? <b>{fmtRp(w.ongkir)}</b> : 'tidak ada'}
                        {w.ongkir > 0 && <span className="text-green-700"> (bonus PJ {fmtRp(Math.floor(w.ongkir * 0.5))})</span>}
                      </p>
                      {w.nota_amount != null && <p className="text-xs font-semibold text-emerald-700 mt-0.5">🧾 Nota {fmtRp(w.nota_amount)}</p>}
                      <p className="text-xs text-slate-400">Disiapkan {w.completer?.full_name ?? '-'}{w.completed_at ? ` · ${fmtDateTime(w.completed_at)}` : ''}</p>
                      <p className={`inline-block mt-1.5 text-xs font-semibold px-2 py-1 rounded-md border ${waitingTone(waitMs)}`}>⏱ Sudah {fmtDur(waitMs)} belum diambil</p>
                      {w.packages.length > 0 && (
                        <div className="flex gap-2 mt-2 overflow-x-auto">
                          {w.packages.map(p => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={p.id} src={p.photo_url} alt={p.caption} title={p.caption}
                              onClick={e => { e.preventDefault(); openLightbox(p.photo_url, p.caption) }}
                              className="w-16 h-16 object-cover rounded-lg border border-slate-200 cursor-zoom-in shrink-0" />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </label>
              )
            })}
            {groomTasks.map(g => {
              const o = g.order
              const mine = g.assignee === myEmployeeId
              const selectable = mine && !myTrip
              const since = g.leg === 'jemput' ? o.created_at : o.ready_at
              const waitMs = since ? now - ms(since) : 0
              const ongkir = Number((g.leg === 'jemput' ? o.pickup_ongkir : o.delivery_ongkir) ?? 0)
              const cats = o.cats?.length ?? 0
              return (
                <label key={g.key} className={`block bg-white border rounded-xl p-4 ${selected[g.key] ? 'border-pink-400 ring-2 ring-pink-200' : 'border-pink-200'} ${selectable ? 'cursor-pointer' : ''}`}>
                  <div className="flex items-start gap-3">
                    {selectable && (
                      <input type="checkbox" checked={!!selected[g.key]} onChange={e => setSelected(s => ({ ...s, [g.key]: e.target.checked }))}
                        className="mt-1 w-5 h-5 accent-pink-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">
                        🐱 {g.leg === 'jemput' ? 'Jemput' : 'Antar'} kucing — {o.customer?.name ?? '-'}
                        <span className="font-normal text-xs text-slate-500"> · nota {o.nota_number} · {cats} kucing</span>
                      </p>
                      {o.customer?.address && <p className="text-xs text-slate-500">{o.customer.address}</p>}
                      {o.customer?.phone && <a href={`tel:${o.customer.phone}`} onClick={e => e.stopPropagation()} className="text-xs text-blue-600">📞 {o.customer.phone}</a>}
                      <p className="text-xs text-slate-600 mt-0.5">
                        {g.leg === 'jemput'
                          ? <>Dibawa ke <b>{o.groom_branch?.name ?? '-'}</b> (cabang grooming)</>
                          : <>📍 Ambil kucing di <b>{o.groom_branch?.name ?? '-'}</b></>}
                        {!mine && <> · {g.leg === 'jemput' ? 'Penjemput' : 'Pengantar'}: <b>{o.assignee_emp?.full_name ?? '-'}</b></>}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Ongkir {ongkir > 0 ? <b>{fmtRp(ongkir)}</b> : 'tidak ada'}
                        {ongkir > 0 && <span className="text-green-700"> (bonus PJ {fmtRp(Math.floor(ongkir * 0.5))}, cair setelah order grooming selesai)</span>}
                      </p>
                      <p className={`inline-block mt-1.5 text-xs font-semibold px-2 py-1 rounded-md border ${waitingTone(waitMs)}`}>
                        ⏱ {g.leg === 'jemput' ? 'Order dibuat' : 'Siap diantar'} {fmtDur(waitMs)} lalu
                      </p>
                    </div>
                  </div>
                </label>
              )
            })}
            {(myWaiting.length > 0 || myGroomTasks.length > 0) && myTrip && (
              <p className="text-xs text-slate-500 text-center">Selesaikan dulu tugas antar Anda (sampai foto kembali) sebelum mengambil tugas baru.</p>
            )}
            {!myTrip && selectedCount > 0 && (
              <div className="bg-white border-2 border-purple-300 rounded-xl p-4 space-y-2 sticky bottom-4 shadow-lg">
                <p className="text-sm font-semibold text-slate-800">
                  Ambil {[
                    selectedIds.length > 0 ? `${selectedIds.length} kiriman barang` : '',
                    selectedGroomKeys.length > 0 ? `${selectedGroomKeys.length} tugas kucing` : '',
                  ].filter(Boolean).join(' + ')} — Anda jadi PJ.
                </p>
                <p className="text-xs text-slate-500">
                  Foto barang/kucing yang dibawa sebagai bukti berangkat{selectedGroomKeys.some(k => k.endsWith(':jemput')) ? ' (untuk jemput: foto saat berangkat dari cabang)' : ''}.
                </p>
                {busy ? <p className="text-xs text-slate-500 text-center py-2">Mengirim...</p> : (
                  <LogisticsCameraCapture label="Foto Berangkat / Barang Diambil" employeeName={myName}
                    maxFileAgeMs={MAX_FILE_AGE_MS} onCaptured={blob => doStart(blob, selectedIds, selectedGroomKeys)} />
                )}
              </div>
            )}
            {canSeeAll && myWaiting.length + myGroomTasks.length < waitingCount && (
              <p className="text-xs text-slate-400 text-center">Kiriman hanya bisa diambil (foto 1) oleh pengantar yang ditugaskan.</p>
            )}
          </>
        )}
      </section>

      {/* Sedang diantar orang lain */}
      {otherActive.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-slate-700">🛵 Sedang Diantar ({otherActive.length})</h2>
          {otherActive.map(t => {
            const sinceLast = now - lastEventAt(t)
            const stale = sinceLast > STALE_MS
            const live = liveStops(t)
            return (
              <div key={t.id} className={`bg-white border rounded-xl p-4 space-y-2 ${stale ? 'border-red-300' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">PJ: {t.pj?.full_name}</p>
                    <p className="text-xs text-slate-500">
                      {live.filter(s => s.arrived_at).length}/{live.length} toko sampai · sudah {fmtDur(now - ms(t.pickup_at))} sejak diambil
                    </p>
                  </div>
                  {stale && <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">⚠️ {fmtDur(sinceLast)} tanpa foto</span>}
                </div>
                <details>
                  <summary className="text-xs text-blue-600 cursor-pointer">Lihat foto</summary>
                  <div className="mt-2">{renderStopsTimeline(t)}</div>
                </details>
                {isOwner && (
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                    <button disabled={busy} onClick={() => rpcWithReason('force_close_tp_trip', { p_trip_id: t.id },
                      `Tutup paksa tugas ${t.pj?.full_name}. Toko yang belum difoto sampai kembali ke daftar menunggu, dan trip ini TIDAK dapat bonus ongkir. Alasan:`, 'Tugas ditutup paksa.')}
                      className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">Tutup Paksa</button>
                    <select disabled={busy} value="" onChange={e => handleReassign(t, e.target.value)}
                      className="text-xs px-2 py-1 border border-slate-300 rounded-lg bg-white">
                      <option value="">Alihkan PJ ke...</option>
                      {candidates.filter(e => e.id !== t.pj_id).map(e => <option key={e.id} value={e.id}>{e.full_name} — {e.branch_name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* Riwayat & rekap */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-700">🗂️ Riwayat {canSeeAll ? '' : 'Saya '}— Periode Gaji</h2>
          <div className="flex gap-2">
            <select value={period.month} onChange={e => changePeriod({ ...period, month: Number(e.target.value) })}
              className="text-sm px-2 py-1 border border-slate-300 rounded-lg bg-white">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={period.year} onChange={e => changePeriod({ ...period, year: Number(e.target.value) })}
              className="text-sm px-2 py-1 border border-slate-300 rounded-lg bg-white">
              {[period.year - 1, period.year, period.year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {pStart.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – {pEndShown.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>

        {recap.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="bg-slate-50 px-3 py-2">Karyawan</th>
                  <th className="bg-slate-50 px-3 py-2">Trip</th>
                  <th className="bg-slate-50 px-3 py-2">Rata² berangkat</th>
                  <th className="bg-slate-50 px-3 py-2">Rata² kembali</th>
                  <th className="bg-slate-50 px-3 py-2">⚠️</th>
                  <th className="bg-slate-50 px-3 py-2">Tutup paksa</th>
                  <th className="bg-slate-50 px-3 py-2">Bonus ongkir</th>
                </tr>
              </thead>
              <tbody>
                {recap.map(r => (
                  <tr key={r.name} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-700">{r.name}</td>
                    <td className="px-3 py-2">{r.done}/{r.trips}</td>
                    <td className="px-3 py-2">{r.n ? fmtMin(r.depSum / r.n) : '-'}</td>
                    <td className="px-3 py-2">{r.n ? fmtMin(r.retSum / r.n) : '-'}</td>
                    <td className={`px-3 py-2 ${r.flagged > 0 ? 'text-red-700 font-semibold' : ''}`}>{r.flagged}</td>
                    <td className={`px-3 py-2 ${r.forced > 0 ? 'text-red-700 font-semibold' : ''}`}>{r.forced}</td>
                    <td className="px-3 py-2 text-green-700 font-semibold">{r.bonus > 0 ? fmtRp(r.bonus) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyTrips.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-500 text-sm">Belum ada riwayat di periode ini.</div>
        ) : (
          <div className="space-y-2">{historyTrips.map(renderTripSummary)}</div>
        )}
      </section>
    </div>
  )
}

function PhotoRow({ label, url, at, extra, onOpen }: { label: string; url: string; at: string; extra?: string; onOpen: (url: string, caption?: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} onClick={() => onOpen(url, label)} className="w-14 h-14 object-cover rounded-lg border border-slate-200 cursor-zoom-in shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="text-xs text-slate-500">{fmtDateTime(at)}{extra ? ` · ${extra}` : ''}</p>
      </div>
    </div>
  )
}
