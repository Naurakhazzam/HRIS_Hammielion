'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Department = {
  id: string
  name: string
}

type Position = {
  id: string
  name: string
  department_id: string
  level: number
  departments: Department
}

export default function JabatanPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [level, setLevel] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Edit state
  const [editPosition, setEditPosition] = useState<Position | null>(null)
  const [editName, setEditName] = useState('')
  const [editDepartmentId, setEditDepartmentId] = useState('')
  const [editLevel, setEditLevel] = useState('1')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)

    const { data: deptData, error: deptError } = await supabase
      .from('departments')
      .select('id, name')
      .order('name')

    if (!deptError && deptData) {
      setDepartments(deptData)
      if (deptData.length > 0) {
        setDepartmentId(deptData[0].id)
      }
    }

    const { data: posData, error: posError } = await supabase
      .from('positions')
      .select('id, name, department_id, level, departments(id, name)')
      .order('level')
      .order('name')

    if (posError) {
      showMessage('error', 'Gagal memuat data jabatan: ' + posError.message)
    } else {
      setPositions((posData as unknown as Position[]) || [])
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

    if (!departmentId) {
      showMessage('error', 'Silakan pilih departemen terlebih dahulu.')
      setSubmitting(false)
      return
    }

    const { error } = await supabase
      .from('positions')
      .insert([{
        name,
        department_id: departmentId,
        level: parseInt(level, 10)
      }])

    if (error) {
      showMessage('error', 'Gagal menambah jabatan: ' + error.message)
    } else {
      showMessage('success', 'Jabatan berhasil ditambahkan')
      setName('')
      setLevel('1')
      fetchData()
    }
    setSubmitting(false)
  }

  function openEditModal(pos: Position) {
    setEditPosition(pos)
    setEditName(pos.name)
    setEditDepartmentId(pos.department_id)
    setEditLevel(String(pos.level))
  }

  async function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editPosition) return
    setEditSubmitting(true)

    const { error } = await supabase
      .from('positions')
      .update({
        name: editName,
        department_id: editDepartmentId,
        level: parseInt(editLevel, 10)
      })
      .eq('id', editPosition.id)

    if (error) {
      showMessage('error', 'Gagal mengupdate jabatan: ' + error.message)
    } else {
      showMessage('success', 'Jabatan berhasil diupdate.')
      setEditPosition(null)
      fetchData()
    }
    setEditSubmitting(false)
  }

  async function handleDelete(pos: Position) {
    if (!confirm(`Hapus jabatan "${pos.name}"?\n\nPastikan tidak ada karyawan yang masih memakai jabatan ini.`)) return

    const { error } = await supabase
      .from('positions')
      .delete()
      .eq('id', pos.id)

    if (error) {
      showMessage('error', 'Gagal menghapus jabatan: ' + error.message)
    } else {
      showMessage('success', `Jabatan "${pos.name}" berhasil dihapus.`)
      fetchData()
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Manajemen Jabatan</h1>
      <p className="text-sm text-slate-500 mb-6">Kelola struktur jabatan berdasarkan departemen.</p>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Tambah Jabatan */}
        <div className="lg:col-span-1">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold text-slate-700 mb-4">Tambah Jabatan Baru</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nama Jabatan <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contoh: Manager Operasional"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Departemen <span className="text-red-500">*</span></label>
                <select
                  required
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Level Hierarki <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  required
                  min="1"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contoh: 1 (Direksi), 2 (Manager), dst."
                />
                <p className="text-xs text-slate-400 mt-1">Angka lebih kecil = hierarki lebih tinggi.</p>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg text-sm transition disabled:opacity-50 mt-2"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Jabatan'}
              </button>
            </form>
          </div>
        </div>

        {/* Tabel Data Jabatan */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Jabatan</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Departemen</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">Level</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td>
                    </tr>
                  ) : positions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data jabatan.</td>
                    </tr>
                  ) : (
                    positions.map((pos) => (
                      <tr key={pos.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{pos.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
                            {pos.departments?.name || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                            {pos.level}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditModal(pos)}
                              className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(pos)}
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
      {editPosition && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Jabatan</h2>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nama Jabatan <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Departemen <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={editDepartmentId}
                    onChange={(e) => setEditDepartmentId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Level Hierarki <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={editLevel}
                    onChange={(e) => setEditLevel(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Angka lebih kecil = hierarki lebih tinggi.</p>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditPosition(null)}
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
