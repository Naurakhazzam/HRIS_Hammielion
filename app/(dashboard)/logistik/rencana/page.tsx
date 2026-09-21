'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'

type Vehicle = { id: string; name: string; plate_number: string | null }
type Route = { id: string; name: string }
type Employee = { id: string; full_name: string }

type Plan = {
  id: string
  plan_date: string
  status: string
  vehicles: { name: string } | null
  delivery_routes: { name: string } | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600' },
  ready: { label: 'Siap Kirim', className: 'bg-blue-100 text-blue-700' },
  departed: { label: 'Berjalan', className: 'bg-amber-100 text-amber-700' },
  closing: { label: 'Menuju Garasi', className: 'bg-purple-100 text-purple-700' },
  completed: { label: 'Selesai', className: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Dibatalkan', className: 'bg-red-100 text-red-600' },
}

export default function RencanaPengirimanPage() {
  const supabase = createClient()
  const [canManage, setCanManage] = useState(false)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Employee[]>([])
  const [helpers, setHelpers] = useState<Employee[]>([])

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ vehicle_id: '', route_id: '', driver_id: '', helper_id: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (userData) {
        setMyEmployeeId(userData.employee_id || '')
        if (userData.role === 'owner') {
          setCanManage(true)
        } else if (userData.employee_id) {
          const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', userData.employee_id).single()
          setCanManage((emp as any)?.positions?.name === 'Kepala Gudang')
        }
      }
    }
    await Promise.all([fetchPlans(), fetchMasterData()])
    setLoading(false)
  }

  async function fetchPlans() {
    const { data, error } = await supabase
      .from('logistics_delivery_plans')
      .select(`
        id, plan_date, status,
        vehicles(name),
        delivery_routes(name),
        driver:employees!logistics_delivery_plans_driver_id_fkey(full_name),
        helper:employees!logistics_delivery_plans_helper_id_fkey(full_name)
      `)
      .order('plan_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) showMessage('error', 'Gagal memuat rencana: ' + error.message)
    else setPlans((data as unknown as Plan[]) || [])
  }

  async function fetchMasterData() {
    const { data: vData } = await supabase.from('vehicles').select('id, name, plate_number').eq('is_active', true).order('name')
    if (vData) setVehicles(vData)
    const { data: rData } = await supabase.from('delivery_routes').select('id, name').eq('is_active', true).order('name')
    if (rData) setRoutes(rData)

    // Termasuk karyawan yang merangkap Driver (can_drive=true) — sama seperti Penggajian Driver.
    const { data: drvData } = await supabase.from('employees').select('id, full_name')
      .or('employee_type.eq.driver,can_drive.eq.true').eq('is_active', true)
    if (drvData) setDrivers(drvData)

    const { data: allPerm } = await supabase.from('employees').select('id, full_name, departments(name)')
      .eq('employee_type', 'permanent').eq('is_active', true)
    const { data: helperDrivers } = await supabase.from('employees').select('id, full_name')
      .eq('employee_type', 'driver').eq('can_help', true).eq('is_active', true)
    if (allPerm) {
      const gudangWorkers = (allPerm as any[]).filter(p => {
        const dept = Array.isArray(p.departments) ? p.departments[0] : p.departments
        return dept?.name === 'Team Gudang'
      })
      const toEmployee = (arr: any[]) => arr.map(p => ({ id: p.id, full_name: p.full_name }))
      const base = gudangWorkers.length > 0 ? toEmployee(gudangWorkers) : toEmployee(allPerm)
      setHelpers([...base, ...(helperDrivers || [])])
    }
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (form.helper_id && form.helper_id === form.driver_id) {
      showMessage('error', 'Driver dan Kenek tidak boleh orang yang sama.')
      return
    }
    setSubmitting(true)
    const { data, error } = await supabase.from('logistics_delivery_plans').insert({
      plan_date: todayLocalStr(),
      vehicle_id: form.vehicle_id,
      route_id: form.route_id,
      driver_id: form.driver_id,
      helper_id: form.helper_id || null,
      created_by: myEmployeeId,
    }).select('id').single()

    if (error || !data) {
      showMessage('error', 'Gagal membuat rencana: ' + error?.message)
      setSubmitting(false)
      return
    }
    window.location.href = `/logistik/rencana/${data.id}`
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Rencana Pengiriman</h1>
          <p className="text-sm text-slate-500">Susun rencana kirim harian: mobil, ritase, driver, kenek, dan daftar toko.</p>
        </div>
        {canManage && (
          <button onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            {showForm ? 'Batal' : '+ Buat Rencana Baru'}
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {!loading && !canManage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-6">
          Cuma Kepala Gudang atau Owner yang bisa membuat rencana pengiriman.
        </div>
      )}

      {showForm && canManage && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Buat Rencana Baru</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Tanggal</label>
              <div className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm text-slate-500">
                {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Mobil <span className="text-red-500">*</span></label>
              <select required value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Pilih Mobil --</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} {v.plate_number ? `(${v.plate_number})` : ''}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Ritase <span className="text-red-500">*</span></label>
              <select required value={form.route_id} onChange={e => setForm({ ...form, route_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Pilih Ritase --</option>
                {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Driver <span className="text-red-500">*</span></label>
              <select required value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Pilih Driver --</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Kenek (Opsional)</label>
              <select value={form.helper_id} onChange={e => setForm({ ...form, helper_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Tanpa Kenek --</option>
                {helpers.map(h => <option key={h.id} value={h.id}>{h.full_name}</option>)}
              </select>
            </div>
            <div className="lg:col-span-4 flex justify-end pt-2">
              <button type="submit" disabled={submitting}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Membuat...' : 'Buat & Susun Toko →'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Mobil</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Ritase</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Driver</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kenek</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">Memuat data...</td></tr>
            ) : plans.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada rencana pengiriman.</td></tr>
            ) : plans.map(p => {
              const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.draft
              return (
                <tr key={p.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(p.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-3 text-sm text-slate-800">{p.vehicles?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-800">{p.delivery_routes?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-800">{p.driver?.full_name ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{p.helper?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Link href={`/logistik/rencana/${p.id}`} className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Detail</Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
