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
  delivery_routes: { name: string } | null
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
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
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

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = `${filterMonth}-01`
    const endDate = localDateStr(new Date(year, month, 0))

    const { data: planData } = await supabase
      .from('logistics_delivery_plans')
      .select(`
        id, plan_date, status, box_photo_url, garage_photo_url, needs_refuel, refuel_amount, current_target_store_id,
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
            .select('plan_store_id, item_name, ordered_item_name, disposition, owner:branches(name)').in('plan_store_id', incIds).order('created_at')
          type IncRow = { plan_store_id: string; item_name: string; ordered_item_name: string | null; disposition: string; owner: { name: string } | null }
          const incBy: Record<string, string[]> = {}
          for (const r of (incRows as unknown as IncRow[]) || []) {
            ;(incBy[r.plan_store_id] ??= []).push(`${r.item_name}${r.ordered_item_name ? ` (seharusnya ${r.ordered_item_name})` : ''} · milik ${r.owner?.name ?? '-'} · ${r.disposition === 'dibawa_pulang' ? '↩️ dibawa pulang' : '🛒 dibeli toko'}`)
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
        .select('id, plan_id, status, notes, proof_photo_url, resolved_at, delivery_routes(name)')
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
    } else {
      setStoresByPlan({})
      setSupplierTasksByPlan({})
      setReturnsByPlan({})
      setReturnItemsByReturn({})
    }
    setLoading(false)
  }, [filterMonth, supabase])

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

  const allStores = Object.values(storesByPlan).flat()
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
  const visiblePlans = onlyUnverified ? plans.filter(p => unverifiedPlanIds.has(p.id)) : plans

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
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
              {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
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
              {plans.length === 0 ? 'Belum ada trip selesai di periode ini.' : 'Semua uang tunai di periode ini sudah diverifikasi. 👍'}
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
                                s.id === p.current_target_store_id ? (
                                  <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium animate-pulse">🚗 Sedang dalam perjalanan menuju toko ini</span>
                                ) : (
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
                <p className="text-xs text-slate-500">{detailStores.length} toko · periode {monthOptions.find(m => m.value === filterMonth)?.label}</p>
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

      {visitDetail && (
        <RincianKunjunganModal planStoreId={visitDetail.id} trip={visitDetail.trip} onClose={() => setVisitDetail(null)} />
      )}
    </div>
  )
}
