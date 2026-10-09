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
  logistics_central_loadings: {
    nota_amount: number | null; origin: { name: string } | null; logistics_stores: { name: string } | null
    siblings: { status: string; taken_by: string | null; taken: { full_name: string } | null }[]
    postpone_count: number; last_postpone_reason: string | null
  } | null
}

type TakenPackage = {
  id: string
  photo_url: string
  caption: string
  taken_at: string | null
  logistics_central_loadings: { nota_amount: number | null; logistics_stores: { name: string } | null } | null
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')

const fmtDateTime =(s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

// Route tetap /logistik/jemput-toko-pusat, tapi sejak migrasi 068 isinya paket dari 4 cabang toko.
export default function JemputBarangCabangPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingPackage[]>([])
  const [taken, setTaken] = useState<TakenPackage[]>([])
  const [claimingId, setClaimingId] = useState<string | null>(null)
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
      .select('id, photo_url, caption, loading_id, logistics_central_loadings!inner(status, nota_amount, postpone_count, last_postpone_reason, origin:branches!logistics_central_loadings_origin_branch_id_fkey(name), logistics_stores(name), siblings:logistics_central_loading_packages(status, taken_by, taken:employees!logistics_central_loading_packages_taken_by_fkey(full_name)))')
      .eq('status', 'pending')
      .eq('logistics_central_loadings.status', 'selesai')
      // Kiriman jalur "Diantar Sendiri" tidak boleh terlihat/diklaim driver.
      .eq('logistics_central_loadings.delivery_method', 'driver')
      .order('created_at')
    setPending((data as unknown as PendingPackage[]) || [])
  }, [supabase])

  const fetchTaken = useCallback(async (empId: string, planId: string) => {
    const { data } = await supabase
      .from('logistics_central_loading_packages')
      .select('id, photo_url, caption, taken_at, logistics_central_loadings(nota_amount, logistics_stores(name)), plan_store_id, logistics_plan_stores!inner(plan_id)')
      .eq('taken_by', empId)
      .eq('logistics_plan_stores.plan_id', planId)
      .order('taken_at', { ascending: false })
    setTaken((data as unknown as TakenPackage[]) || [])
  }, [supabase])

  async function refresh() {
    await fetchPending()
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
      await fetchPending()
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

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Jemput Barang Cabang</h1>
      <p className="text-sm text-slate-500 mb-6">Barang titipan dari cabang toko (Toko Pusat, Toko Depan, Markas, Raja) yang harus diambil sebelum/selama trip.</p>

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
            {pending.map(pk => {
              const nota = pk.logistics_central_loadings?.nota_amount
              const sameNota = pending.filter(p => p.loading_id === pk.loading_id).length
              // Satu nota = satu driver selama tripnya berjalan (migrasi 085) -- beri tahu sebelum klik.
              const otherTakers = nota == null ? [] : [...new Set((pk.logistics_central_loadings?.siblings ?? [])
                .filter(sb => sb.status === 'diambil' && sb.taken_by !== myEmployeeId)
                .map(sb => sb.taken?.full_name ?? 'driver lain'))]
              return (
              <div key={pk.id} className="flex items-center gap-3 px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pk.photo_url} alt={pk.caption} onClick={() => openLightbox(pk.photo_url, pk.caption)}
                  className="w-14 h-14 object-cover rounded-lg border border-slate-200 shrink-0 cursor-zoom-in" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{pk.logistics_central_loadings?.logistics_stores?.name ?? '-'}</p>
                  <p className="text-xs text-slate-500 truncate">{pk.caption}</p>
                  <p className="text-xs text-blue-700 font-medium truncate">📍 Ambil di {pk.logistics_central_loadings?.origin?.name ?? '-'}</p>
                  {nota != null && (
                    <p className="text-xs text-emerald-700 font-semibold">
                      🧾 Nota {fmtRp(nota)}{sameNota > 1 ? ` · ${sameNota} paket satu nota, wajib dibawa semua` : ''}
                    </p>
                  )}
                  {(pk.logistics_central_loadings?.postpone_count ?? 0) > 0 && (
                    <p className="text-xs text-amber-700">
                      📅 Pernah ditunda {pk.logistics_central_loadings?.postpone_count}× — {pk.logistics_central_loadings?.last_postpone_reason ?? '-'}
                    </p>
                  )}
                  {otherTakers.length > 0 && (
                    <p className="text-xs text-amber-700">
                      🔒 Paket lain nota ini sudah dibawa {otherTakers.join(', ')} — selama tripnya masih jalan, hanya dia yang bisa mengambil.
                    </p>
                  )}
                </div>
                <button onClick={() => handleClaim(pk)} disabled={!selectedPlanId || claimingId === pk.id}
                  className="shrink-0 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
                  {claimingId === pk.id ? 'Menyimpan...' : '✓ Saya Ambil'}
                </button>
              </div>
              )
            })}
          </div>
        )}
      </div>

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
                  {pk.logistics_central_loadings?.nota_amount != null && (
                    <p className="text-xs text-emerald-700 font-medium">🧾 Nota {fmtRp(pk.logistics_central_loadings.nota_amount)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
