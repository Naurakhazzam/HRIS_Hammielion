'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type FreelanceWorker = {
  id: string
  full_name: string
  phone: string | null
  is_active: boolean
}

export default function MasterPekerjaBoronganPage() {
  const [workers, setWorkers] = useState<FreelanceWorker[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const supabase = createClient()

  const [formData, setFormData] = useState({ full_name: '', phone: '' })

  // Edit state
  const [editWorker, setEditWorker] = useState<FreelanceWorker | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', phone: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)

  useEffect(() => {
    fetchWorkers()
  }, [])

  async function fetchWorkers() {
    setLoading(true)
    const { data, error } = await supabase
      .from('freelance_workers')
      .select('*')
      .order('is_active', { ascending: false })
      .order('full_name', { ascending: true })

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
    } else {
      setWorkers(data || [])
    }
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    const { error } = await supabase
      .from('freelance_workers')
      .insert([{
        full_name: formData.full_name,
        phone: formData.phone || null
      }])

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal menambah pekerja: ' + error.message)
    } else {
      showMessage('success', 'Pekerja borongan berhasil ditambahkan.')
      setFormData({ full_name: '', phone: '' })
      fetchWorkers()
    }
    setSubmitting(false)
  }

  function openEditModal(w: FreelanceWorker) {
    setEditWorker(w)
    setEditForm({ full_name: w.full_name, phone: w.phone || '' })
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editWorker) return
    setEditSubmitting(true)
    const { error } = await supabase
      .from('freelance_workers')
      .update({ full_name: editForm.full_name, phone: editForm.phone || null })
      .eq('id', editWorker.id)
    if (error) {
      showMessage('error', 'Gagal mengupdate pekerja: ' + error.message)
    } else {
      showMessage('success', 'Data pekerja berhasil diupdate.')
      setEditWorker(null)
      fetchWorkers()
    }
    setEditSubmitting(false)
  }

  async function toggleActive(id: string, currentStatus: boolean) {
    const { error } = await supabase
      .from('freelance_workers')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal merubah status: ' + error.message)
    } else {
      fetchWorkers()
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Pekerja Borongan</h1>
        <p className="text-sm text-slate-500">Master data pekerja lepas harian (Bongkar Muat).</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Form Insert */}
        <div className="md:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Pekerja</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                required 
                value={formData.full_name} 
                onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nomor HP</label>
              <input 
                type="tel" 
                value={formData.phone} 
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={submitting} 
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Pekerja'}
              </button>
            </div>
          </form>
        </div>

        {/* List Data */}
        <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Pekerja</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nomor HP</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td>
                  </tr>
                ) : workers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pekerja terdaftar.</td>
                  </tr>
                ) : (
                  workers.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">{w.full_name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-600">{w.phone || '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${w.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                          {w.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditModal(w)}
                            className="text-xs px-2.5 py-1 rounded border font-medium transition text-blue-600 border-blue-200 hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggleActive(w.id, w.is_active)}
                            className={`text-xs px-2.5 py-1 rounded border font-medium transition ${
                              w.is_active
                                ? 'text-orange-600 border-orange-200 hover:bg-orange-50'
                                : 'text-green-600 border-green-200 hover:bg-green-50'
                            }`}
                          >
                            {w.is_active ? 'Nonaktifkan' : 'Aktifkan'}
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

      {/* Modal Edit Pekerja */}
      {editWorker && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Pekerja Borongan</h2>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nama Lengkap <span className="text-red-500">*</span></label>
                  <input
                    type="text" required
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nomor HP</label>
                  <input
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Opsional"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setEditWorker(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={editSubmitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
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
