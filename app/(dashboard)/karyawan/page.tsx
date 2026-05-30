'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// -- Types --
type Branch = { id: string; name: string }
type Department = { id: string; name: string }
type Position = { id: string; name: string; department_id: string }
type Employee = {
  id: string
  employee_code: string
  full_name: string
  nik: string | null
  phone: string | null
  employee_type: string
  join_date: string | null
  is_active: boolean
  kpi_bonus_max: number
  branches: { id: string; name: string }
  departments: { id: string; name: string }
  positions: { id: string; name: string; department_id: string }
}

export default function KaryawanPage() {
  // Data Lists
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  
  // Filtering & State
  const [loading, setLoading] = useState(true)
  const [filterBranch, setFilterBranch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  
  // Form State
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  // Edit State
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState({
    full_name: '', employee_code: '', nik: '', phone: '',
    branch_id: '', department_id: '', position_id: '',
    employee_type: 'permanent', join_date: '', kpi_bonus_max: '0'
  })
  const [editSubmitting, setEditSubmitting] = useState(false)

  // Form Data
  const [formData, setFormData] = useState({
    full_name: '',
    employee_code: '',
    nik: '',
    branch_id: '',
    department_id: '',
    position_id: '',
    employee_type: 'permanent', // permanent, driver, freelance
    join_date: new Date().toISOString().split('T')[0],
    phone: '',
    kpi_bonus_max: '0'
  })

  const supabase = createClient()

  useEffect(() => {
    fetchReferenceData()
  }, [])

  useEffect(() => {
    fetchEmployees()
  }, [filterBranch, filterDept])

  async function fetchReferenceData() {
    // Ambil data Cabang, Departemen, dan Jabatan secara paralel
    const [bRes, dRes, pRes] = await Promise.all([
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('departments').select('id, name').order('name'),
      supabase.from('positions').select('id, name, department_id').order('name')
    ])

    if (bRes.data) setBranches(bRes.data)
    if (dRes.data) setDepartments(dRes.data)
    if (pRes.data) setPositions(pRes.data)
  }

  async function fetchEmployees() {
    setLoading(true)
    let query = supabase
      .from('employees')
      .select('id, employee_code, full_name, nik, phone, join_date, employee_type, is_active, kpi_bonus_max, branches(id, name), departments(id, name), positions(id, name, department_id)')
      .order('full_name')

    if (filterBranch) query = query.eq('branch_id', filterBranch)
    if (filterDept) query = query.eq('department_id', filterDept)

    const { data, error } = await query

    if (error) {
      showMessage('error', 'Gagal memuat data karyawan: ' + error.message)
    } else {
      setEmployees((data as unknown as Employee[]) || [])
    }
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function generateEmployeeCode(): Promise<string> {
    const { data } = await supabase
      .from('employees')
      .select('employee_code')
      .like('employee_code', 'EMP-%')
      .order('employee_code', { ascending: false })
      .limit(1)

    if (data && data.length > 0) {
      const lastCode = data[0].employee_code // e.g. "EMP-007"
      const num = parseInt(lastCode.replace('EMP-', ''), 10)
      if (!isNaN(num)) {
        return `EMP-${String(num + 1).padStart(3, '0')}`
      }
    }
    return 'EMP-001'
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
      // Jika departemen berubah, reset jabatan
      ...(name === 'department_id' ? { position_id: '' } : {})
    }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    if (!formData.branch_id || !formData.department_id || !formData.position_id) {
      showMessage('error', 'Harap isi Cabang, Departemen, dan Jabatan.')
      setSubmitting(false)
      return
    }

    const { error } = await supabase
      .from('employees')
      .insert([{
        full_name: formData.full_name,
        employee_code: formData.employee_code,
        nik: formData.nik || null,
        branch_id: formData.branch_id,
        department_id: formData.department_id,
        position_id: formData.position_id,
        employee_type: formData.employee_type,
        join_date: formData.join_date,
        phone: formData.phone || null,
        kpi_bonus_max: parseFloat(formData.kpi_bonus_max) || 0
      }])

    if (error) {
      showMessage('error', 'Gagal menambah karyawan: ' + error.message)
    } else {
      showMessage('success', 'Karyawan berhasil ditambahkan.')
      setShowForm(false)
      // Reset form
      setFormData({
        full_name: '', employee_code: '', nik: '',
        branch_id: '', department_id: '', position_id: '',
        employee_type: 'permanent', join_date: new Date().toISOString().split('T')[0], phone: '', kpi_bonus_max: '0'
      })
      fetchEmployees()
    }
    setSubmitting(false)
  }

  function openEditModal(emp: Employee) {
    setEditEmployee(emp)
    setEditForm({
      full_name: emp.full_name,
      employee_code: emp.employee_code,
      nik: emp.nik || '',
      phone: emp.phone || '',
      branch_id: emp.branches?.id || '',
      department_id: emp.departments?.id || '',
      position_id: emp.positions?.id || '',
      employee_type: emp.employee_type,
      join_date: emp.join_date || '',
      kpi_bonus_max: String(emp.kpi_bonus_max || 0)
    })
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editEmployee) return
    setEditSubmitting(true)
    const { error } = await supabase
      .from('employees')
      .update({
        full_name: editForm.full_name,
        employee_code: editForm.employee_code,
        nik: editForm.nik || null,
        phone: editForm.phone || null,
        branch_id: editForm.branch_id,
        department_id: editForm.department_id,
        position_id: editForm.position_id,
        employee_type: editForm.employee_type,
        join_date: editForm.join_date || null,
        kpi_bonus_max: parseFloat(editForm.kpi_bonus_max) || 0
      })
      .eq('id', editEmployee.id)

    if (error) {
      console.error('Edit error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal mengupdate karyawan: ' + error.message)
    } else {
      showMessage('success', 'Data karyawan berhasil diupdate.')
      setEditEmployee(null)
      fetchEmployees()
    }
    setEditSubmitting(false)
  }

  async function toggleStatus(id: string, currentStatus: boolean) {
    const { error } = await supabase
      .from('employees')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (error) {
      showMessage('error', 'Gagal mengubah status: ' + error.message)
    } else {
      showMessage('success', 'Status karyawan berhasil diubah')
      fetchEmployees()
    }
  }

  async function handleDelete(emp: Employee) {
    if (!confirm(`Hapus karyawan "${emp.full_name}" (${emp.employee_code})?\n\nTindakan ini tidak dapat dibatalkan.`)) return

    const { error } = await supabase
      .from('employees')
      .delete()
      .eq('id', emp.id)

    if (error) {
      console.error('Delete error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal menghapus karyawan: ' + error.message)
    } else {
      showMessage('success', `Karyawan "${emp.full_name}" berhasil dihapus.`)
      fetchEmployees()
    }
  }

  // Filter jabatan berdasarkan departemen yang dipilih di form
  const filteredPositionsForForm = positions.filter(p => p.department_id === formData.department_id)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Data Karyawan</h1>
          <p className="text-sm text-slate-500">Kelola informasi seluruh karyawan perusahaan.</p>
        </div>
        <button
          onClick={async () => {
            if (!showForm) {
              const nextCode = await generateEmployeeCode()
              setFormData(prev => ({ ...prev, employee_code: nextCode }))
            }
            setShowForm(!showForm)
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
        >
          {showForm ? 'Batal Tambah' : '+ Tambah Karyawan'}
        </button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Form Tambah Karyawan */}
      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Form Tambah Karyawan Baru</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nama Lengkap <span className="text-red-500">*</span></label>
              <input type="text" required name="full_name" value={formData.full_name} onChange={handleInputChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Kode Karyawan <span className="text-red-500">*</span></label>
              <input type="text" required name="employee_code" value={formData.employee_code} onChange={handleInputChange} placeholder="EMP-001"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none uppercase" />
              <p className="text-xs text-slate-400">Otomatis terisi berurutan, bisa diubah manual jika perlu</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">NIK (KTP)</label>
              <input type="text" name="nik" value={formData.nik} onChange={handleInputChange} maxLength={16}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Cabang <span className="text-red-500">*</span></label>
              <select required name="branch_id" value={formData.branch_id} onChange={handleInputChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Pilih Cabang --</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Departemen <span className="text-red-500">*</span></label>
              <select required name="department_id" value={formData.department_id} onChange={handleInputChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Pilih Departemen --</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Jabatan <span className="text-red-500">*</span></label>
              <select required name="position_id" value={formData.position_id} onChange={handleInputChange} disabled={!formData.department_id}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-100">
                <option value="">{formData.department_id ? '-- Pilih Jabatan --' : 'Pilih Dept Dahulu'}</option>
                {filteredPositionsForForm.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Tipe Karyawan <span className="text-red-500">*</span></label>
              <select required name="employee_type" value={formData.employee_type} onChange={handleInputChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="permanent">Karyawan Tetap</option>
                <option value="driver">Sopir (Driver)</option>
                <option value="freelance">Borongan / Freelance</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Tanggal Bergabung <span className="text-red-500">*</span></label>
              <input type="date" required name="join_date" value={formData.join_date} onChange={handleInputChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nomor HP</label>
              <input type="tel" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="Contoh: 0812..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nominal Bonus KPI Maks (Rp)</label>
              <input
                type="number" min="0"
                value={formData.kpi_bonus_max}
                onChange={e => setFormData({...formData, kpi_bonus_max: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="0"
              />
              <p className="text-xs text-slate-400 mt-0.5">Digunakan sebagai default nominal bonus di modul KPI</p>
            </div>

            <div className="md:col-span-2 lg:col-span-3 pt-4 border-t border-slate-100 flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                Batal
              </button>
              <button type="submit" disabled={submitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Menyimpan...' : 'Simpan Data'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter & Tabel Data */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500">Cabang:</label>
            <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2">
              <option value="">Semua Cabang</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500">Dept:</label>
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2">
              <option value="">Semua Departemen</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        {/* Tabel */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kode</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jabatan / Dept</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tipe</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data karyawan...</td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data karyawan yang sesuai.</td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-sm font-medium text-slate-600">{emp.employee_code}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{emp.full_name}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-700">{emp.positions?.name}</div>
                      <div className="text-xs text-slate-500">{emp.departments?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{emp.branches?.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 capitalize">{emp.employee_type}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        emp.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {emp.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center flex items-center justify-center gap-1">
                      <button
                        onClick={() => openEditModal(emp)}
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleStatus(emp.id, emp.is_active)}
                        className={`text-xs px-2.5 py-1 rounded font-medium transition ${
                          emp.is_active
                            ? 'text-orange-600 hover:bg-orange-50 border border-orange-200'
                            : 'text-green-600 hover:bg-green-50 border border-green-200'
                        }`}
                      >
                        {emp.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button
                        onClick={() => handleDelete(emp)}
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editEmployee && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Karyawan</h2>
              <form onSubmit={handleEditSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Nama Lengkap <span className="text-red-500">*</span></label>
                  <input type="text" required value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Kode Karyawan <span className="text-red-500">*</span></label>
                  <input type="text" required value={editForm.employee_code} onChange={e => setEditForm({...editForm, employee_code: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none uppercase" />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">NIK (KTP)</label>
                  <input type="text" value={editForm.nik} onChange={e => setEditForm({...editForm, nik: e.target.value})} maxLength={16}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Cabang <span className="text-red-500">*</span></label>
                  <select required value={editForm.branch_id} onChange={e => setEditForm({...editForm, branch_id: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">-- Pilih Cabang --</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Departemen <span className="text-red-500">*</span></label>
                  <select required value={editForm.department_id} onChange={e => setEditForm({...editForm, department_id: e.target.value, position_id: ''})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">-- Pilih Departemen --</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Jabatan <span className="text-red-500">*</span></label>
                  <select required value={editForm.position_id} onChange={e => setEditForm({...editForm, position_id: e.target.value})} disabled={!editForm.department_id}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-100">
                    <option value="">{editForm.department_id ? '-- Pilih Jabatan --' : 'Pilih Dept Dahulu'}</option>
                    {positions.filter(p => p.department_id === editForm.department_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Tipe Karyawan <span className="text-red-500">*</span></label>
                  <select required value={editForm.employee_type} onChange={e => setEditForm({...editForm, employee_type: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="permanent">Karyawan Tetap</option>
                    <option value="driver">Sopir (Driver)</option>
                    <option value="freelance">Borongan / Freelance</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Tanggal Bergabung <span className="text-red-500">*</span></label>
                  <input type="date" required value={editForm.join_date} onChange={e => setEditForm({...editForm, join_date: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Nomor HP</label>
                  <input type="tel" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} placeholder="Contoh: 0812..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Nominal Bonus KPI Maks (Rp)</label>
                  <input
                    type="number" min="0"
                    value={editForm.kpi_bonus_max}
                    onChange={e => setEditForm({...editForm, kpi_bonus_max: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="0"
                  />
                  <p className="text-xs text-slate-400 mt-0.5">Digunakan sebagai default nominal bonus di modul KPI</p>
                </div>

                <div className="md:col-span-2 pt-4 border-t border-slate-100 flex justify-end gap-3">
                  <button type="button" onClick={() => setEditEmployee(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={editSubmitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
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
