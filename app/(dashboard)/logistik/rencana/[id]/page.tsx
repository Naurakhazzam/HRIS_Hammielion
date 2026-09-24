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
  driver_id: string
  helper_id: string | null
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
}

type Employee = { id: string; full_name: string }

type PlanStore = {
  id: string
  store_id: string
  sequence_order: number
  status: string
  logistics_stores: { name: string; address: string | null } | null
}

type Store = { id: string; name: string }

type PlanSupplierTask = {
  id: string
  supplier_id: string
  status: string
  notes: string | null
  suppliers: { name: string } | null
}

type Supplier = { id: string; name: string }

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
  const [storeSearchText, setStoreSearchText] = useState('')
  const [supplierTasks, setSupplierTasks] = useState<PlanSupplierTask[]>([])
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([])
  const [supplierSearchText, setSupplierSearchText] = useState('')
  const [supplierTaskNotes, setSupplierTaskNotes] = useState('')
  const [hasRateConfig, setHasRateConfig] = useState<boolean | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Ganti Driver/Kenek kalau salah pilih -- database (RLS) sudah mengizinkan Kepala Gudang/
  // Owner update plan kapan saja, tidak dibatasi status, jadi ini murni tampilan. Sengaja
  // TIDAK diizinkan lagi setelah trip benar-benar selesai/dibatalkan (completed/cancelled) --
  // di titik itu upah sudah dihitung berdasarkan driver_id/helper_id saat itu, mengubahnya lagi
  // cuma akan bikin data tercatat tidak sinkron dengan yang sudah dibayar.
  const [drivers, setDrivers] = useState<Employee[]>([])
  const [helpers, setHelpers] = useState<Employee[]>([])
  const [editingAssignment, setEditingAssignment] = useState(false)
  const [editDriverId, setEditDriverId] = useState('')
  const [editHelperId, setEditHelperId] = useState('')
  const [assignmentSaving, setAssignmentSaving] = useState(false)

  const editable = !!plan && ['draft', 'ready'].includes(plan.status)
  // Trip yang sudah berjalan (Berjalan/Menuju Garasi) masih boleh dikoreksi Kepala Gudang/Owner
  // kalau ada salah pilih -- beda dari `editable` di atas yang membuka SEMUA kontrol (termasuk
  // urutan toko, Batalkan Rencana, dst) yang memang cuma masuk akal sebelum berangkat.
  const canEditActive = !!plan && canManage && ['departed', 'closing'].includes(plan.status)

  const fetchAll = useCallback(async () => {
    const { data: planData, error } = await supabase
      .from('logistics_delivery_plans')
      .select(`
        id, plan_date, status, vehicle_id, route_id, driver_id, helper_id,
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

    const { data: taskData } = await supabase.from('logistics_plan_supplier_tasks')
      .select('id, supplier_id, status, notes, suppliers(name)')
      .eq('plan_id', params.id).order('created_at')
    setSupplierTasks((taskData as unknown as PlanSupplierTask[]) || [])

    const { data: supplierData } = await supabase.from('suppliers').select('id, name').eq('is_active', true).order('name')
    setAllSuppliers(supplierData || [])

    // Sama persis kondisinya dengan dropdown Driver/Kenek di /logistik/rencana (halaman daftar)
    // -- driver "asli" (employee_type='driver') belum tentu can_drive=true, begitu juga
    // sebaliknya untuk karyawan yang cuma merangkap.
    const { data: drvData } = await supabase.from('employees').select('id, full_name')
      .or('employee_type.eq.driver,can_drive.eq.true').eq('is_active', true).order('full_name')
    setDrivers(drvData || [])
    const { data: allPerm } = await supabase.from('employees').select('id, full_name, departments(name)')
      .eq('employee_type', 'permanent').eq('is_active', true)
    const { data: helperDrivers } = await supabase.from('employees').select('id, full_name')
      .eq('employee_type', 'driver').eq('can_help', true).eq('is_active', true)
    if (allPerm) {
      const gudangWorkers = (allPerm as any[]).filter(pw => {
        const dept = Array.isArray(pw.departments) ? pw.departments[0] : pw.departments
        return dept?.name === 'Team Gudang'
      })
      const toEmployee = (arr: any[]) => arr.map(pw => ({ id: pw.id, full_name: pw.full_name }))
      const base = gudangWorkers.length > 0 ? toEmployee(gudangWorkers) : toEmployee(allPerm)
      setHelpers([...base, ...(helperDrivers || [])])
    }

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

  function openEditAssignment() {
    if (!plan) return
    setEditDriverId(plan.driver_id)
    setEditHelperId(plan.helper_id || '')
    setEditingAssignment(true)
  }

  async function submitEditAssignment() {
    if (!plan || !editDriverId) return
    if (editHelperId && editHelperId === editDriverId) { showMessage('error', 'Driver dan Kenek tidak boleh orang yang sama.'); return }
    setAssignmentSaving(true)
    const { error } = await supabase.from('logistics_delivery_plans').update({
      driver_id: editDriverId, helper_id: editHelperId || null,
    }).eq('id', plan.id)
    if (error) showMessage('error', 'Gagal mengubah Driver/Kenek: ' + error.message)
    else { showMessage('success', 'Driver/Kenek berhasil diperbarui.'); setEditingAssignment(false); fetchAll() }
    setAssignmentSaving(false)
  }

  const availableStores = allStores.filter(s => !planStores.some(ps => ps.store_id === s.id))
  const availableSuppliers = allSuppliers.filter(s => !supplierTasks.some(t => t.supplier_id === s.id && t.status === 'pending'))
  // Ketik nama toko, cocokkan persis (case-insensitive) ke saran yang muncul dari datalist —
  // supaya Kepala Gudang tidak perlu scroll dropdown ratusan toko satu-satu.
  const matchedStore = availableStores.find(s => s.name.trim().toLowerCase() === storeSearchText.trim().toLowerCase())

  async function handleAddStore(e: React.FormEvent) {
    e.preventDefault()
    if (!matchedStore) { showMessage('error', 'Toko tidak ditemukan. Ketik nama toko lalu pilih dari saran yang muncul.'); return }
    const nextOrder = planStores.length > 0 ? Math.max(...planStores.map(ps => ps.sequence_order)) + 1 : 1
    const { error } = await supabase.from('logistics_plan_stores').insert({
      plan_id: params.id, store_id: matchedStore.id, sequence_order: nextOrder,
    })
    if (error) showMessage('error', 'Gagal menambah toko: ' + error.message)
    else { setStoreSearchText(''); fetchAll() }
  }

  async function handleRemoveStore(ps: PlanStore) {
    if (!confirm(`Hapus "${ps.logistics_stores?.name}" dari rencana ini?`)) return
    const { error } = await supabase.from('logistics_plan_stores').delete().eq('id', ps.id)
    if (error) showMessage('error', 'Gagal menghapus toko: ' + error.message)
    else fetchAll()
  }

  const matchedSupplier = availableSuppliers.find(s => s.name.trim().toLowerCase() === supplierSearchText.trim().toLowerCase())

  async function handleAddSupplierTask(e: React.FormEvent) {
    e.preventDefault()
    if (!matchedSupplier) { showMessage('error', 'Supplier tidak ditemukan. Ketik nama supplier lalu pilih dari saran yang muncul.'); return }
    const { error } = await supabase.from('logistics_plan_supplier_tasks').insert({
      plan_id: params.id, supplier_id: matchedSupplier.id, notes: supplierTaskNotes.trim() || null, created_by: myEmployeeId,
    })
    if (error) showMessage('error', 'Gagal menambah tugas belanja: ' + error.message)
    else { setSupplierSearchText(''); setSupplierTaskNotes(''); fetchAll() }
  }

  async function handleRemoveSupplierTask(t: PlanSupplierTask) {
    if (!confirm(`Hapus tugas belanja ke "${t.suppliers?.name}" dari rencana ini?`)) return
    const { error } = await supabase.from('logistics_plan_supplier_tasks').delete().eq('id', t.id)
    if (error) showMessage('error', 'Gagal menghapus tugas: ' + error.message)
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
          <div>
            <p className="text-slate-400 text-xs uppercase mb-0.5">Driver / Kenek</p>
            <div className="flex items-center gap-2">
              <p className="font-medium text-slate-800">{plan.driver?.full_name} {plan.helper?.full_name ? `/ ${plan.helper.full_name}` : ''}</p>
              {canManage && !['completed', 'cancelled'].includes(plan.status) && !editingAssignment && (
                <button onClick={openEditAssignment} className="text-xs text-blue-600 hover:underline shrink-0">Ubah</button>
              )}
            </div>
          </div>
        </div>

        {editingAssignment && (
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Driver</label>
              <select value={editDriverId} onChange={e => setEditDriverId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Pilih Driver --</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Kenek (Opsional)</label>
              <select value={editHelperId} onChange={e => setEditHelperId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Tanpa Kenek --</option>
                {helpers.map(h => <option key={h.id} value={h.id}>{h.full_name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
              <button onClick={() => setEditingAssignment(false)} className="px-4 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
              <button onClick={submitEditAssignment} disabled={!editDriverId || assignmentSaving}
                className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                {assignmentSaving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        )}

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
                {ps.status !== 'pending' && (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${ps.status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {ps.status === 'delivered' ? 'Terkirim' : 'Gagal'}
                  </span>
                )}
                {editable && canManage && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => handleMove(i, -1)} disabled={i === 0} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded disabled:opacity-30">↑</button>
                    <button onClick={() => handleMove(i, 1)} disabled={i === planStores.length - 1} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded disabled:opacity-30">↓</button>
                    <button onClick={() => handleRemoveStore(ps)} className="w-7 h-7 flex items-center justify-center text-red-400 hover:bg-red-50 rounded">✕</button>
                  </div>
                )}
                {/* Trip sudah berjalan — cuma toko yang BELUM diproses (pending) yang boleh
                    dihapus (salah masuk daftar). Toko yang sudah Terkirim/Gagal dikunci,
                    supaya histori pengiriman & foto buktinya tidak bisa dihapus begitu saja. */}
                {!editable && canEditActive && ps.status === 'pending' && (
                  <button onClick={() => handleRemoveStore(ps)} className="w-7 h-7 flex items-center justify-center text-red-400 hover:bg-red-50 rounded shrink-0">✕</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(editable || canEditActive) && canManage && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
          {canEditActive && <p className="text-xs text-amber-600 mb-2">⚠ Trip sudah berjalan — toko baru langsung ikut jadi bagian trip ini, driver/kenek bisa langsung memprosesnya.</p>}
          <form onSubmit={handleAddStore} className="flex gap-2">
            <input type="text" list="available-stores-datalist" value={storeSearchText}
              onChange={e => setStoreSearchText(e.target.value)}
              placeholder="Ketik nama toko untuk ditambahkan..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
            <datalist id="available-stores-datalist">
              {availableStores.map(s => <option key={s.id} value={s.name} />)}
            </datalist>
            <button type="submit" disabled={!matchedStore}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">+ Tambah</button>
          </form>
          {availableStores.length === 0 && allStores.length === 0 && (
            <p className="text-xs text-slate-400 mt-2">Belum ada toko di Master Toko. <Link href="/logistik/toko" className="text-blue-600 hover:underline">Tambah dulu di sini</Link>.</p>
          )}
        </div>
      )}

      {/* Tugas Belanja Supplier — bebas dikombinasikan dengan toko, tidak dipaksa urutan
          (sebelum atau sesudah kirim ke toko, terserah driver di lapangan). Bisa ditambahkan
          juga ke trip yang sudah berjalan, sama seperti toko. */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <span className="text-sm font-bold text-slate-700">🛒 Tugas Belanja Supplier ({supplierTasks.length})</span>
        </div>
        {supplierTasks.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Belum ada tugas belanja supplier.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {supplierTasks.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{t.suppliers?.name}</p>
                  {t.notes && <p className="text-xs text-slate-400 truncate">{t.notes}</p>}
                </div>
                {t.status === 'done' ? (
                  <span className="text-xs px-2 py-0.5 rounded font-medium shrink-0 bg-green-100 text-green-700">Selesai</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded font-medium shrink-0 bg-slate-100 text-slate-500">Belum Diproses</span>
                )}
                {(editable || canEditActive) && canManage && t.status === 'pending' && (
                  <button onClick={() => handleRemoveSupplierTask(t)} className="w-7 h-7 flex items-center justify-center text-red-400 hover:bg-red-50 rounded shrink-0">✕</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(editable || canEditActive) && canManage && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
          {canEditActive && <p className="text-xs text-amber-600 mb-2">⚠ Trip sudah berjalan — tugas belanja baru langsung ikut jadi bagian trip ini, driver/kenek bisa langsung memprosesnya.</p>}
          <form onSubmit={handleAddSupplierTask} className="flex flex-col sm:flex-row gap-2">
            <input type="text" list="available-suppliers-datalist" value={supplierSearchText}
              onChange={e => setSupplierSearchText(e.target.value)}
              placeholder="Ketik nama supplier untuk ditambahkan..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
            <datalist id="available-suppliers-datalist">
              {availableSuppliers.map(s => <option key={s.id} value={s.name} />)}
            </datalist>
            <input type="text" value={supplierTaskNotes} onChange={e => setSupplierTaskNotes(e.target.value)}
              placeholder="Catatan (opsional)"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
            <button type="submit" disabled={!matchedSupplier}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 whitespace-nowrap">+ Tambah Tugas</button>
          </form>
          {availableSuppliers.length === 0 && allSuppliers.length === 0 && (
            <p className="text-xs text-slate-400 mt-2">Belum ada data Supplier. <Link href="/keuangan/pembelian/supplier" className="text-blue-600 hover:underline">Tambah dulu di sini</Link>.</p>
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
