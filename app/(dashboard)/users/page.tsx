'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type UserAccount = {
  id: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  employees: {
    full_name: string
    employee_code: string
    branches: { name: string } | null
    positions: { name: string } | null
  } | null
}

type Employee = {
  id: string
  full_name: string
  employee_code: string
  branches: { name: string } | null
  positions: { name: string } | null
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  owner:      { label: 'Owner',      color: 'bg-purple-100 text-purple-700' },
  hr:         { label: 'HR',         color: 'bg-blue-100 text-blue-700' },
  finance:    { label: 'Finance',    color: 'bg-green-100 text-green-700' },
  supervisor: { label: 'Supervisor', color: 'bg-orange-100 text-orange-700' },
  employee:   { label: 'Karyawan',   color: 'bg-slate-100 text-slate-700' },
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserAccount[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [myRole, setMyRole] = useState<string>('')
  const [myId, setMyId] = useState<string>('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form tambah user
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ employee_id: '', email: '', password: '', role: 'employee' })
  const [submitting, setSubmitting] = useState(false)

  // Modal edit
  const [editUser, setEditUser] = useState<UserAccount | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const supabase = createClient()

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMyId(user.id)

    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
    if (me) setMyRole(me.role)

    await Promise.all([fetchUsers(), fetchEmployees()])
    setLoading(false)
  }

  async function fetchUsers() {
    const res = await fetch('/api/users')
    const data = await res.json()
    if (data.users) setUsers(data.users)
  }

  async function fetchEmployees() {
    const { data } = await supabase
      .from('employees')
      .select('id, full_name, employee_code, branches(name), positions(name)')
      .eq('is_active', true)
      .order('full_name')
    if (data) setEmployees(data as unknown as Employee[])
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  // Karyawan yang belum punya akun
  const usedEmployeeIds = new Set(users.map(u => u.employees ? u.id : null).filter(Boolean))
  const availableEmployees = employees.filter(e => {
    const hasAccount = users.some(u => u.employees?.employee_code === e.employee_code)
    return !hasAccount
  })

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (formData.password.length < 6) {
      showMsg('error', 'Password minimal 6 karakter.')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
    const data = await res.json()
    if (data.error) {
      showMsg('error', data.error)
    } else {
      showMsg('success', 'Akun berhasil dibuat.')
      setShowForm(false)
      setFormData({ employee_id: '', email: '', password: '', role: 'employee' })
      await fetchUsers()
    }
    setSubmitting(false)
  }

  function openEdit(u: UserAccount) {
    setEditUser(u)
    setEditRole(u.role)
    setEditPassword('')
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    if (editPassword && editPassword.length < 6) {
      showMsg('error', 'Password baru minimal 6 karakter.')
      return
    }
    setEditSubmitting(true)
    const body: any = { userId: editUser.id, role: editRole }
    if (editPassword) body.password = editPassword
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.error) {
      showMsg('error', data.error)
    } else {
      showMsg('success', 'Akun berhasil diupdate.')
      setEditUser(null)
      await fetchUsers()
    }
    setEditSubmitting(false)
  }

  async function toggleActive(u: UserAccount) {
    const action = u.is_active ? 'nonaktifkan' : 'aktifkan'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} akun ${u.email}?`)) return
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id, is_active: !u.is_active })
    })
    const data = await res.json()
    if (data.error) showMsg('error', data.error)
    else { showMsg('success', `Akun berhasil di-${action}kan.`); await fetchUsers() }
  }

  async function handleDelete(u: UserAccount) {
    if (!confirm(`Hapus akun "${u.email}" secara permanen?\n\nTindakan ini tidak dapat dibatalkan.`)) return
    const res = await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id })
    })
    const data = await res.json()
    if (data.error) showMsg('error', data.error)
    else { showMsg('success', 'Akun berhasil dihapus.'); await fetchUsers() }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Manajemen Akun User</h1>
          <p className="text-sm text-slate-500">Kelola akun login karyawan untuk mengakses sistem HRIS.</p>
        </div>
        {['owner', 'hr'].includes(myRole) && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm"
          >
            {showForm ? 'Batal' : '+ Buat Akun Baru'}
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${
          message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {/* Form Buat Akun */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Form Buat Akun Baru</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Karyawan <span className="text-red-500">*</span></label>
              <select required value={formData.employee_id}
                onChange={e => {
                  const emp = availableEmployees.find(x => x.id === e.target.value)
                  setFormData({ ...formData, employee_id: e.target.value, email: emp ? '' : formData.email })
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">-- Pilih Karyawan --</option>
                {availableEmployees.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} — {e.full_name} ({e.positions?.name || '-'})
                  </option>
                ))}
              </select>
              {availableEmployees.length === 0 && (
                <p className="text-xs text-orange-500 mt-1">Semua karyawan aktif sudah memiliki akun.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role <span className="text-red-500">*</span></label>
              <select required value={formData.role}
                onChange={e => setFormData({ ...formData, role: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {Object.entries(ROLE_CONFIG).map(([val, cfg]) => (
                  <option key={val} value={val}>{cfg.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email <span className="text-red-500">*</span></label>
              <input required type="email" value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                placeholder="contoh@email.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password <span className="text-red-500">*</span></label>
              <input required type="password" value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                placeholder="Minimal 6 karakter"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="md:col-span-2 flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                Batal
              </button>
              <button type="submit" disabled={submitting}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Membuat Akun...' : 'Buat Akun'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabel User */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Daftar Akun ({users.length})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Email</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Role</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Memuat data...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Belum ada akun.</td></tr>
              ) : (
                users.map(u => {
                  const roleCfg = ROLE_CONFIG[u.role] ?? { label: u.role, color: 'bg-slate-100 text-slate-600' }
                  const isSelf = u.id === myId
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3">
                        {u.employees ? (
                          <>
                            <div className="font-medium text-slate-800">{u.employees.full_name}</div>
                            <div className="text-xs text-slate-400">{u.employees.employee_code} · {u.employees.positions?.name || '-'} · {u.employees.branches?.name || '-'}</div>
                          </>
                        ) : (
                          <span className="text-xs text-red-400 italic">Tidak terhubung ke karyawan</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${roleCfg.color}`}>
                          {roleCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
                        }`}>
                          {u.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {['owner', 'hr'].includes(myRole) && (
                            <button onClick={() => openEdit(u)}
                              className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition">
                              Edit
                            </button>
                          )}
                          {['owner', 'hr'].includes(myRole) && !isSelf && (
                            <button onClick={() => toggleActive(u)}
                              className={`px-2.5 py-1 text-xs font-medium rounded border transition ${
                                u.is_active
                                  ? 'text-orange-600 border-orange-200 hover:bg-orange-50'
                                  : 'text-green-600 border-green-200 hover:bg-green-50'
                              }`}>
                              {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                          )}
                          {myRole === 'owner' && !isSelf && (
                            <button onClick={() => handleDelete(u)}
                              className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">
                              Hapus
                            </button>
                          )}
                          {isSelf && (
                            <span className="text-xs text-slate-400 italic">Akun Anda</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Edit */}
      {editUser && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1 pb-2 border-b border-slate-100">Edit Akun</h2>
              <p className="text-sm text-slate-500 mb-4">{editUser.employees?.full_name || editUser.email}</p>
              <form onSubmit={handleEdit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                  <select value={editRole} onChange={e => setEditRole(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {Object.entries(ROLE_CONFIG).map(([val, cfg]) => (
                      <option key={val} value={val}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Reset Password <span className="text-slate-400 font-normal">(kosongkan jika tidak diubah)</span>
                  </label>
                  <input type="password" value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                    placeholder="Password baru (min. 6 karakter)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setEditUser(null)}
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
