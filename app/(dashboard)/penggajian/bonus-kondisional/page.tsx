'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Employee = {
  id: string
  employee_code: string
  full_name: string
  employee_type: string
  branches: { name: string } | null
  positions: { name: string } | null
}

type BonusCriteria = {
  id: string
  employee_id: string
  criteria_name: string
  nominal_amount: number
  is_active: boolean
}

const fmtRp = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

export default function BonusKondisionalPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [criteriaMap, setCriteriaMap] = useState<Record<string, BonusCriteria[]>>({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')

  // Expanded employee
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Form tambah kriteria
  const [addForm, setAddForm] = useState<Record<string, { name: string; nominal: string }>>({})
  const [addSubmitting, setAddSubmitting] = useState<string | null>(null)

  // Edit kriteria
  const [editCriteria, setEditCriteria] = useState<BonusCriteria | null>(null)
  const [editForm, setEditForm] = useState({ name: '', nominal: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: empData } = await supabase
      .from('employees')
      .select('id, employee_code, full_name, employee_type, branches(name), positions(name)')
      .eq('is_active', true)
      .in('employee_type', ['permanent', 'training'])
      .order('full_name')

    if (empData) setEmployees(empData as unknown as Employee[])

    const { data: critData } = await supabase
      .from('employee_bonus_criteria')
      .select('*')
      .order('created_at')

    if (critData) {
      const map: Record<string, BonusCriteria[]> = {}
      critData.forEach((c: BonusCriteria) => {
        if (!map[c.employee_id]) map[c.employee_id] = []
        map[c.employee_id].push(c)
      })
      setCriteriaMap(map)
    }
    setLoading(false)
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  function getTotalMax(employeeId: string) {
    return (criteriaMap[employeeId] || [])
      .filter(c => c.is_active)
      .reduce((s, c) => s + Number(c.nominal_amount), 0)
  }

  async function handleAddCriteria(employeeId: string) {
    const f = addForm[employeeId]
    if (!f?.name || !f?.nominal) { showMsg('error', 'Isi nama dan nominal kriteria.'); return }
    const nominal = parseFloat(f.nominal)
    if (isNaN(nominal) || nominal <= 0) { showMsg('error', 'Nominal harus lebih dari 0.'); return }

    setAddSubmitting(employeeId)
    const { error } = await supabase.from('employee_bonus_criteria').insert({
      employee_id: employeeId,
      criteria_name: f.name.trim(),
      nominal_amount: nominal,
      is_active: true
    })

    if (error) { showMsg('error', 'Gagal menambah kriteria: ' + error.message) }
    else {
      showMsg('success', 'Kriteria berhasil ditambahkan.')
      setAddForm(prev => ({ ...prev, [employeeId]: { name: '', nominal: '' } }))
      fetchData()
    }
    setAddSubmitting(null)
  }

  async function handleToggleActive(c: BonusCriteria) {
    const { error } = await supabase
      .from('employee_bonus_criteria')
      .update({ is_active: !c.is_active })
      .eq('id', c.id)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else fetchData()
  }

  async function handleDelete(c: BonusCriteria) {
    if (!confirm(`Hapus kriteria "${c.criteria_name}"?`)) return
    const { error } = await supabase.from('employee_bonus_criteria').delete().eq('id', c.id)
    if (error) showMsg('error', 'Gagal menghapus: ' + error.message)
    else { showMsg('success', 'Kriteria dihapus.'); fetchData() }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editCriteria) return
    const nominal = parseFloat(editForm.nominal)
    if (isNaN(nominal) || nominal <= 0) { showMsg('error', 'Nominal tidak valid.'); return }
    setEditSubmitting(true)
    const { error } = await supabase
      .from('employee_bonus_criteria')
      .update({ criteria_name: editForm.name.trim(), nominal_amount: nominal })
      .eq('id', editCriteria.id)
    if (error) showMsg('error', 'Gagal mengupdate: ' + error.message)
    else { showMsg('success', 'Kriteria berhasil diupdate.'); setEditCriteria(null); fetchData() }
    setEditSubmitting(false)
  }

  const filtered = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_code.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Bonus Kondisional</h1>
        <p className="text-sm text-slate-500">
          Tentukan kriteria dan nominal bonus per karyawan. Setiap bulan, HR/Owner menilai mana yang terpenuhi — bonus masuk otomatis ke slip gaji.
        </p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input type="text" placeholder="Cari nama karyawan..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Memuat data...</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(emp => {
            const criteria = criteriaMap[emp.id] || []
            const totalMax = getTotalMax(emp.id)
            const isExpanded = expandedId === emp.id
            const f = addForm[emp.id] || { name: '', nominal: '' }

            return (
              <div key={emp.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {/* Header karyawan */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition"
                  onClick={() => setExpandedId(isExpanded ? null : emp.id)}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium text-slate-800">{emp.full_name}</div>
                      <div className="text-xs text-slate-400">{emp.employee_code} · {emp.positions?.name} · {emp.branches?.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {totalMax > 0 ? (
                      <div className="text-right">
                        <div className="text-xs text-slate-400">Maks Bonus</div>
                        <div className="text-sm font-bold text-blue-600">{fmtRp(totalMax)}/bln</div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Belum ada kriteria</span>
                    )}
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Detail kriteria */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50 p-5 space-y-4">
                    {/* Daftar kriteria */}
                    {criteria.length === 0 ? (
                      <p className="text-sm text-slate-500 italic">Belum ada kriteria bonus untuk karyawan ini.</p>
                    ) : (
                      <div className="space-y-2">
                        {criteria.map(c => (
                          <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${c.is_active ? 'bg-white border-slate-200' : 'bg-slate-100 border-slate-200 opacity-60'}`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.is_active ? 'bg-green-500' : 'bg-slate-400'}`} />
                              <div>
                                <div className="text-sm font-medium text-slate-800">{c.criteria_name}</div>
                                <div className="text-xs text-slate-500">{c.is_active ? 'Aktif' : 'Nonaktif'}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold text-green-600">{fmtRp(c.nominal_amount)}</span>
                              <div className="flex gap-1">
                                <button onClick={() => { setEditCriteria(c); setEditForm({ name: c.criteria_name, nominal: String(c.nominal_amount) }) }}
                                  className="px-2 py-1 text-xs font-medium border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition">
                                  Edit
                                </button>
                                <button onClick={() => handleToggleActive(c)}
                                  className={`px-2 py-1 text-xs font-medium rounded border transition ${c.is_active ? 'border-orange-200 text-orange-600 hover:bg-orange-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                                  {c.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                                </button>
                                <button onClick={() => handleDelete(c)}
                                  className="px-2 py-1 text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 rounded transition">
                                  Hapus
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {/* Total */}
                        <div className="flex justify-between items-center px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                          <span className="text-sm font-semibold text-slate-700">Total Maks Bonus / Bulan</span>
                          <span className="text-sm font-bold text-blue-700">{fmtRp(totalMax)}</span>
                        </div>
                      </div>
                    )}

                    {/* Form tambah kriteria */}
                    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                      <p className="text-xs font-semibold text-slate-600 mb-3">+ Tambah Kriteria Baru</p>
                      <div className="flex flex-col sm:flex-row gap-2 items-end">
                        <div className="flex-1">
                          <label className="block text-xs text-slate-500 mb-1">Nama Kriteria</label>
                          <input type="text" value={f.name}
                            onChange={e => setAddForm(prev => ({ ...prev, [emp.id]: { ...f, name: e.target.value } }))}
                            placeholder="Contoh: Tidak ada kehilangan barang"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                        <div className="w-40">
                          <label className="block text-xs text-slate-500 mb-1">Nominal (Rp)</label>
                          <input type="number" min="0" value={f.nominal}
                            onChange={e => setAddForm(prev => ({ ...prev, [emp.id]: { ...f, nominal: e.target.value } }))}
                            placeholder="500000"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                        <button onClick={() => handleAddCriteria(emp.id)} disabled={addSubmitting === emp.id}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 whitespace-nowrap">
                          {addSubmitting === emp.id ? '...' : 'Tambah'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Edit Kriteria */}
      {editCriteria && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Kriteria</h2>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nama Kriteria <span className="text-red-500">*</span></label>
                  <input type="text" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nominal (Rp) <span className="text-red-500">*</span></label>
                  <input type="number" required min="0" value={editForm.nominal} onChange={e => setEditForm({ ...editForm, nominal: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setEditCriteria(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">Batal</button>
                  <button type="submit" disabled={editSubmitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                    {editSubmitting ? 'Menyimpan...' : 'Simpan'}
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
