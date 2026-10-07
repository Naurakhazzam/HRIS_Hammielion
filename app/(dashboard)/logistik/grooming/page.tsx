'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import RupiahInput from '@/components/RupiahInput'
import DeliveryAssigneePicker, { fetchDeliveryCandidates, type DeliveryCandidate } from '@/components/DeliveryAssigneePicker'

// Menu "Order Grooming" (Fase 3, migrasi 070). Alur:
//   ① order dibuat di cabang penerima (foto struk + nomor nota unik per cabang, pelanggan wajib
//     punya nomor HP, tiap kucing: harga + groomer) -> MENUNGGU
//   ② 📸 kucing sampai di cabang PENGERJA (Toko Depan -> Toko Pusat, Markas -> Raja) -> DIKERJAKAN
//   ③ 📸 selesai grooming per kucing oleh groomernya (atau Paksa Lanjut oleh pembuat order/Owner
//     untuk groomer tanpa akun, mis. Elan) -> semua selesai = SIAP
//   ④ 📸 serah terima ke pelanggan -> SELESAI
// Perjalanan jemput/antar (trip 3 foto) menyusul di Fase 4; sementara ini ② dan ④ cukup foto.
// Semua waktu dari jam server; tulis lewat RPC.

const MIN_STEP_MS = 5 * 60000
const MAX_FILE_AGE_MS = 2 * 60000
const MAX_CATS = 10

type NameRel = { full_name: string } | null
type GroomerCandidate = { id: string; full_name: string; branch_id: string | null; branch_name: string | null; has_account: boolean; is_extra: boolean }
type Store = { id: string; name: string; phone: string | null; address: string | null; kind: 'toko' | 'pelanggan' }
type StoreBranch = { branch_id: string; can_groom: boolean; groom_branch_id: string | null; name: string }

type GroomerChange = {
  id: string; reason: string | null; order_status: string; changed_at: string; old_groomer: string | null
  old: NameRel; new: NameRel; by: NameRel
}
type PriceChange = { id: string; old_price: number; new_price: number; reason: string; changed_at: string; by: NameRel }
type Cat = {
  id: string; seq: number; cat_name: string | null; price: number; groomer_id: string
  finished_at: string | null; finished_photo_url: string | null; forced_reason: string | null
  groomer_changed_after_start: boolean
  groomer: NameRel; finisher: NameRel
  grooming_groomer_changes: GroomerChange[]
  grooming_price_changes: PriceChange[]
}
type Order = {
  id: string; branch_id: string; groom_branch_id: string; nota_number: string; receipt_photo_url: string
  arrival_mode: 'jemput' | 'datang_sendiri'; return_mode: 'antar' | 'ambil_sendiri'
  pickup_ongkir: number | null; pickup_assignee: string | null; delivery_ongkir: number | null; delivery_assignee: string | null
  notes: string | null; status: 'menunggu' | 'dikerjakan' | 'siap' | 'selesai' | 'batal'
  created_by: string | null; created_at: string
  arrived_at: string | null; arrived_photo_url: string | null
  ready_at: string | null; handover_at: string | null; handover_photo_url: string | null
  cancelled_at: string | null; cancel_reason: string | null; status_before_cancel: string | null
  branch: { name: string } | null; groom_branch: { name: string } | null
  customer: { name: string; phone: string | null; address: string | null; kind: string } | null
  creator: NameRel; pickup_emp: NameRel; delivery_emp: NameRel; arriver: NameRel; handover_emp: NameRel; canceller: NameRel
  arrived_forced_reason: string | null; handover_forced_reason: string | null
  grooming_order_cats: Cat[]
  trip_stops: TripStopRel[]
  grooming_assignment_changes: { id: string; leg: string; reason: string | null; changed_at: string; old: NameRel; new: NameRel; by: NameRel }[]
  grooming_ongkir_changes: { id: string; leg: string; old_ongkir: number | null; new_ongkir: number; changed_at: string; by: NameRel }[]
}
// Perjalanan jemput/antar lewat menu Kirim Barang (migrasi 071).
type TripStopRel = {
  id: string; kind: 'jemput_kucing' | 'serah_kucing' | 'antar_kucing'
  arrived_at: string | null; arrived_photo_url: string | null; cancelled_at: string | null; auto_on_return: boolean
  logistics_tp_trips: { status: string; pj: NameRel } | null
}

const ORDER_SELECT = `
  id, branch_id, groom_branch_id, nota_number, receipt_photo_url, arrival_mode, return_mode,
  pickup_ongkir, pickup_assignee, delivery_ongkir, delivery_assignee, notes, status, created_by, created_at,
  arrived_at, arrived_photo_url, ready_at, handover_at, handover_photo_url, cancelled_at, cancel_reason, status_before_cancel,
  arrived_forced_reason, handover_forced_reason,
  trip_stops:logistics_tp_trip_stops(id, kind, arrived_at, arrived_photo_url, cancelled_at, auto_on_return,
    logistics_tp_trips(status, pj:employees!logistics_tp_trips_pj_id_fkey(full_name))),
  grooming_assignment_changes(id, leg, reason, changed_at,
    old:employees!grooming_assignment_changes_old_emp_fkey(full_name),
    new:employees!grooming_assignment_changes_new_emp_fkey(full_name),
    by:employees!grooming_assignment_changes_changed_by_fkey(full_name)),
  grooming_ongkir_changes(id, leg, old_ongkir, new_ongkir, changed_at,
    by:employees!grooming_ongkir_changes_changed_by_fkey(full_name)),
  branch:branches!grooming_orders_branch_id_fkey(name),
  groom_branch:branches!grooming_orders_groom_branch_id_fkey(name),
  customer:logistics_stores!grooming_orders_customer_id_fkey(name, phone, address, kind),
  creator:employees!grooming_orders_created_by_fkey(full_name),
  pickup_emp:employees!grooming_orders_pickup_assignee_fkey(full_name),
  delivery_emp:employees!grooming_orders_delivery_assignee_fkey(full_name),
  arriver:employees!grooming_orders_arrived_by_fkey(full_name),
  handover_emp:employees!grooming_orders_handover_by_fkey(full_name),
  canceller:employees!grooming_orders_cancelled_by_fkey(full_name),
  grooming_order_cats(id, seq, cat_name, price, groomer_id, finished_at, finished_photo_url, forced_reason, groomer_changed_after_start,
    groomer:employees!grooming_order_cats_groomer_id_fkey(full_name),
    finisher:employees!grooming_order_cats_finished_by_fkey(full_name),
    grooming_groomer_changes(id, reason, order_status, changed_at, old_groomer,
      old:employees!grooming_groomer_changes_old_groomer_fkey(full_name),
      new:employees!grooming_groomer_changes_new_groomer_fkey(full_name),
      by:employees!grooming_groomer_changes_changed_by_fkey(full_name)),
    grooming_price_changes(id, old_price, new_price, reason, changed_at,
      by:employees!grooming_price_changes_changed_by_fkey(full_name)))
`

const STATUS_LABEL: Record<Order['status'], { label: string; cls: string }> = {
  menunggu: { label: 'Menunggu Datang', cls: 'bg-amber-100 text-amber-800' },
  dikerjakan: { label: 'Dikerjakan', cls: 'bg-blue-100 text-blue-800' },
  siap: { label: 'Siap Diserahkan', cls: 'bg-purple-100 text-purple-800' },
  selesai: { label: 'Selesai', cls: 'bg-green-100 text-green-700' },
  batal: { label: 'Batal', cls: 'bg-slate-200 text-slate-600' },
}

const fmtDateTime = (s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const ms = (s: string) => new Date(s).getTime()
const sortedCats = (o: Order) => [...o.grooming_order_cats].sort((a, b) => a.seq - b.seq)
const catLabel = (c: Cat) => `Kucing ${c.seq}${c.cat_name ? ` — ${c.cat_name}` : ''}`

// Periode gaji: 26 bulan lalu s/d 25 bulan ini (sama dengan Kirim Barang).
function periodRange(month: number, year: number) {
  return { start: new Date(year, month - 2, 26), end: new Date(year, month - 1, 26) }
}
function currentPeriod() {
  const d = new Date()
  const m = d.getDate() >= 26 ? d.getMonth() + 2 : d.getMonth() + 1
  return m === 13 ? { month: 1, year: d.getFullYear() + 1 } : { month: m, year: d.getFullYear() }
}
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

async function uploadGroomingPhoto(supabase: SupabaseClient, folder: string, blob: Blob, tag: string): Promise<string | null> {
  const path = `grooming/${folder}/${tag}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('logistics-photos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) return null
  return supabase.storage.from('logistics-photos').getPublicUrl(path).data.publicUrl
}

type Me = { empId: string; name: string; isOwner: boolean; branchId: string; isStoreStaff: boolean; seeAll: boolean }
type Pending = { key: string; blob: Blob; run: (blob: Blob) => Promise<void> }

export default function OrderGroomingPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<Me>({ empId: '', name: '', isOwner: false, branchId: '', isStoreStaff: false, seeAll: false })
  const [tab, setTab] = useState<'aktif' | 'buat' | 'riwayat'>('aktif')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  const [storeBranches, setStoreBranches] = useState<StoreBranch[]>([])
  const [groomers, setGroomers] = useState<GroomerCandidate[]>([])
  const [couriers, setCouriers] = useState<DeliveryCandidate[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [priceOptions, setPriceOptions] = useState<Record<string, number[]>>({})

  const [active, setActive] = useState<Order[]>([])
  const [history, setHistory] = useState<Order[]>([])
  const [period, setPeriod] = useState(currentPeriod)
  const [forceReason, setForceReason] = useState<Record<string, string>>({})

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 8000)
  }

  const fetchOrders = useCallback(async (p: { month: number; year: number }) => {
    const { data: act, error } = await supabase.from('grooming_orders').select(ORDER_SELECT)
      .in('status', ['menunggu', 'dikerjakan', 'siap']).order('created_at')
    if (error) { showMessage('error', 'Gagal memuat order: ' + error.message); return }
    setActive((act as unknown as Order[]) || [])
    const { start, end } = periodRange(p.month, p.year)
    const { data: hist } = await supabase.from('grooming_orders').select(ORDER_SELECT)
      .in('status', ['selesai', 'batal'])
      .gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
    setHistory((hist as unknown as Order[]) || [])
  }, [supabase])

  const fetchStores = useCallback(async () => {
    const { data } = await supabase.from('logistics_stores').select('id, name, phone, address, kind').eq('is_active', true).order('name')
    setStores((data as Store[]) || [])
  }, [supabase])

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      const next: Me = { empId: '', name: '', isOwner: false, branchId: '', isStoreStaff: false, seeAll: false }
      if (user) {
        const { data: u } = await supabase.from('users').select('role, employee_id, employees(full_name, branch_id, positions(name))').eq('id', user.id).single()
        if (u) {
          type EmpRel = { full_name: string; branch_id: string | null; positions: { name: string } | { name: string }[] | null }
          const e = (Array.isArray(u.employees) ? u.employees[0] : u.employees) as EmpRel | null
          const pos = Array.isArray(e?.positions) ? e?.positions[0] : e?.positions
          next.empId = u.employee_id || ''
          next.name = e?.full_name || ''
          next.branchId = e?.branch_id || ''
          next.isOwner = u.role === 'owner'
          next.seeAll = ['owner', 'hr', 'finance'].includes(u.role) || pos?.name === 'Kepala Gudang'
        }
      }
      const { data: sb } = await supabase.from('logistics_store_branches')
        .select('branch_id, can_groom, groom_branch_id, branches!logistics_store_branches_branch_id_fkey(name)')
      const sbRows: StoreBranch[] = ((sb as unknown as { branch_id: string; can_groom: boolean; groom_branch_id: string | null; branches: { name: string } | null }[]) || [])
        .map(r => ({ branch_id: r.branch_id, can_groom: r.can_groom, groom_branch_id: r.groom_branch_id, name: r.branches?.name ?? '-' }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setStoreBranches(sbRows)
      next.isStoreStaff = next.isOwner || sbRows.some(r => r.branch_id === next.branchId)
      setMe(next)

      if (next.isStoreStaff || next.seeAll) {
        const [g, c] = await Promise.all([supabase.rpc('list_groomer_candidates'), fetchDeliveryCandidates(supabase)])
        setGroomers((g.data as GroomerCandidate[]) || [])
        setCouriers(c)
        const opts: Record<string, number[]> = {}
        for (const b of sbRows.filter(r => r.can_groom)) {
          const { data } = await supabase.rpc('get_grooming_price_options', { p_groom_branch_id: b.branch_id })
          opts[b.branch_id] = ((data as number[]) || []).map(Number)
        }
        setPriceOptions(opts)
        await Promise.all([fetchStores(), fetchOrders(period)])
      }
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    await fetchOrders(period)
    window.dispatchEvent(new Event('grooming-badge-refresh'))
  }, [fetchOrders, period])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (loading) return
    const t = setInterval(() => { fetchOrders(period) }, 60000)
    return () => clearInterval(t)
  }, [loading, fetchOrders, period])

  // Unggah foto lalu panggil RPC. Gagal karena sinyal -> simpan foto supaya bisa dicoba lagi
  // tanpa foto ulang.
  async function photoAction(key: string, blob: Blob, folder: string, tag: string, fn: string, args: (url: string) => Record<string, unknown>, okText: string) {
    const run = async (b: Blob) => {
      setBusy(true)
      const url = await uploadGroomingPhoto(supabase, folder, b, tag)
      if (!url) {
        setBusy(false); setPending({ key, blob: b, run })
        showMessage('error', 'Foto gagal terkirim (cek sinyal). Tekan "Coba Kirim Lagi" — tidak perlu foto ulang.'); return
      }
      const { error } = await supabase.rpc(fn, args(url))
      setBusy(false)
      if (error) {
        if (/fetch|network/i.test(error.message)) { setPending({ key, blob: b, run }); showMessage('error', 'Gagal terhubung ke server. Tekan "Coba Kirim Lagi".'); return }
        setPending(null); showMessage('error', error.message); await refresh(); return
      }
      setPending(null)
      showMessage('success', okText)
      await refresh()
    }
    await run(blob)
  }

  async function rpcWithReason(fn: string, args: Record<string, unknown>, promptText: string, okText: string) {
    const reason = window.prompt(promptText)
    if (reason === null) return
    if (reason.trim().length < 3) { showMessage('error', 'Alasan wajib diisi.'); return }
    setBusy(true)
    const { error } = await supabase.rpc(fn, { ...args, p_reason: reason.trim() })
    setBusy(false)
    if (error) { showMessage('error', error.message); return }
    showMessage('success', okText)
    await refresh()
  }

  async function handleChangeGroomer(o: Order, c: Cat, newId: string) {
    if (!newId) return
    const name = groomers.find(g => g.id === newId)?.full_name
    const warn = o.status === 'dikerjakan' ? '\n⚠️ Kucing sudah dikerjakan — pergantian ini akan ditandai di laporan persetujuan.' : ''
    await rpcWithReason('change_grooming_groomer', { p_cat_id: c.id, p_new_groomer: newId },
      `Ganti groomer ${catLabel(c)} dari ${c.groomer?.full_name ?? '-'} ke ${name}.${warn}\nAlasan:`, `Groomer diganti ke ${name}.`)
  }

  async function handleCorrectPrice(c: Cat) {
    const raw = window.prompt(`Koreksi harga ${catLabel(c)} (sekarang ${fmtRp(c.price)}). Harga baru:`)
    if (raw === null) return
    const price = Number(raw.replace(/[^\d]/g, ''))
    if (!price) { showMessage('error', 'Harga tidak valid.'); return }
    await rpcWithReason('correct_grooming_price', { p_cat_id: c.id, p_new_price: price },
      `Ubah harga ${catLabel(c)}: ${fmtRp(c.price)} → ${fmtRp(price)}. Alasan (mis. tambah layanan):`, 'Harga dikoreksi.')
  }

  async function handleReassignLeg(o: Order, leg: 'jemput' | 'antar', newId: string) {
    if (!newId) return
    const name = couriers.find(c => c.id === newId)?.full_name
    await rpcWithReason('reassign_grooming_leg', { p_order_id: o.id, p_leg: leg, p_new_emp: newId },
      `Ganti ${leg === 'jemput' ? 'penjemput' : 'pengantar'} nota ${o.nota_number} ke ${name}. Alasan:`, `${leg === 'jemput' ? 'Penjemput' : 'Pengantar'} diganti ke ${name}.`)
  }

  async function handleSetOngkir(o: Order, leg: 'jemput' | 'antar') {
    const cur = Number((leg === 'jemput' ? o.pickup_ongkir : o.delivery_ongkir) ?? 0)
    const raw = window.prompt(`Ongkir ${leg} nota ${o.nota_number} (sekarang ${fmtRp(cur)}). Ongkir baru (0 kalau tidak ada):`)
    if (raw === null) return
    const digits = raw.replace(/[^\d]/g, '')
    if (digits === '') { showMessage('error', 'Ongkir tidak valid.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('set_grooming_ongkir', { p_order_id: o.id, p_leg: leg, p_ongkir: Number(digits) })
    setBusy(false)
    if (error) { showMessage('error', error.message); return }
    showMessage('success', 'Ongkir diubah.')
    await refresh()
  }

  const staffOf = (o: Order) => me.isOwner || (me.isStoreStaff && !!me.branchId && (me.branchId === o.branch_id || me.branchId === o.groom_branch_id))
  const isCreator = (o: Order) => !!me.empId && o.created_by === me.empId

  // Kucing yang perlu aksi saya (badge).
  const myTasks = useMemo(() => active.filter(o => o.status === 'dikerjakan' && o.grooming_order_cats.some(c => !c.finished_at && c.groomer_id === me.empId)), [active, me.empId])

  const recap = useMemo(() => {
    const map: Record<string, { name: string; cats: number; total: number; forced: number; changed: number }> = {}
    history.filter(o => o.status === 'selesai').forEach(o => o.grooming_order_cats.forEach(c => {
      const r = map[c.groomer_id] ??= { name: c.groomer?.full_name ?? '-', cats: 0, total: 0, forced: 0, changed: 0 }
      r.cats++; r.total += Number(c.price)
      if (c.forced_reason) r.forced++
      if (c.groomer_changed_after_start) r.changed++
    }))
    return Object.values(map).sort((a, b) => b.cats - a.cats)
  }, [history])

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  if (!me.isStoreStaff && !me.seeAll) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Order Grooming</h1>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mt-4">
          Cuma staf cabang toko (Toko Pusat, Toko Depan, Markas, Raja), Kepala Gudang, HR/Finance, atau Owner yang bisa membuka halaman ini.
        </div>
      </div>
    )
  }

  // Status & aksi perjalanan jemput/antar (dijalankan PJ lewat menu Kirim Barang).
  function renderLeg(o: Order, leg: 'jemput' | 'antar') {
    const done = leg === 'jemput' ? o.status !== 'menunggu' : o.status === 'selesai'
    if (done) return null
    const kind = leg === 'jemput' ? 'jemput_kucing' : 'antar_kucing'
    const stop = o.trip_stops.find(s => s.kind === kind && !s.cancelled_at)
    const inTrip = stop?.logistics_tp_trips?.status === 'berjalan'
    const pj = stop?.logistics_tp_trips?.pj?.full_name ?? '-'
    const assignee = (leg === 'jemput' ? o.pickup_emp?.full_name : o.delivery_emp?.full_name) ?? '-'
    const assigneeId = leg === 'jemput' ? o.pickup_assignee : o.delivery_assignee
    const groomBranchName = o.groom_branch?.name ?? 'cabang grooming'
    const canManage = staffOf(o) || isCreator(o)
    const ready = leg === 'jemput' ? o.status === 'menunggu' : o.status === 'siap'
    const canEmergency = (me.isOwner || isCreator(o)) && ready && !inTrip
    const reasonKey = `${leg}-${o.id}`
    const reason = forceReason[reasonKey] ?? ''

    let statusText: string
    if (inTrip && stop) {
      statusText = leg === 'jemput'
        ? (stop.arrived_at ? `Kucing sudah dijemput ${pj}, dalam perjalanan ke ${groomBranchName}.` : `Sedang dijemput ${pj}.`)
        : `Sedang diantar ${pj}.`
    } else if (!ready) {
      statusText = `Akan diantar ${assignee} setelah semua kucing selesai.`
    } else {
      statusText = `Menunggu diambil ${assignee} di menu Kirim Barang.`
    }

    return (
      <div className={`border rounded-lg p-3 space-y-2 ${leg === 'jemput' ? 'bg-amber-50 border-amber-200' : 'bg-purple-50 border-purple-200'}`}>
        <p className="text-sm font-semibold text-slate-800">🛵 {leg === 'jemput' ? 'Jemput' : 'Antar'} kucing</p>
        <p className="text-xs text-slate-700">{statusText}</p>
        {!stop && canManage && (
          <div className="flex flex-wrap gap-2">
            <select disabled={busy} value="" onChange={e => handleReassignLeg(o, leg, e.target.value)}
              className="text-xs px-2 py-1 border border-slate-300 rounded-lg bg-white">
              <option value="">Ganti {leg === 'jemput' ? 'penjemput' : 'pengantar'} ke...</option>
              {couriers.filter(c => c.id !== assigneeId).map(c => <option key={c.id} value={c.id}>{c.full_name} — {c.branch_name}</option>)}
            </select>
            <button disabled={busy} onClick={() => handleSetOngkir(o, leg)}
              className="text-xs px-2 py-1 border border-slate-300 bg-white rounded-lg text-slate-600 disabled:opacity-50">Ubah Ongkir</button>
          </div>
        )}
        {stop && me.isOwner && (
          <button disabled={busy} onClick={() => handleSetOngkir(o, leg)}
            className="text-xs px-2 py-1 border border-slate-300 bg-white rounded-lg text-slate-600 disabled:opacity-50">Ubah Ongkir (Owner)</button>
        )}
        {canEmergency && (
          <details className="bg-white border border-slate-200 rounded-lg p-2">
            <summary className="text-xs text-slate-600 cursor-pointer">Jalur darurat (pembuat order/Owner)</summary>
            <div className="mt-2 space-y-2">
              <p className="text-xs text-slate-500">
                Pakai hanya kalau perjalanan {leg} tidak terjadi lewat Kirim Barang (mis. trip ditutup paksa, pelanggan akhirnya {leg === 'jemput' ? 'datang' : 'mengambil'} sendiri).
                Ongkir {leg} <b>tidak</b> jadi bonus.
              </p>
              <input type="text" value={reason} onChange={e => setForceReason(r => ({ ...r, [reasonKey]: e.target.value }))}
                placeholder="Alasan (min. 5 huruf)" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              {busy ? <p className="text-xs text-slate-500 text-center py-1">Mengirim...</p> : reason.trim().length >= 5 ? (
                leg === 'jemput' ? (
                  <LogisticsCameraCapture label={`Kucing Sampai di ${groomBranchName}`} employeeName={me.name} maxFileAgeMs={MAX_FILE_AGE_MS}
                    onCaptured={blob => photoAction(`arrive-${o.id}`, blob, o.id, 'sampai', 'mark_grooming_arrived',
                      url => ({ p_order_id: o.id, p_photo_url: url, p_forced_reason: reason.trim() }), 'Kucing sampai — status DIKERJAKAN.')} />
                ) : (
                  <LogisticsCameraCapture label="Serah Terima ke Pelanggan" employeeName={me.name} maxFileAgeMs={MAX_FILE_AGE_MS}
                    onCaptured={blob => photoAction(`handover-${o.id}`, blob, o.id, 'serah', 'complete_grooming_handover',
                      url => ({ p_order_id: o.id, p_photo_url: url, p_forced_reason: reason.trim() }), 'Order grooming selesai.')} />
                )
              ) : <p className="text-xs text-slate-400">Isi alasan dulu.</p>}
            </div>
          </details>
        )}
      </div>
    )
  }

  function renderOrder(o: Order, collapsible: boolean) {
    const cats = sortedCats(o)
    const st = STATUS_LABEL[o.status]
    const total = cats.reduce((s, c) => s + Number(c.price), 0)
    const sinceArrive = o.arrived_at ? now - ms(o.arrived_at) : 0
    const waitLeft = Math.max(0, MIN_STEP_MS - sinceArrive)
    const canCancel = o.status !== 'batal' && (me.isOwner || isCreator(o) || (me.isStoreStaff && me.branchId === o.branch_id)) && (o.status !== 'selesai' || me.isOwner)
    const canEditPrice = o.status !== 'batal' && (me.isOwner || isCreator(o))
    const canChangeGroomer = ['menunggu', 'dikerjakan'].includes(o.status) && (staffOf(o) || isCreator(o))
    const groomBranchName = o.groom_branch?.name ?? 'cabang grooming'
    const jemputStop = o.trip_stops.find(s => s.kind === 'jemput_kucing' && !s.cancelled_at)
    const serahAuto = o.trip_stops.some(s => s.kind === 'serah_kucing' && !s.cancelled_at && s.auto_on_return)

    const header = (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 text-sm">✂️ Nota {o.nota_number} · {o.customer?.name ?? '-'}</p>
          <p className="text-xs text-slate-500">
            {o.customer?.phone && <a href={`tel:${o.customer.phone}`} className="text-blue-600" onClick={e => e.stopPropagation()}>📞 {o.customer.phone}</a>}
            {o.customer?.phone && ' · '}{cats.length} kucing · {fmtRp(total)}
          </p>
          <p className="text-xs text-slate-500">
            {o.branch?.name}{o.groom_branch_id !== o.branch_id && <> → dikerjakan di <b>{groomBranchName}</b></>} · {fmtDateTime(o.created_at)}
          </p>
        </div>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
      </div>
    )

    const body = (
      <div className="space-y-3">
        <div className="text-xs text-slate-600 space-y-0.5">
          <p>Datang: <b>{o.arrival_mode === 'jemput' ? `Dijemput ${o.pickup_emp?.full_name ?? '-'}` : 'Datang sendiri'}</b>
            {o.arrival_mode === 'jemput' && <> · ongkir {fmtRp(Number(o.pickup_ongkir ?? 0))}</>}</p>
          <p>Pulang: <b>{o.return_mode === 'antar' ? `Diantar ${o.delivery_emp?.full_name ?? '-'}` : 'Diambil sendiri'}</b>
            {o.return_mode === 'antar' && <> · ongkir {fmtRp(Number(o.delivery_ongkir ?? 0))}</>}</p>
          <p>Dibuat oleh {o.creator?.full_name ?? 'Owner'}{o.notes ? ` · Catatan: "${o.notes}"` : ''}</p>
          {o.status === 'batal' && <p className="text-red-700">Dibatalkan {o.canceller?.full_name ?? ''}{o.cancelled_at ? ` (${fmtDateTime(o.cancelled_at)})` : ''}: {o.cancel_reason} — tanpa bonus apa pun.</p>}
        </div>

        <div className="space-y-2">
          <PhotoRow label="🧾 Struk" url={o.receipt_photo_url} at={o.created_at} onOpen={openLightbox} />
          {jemputStop?.arrived_at && jemputStop.arrived_photo_url && (
            <PhotoRow label="📸 Kucing dijemput di pelanggan" url={jemputStop.arrived_photo_url} at={jemputStop.arrived_at}
              extra={jemputStop.logistics_tp_trips?.pj?.full_name ?? undefined} onOpen={openLightbox} />
          )}
          {o.arrived_photo_url && o.arrived_at && (
            <PhotoRow label={`📸 Sampai di ${groomBranchName}${serahAuto ? ' (foto kembali penjemput)' : ''}`} url={o.arrived_photo_url} at={o.arrived_at}
              extra={[o.arriver?.full_name, o.arrived_forced_reason ? `jalur darurat: "${o.arrived_forced_reason}"` : ''].filter(Boolean).join(' · ') || undefined} onOpen={openLightbox} />
          )}
        </div>

        {/* Kucing */}
        <div className="space-y-2">
          {cats.map(c => {
            const mine = c.groomer_id === me.empId
            const canForce = !mine && (me.isOwner || isCreator(o))
            const changes = c.grooming_groomer_changes.filter(g => g.old_groomer).sort((a, b) => ms(a.changed_at) - ms(b.changed_at))
            const reason = forceReason[c.id] ?? ''
            return (
              <div key={c.id} className={`border rounded-lg p-3 space-y-2 ${c.finished_at ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">🐱 {catLabel(c)}</p>
                    <p className="text-xs text-slate-600">
                      {fmtRp(Number(c.price))} · Groomer: <b>{c.groomer?.full_name ?? '-'}</b>
                      {c.groomer_changed_after_start && <span className="text-red-700 font-semibold" title="Groomer diganti setelah kucing dikerjakan"> ⚠️ diganti saat dikerjakan</span>}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-semibold ${c.finished_at ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                    {c.finished_at ? '✓ Selesai' : 'Belum'}
                  </span>
                </div>
                {c.finished_at && c.finished_photo_url && (
                  <PhotoRow label="📸 Selesai grooming" url={c.finished_photo_url} at={c.finished_at}
                    extra={c.forced_reason ? `Paksa lanjut oleh ${c.finisher?.full_name ?? 'Owner'}: "${c.forced_reason}"` : undefined} onOpen={openLightbox} />
                )}
                {(changes.length > 0 || c.grooming_price_changes.length > 0) && (
                  <details>
                    <summary className="text-xs text-blue-600 cursor-pointer">Riwayat perubahan ({changes.length + c.grooming_price_changes.length})</summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {changes.map(g => (
                        <li key={g.id}>{g.order_status === 'dikerjakan' ? '⚠️ ' : ''}{fmtDateTime(g.changed_at)} — groomer {g.old?.full_name ?? '-'} → {g.new?.full_name ?? '-'} oleh {g.by?.full_name ?? 'Owner'}: &quot;{g.reason}&quot;</li>
                      ))}
                      {c.grooming_price_changes.map(p => (
                        <li key={p.id}>{fmtDateTime(p.changed_at)} — harga {fmtRp(Number(p.old_price))} → {fmtRp(Number(p.new_price))} oleh {p.by?.full_name ?? 'Owner'}: &quot;{p.reason}&quot;</li>
                      ))}
                    </ul>
                  </details>
                )}

                {!c.finished_at && (canChangeGroomer || canEditPrice) && (
                  <div className="flex flex-wrap gap-2">
                    {canChangeGroomer && (
                      <select disabled={busy} value="" onChange={e => handleChangeGroomer(o, c, e.target.value)}
                        className="text-xs px-2 py-1 border border-slate-300 rounded-lg bg-white">
                        <option value="">Ganti groomer ke...</option>
                        <GroomerOptions groomers={groomers.filter(g => g.id !== c.groomer_id)} groomBranchId={o.groom_branch_id} />
                      </select>
                    )}
                    {canEditPrice && (
                      <button disabled={busy} onClick={() => handleCorrectPrice(c)}
                        className="text-xs px-2 py-1 border border-slate-300 bg-white rounded-lg text-slate-600 disabled:opacity-50">Koreksi Harga</button>
                    )}
                  </div>
                )}
                {c.finished_at && canEditPrice && o.status !== 'selesai' && (
                  <button disabled={busy} onClick={() => handleCorrectPrice(c)}
                    className="text-xs px-2 py-1 border border-slate-300 bg-white rounded-lg text-slate-600 disabled:opacity-50">Koreksi Harga</button>
                )}

                {o.status === 'dikerjakan' && !c.finished_at && (mine || canForce) && (
                  waitLeft > 0 ? (
                    <p className="text-xs text-slate-500 text-center py-1">⏳ Foto selesai bisa diambil {Math.ceil(waitLeft / 60000)} menit lagi (minimal 5 menit sejak kucing sampai).</p>
                  ) : busy ? (
                    <p className="text-xs text-slate-500 text-center py-1">Mengirim...</p>
                  ) : mine ? (
                    <LogisticsCameraCapture label={`Selesai Grooming — ${catLabel(c)}`} employeeName={me.name} maxFileAgeMs={MAX_FILE_AGE_MS}
                      onCaptured={blob => photoAction(`cat-${c.id}`, blob, o.id, `selesai-${c.seq}`, 'finish_grooming_cat',
                        url => ({ p_cat_id: c.id, p_photo_url: url, p_forced_reason: null }), `${catLabel(c)} selesai grooming.`)} />
                  ) : (
                    <div className="bg-white border border-amber-200 rounded-lg p-2 space-y-2">
                      <p className="text-xs text-amber-800 font-semibold">
                        Paksa Lanjut — tandai selesai atas nama {c.groomer?.full_name}{groomers.find(g => g.id === c.groomer_id)?.has_account === false ? ' (tidak punya akun aplikasi)' : ''}. Foto oleh Anda + alasan wajib, tercatat.
                      </p>
                      <input type="text" value={reason} onChange={e => setForceReason(r => ({ ...r, [c.id]: e.target.value }))}
                        placeholder="Alasan (mis. Elan tidak punya akun aplikasi)"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                      {reason.trim().length >= 5 ? (
                        <LogisticsCameraCapture label={`Paksa Selesai — ${catLabel(c)}`} employeeName={me.name} maxFileAgeMs={MAX_FILE_AGE_MS}
                          onCaptured={blob => photoAction(`cat-${c.id}`, blob, o.id, `selesai-${c.seq}`, 'finish_grooming_cat',
                            url => ({ p_cat_id: c.id, p_photo_url: url, p_forced_reason: reason.trim() }), `${catLabel(c)} ditandai selesai (paksa lanjut).`)} />
                      ) : (
                        <p className="text-xs text-slate-400">Isi alasan (min. 5 huruf) dulu.</p>
                      )}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>

        {o.handover_photo_url && o.handover_at && (
          <PhotoRow label="📸 Serah terima ke pelanggan" url={o.handover_photo_url} at={o.handover_at}
            extra={[o.handover_emp?.full_name, o.handover_forced_reason ? `jalur darurat: "${o.handover_forced_reason}"` : ''].filter(Boolean).join(' · ') || undefined} onOpen={openLightbox} />
        )}

        {/* Aksi tahap order */}
        {o.status === 'menunggu' && o.arrival_mode === 'datang_sendiri' && staffOf(o) && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-semibold text-amber-900">📍 Kucing sudah sampai di {groomBranchName}?</p>
            {busy ? <p className="text-xs text-slate-500 text-center py-1">Mengirim...</p> : (
              <LogisticsCameraCapture label={`Kucing Sampai di ${groomBranchName}`} employeeName={me.name} maxFileAgeMs={MAX_FILE_AGE_MS}
                onCaptured={blob => photoAction(`arrive-${o.id}`, blob, o.id, 'sampai', 'mark_grooming_arrived',
                  url => ({ p_order_id: o.id, p_photo_url: url, p_forced_reason: null }), 'Kucing sampai — status DIKERJAKAN.')} />
            )}
          </div>
        )}
        {o.arrival_mode === 'jemput' && ['menunggu', 'dikerjakan', 'siap'].includes(o.status) && renderLeg(o, 'jemput')}
        {o.status === 'siap' && o.return_mode === 'ambil_sendiri' && staffOf(o) && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-semibold text-purple-900">
              🎀 Semua kucing selesai{o.ready_at ? ` (${fmtDateTime(o.ready_at)})` : ''}. Diambil sendiri oleh pelanggan.
            </p>
            <p className="text-xs text-purple-800">Foto saat kucing diserahkan ke pelanggan.</p>
            {busy ? <p className="text-xs text-slate-500 text-center py-1">Mengirim...</p> : (
              <LogisticsCameraCapture label="Serah Terima ke Pelanggan" employeeName={me.name} maxFileAgeMs={MAX_FILE_AGE_MS}
                onCaptured={blob => photoAction(`handover-${o.id}`, blob, o.id, 'serah', 'complete_grooming_handover',
                  url => ({ p_order_id: o.id, p_photo_url: url, p_forced_reason: null }), 'Order grooming selesai. Terima kasih!')} />
            )}
          </div>
        )}
        {o.return_mode === 'antar' && ['menunggu', 'dikerjakan', 'siap'].includes(o.status) && renderLeg(o, 'antar')}

        {(o.grooming_assignment_changes.length > 0 || o.grooming_ongkir_changes.length > 0) && (
          <details>
            <summary className="text-xs text-blue-600 cursor-pointer">Riwayat penjemput/pengantar & ongkir ({o.grooming_assignment_changes.length + o.grooming_ongkir_changes.length})</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {o.grooming_assignment_changes.map(a => (
                <li key={a.id}>{fmtDateTime(a.changed_at)} — {a.leg} {a.old?.full_name ?? '-'} → {a.new?.full_name ?? '-'} oleh {a.by?.full_name ?? 'Owner'}: &quot;{a.reason}&quot;</li>
              ))}
              {o.grooming_ongkir_changes.map(k => (
                <li key={k.id}>{fmtDateTime(k.changed_at)} — ongkir {k.leg} {fmtRp(Number(k.old_ongkir ?? 0))} → {fmtRp(Number(k.new_ongkir))} oleh {k.by?.full_name ?? 'Owner'}</li>
              ))}
            </ul>
          </details>
        )}

        {canCancel && (
          <div className="flex justify-end">
            <button disabled={busy} onClick={() => rpcWithReason('cancel_grooming_order', { p_order_id: o.id },
              `Batalkan order nota ${o.nota_number}? Order batal TIDAK menghasilkan bonus apa pun (grooming & ongkir). Alasan (min. 5 huruf):`, 'Order dibatalkan.')}
              className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">Batalkan Order</button>
          </div>
        )}
      </div>
    )

    if (collapsible) {
      return (
        <details key={o.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer list-none">{header}</summary>
          <div className="border-t border-slate-100 px-4 py-3">{body}</div>
        </details>
      )
    }
    const highlight = o.grooming_order_cats.some(c => !c.finished_at && c.groomer_id === me.empId) && o.status === 'dikerjakan'
    return (
      <div key={o.id} className={`bg-white border rounded-xl p-4 space-y-3 ${highlight ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'}`}>
        {header}
        {body}
      </div>
    )
  }

  const { start: pStart, end: pEnd } = periodRange(period.month, period.year)
  const pEndShown = new Date(pEnd.getTime() - 86400000)
  const receivingBranches = storeBranches.filter(b => b.groom_branch_id)
  const canCreate = me.isStoreStaff && (me.isOwner || receivingBranches.some(b => b.branch_id === me.branchId))

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Order Grooming</h1>
        <p className="text-sm text-slate-500">Order grooming kucing: struk → sampai di cabang grooming → selesai per kucing → serah terima.</p>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}
      {pending && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-center justify-between gap-2">
          <p className="text-sm text-amber-800">Ada foto yang belum terkirim.</p>
          <button disabled={busy} onClick={() => pending.run(pending.blob)} className="px-3 py-1.5 bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {busy ? 'Mengirim...' : 'Coba Kirim Lagi'}
          </button>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {([
          ['aktif', `Order Aktif (${active.length})`],
          ...(canCreate ? [['buat', '+ Buat Order']] : []),
          ['riwayat', 'Riwayat'],
        ] as [typeof tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'aktif' && (
        <section className="space-y-3">
          {myTasks.length > 0 && (
            <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
              ✂️ Ada {myTasks.reduce((s, o) => s + o.grooming_order_cats.filter(c => !c.finished_at && c.groomer_id === me.empId).length, 0)} kucing yang Anda groom & belum difoto selesai.
            </p>
          )}
          {active.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-500 text-sm">Tidak ada order grooming aktif.</div>
          ) : active.map(o => renderOrder(o, false))}
        </section>
      )}

      {tab === 'buat' && canCreate && (
        <CreateOrderForm
          me={me} receivingBranches={receivingBranches} storeBranches={storeBranches} groomers={groomers} couriers={couriers}
          stores={stores} priceOptions={priceOptions} busy={busy} setBusy={setBusy} showMessage={showMessage}
          reloadStores={fetchStores}
          onCreated={async () => { setTab('aktif'); await refresh() }} />
      )}

      {tab === 'riwayat' && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-700">🗂️ Order Selesai & Batal — Periode Gaji</h2>
            <div className="flex gap-2">
              <select value={period.month} onChange={e => { const n = { ...period, month: Number(e.target.value) }; setPeriod(n); fetchOrders(n) }}
                className="text-sm px-2 py-1 border border-slate-300 rounded-lg bg-white">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select value={period.year} onChange={e => { const n = { ...period, year: Number(e.target.value) }; setPeriod(n); fetchOrders(n) }}
                className="text-sm px-2 py-1 border border-slate-300 rounded-lg bg-white">
                {[period.year - 1, period.year, period.year + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            {pStart.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – {pEndShown.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} (tanggal order dibuat)
          </p>
          {recap.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="bg-slate-50 px-3 py-2">Groomer</th>
                    <th className="bg-slate-50 px-3 py-2">Kucing selesai</th>
                    <th className="bg-slate-50 px-3 py-2">Total harga</th>
                    <th className="bg-slate-50 px-3 py-2">Paksa lanjut</th>
                    <th className="bg-slate-50 px-3 py-2">⚠️ Ganti groomer</th>
                  </tr>
                </thead>
                <tbody>
                  {recap.map(r => (
                    <tr key={r.name} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{r.name}</td>
                      <td className="px-3 py-2">{r.cats}</td>
                      <td className="px-3 py-2">{fmtRp(r.total)}</td>
                      <td className="px-3 py-2">{r.forced}</td>
                      <td className={`px-3 py-2 ${r.changed > 0 ? 'text-red-700 font-semibold' : ''}`}>{r.changed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {history.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-500 text-sm">Belum ada riwayat di periode ini.</div>
          ) : (
            <div className="space-y-2">{history.map(o => renderOrder(o, true))}</div>
          )}
        </section>
      )}
    </div>
  )
}

// Pilihan groomer: cabang pengerja order ini dulu, lalu cabang grooming lain, lalu groomer
// tambahan (mis. Elan, tanpa akun).
function GroomerOptions({ groomers, groomBranchId }: { groomers: GroomerCandidate[]; groomBranchId: string }) {
  const tag = (g: GroomerCandidate) => `${g.full_name}${g.has_account ? '' : ' (tanpa akun)'}`
  const local = groomers.filter(g => !g.is_extra && g.branch_id === groomBranchId)
  const other = groomers.filter(g => !g.is_extra && g.branch_id !== groomBranchId)
  const extra = groomers.filter(g => g.is_extra)
  return (
    <>
      {local.length > 0 && <optgroup label={`Cabang pengerja — ${local[0].branch_name}`}>{local.map(g => <option key={g.id} value={g.id}>{tag(g)}</option>)}</optgroup>}
      {other.length > 0 && <optgroup label="Cabang grooming lain">{other.map(g => <option key={g.id} value={g.id}>{tag(g)} — {g.branch_name}</option>)}</optgroup>}
      {extra.length > 0 && <optgroup label="Groomer lain">{extra.map(g => <option key={g.id} value={g.id}>{tag(g)}</option>)}</optgroup>}
    </>
  )
}

type CatDraft = { cat_name: string; price: string; groomer_id: string }

function CreateOrderForm({ me, receivingBranches, storeBranches, groomers, couriers, stores, priceOptions, busy, setBusy, showMessage, reloadStores, onCreated }: {
  me: Me
  receivingBranches: StoreBranch[]
  storeBranches: StoreBranch[]
  groomers: GroomerCandidate[]
  couriers: DeliveryCandidate[]
  stores: Store[]
  priceOptions: Record<string, number[]>
  busy: boolean
  setBusy: (b: boolean) => void
  showMessage: (type: 'success' | 'error', text: string) => void
  reloadStores: () => Promise<void>
  onCreated: () => Promise<void>
}) {
  const supabase = createClient()
  const [branchId, setBranchId] = useState(() => receivingBranches.some(b => b.branch_id === me.branchId) ? me.branchId : '')
  const branch = receivingBranches.find(b => b.branch_id === branchId)
  const groomBranchId = branch?.groom_branch_id ?? ''
  const groomBranchName = storeBranches.find(b => b.branch_id === groomBranchId)?.name ?? ''
  const opts = priceOptions[groomBranchId] ?? []

  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const customer = stores.find(s => s.id === customerId)
  const [newPhone, setNewPhone] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [nc, setNc] = useState({ name: '', phone: '', address: '' })

  const [nota, setNota] = useState('')
  const [struk, setStruk] = useState<{ blob: Blob; url: string } | null>(null)
  const [cats, setCats] = useState<CatDraft[]>([{ cat_name: '', price: '', groomer_id: '' }])
  const [arrival, setArrival] = useState<'' | 'jemput' | 'datang_sendiri'>('')
  const [ret, setRet] = useState<'' | 'antar' | 'ambil_sendiri'>('')
  const [pickupOngkir, setPickupOngkir] = useState('')
  const [pickupEmp, setPickupEmp] = useState('')
  const [deliveryOngkir, setDeliveryOngkir] = useState('')
  const [deliveryEmp, setDeliveryEmp] = useState('')
  const [notes, setNotes] = useState('')

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    const digits = q.replace(/\D/g, '')
    return stores.filter(s => s.name.toLowerCase().includes(q) || (digits.length >= 4 && (s.phone ?? '').includes(digits))).slice(0, 8)
  }, [search, stores])

  function setQty(n: number) {
    setCats(cs => {
      if (n <= cs.length) return cs.slice(0, n)
      const last = cs[cs.length - 1]
      return [...cs, ...Array.from({ length: n - cs.length }, () => ({ cat_name: '', price: last?.price ?? '', groomer_id: last?.groomer_id ?? '' }))]
    })
  }
  const setCat = (i: number, patch: Partial<CatDraft>) => setCats(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  async function createCustomer() {
    if (nc.name.trim().length < 3) { showMessage('error', 'Nama pelanggan minimal 3 huruf.'); return }
    if (!nc.phone.trim()) { showMessage('error', 'Nomor HP pelanggan wajib.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('quick_create_logistics_store', { p_name: nc.name, p_address: nc.address, p_phone: nc.phone, p_kind: 'pelanggan' })
    setBusy(false)
    if (error) { showMessage('error', error.message); return }
    await reloadStores()
    setCustomerId(data as string)
    setSearch(''); setShowNew(false); setNc({ name: '', phone: '', address: '' })
    showMessage('success', 'Pelanggan baru tersimpan di Master Toko.')
  }

  const totalPrice = cats.reduce((s, c) => s + (Number(c.price) || 0), 0)
  const problems: string[] = []
  if (!branch) problems.push('Pilih cabang penerima order')
  if (!customer) problems.push('Pilih pelanggan')
  else if (!customer.phone && !newPhone.trim()) problems.push('Isi nomor HP pelanggan')
  if (!nota.trim()) problems.push('Isi nomor nota')
  if (!struk) problems.push('Foto struk')
  if (cats.some(c => !c.price)) problems.push('Pilih harga tiap kucing')
  if (cats.some(c => !c.groomer_id)) problems.push('Pilih groomer tiap kucing')
  if (!arrival) problems.push('Pilih cara datang')
  if (arrival === 'jemput' && (pickupOngkir === '' || !pickupEmp)) problems.push('Isi ongkir & penjemput')
  if (!ret) problems.push('Pilih cara pulang')
  if (ret === 'antar' && (deliveryOngkir === '' || !deliveryEmp)) problems.push('Isi ongkir & pengantar')

  async function submit() {
    if (problems.length > 0 || !struk || !customer) return
    setBusy(true)
    if (!customer.phone) {
      const { error } = await supabase.rpc('set_logistics_store_phone', { p_store_id: customer.id, p_phone: newPhone })
      if (error) { setBusy(false); showMessage('error', error.message); return }
      await reloadStores()
    }
    const url = await uploadGroomingPhoto(supabase, crypto.randomUUID(), struk.blob, 'struk')
    if (!url) { setBusy(false); showMessage('error', 'Foto struk gagal terkirim (cek sinyal). Tekan "Simpan Order" lagi — foto tidak perlu diulang.'); return }
    const { error } = await supabase.rpc('create_grooming_order', {
      p_branch_id: branchId, p_customer_id: customer.id, p_nota_number: nota, p_receipt_photo_url: url,
      p_arrival_mode: arrival, p_return_mode: ret,
      p_pickup_ongkir: arrival === 'jemput' ? Number(pickupOngkir) : null, p_pickup_assignee: arrival === 'jemput' ? pickupEmp : null,
      p_delivery_ongkir: ret === 'antar' ? Number(deliveryOngkir) : null, p_delivery_assignee: ret === 'antar' ? deliveryEmp : null,
      p_notes: notes || null,
      p_cats: cats.map(c => ({ cat_name: c.cat_name, price: Number(c.price), groomer_id: c.groomer_id })),
    })
    setBusy(false)
    if (error) { showMessage('error', error.message); return }
    showMessage('success', `Order nota ${nota.trim().toUpperCase()} tersimpan.`)
    await onCreated()
  }

  const input = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white'
  const radio = (on: boolean) => `flex-1 px-3 py-2 rounded-lg border text-sm text-left ${on ? 'border-blue-500 bg-blue-50 text-blue-800 font-semibold' : 'border-slate-300 bg-white text-slate-600'}`

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-5">
      {/* Cabang */}
      <div className="space-y-1">
        <label className="text-sm font-semibold text-slate-700">Cabang penerima order</label>
        {me.isOwner ? (
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className={input}>
            <option value="">— Pilih cabang —</option>
            {receivingBranches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>
        ) : <p className="text-sm text-slate-800">{branch?.name ?? '-'}</p>}
        {branch && <p className="text-xs text-slate-500">Dikerjakan di <b>{groomBranchName}</b>{groomBranchId !== branchId ? ' (kucing dibawa ke sana)' : ''}.</p>}
      </div>

      {/* Pelanggan */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700">Pelanggan</label>
        {customer ? (
          <div className="flex items-start justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">{customer.name} <span className="text-xs font-normal text-slate-500">({customer.kind === 'pelanggan' ? 'Pelanggan' : 'Toko'})</span></p>
              <p className="text-xs text-slate-500">{customer.phone ?? <span className="text-red-600">Belum ada nomor HP</span>}{customer.address ? ` · ${customer.address}` : ''}</p>
            </div>
            <button type="button" onClick={() => { setCustomerId(''); setNewPhone('') }} className="text-xs text-blue-600">Ganti</button>
          </div>
        ) : (
          <>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Ketik nama atau nomor HP pelanggan..." className={input} />
            {matches.length > 0 && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {matches.map(s => (
                  <button key={s.id} type="button" onClick={() => { setCustomerId(s.id); setSearch('') }} className="w-full text-left px-3 py-2 hover:bg-slate-50">
                    <p className="text-sm text-slate-800">{s.name} <span className="text-xs text-slate-400">({s.kind === 'pelanggan' ? 'Pelanggan' : 'Toko'})</span></p>
                    <p className="text-xs text-slate-500">{s.phone ?? 'tanpa nomor HP'}</p>
                  </button>
                ))}
              </div>
            )}
            {search.trim().length >= 2 && matches.length === 0 && <p className="text-xs text-slate-500">Tidak ketemu.</p>}
            {!showNew ? (
              <button type="button" onClick={() => setShowNew(true)} className="text-xs text-blue-600">+ Pelanggan baru</button>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Pelanggan baru (disimpan di Master Toko, jenis Pelanggan)</p>
                <input type="text" value={nc.name} onChange={e => setNc({ ...nc, name: e.target.value })} placeholder="Nama pelanggan" className={input} />
                <input type="tel" value={nc.phone} onChange={e => setNc({ ...nc, phone: e.target.value })} placeholder="Nomor HP (wajib) mis. 081234567890" className={input} />
                <input type="text" value={nc.address} onChange={e => setNc({ ...nc, address: e.target.value })} placeholder="Alamat (opsional, perlu kalau dijemput/diantar)" className={input} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowNew(false)} className="flex-1 py-2 border border-slate-300 rounded-lg text-sm text-slate-600">Batal</button>
                  <button type="button" disabled={busy} onClick={createCustomer} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Simpan Pelanggan</button>
                </div>
              </div>
            )}
          </>
        )}
        {customer && !customer.phone && (
          <div>
            <input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Nomor HP pelanggan (wajib, disimpan ke Master Toko)" className={input} />
          </div>
        )}
      </div>

      {/* Nota & struk */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700">Nomor nota & foto struk</label>
        <input type="text" value={nota} onChange={e => setNota(e.target.value)} placeholder="Nomor nota (unik per cabang)" className={input} />
        {struk ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={struk.url} alt="Struk" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
            <button type="button" onClick={() => { URL.revokeObjectURL(struk.url); setStruk(null) }} className="text-xs text-blue-600">Foto ulang</button>
          </div>
        ) : (
          <LogisticsCameraCapture label="Foto Struk Grooming" employeeName={me.name} maxFileAgeMs={MAX_FILE_AGE_MS}
            onCaptured={blob => setStruk({ blob, url: URL.createObjectURL(blob) })} />
        )}
      </div>

      {/* Kucing */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-semibold text-slate-700">Kucing</label>
          <select value={cats.length} onChange={e => setQty(Number(e.target.value))} className="text-sm px-2 py-1 border border-slate-300 rounded-lg bg-white">
            {Array.from({ length: MAX_CATS }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} kucing</option>)}
          </select>
        </div>
        {!groomBranchId && <p className="text-xs text-slate-500">Pilih cabang dulu.</p>}
        {groomBranchId && opts.length === 0 && (
          <p className="text-xs text-amber-700">Produk promo Grooming {groomBranchName} belum diatur — harga bebas diisi.</p>
        )}
        {cats.map((c, i) => (
          <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-600">Kucing {i + 1}</p>
            <input type="text" value={c.cat_name} onChange={e => setCat(i, { cat_name: e.target.value })} placeholder="Nama / ciri kucing (opsional)" className={input} />
            <div className="grid grid-cols-2 gap-2">
              {opts.length > 0 ? (
                <select value={c.price} onChange={e => setCat(i, { price: e.target.value })} className={input}>
                  <option value="">— Harga —</option>
                  {opts.map(p => <option key={p} value={p}>{fmtRp(p)}</option>)}
                </select>
              ) : (
                <RupiahInput value={c.price} onChange={v => setCat(i, { price: v })} placeholder="Harga" className={input} />
              )}
              <select value={c.groomer_id} onChange={e => setCat(i, { groomer_id: e.target.value })} className={input}>
                <option value="">— Groomer —</option>
                <GroomerOptions groomers={groomers} groomBranchId={groomBranchId} />
              </select>
            </div>
          </div>
        ))}
        {totalPrice > 0 && <p className="text-xs text-slate-600 text-right">Total: <b>{fmtRp(totalPrice)}</b></p>}
      </div>

      {/* Datang & pulang */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700">Cara kucing datang</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setArrival('datang_sendiri')} className={radio(arrival === 'datang_sendiri')}>🚶 Datang sendiri</button>
          <button type="button" onClick={() => setArrival('jemput')} className={radio(arrival === 'jemput')}>🛵 Dijemput</button>
        </div>
        {arrival === 'jemput' && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <RupiahInput value={pickupOngkir} onChange={setPickupOngkir} placeholder="Ongkir jemput (0 kalau tidak ada)" className={input} />
            <DeliveryAssigneePicker candidates={couriers} value={pickupEmp} onChange={setPickupEmp} placeholder="Ketik nama penjemput..." />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700">Cara kucing pulang</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRet('ambil_sendiri')} className={radio(ret === 'ambil_sendiri')}>🚶 Diambil sendiri</button>
          <button type="button" onClick={() => setRet('antar')} className={radio(ret === 'antar')}>🛵 Diantar</button>
        </div>
        {ret === 'antar' && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <RupiahInput value={deliveryOngkir} onChange={setDeliveryOngkir} placeholder="Ongkir antar (0 kalau tidak ada)" className={input} />
            <DeliveryAssigneePicker candidates={couriers} value={deliveryEmp} onChange={setDeliveryEmp} placeholder="Ketik nama pengantar..." />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-semibold text-slate-700">Catatan (opsional)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="mis. kucing galak, minta potong kuku" className={input} />
      </div>

      {problems.length > 0 && <p className="text-xs text-slate-500">Belum lengkap: {problems.join(' · ')}</p>}
      <button type="button" disabled={busy || problems.length > 0} onClick={submit}
        className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
        {busy ? 'Menyimpan...' : 'Simpan Order'}
      </button>
    </section>
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
