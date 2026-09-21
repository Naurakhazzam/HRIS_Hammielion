'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Plan = {
  id: string
  plan_date: string
  status: string
  vehicle_id: string
  route_id: string
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
}

type PlanStore = {
  id: string
  store_id: string
  sequence_order: number
  status: string
  logistics_stores: { name: string; address: string | null } | null
}

type Store = { id: string; name: string }

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', ready: 'Siap Kirim', departed: 'Berjalan',
  closing: 'Menuju Garasi', completed: 'Selesai', cancelled: 'Dibatalkan',
}

export default function RencanaDetailPage() {
  const supabase = createClient()
  const router = useRouter()
  const params = useParams<{ id: string }>()

  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [planStores, setPlanStores] = useState<PlanStore[]>([])
  const [allStores, setAllStores] = useState<Store[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [hasRateConfig, setHasRateConfig] = useState<boolean | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const editable = !!plan && ['draft', 'ready'].includes(plan.status)

  const fetchAll = useCallback(async () => {
    const { data: planData, error } = await supabase
      .from('logistics_delivery_plans')
      .select(`
        id, plan_date, status, vehicle_id, route_id,
        vehicles(name, plate_number),
        delivery_routes(name),
        driver:employees!logistics_delivery_plans_driver_id_fkey(full_name),
        helper:employees!logistics_delivery_plans_helper_id_fkey(full_name)
      `)
      .eq('id', params.id).single()

    if (error || !planData) { showMessage('error', 'Rencana tidak ditemukan.'); setLoading(false); return }
    const p = planData as unknown as Plan
    setPlan(p)

    const { data: rate } = await supabase.from('driver_rate_configs').select('id')
      .eq('vehicle_id', p.vehicle_id).eq('route_id', p.route_id).maybeSingle()
    setHasRateConfig(!!rate)

    const { data: psData } = await supabase.from('logistics_plan_stores')
      .select('id, store_id, sequence_order, status, logistics_stores(name, address)')
      .eq('plan_id', params.id).order('sequence_order')
    setPlanStores((psData as unknown as PlanStore[]) || [])

    const { data: storeData } = await supabase.from('logistics_stores').select('id, name').eq('is_active', true).order('name')
    setAllStores(storeData || [])

    setLoading(false)
  }, [params.id, supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
        if (userData) {
          setMyEmployeeId(userData.employee_id || '')
          if (userData.role === 'owner') setCanManage(true)
          else if (userData.employee_id) {
            const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', userData.employee_id).single()
            setCanManage((emp as any)?.positions?.name === 'Kepala Gudang')
          }
        }
      }
      await fetchAll()
    }
    init()
  }, [fetchAll, supabase])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  const availableStores = allStores.filter(s => !planStores.some(ps => ps.store_id === s.id))

  async function handleAddStore(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedStoreId) return
    const nextOrder = planStores.length > 0 ? Math.max(...planStores.map(ps => ps.sequence_order)) + 1 : 1
    const { error } = await supabase.from('logistics_plan_stores').insert({
      plan_id: params.id, store_id: selectedStoreId, sequence_order: nextOrder,
    })
    if (error) showMessage('error', 'Gagal menambah toko: ' + error.message)
    else { setSelectedStoreId(''); fetchAll() }
  }

  async function handleRemoveStore(ps: PlanStore) {
    if (!confirm(`Hapus "${ps.logistics_stores?.name}" dari rencana ini?`)) return
    const { error } = await supabase.from('logistics_plan_stores').delete().eq('id', ps.id)
    if (error) showMessage('error', 'Gagal menghapus toko: ' + error.message)
    else fetchAll()
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= planStores.length) return
    const a = planStores[index]
    const b = planStores[target]
    await supabase.from('logistics_plan_stores').update({ sequence_order: b.sequence_order }).eq('id', a.id)
    await supabase.from('logistics_plan_stores').update({ sequence_order: a.sequence_order }).eq('id', b.id)
    fetchAll()
  }

  async function handleSiapKirim() {
    if (planStores.length === 0) { showMessage('error', 'Tambahkan minimal satu toko dulu.'); return }
    if (!hasRateConfig) { showMessage('error', 'Tarif untuk kombinasi Mobil dan Ritase ini belum disetup. Setup dulu di Penggajian Driver → Tarif & Mobil Driver.'); return }
    setSubmitting(true)
    const { error } = await supabase.from('logistics_delivery_plans').update({
      status: 'ready', confirmed_by: myEmployeeId, confirmed_at: new Date().toISOString(),
    }).eq('id', params.id)
    if (error) showMessage('error', 'Gagal konfirmasi: ' + error.message)
    else { showMessage('success', 'Rencana ditandai Siap Kirim.'); fetchAll() }
    setSubmitting(false)
  }

  async function handleCancel() {
    if (!confirm('Batalkan rencana pengiriman ini?')) return
    setSubmitting(true)
    const { error } = await supabase.from('logistics_delivery_plans').update({
      status: 'cancelled', cancelled_by: myEmployeeId, cancelled_at: new Date().toISOString(),
    }).eq('id', params.id)
    if (error) showMessage('error', 'Gagal membatalkan: ' + error.message)
    else { showMessage('success', 'Rencana dibatalkan.'); router.push('/logistik/rencana') }
    setSubmitting(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>
  if (!plan) return <div className="text-center py-12 text-slate-500">Rencana tidak ditemukan.</div>

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/logistik/rencana" className="text-sm text-blue-600 hover:underline">← Kembali ke Daftar Rencana</Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">Rencana Pengiriman</h1>
        </div>
        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">{STATUS_LABEL[plan.status]}</span>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><p className="text-slate-400 text-xs uppercase mb-0.5">Tanggal</p><p className="font-medium text-slate-800">{new Date(plan.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</p></div>
          <div><p className="text-slate-400 text-xs uppercase mb-0.5">Mobil</p><p className="font-medium text-slate-800">{plan.vehicles?.name} {plan.vehicles?.plate_number ? `(${plan.vehicles.plate_number})` : ''}</p></div>
          <div><p className="text-slate-400 text-xs uppercase mb-0.5">Ritase</p><p className="font-medium text-slate-800">{plan.delivery_routes?.name}</p></div>
          <div><p className="text-slate-400 text-xs uppercase mb-0.5">Driver / Kenek</p><p className="font-medium text-slate-800">{plan.driver?.full_name} {plan.helper?.full_name ? `/ ${plan.helper.full_name}` : ''}</p></div>
        </div>
        {hasRateConfig === false && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠ Tarif untuk kombinasi Mobil + Ritase ini belum disetup — rencana tidak bisa ditandai "Siap Kirim" sampai tarifnya diatur di Penggajian Driver → Tarif &amp; Mobil Driver.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">Daftar Toko ({planStores.length})</span>
        </div>
        {planStores.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Belum ada toko ditambahkan.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {planStores.map((ps, i) => (
              <div key={ps.id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{ps.logistics_stores?.name}</p>
                  {ps.logistics_stores?.address && <p className="text-xs text-slate-400 truncate">{ps.logistics_stores.address}</p>}
                </div>
                {editable && canManage && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => handleMove(i, -1)} disabled={i === 0} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded disabled:opacity-30">↑</button>
                    <button onClick={() => handleMove(i, 1)} disabled={i === planStores.length - 1} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded disabled:opacity-30">↓</button>
                    <button onClick={() => handleRemoveStore(ps)} className="w-7 h-7 flex items-center justify-center text-red-400 hover:bg-red-50 rounded">✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editable && canManage && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
          <form onSubmit={handleAddStore} className="flex gap-2">
            <select value={selectedStoreId} onChange={e => setSelectedStoreId(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">-- Pilih Toko untuk Ditambahkan --</option>
              {availableStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="submit" disabled={!selectedStoreId}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">+ Tambah</button>
          </form>
          {availableStores.length === 0 && allStores.length === 0 && (
            <p className="text-xs text-slate-400 mt-2">Belum ada toko di Master Toko. <Link href="/logistik/toko" className="text-blue-600 hover:underline">Tambah dulu di sini</Link>.</p>
          )}
        </div>
      )}

      {editable && canManage && (
        <div className="flex justify-end gap-3">
          <button onClick={handleCancel} disabled={submitting}
            className="px-5 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition disabled:opacity-50">
            Batalkan Rencana
          </button>
          {plan.status === 'draft' && (
            <button onClick={handleSiapKirim} disabled={submitting}
              className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
              {submitting ? 'Memproses...' : 'Tandai Siap Kirim'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
