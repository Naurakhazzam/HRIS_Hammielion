'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePhotoLightbox } from '@/components/PhotoLightbox'

type PlanSummary = {
  id: string
  plan_date: string
  status: string
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
}

type PendingPackage = {
  id: string
  photo_url: string
  caption: string
  loading_id: string
  logistics_central_loadings: { logistics_stores: { name: string } | null } | null
}

type TakenPackage = {
  id: string
  photo_url: string
  caption: string
  taken_at: string | null
  logistics_central_loadings: { logistics_stores: { name: string } | null } | null
}

// Beda dari PendingPackage: ini bukan paket fisik yang sudah ada di Toko Pusat, tapi sekadar
// PENANDA "toko X ada retur menunggu diambil" -- barangnya sendiri masih di toko konsumen,
// baru akan dipegang driver nanti pas mampir ke toko itu (lihat migration 058).
type PendingReturn = {
  id: string
  store_id: string
  note: string | null
  logistics_stores: { name: string } | null
}

const fmtDateTime = (s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function JemputTokoPusatPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingPackage[]>([])
  const [taken, setTaken] = useState<TakenPackage[]>([])
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([])
  const [claimingReturnId, setClaimingReturnId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const fetchPlans = useCallback(async (empId: string) => {
    const { data } = await supabase
      .from('logistics_delivery_plans')
      .select('id, plan_date, status, vehicles(name, plate_number), delivery_routes(name)')
      .or(`driver_id.eq.${empId},helper_id.eq.${empId}`)
      .in('status', ['ready', 'departed'])
      .order('plan_date', { ascending: false })
    const rows = (data as unknown as PlanSummary[]) || []
    setPlans(rows)
    if (rows.length === 1) setSelectedPlanId(rows[0].id)
  }, [supabase])

  const fetchPending = useCallback(async () => {
    const { data } = await supabase
      .from('logistics_central_loading_packages')
      .select('id, photo_url, caption, loading_id, logistics_central_loadings!inner(status, logistics_stores(name))')
      .eq('status', 'pending')
      .eq('logistics_central_loadings.status', 'selesai')
      // Kiriman jalur "Diantar Toko Pusat Sendiri" tidak boleh terlihat/diklaim driver.
      .eq('logistics_central_loadings.delivery_method', 'driver')
      .order('created_at')
    setPending((data as unknown as PendingPackage[]) || [])
  }, [supabase])

  const fetchPendingReturns = useCallback(async () => {
    const { data } = await supabase
      .from('logistics_store_returns')
      .select('id, store_id, note, logistics_stores(name)')
      .eq('status', 'menunggu')
      .order('flagged_at')
    setPendingReturns((data as unknown as PendingReturn[]) || [])
  }, [supabase])

  const fetchTaken = useCallback(async (empId: string, planId: string) => {
    const { data } = await supabase
      .from('logistics_central_loading_packages')
      .select('id, photo_url, caption, taken_at, logistics_central_loadings(logistics_stores(name)), plan_store_id, logistics_plan_stores!inner(plan_id)')
      .eq('taken_by', empId)
      .eq('logistics_plan_stores.plan_id', planId)
      .order('taken_at', { ascending: false })
    setTaken((data as unknown as TakenPackage[]) || [])
  }, [supabase])

  async function refresh() {
    await Promise.all([fetchPending(), fetchPendingReturns()])
    if (myEmployeeId) await fetchPlans(myEmployeeId)
    if (myEmployeeId && selectedPlanId) await fetchTaken(myEmployeeId, selectedPlanId)
  }

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: userData } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      const empId = userData?.employee_id || ''
      setMyEmployeeId(empId)
      if (empId) await fetchPlans(empId)
      await Promise.all([fetchPending(), fetchPendingReturns()])
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function run() { if (myEmployeeId && selectedPlanId) await fetchTaken(myEmployeeId, selectedPlanId) }
    run()
  }, [myEmployeeId, selectedPlanId, fetchTaken])

  async function handleClaim(pkg: PendingPackage) {
    if (!selectedPlanId) { showMessage('error', 'Pilih rencana/trip Anda dulu.'); return }
    setClaimingId(pkg.id)
    const { error } = await supabase.rpc('claim_central_loading_package', { p_package_id: pkg.id, p_plan_id: selectedPlanId })
    setClaimingId(null)
    if (error) { showMessage('error', 'Gagal mengambil: ' + error.message); return }
    const storeName = pkg.logistics_central_loadings?.logistics_stores?.name ?? 'toko tujuan'
    showMessage('success', `"${pkg.caption}" untuk ${storeName} berhasil diklaim — toko ini otomatis masuk ke rencana Anda.`)
    await refresh()
  }

  // Ambil barang retur beda dari klaim paket biasa -- barangnya belum di tangan driver sama
  // sekali, baru akan diambil nanti pas sampai di toko (prosesnya satu-per-satu di Jalankan
  // Pengiriman, lihat section "Tugas Retur" di sana).
  async function handleClaimReturn(ret: PendingReturn) {
    if (!selectedPlanId) { showMessage('error', 'Pilih rencana/trip Anda dulu.'); return }
    setClaimingReturnId(ret.id)
    const { error } = await supabase.rpc('claim_store_return', { p_return_id: ret.id, p_plan_id: selectedPlanId })
    setClaimingReturnId(null)
    if (error) { showMessage('error', 'Gagal mengambil tugas retur: ' + error.message); return }
    const storeName = ret.logistics_stores?.name ?? 'toko tujuan'
    showMessage('success', `Tugas ambil retur ${storeName} berhasil diklaim — muncul di kartu "Tugas Retur" di Jalankan Pengiriman (bukan daftar toko kirim). Catat barangnya di sana saat sampai di toko.`)
    await refresh()
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Jemput Toko Pusat</h1>
      <p className="text-sm text-slate-500 mb-6">Barang titipan dari Toko Pusat yang harus diambil sebelum/selama trip.</p>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {plans.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-6">
          Anda tidak punya rencana pengiriman aktif — pilih rencana dulu dari menu Pengiriman Logistik sebelum bisa klaim paket.
        </div>
      ) : plans.length > 1 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Klaim untuk rencana/trip mana?</label>
          <select value={selectedPlanId || ''} onChange={e => setSelectedPlanId(e.target.value || null)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">-- Pilih Rencana --</option>
            {plans.map(p => (
              <option key={p.id} value={p.id}>{p.vehicles?.name} — {p.delivery_routes?.name} ({new Date(p.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })})</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 text-sm text-slate-600">
          Klaim untuk: <span className="font-semibold text-slate-800">{plans[0].vehicles?.name} — {plans[0].delivery_routes?.name}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <p className="text-sm font-bold text-slate-700">📦 Belum Diambil ({pending.length})</p>
          <p className="text-xs text-slate-400 mt-0.5">Bebas ambil yang mana saja, tidak harus semua punya Anda.</p>
        </div>
        {pending.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Tidak ada paket yang menunggu diambil saat ini.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pending.map(pk => (
              <div key={pk.id} className="flex items-center gap-3 px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pk.photo_url} alt={pk.caption} onClick={() => openLightbox(pk.photo_url, pk.caption)}
                  className="w-14 h-14 object-cover rounded-lg border border-slate-200 shrink-0 cursor-zoom-in" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{pk.logistics_central_loadings?.logistics_stores?.name ?? '-'}</p>
                  <p className="text-xs text-slate-500 truncate">{pk.caption}</p>
                </div>
                <button onClick={() => handleClaim(pk)} disabled={!selectedPlanId || claimingId === pk.id}
                  className="shrink-0 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
                  {claimingId === pk.id ? 'Menyimpan...' : '✓ Saya Ambil'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingReturns.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden mb-6">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <p className="text-sm font-bold text-amber-800">↩️ Ada Retur Menunggu Diambil ({pendingReturns.length})</p>
            <p className="text-xs text-amber-600 mt-0.5">Barangnya masih di toko tujuan — nanti diambil & difoto satu-per-satu pas sampai di sana (lihat Jalankan Pengiriman).</p>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingReturns.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{r.logistics_stores?.name ?? '-'}</p>
                  {r.note && <p className="text-xs text-slate-500 truncate">{r.note}</p>}
                </div>
                <button onClick={() => handleClaimReturn(r)} disabled={!selectedPlanId || claimingReturnId === r.id}
                  className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
                  {claimingReturnId === r.id ? 'Menyimpan...' : '✓ Saya Ambil'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedPlanId && taken.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <p className="text-sm font-bold text-slate-700">✓ Sudah Saya Ambil ({taken.length})</p>
          </div>
          <div className="divide-y divide-slate-100">
            {taken.map(pk => (
              <div key={pk.id} className="flex items-center gap-3 px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pk.photo_url} alt={pk.caption} onClick={() => openLightbox(pk.photo_url, pk.caption)}
                  className="w-12 h-12 object-cover rounded-lg border border-slate-200 shrink-0 cursor-zoom-in opacity-80" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{pk.logistics_central_loadings?.logistics_stores?.name ?? '-'}</p>
                  <p className="text-xs text-slate-400 truncate">{pk.caption} · {pk.taken_at ? fmtDateTime(pk.taken_at) : '-'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
