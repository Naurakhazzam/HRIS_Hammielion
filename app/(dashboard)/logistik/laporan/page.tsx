'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/date'
import RupiahInput from '@/components/RupiahInput'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import RincianKunjunganModal, { type KunjunganTrip } from '@/components/RincianKunjunganModal'

type Plan = {
  id: string
  plan_date: string
  status: string
  box_photo_url: string | null
  garage_photo_url: string | null
  needs_refuel: boolean | null
  refuel_amount: number | null
  current_target_store_id: string | null
  vehicle_id: string
  route_id: string
  driver_id: string
  helper_id: string | null
  delivery_trip_id: string | null
  // Tutup Paksa Trip oleh kantor (migrasi 107).
  force_closed_by_name: string | null
  force_closed_at: string | null
  force_close_reason: string | null
  force_close_summary: string | null
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
}

const PLAN_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ready: { label: 'Siap Berangkat', className: 'bg-slate-100 text-slate-600' },
  departed: { label: 'Sedang Berjalan', className: 'bg-blue-100 text-blue-700' },
  closing: { label: 'Menuju Garasi', className: 'bg-purple-100 text-purple-700' },
  completed: { label: 'Selesai', className: 'bg-green-100 text-green-700' },
}

type PlanStore = {
  id: string
  plan_id: string
  sequence_order: number
  status: string
  delivery_photo_urls: string[] | null
  payment_method: string | null
  invoice_amount: number | null
  payment_amount: number | null
  received_total: number | null
  payment_photo_url: string | null
  payment_due_date: string | null
  incident_type: string
  incident_photo_url: string | null
  incident_description: string | null
  cut_total: number | null
  cut_status: string | null
  failed_reason: string | null
  fail_kind: 'kirim_besok' | 'gagal' | null
  resolved_at: string | null
  office_verified_amount: number | null
  office_verified_by: string | null
  office_verified_at: string | null
  logistics_stores: { name: string } | null
  // Nota cabang (Laporan Muat) yang ditagih di kunjungan ini -- diisi setelah fetch (migrasi 083).
  branch_notas?: { origin: string; amount: number }[]
  incident_items?: string[]
}

type PlanSupplierTask = {
  id: string
  plan_id: string
  status: string
  notes: string | null
  proof_photo_url: string | null
  resolved_at: string | null
  // Susulan kantor (migrasi 106) -- dicatat Owner/HR/Finance setelah trip selesai, boleh tanpa foto.
  office_reason: string | null
  office_by_name: string | null
  delivery_routes: { name: string } | null
}

// Jejak Susulan / Hapus Belanja oleh kantor (migrasi 106).
type SupplierCorrection = {
  id: string
  plan_id: string
  action: 'tambah' | 'hapus'
  driver_earning: number | null
  helper_earning: number | null
  reason: string
  corrected_by_name: string | null
  corrected_at: string
  delivery_routes: { name: string } | null
}

type SupplierAdd = {
  plan: Plan
  routeId: string
  reason: string
  rates: { route_id: string; driver_rate_with_helper: number; driver_rate_without_helper: number; helper_rate: number }[]
}

type ForceClose = {
  plan: Plan
  reason: string
  pendingKind: 'kirim_besok' | 'gagal'
  payWage: boolean
  // null = tarif mobil x rute belum disetup.
  rate: { driver_rate_with_helper: number; driver_rate_without_helper: number; helper_rate: number } | null
}

type PlanReturn = {
  id: string
  plan_id: string
  status: 'diambil' | 'selesai'
  note: string | null
  final_photo_url: string | null
  final_location_note: string | null
  no_items_reason: string | null
  finished_at: string | null
  logistics_stores: { name: string } | null
}

// Jejak Edit Darurat Rute (migrasi 104) -- rute & upah sebelum/sesudah dikoreksi kantor.
type RouteCorrection = {
  id: string
  plan_id: string
  old_driver_earning: number | null
  new_driver_earning: number | null
  old_helper_earning: number | null
  new_helper_earning: number | null
  reason: string
  corrected_by_name: string | null
  corrected_at: string
  old_route: { name: string } | null
  new_route: { name: string } | null
}

type RouteEdit = {
  plan: Plan
  newRouteId: string
  reason: string
  // Upah tercatat sekarang (null = trip belum selesai, upah belum dibuat).
  trip: { has_helper: boolean; driver_earning: number; helper_earning: number; payment_status: string; helper_payment_status: string | null } | null
  rates: { route_id: string; driver_rate_with_helper: number; driver_rate_without_helper: number; helper_rate: number }[]
}

// Jejak Koreksi Mobil/Driver/Kenek (migrasi 110). Upah = total trip utama + belanja.
type CrewCorrection = {
  id: string
  plan_id: string
  old_driver_earning: number | null
  new_driver_earning: number | null
  old_helper_earning: number | null
  new_helper_earning: number | null
  reason: string
  corrected_by_name: string | null
  corrected_at: string
  old_vehicle: { name: string } | null
  new_vehicle: { name: string } | null
  old_driver: { full_name: string } | null
  new_driver: { full_name: string } | null
  old_helper: { full_name: string } | null
  new_helper: { full_name: string } | null
}

type CrewEdit = {
  plan: Plan
  vehicleId: string
  driverId: string
  helperId: string
  reason: string
  // Semua baris upah plan ini (trip utama + belanja selesai); kosong = trip belum selesai.
  trips: { route_id: string; has_helper: boolean; driver_earning: number; helper_earning: number; payment_status: string; helper_payment_status: string | null }[]
  // Tarif semua mobil untuk rute-rute di atas + rute rencana, supaya pratinjau ikut mobil yang dipilih.
  rates: { vehicle_id: string; route_id: string; driver_rate_with_helper: number; driver_rate_without_helper: number; helper_rate: number }[]
}

type ReturnItem = {
  id: string
  return_id: string
  photo_url: string
  item_name: string
  reason: string
}

const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit', tempo: 'Tempo' }
const INCIDENT_LABEL: Record<string, string> = { tidak_ada: 'Tidak Ada', salah_muat: 'Salah Muat', retur: 'Retur', barang_lebih: 'Barang Lebih' }

const fmtJam = (ts: string) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'pickMonth' | 'custom'

const DATE_PRESETS: { value: Exclude<DatePreset, 'pickMonth' | 'custom'>; label: string }[] = [
  { value: 'today', label: 'Hari ini' },
  { value: 'yesterday', label: 'Kemarin' },
  { value: 'week', label: 'Minggu ini' },
  { value: 'month', label: 'Bulan ini' },
]

// Rentang tanggal (inklusif) untuk filter. "Minggu ini" = minggu gajian driver, Jumat s/d Kamis
// (sama dengan week_start_date di complete_logistics_delivery).
// "Pilih tanggal" (custom): rentang bebas Dari–Sampai; kalau terbalik otomatis ditukar.
function presetRange(preset: DatePreset, pickedMonth: string, customStart = '', customEnd = ''): { start: string; end: string } {
  if (preset === 'custom' && customStart && customEnd) {
    return customStart <= customEnd ? { start: customStart, end: customEnd } : { start: customEnd, end: customStart }
  }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  if (preset === 'today') return { start: localDateStr(today), end: localDateStr(today) }
  if (preset === 'yesterday') { const y = addDays(today, -1); return { start: localDateStr(y), end: localDateStr(y) } }
  if (preset === 'week') {
    const start = addDays(today, -((today.getDay() - 5 + 7) % 7))
    return { start: localDateStr(start), end: localDateStr(addDays(start, 6)) }
  }
  const [year, month] = (preset === 'month'
    ? [today.getFullYear(), today.getMonth() + 1]
    : pickedMonth.split('-').map(Number))
  return { start: localDateStr(new Date(year, month - 1, 1)), end: localDateStr(new Date(year, month, 0)) }
}

const fmtTgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

// Sementara sebelum tab verifikasi finance (Tahap 3): satu kunjungan bisa membawa Nota Gudang
// + nota cabang, dan driver mengetik SATU angka uang diterima untuk semuanya (received_total).
// Data lama (sebelum migrasi 083) cuma punya payment_amount = uang diterima.
const visitInvoice = (s: PlanStore) =>
  Number(s.invoice_amount || 0) + (s.branch_notas ?? []).reduce((sum, n) => sum + n.amount, 0)
const reported = (s: PlanStore) => Number(s.received_total ?? s.payment_amount ?? 0)

// > 0 = sisa piutang konsumen, < 0 = lebih bayar (jadi saldo konsumen).
const storeBalance = (s: PlanStore) => visitInvoice(s) - reported(s)

export default function LaporanPengirimanPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const [loading, setLoading] = useState(true)
  const [canView, setCanView] = useState(false)
  // Verifikasi kas fisik cuma untuk tim kantor (Owner/HR/Finance) -- beda dari canView, karena
  // Kepala Gudang boleh LIHAT laporan tapi bukan yang pegang/hitung uang setoran driver.
  const [canVerify, setCanVerify] = useState(false)
  const [datePreset, setDatePreset] = useState<DatePreset>('month')
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  // Filter per tanggal (preset 'custom'). Default hari ini s/d hari ini.
  const [customStart, setCustomStart] = useState(() => localDateStr(new Date()))
  const [customEnd, setCustomEnd] = useState(() => localDateStr(new Date()))
  // '' = semua mobil. Disaring di browser, jadi semua total di kartu ikut mobil yang dipilih.
  const [filterVehicle, setFilterVehicle] = useState('')
  const [vehicles, setVehicles] = useState<{ id: string; name: string; plate_number: string | null }[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [storesByPlan, setStoresByPlan] = useState<Record<string, PlanStore[]>>({})
  const [supplierTasksByPlan, setSupplierTasksByPlan] = useState<Record<string, PlanSupplierTask[]>>({})
  const [returnsByPlan, setReturnsByPlan] = useState<Record<string, PlanReturn[]>>({})
  const [returnItemsByReturn, setReturnItemsByReturn] = useState<Record<string, ReturnItem[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [verifyAmount, setVerifyAmount] = useState('')
  const [verifySaving, setVerifySaving] = useState(false)
  const [onlyUnverified, setOnlyUnverified] = useState(false)
  const [detailModal, setDetailModal] = useState<'incident' | 'failed' | null>(null)
  const [visitDetail, setVisitDetail] = useState<{ id: string; trip: KunjunganTrip } | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [routes, setRoutes] = useState<{ id: string; name: string }[]>([])
  const [correctionsByPlan, setCorrectionsByPlan] = useState<Record<string, RouteCorrection[]>>({})
  const [routeEdit, setRouteEdit] = useState<RouteEdit | null>(null)
  const [routeEditSaving, setRouteEditSaving] = useState(false)
  const [belanjaRoutes, setBelanjaRoutes] = useState<{ id: string; name: string }[]>([])
  const [supplierCorrByPlan, setSupplierCorrByPlan] = useState<Record<string, SupplierCorrection[]>>({})
  const [supplierAdd, setSupplierAdd] = useState<SupplierAdd | null>(null)
  const [supplierDel, setSupplierDel] = useState<{ task: PlanSupplierTask; plan: Plan; reason: string } | null>(null)
  const [supplierSaving, setSupplierSaving] = useState(false)
  const [forceClose, setForceClose] = useState<ForceClose | null>(null)
  const [forceSaving, setForceSaving] = useState(false)
  const [crewCorrByPlan, setCrewCorrByPlan] = useState<Record<string, CrewCorrection[]>>({})
  const [crewEdit, setCrewEdit] = useState<CrewEdit | null>(null)
  const [crewSaving, setCrewSaving] = useState(false)
  const [drivers, setDrivers] = useState<{ id: string; full_name: string }[]>([])
  const [helpers, setHelpers] = useState<{ id: string; full_name: string }[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { start: startDate, end: endDate } = presetRange(datePreset, filterMonth, customStart, customEnd)

    const { data: planData } = await supabase
      .from('logistics_delivery_plans')
      .select(`
        id, plan_date, status, box_photo_url, garage_photo_url, needs_refuel, refuel_amount, current_target_store_id,
        vehicle_id, route_id, driver_id, helper_id, delivery_trip_id,
        force_closed_by_name, force_closed_at, force_close_reason, force_close_summary,
        vehicles(name, plate_number),
        delivery_routes(name),
        driver:employees!logistics_delivery_plans_driver_id_fkey(full_name),
        helper:employees!logistics_delivery_plans_helper_id_fkey(full_name)
      `)
      // Dulu cuma status 'completed' -- trip yang MASIH BERJALAN jadi sama sekali tidak
      // terlihat di sini (cuma ada Dashboard Pengiriman yang menampilkan angka ringkas, tanpa
      // rincian per-toko/foto/pembayaran). Sekarang ikutkan semua status kecuali draft (masih
      // disusun, belum "Siap Kirim") dan cancelled (dibatalkan, tidak ada progres kirim nyata).
      .in('status', ['ready', 'departed', 'closing', 'completed'])
      .gte('plan_date', startDate).lte('plan_date', endDate)
      .order('plan_date', { ascending: false })
    const list = (planData as unknown as Plan[]) || []
    setPlans(list)

    if (list.length > 0) {
      const { data: storeData } = await supabase.from('logistics_plan_stores')
        .select(`id, plan_id, sequence_order, status, delivery_photo_urls,
          payment_method, invoice_amount, payment_amount, received_total, payment_photo_url, payment_due_date,
          incident_type, incident_photo_url, incident_description, failed_reason, fail_kind, resolved_at,
          cut_total, cut_status,
          office_verified_amount, office_verified_by, office_verified_at,
          logistics_stores(name)`)
        .in('plan_id', list.map(p => p.id)).order('sequence_order')
      const storeRows = (storeData as unknown as PlanStore[]) || []
      if (storeRows.length > 0) {
        const { data: notaRows } = await supabase.from('logistics_central_loadings')
          .select('nota_amount, nota_plan_store_id, origin:branches!logistics_central_loadings_origin_branch_id_fkey(name)')
          .in('nota_plan_store_id', storeRows.map(s => s.id))
        type NotaRow = { nota_amount: number; nota_plan_store_id: string; origin: { name: string } | null }
        const byStore: Record<string, { origin: string; amount: number }[]> = {}
        for (const n of (notaRows as unknown as NotaRow[]) || []) {
          ;(byStore[n.nota_plan_store_id] ??= []).push({ origin: n.origin?.name ?? 'Cabang', amount: Number(n.nota_amount) })
        }
        storeRows.forEach(s => { s.branch_notas = byStore[s.id] ?? [] })

        // Barang kejadian (migrasi 094) -- "dibeli toko" = salah varian, perlu koreksi stok pemilik.
        const incIds = storeRows.filter(s => s.incident_type !== 'tidak_ada').map(s => s.id)
        if (incIds.length > 0) {
          const { data: incRows } = await supabase.from('logistics_visit_incident_items')
            .select('plan_store_id, item_name, ordered_item_name, qty, disposition, owner:branches(name)').in('plan_store_id', incIds).order('created_at')
          type IncRow = { plan_store_id: string; item_name: string; ordered_item_name: string | null; qty: number | null; disposition: string; owner: { name: string } | null }
          const incBy: Record<string, string[]> = {}
          for (const r of (incRows as unknown as IncRow[]) || []) {
            ;(incBy[r.plan_store_id] ??= []).push(`${r.item_name}${r.qty != null ? ` ×${Number(r.qty).toLocaleString('id-ID')}` : ''}${r.ordered_item_name ? ` (seharusnya ${r.ordered_item_name})` : ''} · milik ${r.owner?.name ?? '-'} · ${r.disposition === 'dibawa_pulang' ? '↩️ dibawa pulang' : '🛒 dibeli toko'}`)
          }
          storeRows.forEach(s => { s.incident_items = incBy[s.id] ?? [] })
        }
      }
      const grouped: Record<string, PlanStore[]> = {}
      storeRows.forEach(s => {
        if (!grouped[s.plan_id]) grouped[s.plan_id] = []
        grouped[s.plan_id].push(s)
      })
      setStoresByPlan(grouped)

      const { data: taskData } = await supabase.from('logistics_plan_supplier_tasks')
        .select('id, plan_id, status, notes, proof_photo_url, resolved_at, office_reason, office_by_name, delivery_routes(name)')
        .in('plan_id', list.map(p => p.id)).order('created_at')
      const groupedTasks: Record<string, PlanSupplierTask[]> = {}
      ;(taskData as unknown as PlanSupplierTask[] || []).forEach(t => {
        if (!groupedTasks[t.plan_id]) groupedTasks[t.plan_id] = []
        groupedTasks[t.plan_id].push(t)
      })
      setSupplierTasksByPlan(groupedTasks)

      const { data: returnData } = await supabase.from('logistics_store_returns')
        .select('id, plan_id, status, note, final_photo_url, final_location_note, no_items_reason, finished_at, logistics_stores(name)')
        .in('plan_id', list.map(p => p.id)).order('claimed_at')
      const returns = (returnData as unknown as PlanReturn[]) || []
      const groupedReturns: Record<string, PlanReturn[]> = {}
      returns.forEach(r => {
        if (!groupedReturns[r.plan_id]) groupedReturns[r.plan_id] = []
        groupedReturns[r.plan_id].push(r)
      })
      setReturnsByPlan(groupedReturns)

      if (returns.length > 0) {
        const { data: itemData } = await supabase.from('logistics_store_return_items')
          .select('id, return_id, photo_url, item_name, reason')
          .in('return_id', returns.map(r => r.id)).order('captured_at')
        const groupedItems: Record<string, ReturnItem[]> = {}
        ;(itemData as ReturnItem[] || []).forEach(it => {
          if (!groupedItems[it.return_id]) groupedItems[it.return_id] = []
          groupedItems[it.return_id].push(it)
        })
        setReturnItemsByReturn(groupedItems)
      } else {
        setReturnItemsByReturn({})
      }

      // Tabel migrasi 104 -- kalau belum dijalankan, query gagal dan cukup dianggap kosong.
      const { data: corrData } = await supabase.from('logistics_route_corrections')
        .select(`id, plan_id, old_driver_earning, new_driver_earning, old_helper_earning, new_helper_earning,
          reason, corrected_by_name, corrected_at,
          old_route:delivery_routes!logistics_route_corrections_old_route_id_fkey(name),
          new_route:delivery_routes!logistics_route_corrections_new_route_id_fkey(name)`)
        .in('plan_id', list.map(p => p.id)).order('corrected_at')
      const groupedCorr: Record<string, RouteCorrection[]> = {}
      ;((corrData as unknown as RouteCorrection[]) || []).forEach(c => { (groupedCorr[c.plan_id] ??= []).push(c) })
      setCorrectionsByPlan(groupedCorr)

      // Tabel migrasi 106 -- sama, kalau belum dijalankan cukup dianggap kosong.
      const { data: supCorrData } = await supabase.from('logistics_supplier_task_corrections')
        .select('id, plan_id, action, driver_earning, helper_earning, reason, corrected_by_name, corrected_at, delivery_routes(name)')
        .in('plan_id', list.map(p => p.id)).order('corrected_at')
      const groupedSupCorr: Record<string, SupplierCorrection[]> = {}
      ;((supCorrData as unknown as SupplierCorrection[]) || []).forEach(c => { (groupedSupCorr[c.plan_id] ??= []).push(c) })
      setSupplierCorrByPlan(groupedSupCorr)

      // Tabel migrasi 110 -- sama, kalau belum dijalankan cukup dianggap kosong.
      const { data: crewCorrData } = await supabase.from('logistics_crew_corrections')
        .select(`id, plan_id, old_driver_earning, new_driver_earning, old_helper_earning, new_helper_earning,
          reason, corrected_by_name, corrected_at,
          old_vehicle:vehicles!logistics_crew_corrections_old_vehicle_id_fkey(name),
          new_vehicle:vehicles!logistics_crew_corrections_new_vehicle_id_fkey(name),
          old_driver:employees!logistics_crew_corrections_old_driver_id_fkey(full_name),
          new_driver:employees!logistics_crew_corrections_new_driver_id_fkey(full_name),
          old_helper:employees!logistics_crew_corrections_old_helper_id_fkey(full_name),
          new_helper:employees!logistics_crew_corrections_new_helper_id_fkey(full_name)`)
        .in('plan_id', list.map(p => p.id)).order('corrected_at')
      const groupedCrewCorr: Record<string, CrewCorrection[]> = {}
      ;((crewCorrData as unknown as CrewCorrection[]) || []).forEach(c => { (groupedCrewCorr[c.plan_id] ??= []).push(c) })
      setCrewCorrByPlan(groupedCrewCorr)
    } else {
      setStoresByPlan({})
      setSupplierTasksByPlan({})
      setReturnsByPlan({})
      setReturnItemsByReturn({})
      setCorrectionsByPlan({})
      setSupplierCorrByPlan({})
      setCrewCorrByPlan({})
    }
    setLoading(false)
  }, [datePreset, filterMonth, customStart, customEnd, supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
        if (userData) {
          if (['owner', 'hr', 'finance'].includes(userData.role)) { setCanView(true); setCanVerify(true) }
          else if (userData.employee_id) {
            const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', userData.employee_id).single()
            setCanView((emp as any)?.positions?.name === 'Kepala Gudang')
          }
        }
      }
    }
    init()
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    supabase.from('vehicles').select('id, name, plate_number').order('name')
      .then(({ data }) => setVehicles(data || []))
  }, [supabase])

  useEffect(() => {
    if (!canVerify) return
    // Rute "Belanja X" adalah ritase supplier (tugas terpisah), bukan rute pengiriman toko.
    supabase.from('delivery_routes').select('id, name').eq('is_active', true).not('name', 'ilike', 'Belanja%').order('name')
      .then(({ data }) => setRoutes(data || []))
    supabase.from('delivery_routes').select('id, name').eq('is_active', true).ilike('name', 'Belanja%').order('name')
      .then(({ data }) => setBelanjaRoutes(data || []))

    // Sama dengan dropdown Driver/Kenek di /logistik/rencana: driver = employee_type driver atau
    // can_drive; kenek = karyawan Team Gudang (fallback semua permanent) + driver yang can_help.
    async function loadCrew() {
      const [{ data: drvData }, { data: allPerm }, { data: helperDrivers }] = await Promise.all([
        supabase.from('employees').select('id, full_name')
          .or('employee_type.eq.driver,can_drive.eq.true').eq('is_active', true).order('full_name'),
        supabase.from('employees').select('id, full_name, departments(name)')
          .eq('employee_type', 'permanent').eq('is_active', true).order('full_name'),
        supabase.from('employees').select('id, full_name')
          .eq('employee_type', 'driver').eq('can_help', true).eq('is_active', true).order('full_name'),
      ])
      setDrivers(drvData || [])
      type PermRow = { id: string; full_name: string; departments: { name: string } | { name: string }[] | null }
      const perm = (allPerm as unknown as PermRow[]) || []
      const gudang = perm.filter(pw => {
        const dept = Array.isArray(pw.departments) ? pw.departments[0] : pw.departments
        return dept?.name === 'Team Gudang'
      })
      const base = (gudang.length > 0 ? gudang : perm).map(pw => ({ id: pw.id, full_name: pw.full_name }))
      setHelpers([...base, ...(helperDrivers || [])])
    }
    loadCrew()
  }, [canVerify, supabase])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  function openVerify(s: PlanStore) {
    setVerifyingId(s.id)
    setVerifyAmount(s.office_verified_amount != null ? String(s.office_verified_amount) : (s.received_total != null || s.payment_amount != null ? String(reported(s)) : ''))
  }

  async function submitVerify(storeId: string) {
    const amt = parseFloat(verifyAmount)
    if (isNaN(amt) || amt < 0) { showMessage('error', 'Nominal tidak valid.'); return }
    setVerifySaving(true)
    const { error } = await supabase.rpc('verify_cash_payment', { p_plan_store_id: storeId, p_verified_amount: amt })
    if (error) showMessage('error', 'Gagal verifikasi: ' + error.message)
    else { showMessage('success', 'Verifikasi kas berhasil disimpan.'); setVerifyingId(null); await fetchData() }
    setVerifySaving(false)
  }

  async function openRouteEdit(p: Plan) {
    const [{ data: trip }, { data: rates }] = await Promise.all([
      p.delivery_trip_id
        ? supabase.from('delivery_trips').select('has_helper, driver_earning, helper_earning, payment_status, helper_payment_status').eq('id', p.delivery_trip_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('driver_rate_configs').select('route_id, driver_rate_with_helper, driver_rate_without_helper, helper_rate').eq('vehicle_id', p.vehicle_id),
    ])
    setRouteEdit({ plan: p, newRouteId: '', reason: '', trip: trip as RouteEdit['trip'], rates: (rates as RouteEdit['rates']) || [] })
  }

  async function submitRouteEdit() {
    if (!routeEdit) return
    setRouteEditSaving(true)
    const { data, error } = await supabase.rpc('emergency_change_plan_route', {
      p_plan_id: routeEdit.plan.id, p_new_route_id: routeEdit.newRouteId, p_reason: routeEdit.reason.trim(),
    })
    setRouteEditSaving(false)
    if (error) { showMessage('error', 'Gagal edit rute: ' + error.message); return }
    const row = Array.isArray(data) ? data[0] : data
    const newName = routes.find(r => r.id === routeEdit.newRouteId)?.name
    showMessage('success', row?.new_driver_earning != null
      ? `Rute diubah ke ${newName}. Upah driver jadi ${fmtRp(Number(row.new_driver_earning))}${routeEdit.trip?.has_helper ? `, kenek ${fmtRp(Number(row.new_helper_earning))}` : ''}.`
      : `Rute diubah ke ${newName}. Upah dihitung dari rute ini saat trip selesai.`)
    setRouteEdit(null)
    await fetchData()
  }

  async function openSupplierAdd(p: Plan) {
    const { data: rates } = await supabase.from('driver_rate_configs')
      .select('route_id, driver_rate_with_helper, driver_rate_without_helper, helper_rate').eq('vehicle_id', p.vehicle_id)
    setSupplierAdd({ plan: p, routeId: '', reason: '', rates: (rates as SupplierAdd['rates']) || [] })
  }

  async function submitSupplierAdd() {
    if (!supplierAdd) return
    setSupplierSaving(true)
    const { data, error } = await supabase.rpc('office_add_supplier_task', {
      p_plan_id: supplierAdd.plan.id, p_route_id: supplierAdd.routeId, p_reason: supplierAdd.reason.trim(),
    })
    setSupplierSaving(false)
    if (error) { showMessage('error', 'Gagal menambah susulan belanja: ' + error.message); return }
    const row = Array.isArray(data) ? data[0] : data
    const name = belanjaRoutes.find(r => r.id === supplierAdd.routeId)?.name
    showMessage('success', `Susulan "${name}" tercatat. Upah driver ${fmtRp(Number(row?.driver_earning ?? 0))}${supplierAdd.plan.helper ? `, kenek ${fmtRp(Number(row?.helper_earning ?? 0))}` : ''}.`
      + (row?.week_already_paid ? ' ⚠ Minggu gajian trip ini sudah ada yang dibayar — upah susulan masih BELUM DIBAYAR, cek di Gaji Driver.' : ''))
    setSupplierAdd(null)
    await fetchData()
  }

  async function openForceClose(p: Plan) {
    const { data: rate } = await supabase.from('driver_rate_configs')
      .select('driver_rate_with_helper, driver_rate_without_helper, helper_rate')
      .eq('vehicle_id', p.vehicle_id).eq('route_id', p.route_id).limit(1).maybeSingle()
    setForceClose({ plan: p, reason: '', pendingKind: 'kirim_besok', payWage: true, rate: rate as ForceClose['rate'] })
  }

  async function submitForceClose() {
    if (!forceClose) return
    setForceSaving(true)
    const { data, error } = await supabase.rpc('office_force_complete_plan', {
      p_plan_id: forceClose.plan.id, p_reason: forceClose.reason.trim(),
      p_pending_kind: forceClose.pendingKind, p_pay_wage: forceClose.payWage,
    })
    setForceSaving(false)
    if (error) { showMessage('error', 'Gagal tutup paksa: ' + error.message); return }
    const row = Array.isArray(data) ? data[0] : data
    showMessage('success', forceClose.payWage
      ? `Trip ditutup paksa. Upah driver ${fmtRp(Number(row?.driver_earning ?? 0))}${forceClose.plan.helper ? `, kenek ${fmtRp(Number(row?.helper_earning ?? 0))}` : ''} tercatat.`
      : 'Trip ditutup paksa tanpa upah ritase.')
    setForceClose(null)
    await fetchData()
  }

  async function openCrewEdit(p: Plan) {
    const { data: taskRows } = await supabase.from('logistics_plan_supplier_tasks')
      .select('delivery_trip_id').eq('plan_id', p.id).not('delivery_trip_id', 'is', null)
    const tripIds = [p.delivery_trip_id, ...((taskRows || []).map(t => t.delivery_trip_id as string))].filter(Boolean) as string[]
    const { data: trips } = tripIds.length > 0
      ? await supabase.from('delivery_trips').select('route_id, has_helper, driver_earning, helper_earning, payment_status, helper_payment_status').in('id', tripIds)
      : { data: [] }
    const routeIds = [...new Set([p.route_id, ...((trips || []).map(t => t.route_id as string))])]
    const { data: rates } = await supabase.from('driver_rate_configs')
      .select('vehicle_id, route_id, driver_rate_with_helper, driver_rate_without_helper, helper_rate').in('route_id', routeIds)
    setCrewEdit({
      plan: p, vehicleId: p.vehicle_id, driverId: p.driver_id, helperId: p.helper_id ?? '', reason: '',
      trips: (trips as CrewEdit['trips']) || [], rates: (rates as CrewEdit['rates']) || [],
    })
  }

  async function submitCrewEdit() {
    if (!crewEdit) return
    setCrewSaving(true)
    const { data, error } = await supabase.rpc('office_change_plan_crew', {
      p_plan_id: crewEdit.plan.id, p_vehicle_id: crewEdit.vehicleId, p_driver_id: crewEdit.driverId,
      p_helper_id: crewEdit.helperId || null, p_reason: crewEdit.reason.trim(),
    })
    setCrewSaving(false)
    if (error) { showMessage('error', 'Gagal koreksi mobil/driver/kenek: ' + error.message); return }
    const row = Array.isArray(data) ? data[0] : data
    showMessage('success', row?.new_driver_earning != null
      ? `Koreksi tersimpan. Upah driver jadi ${fmtRp(Number(row.new_driver_earning))}${crewEdit.helperId ? `, kenek ${fmtRp(Number(row.new_helper_earning ?? 0))}` : ''} (${row.trips_updated} ritase).`
      : 'Koreksi tersimpan. Upah dihitung saat trip selesai.')
    setCrewEdit(null)
    await fetchData()
  }

  async function submitSupplierDel() {
    if (!supplierDel) return
    setSupplierSaving(true)
    const { error } = await supabase.rpc('office_delete_supplier_task', { p_task_id: supplierDel.task.id, p_reason: supplierDel.reason.trim() })
    setSupplierSaving(false)
    if (error) { showMessage('error', 'Gagal menghapus belanja: ' + error.message); return }
    showMessage('success', `Belanja "${supplierDel.task.delivery_routes?.name}" dihapus beserta upahnya.`)
    setSupplierDel(null)
    await fetchData()
  }

  // Semua angka di bawah dihitung dari trip yang lolos filter mobil -- jadi total uang, nota,
  // piutang, kejadian, dan gagal kirim ikut menyesuaikan mobil yang dipilih.
  const filteredPlans = filterVehicle ? plans.filter(p => p.vehicle_id === filterVehicle) : plans
  const allStores = filteredPlans.flatMap(p => storesByPlan[p.id] ?? [])
  const cashStores = allStores.filter(s => s.payment_method === 'cash')
  const totalCash = cashStores.reduce((sum, s) => sum + reported(s), 0)
  const totalTransfer = allStores.filter(s => s.payment_method === 'transfer').length
  const totalDeposit = allStores.filter(s => s.payment_method === 'deposit').reduce((sum, s) => sum + reported(s), 0)
  const totalTempo = allStores.filter(s => s.payment_method === 'tempo').length
  // Piutang konsumen = nota - uang diterima (migration 075). Toko lama tanpa nominal nota
  // tidak ikut dihitung -- dihitung terpisah supaya kelihatan masih ada yang belum lengkap.
  const storesWithInvoice = allStores.filter(s => s.status === 'delivered' && s.invoice_amount != null)
  const totalInvoice = storesWithInvoice.reduce((sum, s) => sum + visitInvoice(s), 0)
  const totalPiutang = storesWithInvoice.reduce((sum, s) => sum + Math.max(0, storeBalance(s)), 0)
  const totalLebihBayar = storesWithInvoice.reduce((sum, s) => sum + Math.max(0, -storeBalance(s)), 0)
  const piutangStoreCount = storesWithInvoice.filter(s => storeBalance(s) > 0).length
  const missingInvoiceCount = allStores.filter(s => s.status === 'delivered' && s.invoice_amount == null).length
  const totalIncident = allStores.filter(s => s.incident_type !== 'tidak_ada').length
  const totalFailed = allStores.filter(s => s.status === 'failed').length
  // Deposit juga uang tunai fisik yang diterima driver (beda dari transfer yang cuma bukti foto),
  // jadi sama-sama butuh verifikasi kantor -- bukan cuma cash.
  const verifiableStores = allStores.filter(s => s.payment_method === 'cash' || s.payment_method === 'deposit')
  const verifiedCashStores = verifiableStores.filter(s => s.office_verified_amount != null)
  const unverifiedStores = verifiableStores.filter(s => s.office_verified_amount == null)

  // Uang dipisah: yang sudah diverifikasi (nominal DITERIMA kantor, bukan yang dilaporkan driver)
  // vs yang belum -- jangan dijumlah jadi satu supaya kelihatan berapa yang benar-benar sudah masuk.
  const sumReported = (list: PlanStore[]) => list.reduce((sum, s) => sum + reported(s), 0)
  const sumReceived = (list: PlanStore[]) => list.reduce((sum, s) => sum + Number(s.office_verified_amount || 0), 0)
  const byMethod = (list: PlanStore[], m: string) => list.filter(s => s.payment_method === m)
  const verifiedReported = sumReported(verifiedCashStores)
  const verifiedReceived = sumReceived(verifiedCashStores)
  const totalSelisihKas = verifiedReceived - verifiedReported
  const unverifiedAmount = sumReported(unverifiedStores)
  const unverifiedPlanIds = new Set(unverifiedStores.map(s => s.plan_id))
  const visiblePlans = onlyUnverified ? filteredPlans.filter(p => unverifiedPlanIds.has(p.id)) : filteredPlans

  // Rincian kartu Kejadian / Gagal Kirim: satu baris per toko, lengkap dengan trip, keterangan, dan foto.
  const planById = new Map(plans.map(p => [p.id, p]))
  const tripOf = (p: Plan, ranks?: { planned?: number; actual?: number }): KunjunganTrip => ({
    plan_date: p.plan_date, vehicle: p.vehicles?.name ?? null, route: p.delivery_routes?.name ?? null,
    driver: p.driver?.full_name ?? null, helper: p.helper?.full_name ?? null,
    plannedRank: ranks?.planned, actualRank: ranks?.actual,
  })
  const detailStores = (detailModal === 'incident'
    ? allStores.filter(s => s.incident_type !== 'tidak_ada')
    : detailModal === 'failed' ? allStores.filter(s => s.status === 'failed') : []
  ).sort((a, b) => (planById.get(b.plan_id)?.plan_date ?? '').localeCompare(planById.get(a.plan_id)?.plan_date ?? ''))

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) }
  })

  const range = presetRange(datePreset, filterMonth, customStart, customEnd)
  const vehicleName = vehicles.find(v => v.id === filterVehicle)?.name
  const rangeText = range.start === range.end ? fmtTgl(range.start) : `${fmtTgl(range.start)} – ${fmtTgl(range.end)}`
  const periodLabel = (datePreset === 'pickMonth'
    ? monthOptions.find(m => m.value === filterMonth)?.label ?? filterMonth
    : datePreset === 'custom'
      ? `Tanggal ${rangeText}`
      : `${DATE_PRESETS.find(d => d.value === datePreset)?.label} (${rangeText})`)
    + (vehicleName ? ` · ${vehicleName}` : '')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Laporan Pengiriman</h1>
        <p className="text-sm text-slate-500">Rincian tiap trip (yang sedang berjalan maupun yang sudah selesai): mobil, toko yang dikirim, metode bayar, dan foto buktinya.</p>
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {!canView ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Halaman ini khusus tim manajemen (Owner/HR/Finance/Kepala Gudang).
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <label className="block text-xs text-slate-500 mb-1">Periode</label>
            <div className="flex flex-wrap items-center gap-2">
              {DATE_PRESETS.map(d => (
                <button key={d.value} type="button" onClick={() => setDatePreset(d.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${datePreset === d.value ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                  {d.label}
                </button>
              ))}
              <select value={datePreset === 'pickMonth' ? filterMonth : ''}
                onChange={e => { if (e.target.value) { setFilterMonth(e.target.value); setDatePreset('pickMonth') } }}
                className={`px-3 py-1.5 border rounded-lg text-sm bg-white outline-none ${datePreset === 'pickMonth' ? 'border-blue-600 text-blue-700 font-medium' : 'border-slate-300 text-slate-600'}`}>
                <option value="">Pilih bulan lain…</option>
                {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <button type="button" onClick={() => setDatePreset('custom')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${datePreset === 'custom' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                Pilih tanggal
              </button>
            </div>
            {datePreset === 'custom' && (
              <div className="flex flex-wrap items-end gap-2 mt-2">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Dari</label>
                  <input type="date" value={customStart} max={customEnd || undefined}
                    onChange={e => { if (e.target.value) setCustomStart(e.target.value) }}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-blue-600" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Sampai</label>
                  <input type="date" value={customEnd} min={customStart || undefined}
                    onChange={e => { if (e.target.value) setCustomEnd(e.target.value) }}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-blue-600" />
                </div>
              </div>
            )}
            <label className="block text-xs text-slate-500 mt-3 mb-1">Mobil</label>
            <select value={filterVehicle} onChange={e => setFilterVehicle(e.target.value)}
              className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
              <option value="">Semua mobil</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}{v.plate_number ? ` (${v.plate_number})` : ''}</option>)}
            </select>
            <p className="text-xs text-slate-500 mt-2">Menampilkan: <span className="font-medium text-slate-700">{periodLabel}</span> · {filteredPlans.length} trip</p>
            {canVerify && (
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={onlyUnverified} onChange={e => setOnlyUnverified(e.target.checked)} className="rounded" />
                Tampilkan hanya trip yang uangnya belum diverifikasi ({unverifiedPlanIds.size} trip)
              </label>
            )}
          </div>

          {canVerify && (
            <div className="mb-6">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Uang Tunai dari Driver (Cash + Deposit)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-green-700 uppercase">✅ Sudah Diverifikasi &amp; Diterima Kantor</p>
                  <p className="text-2xl font-bold text-green-700 mt-1">{fmtRp(verifiedReceived)}</p>
                  <p className="text-xs text-green-700 mt-1">
                    {verifiedCashStores.length} toko · Cash {fmtRp(sumReceived(byMethod(verifiedCashStores, 'cash')))} · Deposit {fmtRp(sumReceived(byMethod(verifiedCashStores, 'deposit')))}
                  </p>
                  <p className="text-xs text-slate-600 mt-2">
                    Yang dilaporkan driver {fmtRp(verifiedReported)} · Selisih{' '}
                    <span className={`font-semibold ${totalSelisihKas === 0 ? 'text-green-700' : totalSelisihKas < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {totalSelisihKas === 0 ? 'cocok' : totalSelisihKas < 0 ? `kurang ${fmtRp(Math.abs(totalSelisihKas))}` : `lebih ${fmtRp(totalSelisihKas)}`}
                    </span>
                  </p>
                </div>
                <div className={`rounded-xl p-4 border ${unverifiedStores.length > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
                  <p className={`text-xs font-semibold uppercase ${unverifiedStores.length > 0 ? 'text-amber-700' : 'text-slate-500'}`}>⏳ Belum Diverifikasi</p>
                  <p className={`text-2xl font-bold mt-1 ${unverifiedStores.length > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{fmtRp(unverifiedAmount)}</p>
                  <p className={`text-xs mt-1 ${unverifiedStores.length > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                    {unverifiedStores.length} toko · Cash {fmtRp(sumReported(byMethod(unverifiedStores, 'cash')))} · Deposit {fmtRp(sumReported(byMethod(unverifiedStores, 'deposit')))}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">Nominal menurut laporan driver. Belum dihitung sebagai uang diterima kantor.</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase">Total Dilaporkan Driver</p>
                  <p className="text-2xl font-bold text-slate-700 mt-1">{fmtRp(totalCash + totalDeposit)}</p>
                  <p className="text-xs text-slate-500 mt-1">{verifiableStores.length} toko · Cash {fmtRp(totalCash)} · Deposit {fmtRp(totalDeposit)}</p>
                  <p className="text-xs text-slate-500 mt-2">= sudah diverifikasi + belum diverifikasi (menurut laporan driver).</p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-6">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Nota &amp; Piutang Konsumen</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Total Nota</p>
                <p className="text-2xl font-bold text-slate-700 mt-1">{fmtRp(totalInvoice)}</p>
                <p className="text-xs text-slate-500 mt-1">{storesWithInvoice.length} toko terkirim</p>
              </div>
              <div className={`rounded-xl p-4 border ${totalPiutang > 0 ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-200'}`}>
                <p className="text-xs font-semibold text-orange-700 uppercase">Sisa Piutang Konsumen</p>
                <p className="text-2xl font-bold text-orange-700 mt-1">{fmtRp(totalPiutang)}</p>
                <p className="text-xs text-orange-700 mt-1">{piutangStoreCount} toko · nota dikurangi uang diterima</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Lebih Bayar (Saldo Konsumen)</p>
                <p className="text-2xl font-bold text-sky-700 mt-1">{fmtRp(totalLebihBayar)}</p>
                {missingInvoiceCount > 0 && <p className="text-xs text-amber-600 mt-1">{missingInvoiceCount} toko belum ada nominal nota (data lama) — tidak dihitung.</p>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {!canVerify && (
              <>
                <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase mb-1">Total Cash</p>
                  <p className="text-sm font-bold text-green-600">{fmtRp(totalCash)}</p>
                </div>
                <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase mb-1">Total Deposit</p>
                  <p className="text-sm font-bold text-blue-600">{fmtRp(totalDeposit)}</p>
                </div>
              </>
            )}
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Toko Transfer</p>
              <p className="text-sm font-bold text-slate-700">{totalTransfer} toko</p>
            </div>
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Toko Tempo</p>
              <p className="text-sm font-bold text-amber-600">{totalTempo} toko</p>
            </div>
            <button type="button" onClick={() => totalIncident > 0 && setDetailModal('incident')} disabled={totalIncident === 0}
              className="text-left bg-white p-3 rounded-xl shadow-sm border border-slate-200 enabled:hover:border-red-300 enabled:hover:bg-red-50/40 transition disabled:cursor-default">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Kejadian</p>
              <p className="text-sm font-bold text-red-500">{totalIncident} toko</p>
              {totalIncident > 0 && <p className="text-[10px] text-blue-600 mt-1">Klik untuk lihat rincian ›</p>}
            </button>
            <button type="button" onClick={() => totalFailed > 0 && setDetailModal('failed')} disabled={totalFailed === 0}
              className="text-left bg-white p-3 rounded-xl shadow-sm border border-slate-200 enabled:hover:border-red-300 enabled:hover:bg-red-50/40 transition disabled:cursor-default">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Gagal Kirim</p>
              <p className="text-sm font-bold text-red-500">{totalFailed} toko</p>
              {totalFailed > 0 && <p className="text-[10px] text-blue-600 mt-1">Klik untuk lihat rincian ›</p>}
            </button>
          </div>

          {loading && plans.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">Memuat...</div>
          ) : visiblePlans.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
              {filteredPlans.length === 0
                ? (vehicleName ? `Belum ada trip ${vehicleName} di periode ini.` : 'Belum ada trip di periode ini.')
                : 'Semua uang tunai di periode ini sudah diverifikasi. 👍'}
            </div>
          ) : (
            <div className="space-y-3">
              {visiblePlans.map(p => {
                // Urutan nyata: toko yang sudah diproses diurutkan menurut jam terkirim/dikunjungi
                // (nomor 1 = pertama kali diturunkan), sisanya menyusul sesuai urutan rencana.
                const planned = storesByPlan[p.id] || []
                const plannedRank = new Map(planned.map((s, idx) => [s.id, idx + 1]))
                const stores = [...planned].sort((a, b) =>
                  a.resolved_at && b.resolved_at ? a.resolved_at.localeCompare(b.resolved_at)
                    : a.resolved_at ? -1 : b.resolved_at ? 1 : a.sequence_order - b.sequence_order)
                const planCash = stores.filter(s => s.payment_method === 'cash' || s.payment_method === 'deposit')
                const planUnverified = planCash.filter(s => s.office_verified_amount == null)
                const planVerified = planCash.filter(s => s.office_verified_amount != null)
                const tasks = supplierTasksByPlan[p.id] || []
                const returns = returnsByPlan[p.id] || []
                const isOpen = expanded.has(p.id)
                return (
                  <div key={p.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button onClick={() => toggleExpand(p.id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-slate-800 text-sm">{p.vehicles?.name} — {p.delivery_routes?.name}</p>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${(PLAN_STATUS_LABEL[p.status] ?? PLAN_STATUS_LABEL.ready).className}`}>
                            {(PLAN_STATUS_LABEL[p.status] ?? PLAN_STATUS_LABEL.ready).label}
                          </span>
                        </div>
                        {(correctionsByPlan[p.id] ?? []).length > 0 && (
                          <span className="inline-block mt-0.5 text-[11px] px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold">⚠️ Rute dikoreksi kantor</span>
                        )}
                        {(crewCorrByPlan[p.id] ?? []).length > 0 && (
                          <span className="inline-block mt-0.5 ml-1 text-[11px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">✏️ Mobil/Driver dikoreksi kantor</span>
                        )}
                        {p.force_closed_at && (
                          <span className="inline-block mt-0.5 ml-1 text-[11px] px-2 py-0.5 rounded bg-slate-800 text-white font-semibold">⛔ Ditutup paksa kantor</span>
                        )}
                        <p className="text-xs text-slate-500">{new Date(p.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {p.driver?.full_name}{p.helper?.full_name ? ` / ${p.helper.full_name}` : ''} · {stores.length} toko</p>
                        {canVerify && planCash.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {planVerified.length > 0 && (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-green-100 text-green-700 font-semibold">
                                ✅ Diterima kantor {fmtRp(sumReceived(planVerified))} ({planVerified.length} toko)
                              </span>
                            )}
                            {planUnverified.length > 0 && (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                                ⏳ Belum diverifikasi {fmtRp(sumReported(planUnverified))} ({planUnverified.length} toko)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-blue-600 font-medium shrink-0">{isOpen ? 'Tutup ▲' : 'Rincian ▼'}</span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-slate-100 divide-y divide-slate-50">
                        {(canVerify || (correctionsByPlan[p.id] ?? []).length > 0 || (supplierCorrByPlan[p.id] ?? []).length > 0 || (crewCorrByPlan[p.id] ?? []).length > 0 || p.force_closed_at) && (
                          <div className="px-4 py-2.5">
                            {p.force_closed_at && (
                              <div className="text-xs text-slate-800 bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 mb-2">
                                <p className="font-semibold">⛔ Trip ditutup paksa kantor</p>
                                {p.force_close_summary && <p className="mt-0.5">{p.force_close_summary}</p>}
                                <p className="mt-0.5">Alasan: {p.force_close_reason}</p>
                                <p className="mt-0.5 text-slate-500">
                                  oleh {p.force_closed_by_name ?? '-'} · {new Date(p.force_closed_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            )}
                            {(correctionsByPlan[p.id] ?? []).map(c => (
                              <div key={c.id} className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-2">
                                <p className="font-semibold">⚠️ Edit darurat rute: {c.old_route?.name ?? '-'} → {c.new_route?.name ?? '-'}</p>
                                {c.new_driver_earning != null && (
                                  <p className="mt-0.5">
                                    Upah driver {fmtRp(Number(c.old_driver_earning ?? 0))} → {fmtRp(Number(c.new_driver_earning))}
                                    {(Number(c.old_helper_earning ?? 0) > 0 || Number(c.new_helper_earning ?? 0) > 0) && <> · kenek {fmtRp(Number(c.old_helper_earning ?? 0))} → {fmtRp(Number(c.new_helper_earning ?? 0))}</>}
                                  </p>
                                )}
                                <p className="mt-0.5">Alasan: {c.reason}</p>
                                <p className="mt-0.5 text-rose-600">
                                  oleh {c.corrected_by_name ?? '-'} · {new Date(c.corrected_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            ))}
                            {(crewCorrByPlan[p.id] ?? []).map(c => {
                              const changes = [
                                c.old_vehicle?.name !== c.new_vehicle?.name && `Mobil ${c.old_vehicle?.name ?? '-'} → ${c.new_vehicle?.name ?? '-'}`,
                                c.old_driver?.full_name !== c.new_driver?.full_name && `Driver ${c.old_driver?.full_name ?? '-'} → ${c.new_driver?.full_name ?? '-'}`,
                                c.old_helper?.full_name !== c.new_helper?.full_name && `Kenek ${c.old_helper?.full_name ?? 'tanpa kenek'} → ${c.new_helper?.full_name ?? 'tanpa kenek'}`,
                              ].filter(Boolean)
                              return (
                                <div key={c.id} className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-2">
                                  <p className="font-semibold">✏️ Koreksi: {changes.join(' · ')}</p>
                                  {c.new_driver_earning != null && (
                                    <p className="mt-0.5">
                                      Upah driver {fmtRp(Number(c.old_driver_earning ?? 0))} → {fmtRp(Number(c.new_driver_earning))}
                                      {(Number(c.old_helper_earning ?? 0) > 0 || Number(c.new_helper_earning ?? 0) > 0) && <> · kenek {fmtRp(Number(c.old_helper_earning ?? 0))} → {fmtRp(Number(c.new_helper_earning ?? 0))}</>}
                                    </p>
                                  )}
                                  <p className="mt-0.5">Alasan: {c.reason}</p>
                                  <p className="mt-0.5 text-indigo-600">
                                    oleh {c.corrected_by_name ?? '-'} · {new Date(c.corrected_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              )
                            })}
                            {(supplierCorrByPlan[p.id] ?? []).map(c => (
                              <div key={c.id} className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                                <p className="font-semibold">🛒 {c.action === 'tambah' ? 'Susulan belanja' : 'Belanja dihapus'}: {c.delivery_routes?.name ?? '-'}</p>
                                {c.driver_earning != null && (
                                  <p className="mt-0.5">
                                    Upah driver {c.action === 'hapus' ? '−' : '+'}{fmtRp(Number(c.driver_earning))}
                                    {Number(c.helper_earning ?? 0) > 0 && <> · kenek {c.action === 'hapus' ? '−' : '+'}{fmtRp(Number(c.helper_earning))}</>}
                                  </p>
                                )}
                                <p className="mt-0.5">Alasan: {c.reason}</p>
                                <p className="mt-0.5 text-amber-700">
                                  oleh {c.corrected_by_name ?? '-'} · {new Date(c.corrected_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            ))}
                            {canVerify && (
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => openRouteEdit(p)}
                                  className="text-xs px-2.5 py-1 border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg font-medium transition">
                                  ⚠️ Edit Darurat Rute
                                </button>
                                <button type="button" onClick={() => openCrewEdit(p)}
                                  className="text-xs px-2.5 py-1 border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium transition">
                                  ✏️ Koreksi Mobil/Driver/Kenek
                                </button>
                                {/* Trip Selesai sudah hilang dari HP driver -- belanja yang lupa dilaporkan
                                    cuma bisa disusulkan kantor dari sini (trip yang masih jalan: lewat Rencana). */}
                                {p.status === 'completed' && (
                                  <button type="button" onClick={() => openSupplierAdd(p)}
                                    className="text-xs px-2.5 py-1 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-medium transition">
                                    🛒 Susulan Belanja
                                  </button>
                                )}
                                {/* Trip cuma bisa Selesai lewat HP driver -- kalau HP rusak / lupa ditutup,
                                    trip tersangkut dan upahnya tidak pernah tercatat. */}
                                {(p.status === 'departed' || p.status === 'closing') && (
                                  <button type="button" onClick={() => openForceClose(p)}
                                    className="text-xs px-2.5 py-1 border border-slate-400 bg-slate-100 text-slate-800 hover:bg-slate-200 rounded-lg font-medium transition">
                                    ⛔ Tutup Paksa Trip
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {(p.box_photo_url || p.garage_photo_url) && (
                          <div className="px-4 py-2.5">
                            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                              Penutupan Trip{p.needs_refuel ? ` — ⛽ Perlu Isi Bensin${p.refuel_amount != null ? ` (${fmtRp(Number(p.refuel_amount))})` : ''}` : ''}
                            </p>
                            <div className="flex gap-3">
                              {p.box_photo_url && (
                                <button type="button" onClick={() => openLightbox(p.box_photo_url!, 'Foto box kosong')} title="Foto Box Kosong" className="flex flex-col items-center gap-1">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.box_photo_url} alt="Foto box kosong" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                  <span className="text-[10px] text-slate-500 font-medium">Box Kosong</span>
                                </button>
                              )}
                              {p.garage_photo_url && (
                                <button type="button" onClick={() => openLightbox(p.garage_photo_url!, 'Foto amper bensin')} title="Foto Amper Bensin" className="flex flex-col items-center gap-1">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.garage_photo_url} alt="Foto amper bensin" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                  <span className="text-[10px] text-slate-500 font-medium">Amper Bensin</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {tasks.length > 0 && (
                          <div className="px-4 py-2.5">
                            <p className="text-xs font-semibold text-amber-600 uppercase mb-2">🛒 Belanja Supplier</p>
                            <div className="space-y-2">
                              {tasks.map(t => (
                                <div key={t.id} className="flex items-center gap-3 text-sm">
                                  <span className="flex-1 text-slate-700">
                                    {t.delivery_routes?.name}
                                    {t.notes && <span className="text-slate-400"> — {t.notes}</span>}
                                    {t.office_reason && (
                                      <span className="block text-[11px] text-amber-700">📝 Susulan kantor ({t.office_by_name ?? '-'}): {t.office_reason}</span>
                                    )}
                                  </span>
                                  {t.resolved_at && (
                                    <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">🕐 {fmtJam(t.resolved_at)}</span>
                                  )}
                                  {t.status === 'done' ? (
                                    t.proof_photo_url && (
                                      <button type="button" onClick={() => openLightbox(t.proof_photo_url!, `Surat jalan/nota - ${t.delivery_routes?.name}`)} title="Foto Surat Jalan/Nota" className="flex flex-col items-center gap-0.5 shrink-0">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={t.proof_photo_url} alt="Surat jalan/nota" className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                                      </button>
                                    )
                                  ) : (
                                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-medium shrink-0">Belum Diproses</span>
                                  )}
                                  {canVerify && (
                                    <button type="button" onClick={() => setSupplierDel({ task: t, plan: p, reason: '' })} title="Hapus belanja ini beserta upahnya"
                                      className="text-[11px] text-red-600 hover:underline shrink-0">Hapus</button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {returns.length > 0 && (
                          <div className="px-4 py-2.5">
                            <p className="text-xs font-semibold text-purple-600 uppercase mb-2">↩️ Retur Toko</p>
                            <div className="space-y-3">
                              {returns.map(r => {
                                const items = returnItemsByReturn[r.id] || []
                                return (
                                  <div key={r.id} className="text-sm">
                                    <div className="flex items-center gap-3">
                                      <span className="flex-1 text-slate-700">
                                        {r.logistics_stores?.name}
                                        {r.note && <span className="text-slate-400"> — {r.note}</span>}
                                      </span>
                                      {r.finished_at && (
                                        <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">🕐 {fmtJam(r.finished_at)}</span>
                                      )}
                                      <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${r.status === 'selesai' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {r.status === 'selesai' ? (r.no_items_reason ? 'Tidak Ada Barang' : 'Selesai') : 'Sedang Diambil'}
                                      </span>
                                    </div>
                                    {r.no_items_reason && (
                                      <p className="text-xs text-slate-500 mt-1 ml-0">Kata driver: {r.no_items_reason}</p>
                                    )}
                                    {r.final_location_note && (
                                      <p className="text-xs text-slate-500 mt-1 ml-0">Disimpan di: {r.final_location_note}</p>
                                    )}
                                    {(items.length > 0 || r.final_photo_url) && (
                                      <div className="flex gap-3 mt-2 flex-wrap">
                                        {items.map(it => (
                                          <button key={it.id} type="button" onClick={() => openLightbox(it.photo_url, it.item_name)} title={`${it.item_name} — ${it.reason}`} className="flex flex-col items-center gap-1">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={it.photo_url} alt={it.item_name} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                            <span className="text-[10px] text-slate-500 font-medium truncate max-w-[56px]">{it.item_name}</span>
                                          </button>
                                        ))}
                                        {r.final_photo_url && (
                                          <button type="button" onClick={() => openLightbox(r.final_photo_url!, r.no_items_reason ? 'Foto toko' : 'Posisi akhir barang')} title={r.no_items_reason ? 'Foto Toko' : 'Posisi Akhir Barang'} className="flex flex-col items-center gap-1">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={r.final_photo_url} alt={r.no_items_reason ? 'Foto toko' : 'Posisi akhir barang'} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                            <span className="text-[10px] text-slate-500 font-medium">{r.no_items_reason ? 'Foto Toko' : 'Posisi Akhir'}</span>
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                        {stores.map((s, i) => (
                          <div key={s.id} className="px-4 py-2.5 text-sm">
                            <div className="flex items-center gap-3">
                              <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 shrink-0">{i + 1}</span>
                              <span className="flex-1 text-slate-700">
                                <button type="button" title="Lihat rincian lengkap kunjungan"
                                  onClick={() => setVisitDetail({ id: s.id, trip: tripOf(p, { planned: plannedRank.get(s.id), actual: s.resolved_at ? i + 1 : undefined }) })}
                                  className="text-left text-blue-700 hover:underline font-medium">
                                  {s.logistics_stores?.name} <span className="text-[10px] text-blue-500 font-normal">Rincian ›</span>
                                </button>
                                {s.resolved_at && plannedRank.get(s.id) !== i + 1 && (
                                  <span className="ml-1.5 text-[10px] text-slate-400">(rencana #{plannedRank.get(s.id)})</span>
                                )}
                              </span>
                              {s.resolved_at && (
                                <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                                  🕐 {s.status === 'delivered' ? 'Terkirim jam ' : 'jam '}{fmtJam(s.resolved_at)}
                                </span>
                              )}
                              {s.status === 'failed' ? (
                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${s.fail_kind === 'kirim_besok' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>{s.fail_kind === 'kirim_besok' ? 'Kirim Besok' : 'Gagal'}: {s.failed_reason}</span>
                              ) : s.status === 'pending' ? (
                                s.id !== p.current_target_store_id && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">Belum Diproses</span>
                                )
                              ) : (
                                <>
                                  {s.payment_method && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                                      {PAYMENT_LABEL[s.payment_method]}
                                      {(s.branch_notas ?? []).length > 0
                                        ? `${s.invoice_amount ? ` — nota gudang ${fmtRp(Number(s.invoice_amount))}` : ''}${(s.branch_notas ?? []).map(n => ` — nota ${n.origin} ${fmtRp(n.amount)}`).join('')}`
                                        : s.invoice_amount != null ? ` — nota ${fmtRp(Number(s.invoice_amount))}` : ''}
                                      {reported(s) ? ` — diterima ${fmtRp(reported(s))}` : ''}{s.payment_due_date ? ` — jatuh tempo ${new Date(s.payment_due_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}` : ''}
                                    </span>
                                  )}
                                  {s.invoice_amount != null && storeBalance(s) !== 0 && (
                                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${storeBalance(s) > 0 ? 'bg-orange-100 text-orange-700' : 'bg-sky-100 text-sky-700'}`}>
                                      {storeBalance(s) > 0 ? `Piutang ${fmtRp(storeBalance(s))}` : `Lebih bayar ${fmtRp(-storeBalance(s))}`}
                                    </span>
                                  )}
                                  {s.incident_type !== 'tidak_ada' && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                                      {INCIDENT_LABEL[s.incident_type]}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            {s.incident_description && (
                              <p className="text-xs text-amber-600 mt-1 ml-8">{s.incident_description}</p>
                            )}
                            {(s.incident_items ?? []).map((t, i) => (
                              <p key={i} className="text-xs text-amber-700 mt-0.5 ml-8">• {t}</p>
                            ))}
                            {Number(s.cut_total) > 0 && (
                              <p className="text-xs text-rose-700 mt-1 ml-8">
                                ✂️ Potong nota {fmtRp(Number(s.cut_total))} — {s.cut_status === "disetujui" ? "disetujui" : s.cut_status === "ditolak" ? "ditolak (tetap piutang)" : "menunggu persetujuan Finance"}
                              </p>
                            )}
                            {((s.delivery_photo_urls && s.delivery_photo_urls.length > 0) || s.payment_photo_url || s.incident_photo_url) && (
                              <div className="flex gap-3 mt-2 ml-8 flex-wrap">
                                {s.delivery_photo_urls?.map((url, idx) => (
                                  <button key={idx} type="button" onClick={() => openLightbox(url, `Bukti kirim ${idx + 1}`)} title={`Bukti Kirim ${idx + 1}`} className="flex flex-col items-center gap-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`Bukti kirim ${idx + 1}`} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                    <span className="text-[10px] text-slate-500 font-medium">Bukti Kirim{s.delivery_photo_urls!.length > 1 ? ` ${idx + 1}` : ''}</span>
                                  </button>
                                ))}
                                {s.payment_photo_url && (
                                  <button type="button" onClick={() => openLightbox(s.payment_photo_url!, 'Bukti transfer')} title="Bukti Transfer" className="flex flex-col items-center gap-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={s.payment_photo_url} alt="Bukti transfer" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                    <span className="text-[10px] text-slate-500 font-medium">Bukti Transfer</span>
                                  </button>
                                )}
                                {s.incident_photo_url && (
                                  <button type="button" onClick={() => openLightbox(s.incident_photo_url!, 'Foto kejadian')} title="Foto Kejadian" className="flex flex-col items-center gap-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={s.incident_photo_url} alt="Foto kejadian" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                    <span className="text-[10px] text-slate-500 font-medium">Foto Kejadian</span>
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Validasi kas fisik — nominal yang ditulis driver belum tentu sama
                                dengan yang benar-benar diserahkan ke kantor. Berlaku untuk cash
                                DAN deposit (sama-sama uang tunai fisik, beda dari transfer yang
                                cuma bukti foto), cuma bisa diisi Owner/HR/Finance (canVerify). */}
                            {(s.payment_method === 'cash' || s.payment_method === 'deposit') && canVerify && (
                              <div className="mt-2 ml-8">
                                {verifyingId === s.id ? (
                                  <div className="flex items-center gap-2">
                                    <RupiahInput value={verifyAmount} onChange={setVerifyAmount}
                                      placeholder="Nominal diterima kantor"
                                      className="w-40 px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                                    <button onClick={() => submitVerify(s.id)} disabled={verifySaving}
                                      className="px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition disabled:opacity-50">
                                      {verifySaving ? 'Menyimpan...' : 'Simpan'}
                                    </button>
                                    <button onClick={() => setVerifyingId(null)} className="text-xs text-slate-500 hover:underline">Batal</button>
                                  </div>
                                ) : s.office_verified_amount != null ? (
                                  (() => {
                                    const selisih = Number(s.office_verified_amount) - reported(s)
                                    return (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                          Diterima kantor: {fmtRp(Number(s.office_verified_amount))}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${selisih === 0 ? 'bg-green-100 text-green-700' : selisih < 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                                          {selisih === 0 ? '✓ Cocok' : selisih < 0 ? `Kurang ${fmtRp(Math.abs(selisih))}` : `Lebih ${fmtRp(selisih)}`}
                                        </span>
                                        <button onClick={() => openVerify(s)} className="text-xs text-blue-600 hover:underline">Ubah</button>
                                      </div>
                                    )
                                  })()
                                ) : (
                                  <button onClick={() => openVerify(s)}
                                    className="text-xs px-2.5 py-1 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-medium transition">
                                    ⚠ Verifikasi Kas Diterima
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {detailModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  {detailModal === 'incident' ? 'Rincian Kejadian (Salah Muat / Retur / Barang Lebih)' : 'Rincian Gagal Kirim'}
                </h2>
                <p className="text-xs text-slate-500">{detailStores.length} toko · {periodLabel}</p>
              </div>
              <button onClick={() => setDetailModal(null)} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100">
              {detailStores.map(s => {
                const plan = planById.get(s.plan_id)
                const photos: { url: string; label: string }[] = [
                  ...(s.incident_photo_url ? [{ url: s.incident_photo_url, label: 'Foto Kejadian' }] : []),
                  ...(detailModal === 'failed' ? (s.delivery_photo_urls ?? []).map((url, i) => ({ url, label: `Foto ${i + 1}` })) : []),
                ]
                return (
                  <div key={s.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => plan && setVisitDetail({ id: s.id, trip: tripOf(plan) })}
                        className="text-sm font-semibold text-blue-700 hover:underline text-left">
                        {s.logistics_stores?.name ?? '-'} <span className="text-[10px] font-normal text-blue-500">Rincian lengkap ›</span>
                      </button>
                      {detailModal === 'incident' ? (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                          {INCIDENT_LABEL[s.incident_type] ?? s.incident_type}
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-600 font-semibold">Gagal Kirim</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {plan ? new Date(plan.plan_date).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                      {s.resolved_at && <> · jam {fmtJam(s.resolved_at)}</>}
                      {plan && <> · {plan.vehicles?.name} — {plan.delivery_routes?.name} · {plan.driver?.full_name}{plan.helper?.full_name ? ` / ${plan.helper.full_name}` : ''}</>}
                    </p>
                    <p className="text-sm text-slate-700 mt-1.5 whitespace-pre-wrap">
                      {detailModal === 'incident'
                        ? (s.incident_description || <span className="text-slate-400 italic">Tidak ada keterangan</span>)
                        : (s.failed_reason || <span className="text-slate-400 italic">Tidak ada alasan tercatat</span>)}
                    </p>
                    {detailModal === 'failed' && s.incident_description && (
                      <p className="text-xs text-amber-600 mt-1">{s.incident_description}</p>
                    )}
                    {(s.incident_items ?? []).map((t, i) => (
                      <p key={i} className="text-xs text-amber-700 mt-0.5">• {t}</p>
                    ))}
                    {photos.length > 0 ? (
                      <div className="flex flex-wrap gap-3 mt-2">
                        {photos.map((ph, i) => (
                          <button key={i} type="button" onClick={() => openLightbox(ph.url, `${s.logistics_stores?.name} — ${ph.label}`)} className="flex flex-col items-center gap-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ph.url} alt={ph.label} className="w-24 h-24 object-cover rounded-lg border border-slate-200" />
                            <span className="text-[10px] text-slate-500 font-medium">{ph.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 mt-2">Tidak ada foto.</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {routeEdit && (() => {
        const { plan, trip } = routeEdit
        const rate = routeEdit.rates.find(r => r.route_id === routeEdit.newRouteId)
        const newDriver = rate && trip ? Number(trip.has_helper ? rate.driver_rate_with_helper : rate.driver_rate_without_helper) : 0
        const newHelper = rate && trip ? Number(trip.has_helper ? rate.helper_rate : 0) : 0
        const diff = trip ? newDriver + newHelper - Number(trip.driver_earning) - Number(trip.helper_earning) : 0
        const paid = !!trip && (trip.payment_status === 'paid' || trip.helper_payment_status === 'paid')
        const canSubmit = !!routeEdit.newRouteId && !!rate && routeEdit.reason.trim().length >= 5 && !paid && !routeEditSaving
        return (
          <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => !routeEditSaving && setRouteEdit(null)}>
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-800">⚠️ Edit Darurat Rute</h2>
                  <p className="text-xs text-slate-500">
                    {new Date(plan.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {plan.vehicles?.name} · {plan.driver?.full_name}{plan.helper?.full_name ? ` / ${plan.helper.full_name}` : ''}
                  </p>
                </div>
                <button onClick={() => setRouteEdit(null)} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Untuk trip yang jalannya tidak sesuai rute di rencana. Rute diganti ke rute sebenarnya dan upah ritase driver/kenek dihitung ulang dari tarif rute itu. Perubahan tercatat beserta alasannya.
                </p>
                <div>
                  <p className="text-xs text-slate-500">Rute sekarang</p>
                  <p className="font-semibold text-slate-800">{plan.delivery_routes?.name ?? '-'}</p>
                  {trip ? (
                    <p className="text-xs text-slate-500">Upah driver {fmtRp(Number(trip.driver_earning))}{trip.has_helper ? ` · kenek ${fmtRp(Number(trip.helper_earning))}` : ''}</p>
                  ) : (
                    <p className="text-xs text-slate-500">Trip belum selesai — upah belum tercatat, nanti dihitung dari rute baru.</p>
                  )}
                </div>
                {paid && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Upah trip ini sudah dibayar, jadi rute tidak bisa diedit dari sini. Koreksi lewat Penggajian Driver.
                  </p>
                )}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Rute sebenarnya</label>
                  <select value={routeEdit.newRouteId} onChange={e => setRouteEdit({ ...routeEdit, newRouteId: e.target.value })} disabled={paid}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
                    <option value="">— Pilih rute —</option>
                    {routes.filter(r => r.id !== plan.route_id).map(r => (
                      <option key={r.id} value={r.id}>{r.name}{routeEdit.rates.some(x => x.route_id === r.id) ? '' : ' (tarif belum disetup)'}</option>
                    ))}
                  </select>
                  {routeEdit.newRouteId && !rate && (
                    <p className="text-xs text-red-600 mt-1">Tarif {plan.vehicles?.name} untuk rute ini belum disetup di Penggajian › Tarif &amp; Mobil Driver.</p>
                  )}
                  {rate && trip && (
                    <p className="text-xs text-slate-700 mt-1">
                      Upah baru: driver <b>{fmtRp(newDriver)}</b>{trip.has_helper && <> · kenek <b>{fmtRp(newHelper)}</b></>}{' '}
                      (<span className={diff >= 0 ? 'text-green-700' : 'text-red-600'}>{diff >= 0 ? '+' : '−'}{fmtRp(Math.abs(diff))}</span>)
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Alasan (wajib)</label>
                  <textarea value={routeEdit.reason} onChange={e => setRouteEdit({ ...routeEdit, reason: e.target.value })} rows={3} disabled={paid}
                    placeholder="Mis. toko di Garut dialihkan, mobil jalan ke Tasik Kota"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
                <button onClick={() => setRouteEdit(null)} disabled={routeEditSaving} className="px-3 py-1.5 text-sm text-slate-600 hover:underline">Batal</button>
                <button onClick={submitRouteEdit} disabled={!canSubmit}
                  className="px-3 py-1.5 text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition disabled:opacity-50">
                  {routeEditSaving ? 'Menyimpan...' : 'Simpan Edit Rute'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {supplierAdd && (() => {
        const { plan } = supplierAdd
        const rate = supplierAdd.rates.find(r => r.route_id === supplierAdd.routeId)
        const hasHelper = !!plan.helper
        const canSubmit = !!supplierAdd.routeId && !!rate && supplierAdd.reason.trim().length >= 5 && !supplierSaving
        return (
          <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => !supplierSaving && setSupplierAdd(null)}>
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-800">🛒 Susulan Belanja Supplier</h2>
                  <p className="text-xs text-slate-500">
                    {new Date(plan.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {plan.vehicles?.name} · {plan.driver?.full_name}{plan.helper?.full_name ? ` / ${plan.helper.full_name}` : ''}
                  </p>
                </div>
                <button onClick={() => setSupplierAdd(null)} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Untuk belanja yang benar-benar dikerjakan di trip ini tapi tidak tercatat (lupa dilaporkan driver / tidak ada di rencana). Upah ritase belanja dicatat ke tanggal trip ini dan tercatat beserta alasannya.
                </p>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Rute belanja</label>
                  <select value={supplierAdd.routeId} onChange={e => setSupplierAdd({ ...supplierAdd, routeId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
                    <option value="">— Pilih rute belanja —</option>
                    {belanjaRoutes.map(r => (
                      <option key={r.id} value={r.id}>{r.name}{supplierAdd.rates.some(x => x.route_id === r.id) ? '' : ' (tarif belum disetup)'}</option>
                    ))}
                  </select>
                  {supplierAdd.routeId && !rate && (
                    <p className="text-xs text-red-600 mt-1">Tarif {plan.vehicles?.name} untuk rute ini belum disetup di Penggajian › Tarif &amp; Mobil Driver.</p>
                  )}
                  {rate && (
                    <p className="text-xs text-slate-700 mt-1">
                      Upah: driver <b>{fmtRp(Number(hasHelper ? rate.driver_rate_with_helper : rate.driver_rate_without_helper))}</b>
                      {hasHelper && <> · kenek <b>{fmtRp(Number(rate.helper_rate))}</b></>}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Alasan (wajib)</label>
                  <textarea value={supplierAdd.reason} onChange={e => setSupplierAdd({ ...supplierAdd, reason: e.target.value })} rows={3}
                    placeholder="Mis. driver lupa lapor belanja Aina, nota sudah dicek kantor"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
                <button onClick={() => setSupplierAdd(null)} disabled={supplierSaving} className="px-3 py-1.5 text-sm text-slate-600 hover:underline">Batal</button>
                <button onClick={submitSupplierAdd} disabled={!canSubmit}
                  className="px-3 py-1.5 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition disabled:opacity-50">
                  {supplierSaving ? 'Menyimpan...' : 'Simpan Susulan'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {forceClose && (() => {
        const { plan, rate } = forceClose
        const pendingStores = (storesByPlan[plan.id] ?? []).filter(s => s.status === 'pending')
        const pendingTasks = (supplierTasksByPlan[plan.id] ?? []).filter(t => t.status === 'pending')
        const openReturns = (returnsByPlan[plan.id] ?? []).filter(r => r.status === 'diambil')
        const hasHelper = !!plan.helper
        const canSubmit = forceClose.reason.trim().length >= 5 && (!forceClose.payWage || !!rate) && !forceSaving
        return (
          <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => !forceSaving && setForceClose(null)}>
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-800">⛔ Tutup Paksa Trip</h2>
                  <p className="text-xs text-slate-500">
                    {new Date(plan.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {plan.vehicles?.name} — {plan.delivery_routes?.name} · {plan.driver?.full_name}{plan.helper?.full_name ? ` / ${plan.helper.full_name}` : ''}
                  </p>
                </div>
                <button onClick={() => setForceClose(null)} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Untuk trip yang tidak bisa ditutup driver (HP rusak, lupa Lapor Sampai Garasi, dll). Trip langsung jadi Selesai dan tidak bisa dibuka lagi. Semua tercatat beserta alasannya.
                </p>
                <div className="text-xs text-slate-700 space-y-1">
                  <p className="font-semibold text-slate-500 uppercase">Yang akan terjadi</p>
                  {pendingStores.length > 0 ? (
                    <div>
                      <p>• {pendingStores.length} toko belum diproses ({pendingStores.map(s => s.logistics_stores?.name).join(', ')}) ditandai:</p>
                      <div className="flex gap-2 mt-1 ml-3">
                        {(['kirim_besok', 'gagal'] as const).map(k => (
                          <label key={k} className={`px-2.5 py-1 rounded-lg border cursor-pointer ${forceClose.pendingKind === k ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium' : 'border-slate-300'}`}>
                            <input type="radio" className="hidden" checked={forceClose.pendingKind === k} onChange={() => setForceClose({ ...forceClose, pendingKind: k })} />
                            {k === 'kirim_besok' ? 'Kirim Besok' : 'Gagal'}
                          </label>
                        ))}
                      </div>
                      <p className="ml-3 mt-1 text-slate-500">{forceClose.pendingKind === 'kirim_besok' ? 'Surat jalan/paket kembali ke antrean untuk dikirim lagi.' : 'Surat jalan/paket masuk "perlu keputusan".'}</p>
                    </div>
                  ) : <p>• Semua toko sudah diproses.</p>}
                  {pendingTasks.length > 0 && (
                    <p>• {pendingTasks.length} tugas belanja belum diproses ({pendingTasks.map(t => t.delivery_routes?.name).join(', ')}) <b>dihapus</b>. Kalau ternyata dikerjakan, tambahkan lewat Susulan Belanja.</p>
                  )}
                  {openReturns.length > 0 && (
                    <p>• {openReturns.length} retur yang masih dibawa ({openReturns.map(r => r.logistics_stores?.name).join(', ')}) ditandai selesai dengan catatan tutup paksa.</p>
                  )}
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={forceClose.payWage} onChange={e => setForceClose({ ...forceClose, payWage: e.target.checked })} className="rounded mt-0.5" />
                  <span>
                    Catat upah ritase trip ini
                    {rate ? (
                      <span className="block text-xs text-slate-600">
                        Driver <b>{fmtRp(Number(hasHelper ? rate.driver_rate_with_helper : rate.driver_rate_without_helper))}</b>
                        {hasHelper && <> · kenek <b>{fmtRp(Number(rate.helper_rate))}</b></>}
                      </span>
                    ) : (
                      <span className="block text-xs text-red-600">Tarif {plan.vehicles?.name} untuk rute ini belum disetup di Penggajian › Tarif &amp; Mobil Driver.</span>
                    )}
                    <span className="block text-xs text-slate-500">Hilangkan centang kalau trip ini ternyata tidak jalan.</span>
                  </span>
                </label>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Alasan (wajib)</label>
                  <textarea value={forceClose.reason} onChange={e => setForceClose({ ...forceClose, reason: e.target.value })} rows={3}
                    placeholder="Mis. HP driver rusak, sudah konfirmasi lewat telepon semua toko terkirim"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
                <button onClick={() => setForceClose(null)} disabled={forceSaving} className="px-3 py-1.5 text-sm text-slate-600 hover:underline">Batal</button>
                <button onClick={submitForceClose} disabled={!canSubmit}
                  className="px-3 py-1.5 text-sm font-medium bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition disabled:opacity-50">
                  {forceSaving ? 'Menyimpan...' : 'Tutup Paksa'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {crewEdit && (() => {
        const { plan, trips } = crewEdit
        const hasHelper = !!crewEdit.helperId
        // Server menghitung ulang upah hanya kalau mobil berubah atau kenek ditambah/dihapus.
        const recalc = crewEdit.vehicleId !== plan.vehicle_id || hasHelper !== !!plan.helper_id
        const rateFor = (routeId: string) => crewEdit.rates.find(r => r.vehicle_id === crewEdit.vehicleId && r.route_id === routeId)
        const missingRate = (crewEdit.vehicleId !== plan.vehicle_id && !rateFor(plan.route_id))
          || (recalc && trips.some(t => !rateFor(t.route_id)))
        const oldDriver = trips.reduce((s, t) => s + Number(t.driver_earning), 0)
        const oldHelper = trips.reduce((s, t) => s + Number(t.helper_earning), 0)
        const newDriver = recalc
          ? trips.reduce((s, t) => { const r = rateFor(t.route_id); return s + Number(r ? (hasHelper ? r.driver_rate_with_helper : r.driver_rate_without_helper) : 0) }, 0)
          : oldDriver
        const newHelper = recalc
          ? trips.reduce((s, t) => { const r = rateFor(t.route_id); return s + Number(r && hasHelper ? r.helper_rate : 0) }, 0)
          : oldHelper
        const paid = trips.some(t => t.payment_status === 'paid' || t.helper_payment_status === 'paid')
        const unchanged = crewEdit.vehicleId === plan.vehicle_id && crewEdit.driverId === plan.driver_id && crewEdit.helperId === (plan.helper_id ?? '')
        const sameCrew = !!crewEdit.helperId && crewEdit.helperId === crewEdit.driverId
        const canSubmit = !!crewEdit.vehicleId && !!crewEdit.driverId && !unchanged && !sameCrew && !missingRate && !paid
          && crewEdit.reason.trim().length >= 5 && !crewSaving
        // Orang yang tercatat sekarang tetap muncul walau sudah tidak aktif / di luar daftar.
        const driverOpts = drivers.some(d => d.id === plan.driver_id) ? drivers : [{ id: plan.driver_id, full_name: plan.driver?.full_name ?? '-' }, ...drivers]
        const helperOpts = !plan.helper_id || helpers.some(h => h.id === plan.helper_id) ? helpers : [{ id: plan.helper_id, full_name: plan.helper?.full_name ?? '-' }, ...helpers]
        return (
          <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => !crewSaving && setCrewEdit(null)}>
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-800">✏️ Koreksi Mobil/Driver/Kenek</h2>
                  <p className="text-xs text-slate-500">
                    {new Date(plan.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {plan.vehicles?.name} — {plan.delivery_routes?.name} · {plan.driver?.full_name}{plan.helper?.full_name ? ` / ${plan.helper.full_name}` : ''}
                  </p>
                </div>
                <button onClick={() => setCrewEdit(null)} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Untuk salah pilih mobil, driver, atau kenek. Upah ritase yang sudah tercatat (trip & belanja) ikut pindah ke orang yang benar; kalau mobil berubah atau kenek ditambah/dihapus, upah dihitung ulang dari tarif. Perubahan tercatat beserta alasannya.
                </p>
                {paid && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Upah trip ini sudah dibayar, jadi tidak bisa dikoreksi dari sini. Koreksi lewat Penggajian Driver.
                  </p>
                )}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Mobil</label>
                  <select value={crewEdit.vehicleId} onChange={e => setCrewEdit({ ...crewEdit, vehicleId: e.target.value })} disabled={paid}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}{v.plate_number ? ` (${v.plate_number})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Driver</label>
                  <select value={crewEdit.driverId} onChange={e => setCrewEdit({ ...crewEdit, driverId: e.target.value })} disabled={paid}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
                    {driverOpts.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Kenek</label>
                  <select value={crewEdit.helperId} onChange={e => setCrewEdit({ ...crewEdit, helperId: e.target.value })} disabled={paid}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
                    <option value="">— Tanpa kenek —</option>
                    {helperOpts.filter(h => h.id !== crewEdit.driverId).map(h => <option key={h.id} value={h.id}>{h.full_name}</option>)}
                  </select>
                  {sameCrew && <p className="text-xs text-red-600 mt-1">Driver dan Kenek tidak boleh orang yang sama.</p>}
                </div>
                {missingRate && (
                  <p className="text-xs text-red-600">Tarif mobil ini untuk rute trip/belanja ini belum disetup di Penggajian › Tarif &amp; Mobil Driver.</p>
                )}
                {!unchanged && !missingRate && (
                  trips.length > 0 ? (
                    <p className="text-xs text-slate-700">
                      Upah {trips.length > 1 ? `(${trips.length} ritase) ` : ''}driver {fmtRp(oldDriver)} → <b>{fmtRp(newDriver)}</b>
                      {(oldHelper > 0 || newHelper > 0) && <> · kenek {fmtRp(oldHelper)} → <b>{fmtRp(newHelper)}</b></>}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">Trip belum selesai — upah belum tercatat, nanti dihitung dari data yang baru.</p>
                  )
                )}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Alasan (wajib)</label>
                  <textarea value={crewEdit.reason} onChange={e => setCrewEdit({ ...crewEdit, reason: e.target.value })} rows={3} disabled={paid}
                    placeholder="Mis. salah pilih driver di rencana, yang jalan sebenarnya Budi"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
                <button onClick={() => setCrewEdit(null)} disabled={crewSaving} className="px-3 py-1.5 text-sm text-slate-600 hover:underline">Batal</button>
                <button onClick={submitCrewEdit} disabled={!canSubmit}
                  className="px-3 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-50">
                  {crewSaving ? 'Menyimpan...' : 'Simpan Koreksi'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {supplierDel && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => !supplierSaving && setSupplierDel(null)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-800">Hapus Belanja &quot;{supplierDel.task.delivery_routes?.name}&quot;</h2>
                <p className="text-xs text-slate-500">
                  {new Date(supplierDel.plan.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {supplierDel.plan.vehicles?.name} · {supplierDel.plan.driver?.full_name}
                </p>
              </div>
              <button onClick={() => setSupplierDel(null)} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Tugas belanja ini dan upah ritasenya (driver{supplierDel.plan.helper ? ' & kenek' : ''}) akan dihapus. Tidak bisa kalau upahnya sudah dibayar.
              </p>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Alasan (wajib)</label>
                <textarea value={supplierDel.reason} onChange={e => setSupplierDel({ ...supplierDel, reason: e.target.value })} rows={3}
                  placeholder="Mis. belanja tidak jadi, salah tekan selesai"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
              <button onClick={() => setSupplierDel(null)} disabled={supplierSaving} className="px-3 py-1.5 text-sm text-slate-600 hover:underline">Batal</button>
              <button onClick={submitSupplierDel} disabled={supplierDel.reason.trim().length < 5 || supplierSaving}
                className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition disabled:opacity-50">
                {supplierSaving ? 'Menghapus...' : 'Hapus Belanja'}
              </button>
            </div>
          </div>
        </div>
      )}

      {visitDetail && (
        <RincianKunjunganModal planStoreId={visitDetail.id} trip={visitDetail.trip} onClose={() => setVisitDetail(null)} />
      )}
    </div>
  )
}
