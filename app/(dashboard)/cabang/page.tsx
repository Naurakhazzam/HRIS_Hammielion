'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = {
  id: string
  name: string
  address: string | null
  is_active: boolean
  created_at: string
}

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

  const supabase = createClient()

  useEffect(() => {
    fetchBranches()
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
  }

  async function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editBranch) return
    setEditSubmitting(true)

    const { error } = await supabase
      .from('branches')
      .update({ name: editName, address: editAddress || null })
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
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td>
                    </tr>
                  ) : branches.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data cabang.</td>
                    </tr>
                  ) : (
                    branches.map((branch) => (
                      <tr key={branch.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{branch.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-pre-wrap">{branch.address || '-'}</td>
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
