'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Vehicle = { id: string; name: string; plate_number: string | null; is_active: boolean }
type Route = { id: string; name: string }
type RateConfig = {
  id: string
  vehicle_id: string
  route_id: string
  vehicles: { name: string; plate_number: string } | null
  delivery_routes: { name: string } | null
  driver_rate_with_helper: number
  driver_rate_without_helper: number
  helper_rate: number
}

export default function SetupDriverPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [rates, setRates] = useState<RateConfig[]>([])

  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const supabase = createClient()

  // Form tambah mobil
  const [vehicleForm, setVehicleForm] = useState({ name: '', plate_number: '' })

  // Form tambah/edit tarif
  const [rateForm, setRateForm] = useState({
    vehicle_id: '',
    route_id: '',
    driver_rate_with_helper: '0',
    driver_rate_without_helper: '0',
    helper_rate: '0'
  })

  // Edit Mobil modal
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null)
  const [editVehicleForm, setEditVehicleForm] = useState({ name: '', plate_number: '' })
  const [editVehicleSubmitting, setEditVehicleSubmitting] = useState(false)

  // Edit Tarif modal
  const [editRate, setEditRate] = useState<RateConfig | null>(null)
  const [editRateForm, setEditRateForm] = useState({
    driver_rate_with_helper: '0',
    driver_rate_without_helper: '0',
    helper_rate: '0'
  })
  const [editRateSubmitting, setEditRateSubmitting] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const { data: routeData } = await supabase.from('delivery_routes').select('*').eq('is_active', true)
    if (!routeData || routeData.length === 0) {
      const defaultRoutes = [{ name: 'Garut' }, { name: 'Tasik Kota' }, { name: 'Banjar' }]
      await supabase.from('delivery_routes').insert(defaultRoutes)
      const { data: newRoutes } = await supabase.from('delivery_routes').select('*').eq('is_active', true)
      setRoutes(newRoutes || [])
    } else {
      setRoutes(routeData)
    }

    const { data: vData } = await supabase.from('vehicles').select('*').order('name')
    setVehicles(vData || [])

    const { data: rData } = await supabase
      .from('driver_rate_configs')
      .select('id, vehicle_id, route_id, driver_rate_with_helper, driver_rate_without_helper, helper_rate, vehicles(name, plate_number), delivery_routes(name)')
    setRates((rData as unknown as RateConfig[]) || [])

    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  // ── Tambah Mobil ──
  async function handleVehicleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('vehicles').insert([vehicleForm])
    if (error) {
      showMessage('error', 'Gagal menambah mobil: ' + error.message)
    } else {
      showMessage('success', 'Mobil berhasil ditambahkan.')
      setVehicleForm({ name: '', plate_number: '' })
      fetchData()
    }
  }

  // ── Edit Mobil ──
  function openEditVehicle(v: Vehicle) {
    setEditVehicle(v)
    setEditVehicleForm({ name: v.name, plate_number: v.plate_number || '' })
  }

  async function handleEditVehicleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editVehicle) return
    setEditVehicleSubmitting(true)
    const { error } = await supabase
      .from('vehicles')
      .update({ name: editVehicleForm.name, plate_number: editVehicleForm.plate_number || null })
      .eq('id', editVehicle.id)
    if (error) {
      showMessage('error', 'Gagal mengupdate mobil: ' + error.message)
    } else {
      showMessage('success', 'Data mobil berhasil diupdate.')
      setEditVehicle(null)
      fetchData()
    }
    setEditVehicleSubmitting(false)
  }

  // ── Hapus Mobil ──
  async function handleDeleteVehicle(vehicleId: string, vehicleName: string) {
    if (!confirm(`Hapus mobil "${vehicleName}"? Semua tarif untuk mobil ini juga akan terhapus.`)) return
    await supabase.from('driver_rate_configs').delete().eq('vehicle_id', vehicleId)
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId)
    if (error) {
      showMessage('error', 'Gagal menghapus mobil. Mobil ini mungkin sudah memiliki data trip.')
    } else {
      showMessage('success', `Mobil "${vehicleName}" berhasil dihapus.`)
      fetchData()
    }
  }

  // ── Tambah/Update Tarif ──
  async function handleRateSubmit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase
      .from('driver_rate_configs')
      .upsert({
        vehicle_id: rateForm.vehicle_id,
        route_id: rateForm.route_id,
        driver_rate_with_helper: parseFloat(rateForm.driver_rate_with_helper) || 0,
        driver_rate_without_helper: parseFloat(rateForm.driver_rate_without_helper) || 0,
        helper_rate: parseFloat(rateForm.helper_rate) || 0
      }, { onConflict: 'vehicle_id, route_id' })
    if (error) {
      showMessage('error', 'Gagal menyimpan tarif: ' + error.message)
    } else {
      showMessage('success', 'Tarif berhasil disimpan/diperbarui.')
      setRateForm({ vehicle_id: '', route_id: '', driver_rate_with_helper: '0', driver_rate_without_helper: '0', helper_rate: '0' })
      fetchData()
    }
  }

  // ── Edit Tarif ──
  function openEditRate(r: RateConfig) {
    setEditRate(r)
    setEditRateForm({
      driver_rate_with_helper: String(r.driver_rate_with_helper),
      driver_rate_without_helper: String(r.driver_rate_without_helper),
      helper_rate: String(r.helper_rate)
    })
  }

  async function handleEditRateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editRate) return
    setEditRateSubmitting(true)
    const { error } = await supabase
      .from('driver_rate_configs')
      .update({
        driver_rate_with_helper: parseFloat(editRateForm.driver_rate_with_helper) || 0,
        driver_rate_without_helper: parseFloat(editRateForm.driver_rate_without_helper) || 0,
        helper_rate: parseFloat(editRateForm.helper_rate) || 0
      })
      .eq('id', editRate.id)
    if (error) {
      showMessage('error', 'Gagal mengupdate tarif: ' + error.message)
    } else {
      showMessage('success', 'Tarif berhasil diupdate.')
      setEditRate(null)
      fetchData()
    }
    setEditRateSubmitting(false)
  }

  // ── Hapus Tarif ──
  async function handleDeleteRate(rateId: string) {
    if (!confirm('Hapus konfigurasi tarif ini?')) return
    const { error } = await supabase.from('driver_rate_configs').delete().eq('id', rateId)
    if (error) {
      showMessage('error', 'Gagal menghapus tarif: ' + error.message)
    } else {
      showMessage('success', 'Tarif berhasil dihapus.')
      fetchData()
    }
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Tarif & Mobil</h1>
        <p className="text-sm text-slate-500">Konfigurasi mobil operasional dan tarif ritase driver per rute.</p>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Kolom Kiri: Form */}
        <div className="lg:col-span-1 space-y-6">

          {/* Form Tambah Mobil */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Mobil Baru</h2>
            <form onSubmit={handleVehicleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Mobil <span className="text-red-500">*</span></label>
                <input
                  type="text" required placeholder="Cth: Box Engkel 1"
                  value={vehicleForm.name} onChange={(e) => setVehicleForm({ ...vehicleForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Plat</label>
                <input
                  type="text" placeholder="Cth: D 1234 XYZ"
                  value={vehicleForm.plate_number} onChange={(e) => setVehicleForm({ ...vehicleForm, plate_number: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <button type="submit" className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded shadow-sm transition">
                Simpan Mobil
              </button>
            </form>
          </div>

          {/* Form Atur Tarif */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Atur Tarif Ritase</h2>
            <form onSubmit={handleRateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mobil <span className="text-red-500">*</span></label>
                <select
                  required value={rateForm.vehicle_id} onChange={(e) => setRateForm({ ...rateForm, vehicle_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="">-- Pilih Mobil --</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} {v.plate_number ? `(${v.plate_number})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Rute <span className="text-red-500">*</span></label>
                <select
                  required value={rateForm.route_id} onChange={(e) => setRateForm({ ...rateForm, route_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="">-- Pilih Rute --</option>
                  {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Upah Driver (Tanpa Kenek) Rp</label>
                <input
                  type="number" required min="0" value={rateForm.driver_rate_without_helper}
                  onChange={(e) => setRateForm({ ...rateForm, driver_rate_without_helper: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Upah Driver (Dengan Kenek) Rp</label>
                <input
                  type="number" required min="0" value={rateForm.driver_rate_with_helper}
                  onChange={(e) => setRateForm({ ...rateForm, driver_rate_with_helper: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Upah Kenek Rp</label>
                <input
                  type="number" required min="0" value={rateForm.helper_rate}
                  onChange={(e) => setRateForm({ ...rateForm, helper_rate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition">
                Simpan Tarif
              </button>
            </form>
          </div>
        </div>

        {/* Kolom Kanan: Tabel */}
        <div className="lg:col-span-2 space-y-6">

          {/* Tabel Tarif Aktif */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-bold text-slate-800">Daftar Tarif Aktif</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Mobil</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Rute</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Tanpa Kenek</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Dgn Kenek</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Upah Kenek</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
                  ) : rates.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada konfigurasi tarif.</td></tr>
                  ) : (
                    rates.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-800">{r.vehicles?.name}</div>
                          <div className="text-xs text-slate-500">{r.vehicles?.plate_number || '-'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-blue-600">{r.delivery_routes?.name}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{formatRupiah(r.driver_rate_without_helper)}</td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{formatRupiah(r.driver_rate_with_helper)}</td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{formatRupiah(r.helper_rate)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditRate(r)}
                              className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteRate(r.id)}
                              className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition"
                            >
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Daftar Mobil */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-bold text-slate-800">Daftar Mobil Terdaftar</h2>
            </div>
            <div className="p-4">
              <div className="divide-y divide-slate-100">
                {vehicles.map(v => (
                  <div key={v.id} className="flex items-center justify-between py-2.5 px-1">
                    <div>
                      <span className="text-sm font-semibold text-slate-800">{v.name}</span>
                      <span className="text-xs text-slate-500 ml-2">{v.plate_number || 'Tanpa Plat'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditVehicle(v)}
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteVehicle(v.id, v.name)}
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
                {vehicles.length === 0 && !loading && (
                  <p className="text-sm text-slate-500 py-2">Belum ada mobil.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal Edit Mobil ── */}
      {editVehicle && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Mobil</h2>
              <form onSubmit={handleEditVehicleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nama Mobil <span className="text-red-500">*</span></label>
                  <input
                    type="text" required
                    value={editVehicleForm.name}
                    onChange={(e) => setEditVehicleForm({ ...editVehicleForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nomor Plat</label>
                  <input
                    type="text"
                    value={editVehicleForm.plate_number}
                    onChange={(e) => setEditVehicleForm({ ...editVehicleForm, plate_number: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Opsional"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setEditVehicle(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={editVehicleSubmitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                    {editVehicleSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Edit Tarif ── */}
      {editRate && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1 pb-2 border-b border-slate-100">Edit Tarif Ritase</h2>
              <p className="text-sm text-slate-500 mb-4">
                {editRate.vehicles?.name} → <span className="font-medium text-blue-600">{editRate.delivery_routes?.name}</span>
              </p>
              <form onSubmit={handleEditRateSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Upah Driver (Tanpa Kenek) Rp <span className="text-red-500">*</span></label>
                  <input
                    type="number" required min="0"
                    value={editRateForm.driver_rate_without_helper}
                    onChange={(e) => setEditRateForm({ ...editRateForm, driver_rate_without_helper: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Upah Driver (Dengan Kenek) Rp <span className="text-red-500">*</span></label>
                  <input
                    type="number" required min="0"
                    value={editRateForm.driver_rate_with_helper}
                    onChange={(e) => setEditRateForm({ ...editRateForm, driver_rate_with_helper: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Upah Kenek Rp <span className="text-red-500">*</span></label>
                  <input
                    type="number" required min="0"
                    value={editRateForm.helper_rate}
                    onChange={(e) => setEditRateForm({ ...editRateForm, helper_rate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setEditRate(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={editRateSubmitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                    {editRateSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
