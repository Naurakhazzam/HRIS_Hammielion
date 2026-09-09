'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = {
  id: string
  name: string
  address: string | null
  is_active: boolean
  created_at: string
  fingerprint_device_group_id: string | null
  latitude: number | null
  longitude: number | null
  checkin_radius_meters: number
}

type DeviceGroup = { id: string; name: string }

export default function CabangPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Edit state
  const [editBranch, setEditBranch] = useState<Branch | null>(null)
  const [editName, setEditName] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)
  // Absen HP (test drive) — titik koordinat & radius cabang, dipakai AbsenSekarang.tsx untuk
  // cek jarak. Kosong (null) = cabang itu belum diaktifkan untuk absen HP, fingerprint tetap jalan.
  const [editLat, setEditLat] = useState('')
  const [editLng, setEditLng] = useState('')
  const [editRadius, setEditRadius] = useState('150')
  const [locatingMe, setLocatingMe] = useState(false)

  // Kelompok Mesin Fingerprint
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchBranches()
    fetchDeviceGroups()
  }, [])

  async function fetchBranches() {
    setLoading(true)
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      showMessage('error', 'Gagal memuat data cabang: ' + error.message)
    } else {
      setBranches(data || [])
    }
    setLoading(false)
  }

  async function fetchDeviceGroups() {
    const { data } = await supabase.from('fingerprint_device_groups').select('id, name').order('name')
    setDeviceGroups(data || [])
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setCreatingGroup(true)
    const { error } = await supabase.from('fingerprint_device_groups').insert([{ name: newGroupName.trim() }])
    if (error) {
      showMessage('error', 'Gagal menambah kelompok mesin: ' + error.message)
    } else {
      showMessage('success', 'Kelompok mesin berhasil ditambahkan.')
      setNewGroupName('')
      fetchDeviceGroups()
    }
    setCreatingGroup(false)
  }

  async function handleBranchGroupChange(branchId: string, groupId: string) {
    const { error } = await supabase
      .from('branches')
      .update({ fingerprint_device_group_id: groupId || null })
      .eq('id', branchId)
    if (error) showMessage('error', 'Gagal mengubah kelompok mesin: ' + error.message)
    else { showMessage('success', 'Kelompok mesin cabang berhasil diubah.'); fetchBranches() }
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    const { error } = await supabase
      .from('branches')
      .insert([{ name, address: address || null }])

    if (error) {
      showMessage('error', 'Gagal menambah cabang: ' + error.message)
    } else {
      showMessage('success', 'Cabang berhasil ditambahkan')
      setName('')
      setAddress('')
      fetchBranches()
    }
    setSubmitting(false)
  }

  function openEditModal(branch: Branch) {
    setEditBranch(branch)
    setEditName(branch.name)
    setEditAddress(branch.address || '')
    setEditLat(branch.latitude != null ? String(branch.latitude) : '')
    setEditLng(branch.longitude != null ? String(branch.longitude) : '')
    setEditRadius(String(branch.checkin_radius_meters ?? 150))
  }

  function useMyLocationForEdit() {
    if (!navigator.geolocation) { showMessage('error', 'Browser ini tidak mendukung deteksi lokasi.'); return }
    setLocatingMe(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setEditLat(String(pos.coords.latitude)); setEditLng(String(pos.coords.longitude)); setLocatingMe(false) },
      () => { showMessage('error', 'Gagal mengambil lokasi — pastikan izin lokasi browser diaktifkan.'); setLocatingMe(false) },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  async function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editBranch) return
    setEditSubmitting(true)

    const latNum = editLat.trim() === '' ? null : Number(editLat)
    const lngNum = editLng.trim() === '' ? null : Number(editLng)
    if ((latNum !== null && isNaN(latNum)) || (lngNum !== null && isNaN(lngNum))) {
      showMessage('error', 'Koordinat tidak valid.')
      setEditSubmitting(false)
      return
    }
    const radiusNum = Math.max(10, Number(editRadius) || 150)

    const { error } = await supabase
      .from('branches')
      .update({ name: editName, address: editAddress || null, latitude: latNum, longitude: lngNum, checkin_radius_meters: radiusNum })
      .eq('id', editBranch.id)

    if (error) {
      showMessage('error', 'Gagal mengupdate cabang: ' + error.message)
    } else {
      showMessage('success', 'Cabang berhasil diupdate')
      setEditBranch(null)
      fetchBranches()
    }
    setEditSubmitting(false)
  }

  async function handleDelete(branch: Branch) {
    if (!confirm(`Hapus cabang "${branch.name}"?\n\nPastikan tidak ada karyawan yang masih ditugaskan di cabang ini.`)) return

    const { error } = await supabase
      .from('branches')
      .delete()
      .eq('id', branch.id)

    if (error) {
      showMessage('error', 'Gagal menghapus cabang: ' + error.message)
    } else {
      showMessage('success', `Cabang "${branch.name}" berhasil dihapus.`)
      fetchBranches()
    }
  }

  async function toggleStatus(id: string, currentStatus: boolean) {
    const { error } = await supabase
      .from('branches')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (error) {
      showMessage('error', 'Gagal mengubah status: ' + error.message)
    } else {
      showMessage('success', 'Status cabang berhasil diubah')
      fetchBranches()
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Manajemen Cabang</h1>
      <p className="text-sm text-slate-500 mb-6">Kelola data cabang perusahaan Anda di sini.</p>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Kelompok Mesin Fingerprint */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mb-6">
        <h2 className="text-lg font-semibold text-slate-700 mb-1">Kelompok Mesin Fingerprint</h2>
        <p className="text-xs text-slate-500 mb-4">
          Cabang yang pakai mesin fingerprint fisik yang SAMA harus satu kelompok — supaya ID Fingerprint yang sama tidak tumpang tindih dengan cabang yang pakai mesin lain, dan Import Absensi tahu file itu untuk kelompok cabang mana.
        </p>
        <form onSubmit={handleCreateGroup} className="flex gap-2 mb-4">
          <input
            type="text"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            placeholder="Contoh: Mesin Cabang Garut"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={creatingGroup || !newGroupName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {creatingGroup ? 'Menyimpan...' : '+ Tambah Kelompok'}
          </button>
        </form>
        {deviceGroups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {deviceGroups.map(g => (
              <span key={g.id} className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">
                {g.name}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">Atur cabang mana masuk kelompok mana lewat kolom <strong>Kelompok Mesin</strong> di tabel cabang di bawah.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Tambah Cabang */}
        <div className="lg:col-span-1">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold text-slate-700 mb-4">Tambah Cabang Baru</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nama Cabang <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contoh: Cabang Garut"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Alamat</label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Alamat lengkap (opsional)"
                  rows={3}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg text-sm transition disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Cabang'}
              </button>
            </form>
          </div>
        </div>

        {/* Tabel Data Cabang */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Nama Cabang</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Alamat</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Kelompok Mesin</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">Absen HP</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td>
                    </tr>
                  ) : branches.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data cabang.</td>
                    </tr>
                  ) : (
                    branches.map((branch) => (
                      <tr key={branch.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{branch.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-pre-wrap">{branch.address || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <select
                            value={branch.fingerprint_device_group_id || ''}
                            onChange={e => handleBranchGroupChange(branch.id, e.target.value)}
                            className="px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">-- Belum diatur --</option>
                            {deviceGroups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {branch.latitude != null && branch.longitude != null ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700">✓ Aktif ({branch.checkin_radius_meters}m)</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            branch.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {branch.is_active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditModal(branch)}
                              className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => toggleStatus(branch.id, branch.is_active)}
                              className={`text-xs px-2.5 py-1 rounded font-medium transition ${
                                branch.is_active
                                  ? 'text-orange-600 hover:bg-orange-50 border border-orange-200'
                                  : 'text-green-600 hover:bg-green-50 border border-green-200'
                              }`}
                            >
                              {branch.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              onClick={() => handleDelete(branch)}
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
        </div>
      </div>

      {/* Edit Modal */}
      {editBranch && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Cabang</h2>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nama Cabang <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Alamat</label>
                  <textarea
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-slate-700">Absen HP (Test Drive)</label>
                    <button type="button" onClick={useMyLocationForEdit} disabled={locatingMe}
                      className="text-xs px-2.5 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50 transition disabled:opacity-50">
                      {locatingMe ? 'Mendeteksi...' : '📍 Pakai lokasi saya sekarang'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2">Kosongkan Latitude/Longitude kalau cabang ini belum ikut test drive absen HP — karyawan tetap pakai fingerprint seperti biasa.</p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Latitude</label>
                      <input type="text" inputMode="decimal" value={editLat} onChange={e => setEditLat(e.target.value)}
                        placeholder="Contoh: -6.914744"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Longitude</label>
                      <input type="text" inputMode="decimal" value={editLng} onChange={e => setEditLng(e.target.value)}
                        placeholder="Contoh: 107.609810"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Radius Absen (meter)</label>
                    <input type="number" min={10} value={editRadius} onChange={e => setEditRadius(e.target.value)}
                      className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditBranch(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50"
                  >
                    {editSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
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
