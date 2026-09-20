'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { todayLocalStr } from '@/lib/date'

type EmployeeWithSalary = {
  id: string
  full_name: string
  branch_name: string
  position_name: string
  employee_type: string
  base_salary: number | null
  effective_date: string | null
}

type SalaryDefault = { id: string; label: string; base_salary: number; position_allowance: number; meal_allowance: number; late_penalty_per_minute: number }

export default function SetupKomponenGajiPage() {
  const [employees, setEmployees] = useState<EmployeeWithSalary[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [defaults, setDefaults] = useState<SalaryDefault[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [applyDefaultId, setApplyDefaultId] = useState('')
  const [applyDate, setApplyDate] = useState(todayLocalStr())
  const [applying, setApplying] = useState(false)
  const [showDefaultEditor, setShowDefaultEditor] = useState(false)
  const [defaultForm, setDefaultForm] = useState<Record<string, { base_salary: string; position_allowance: string; meal_allowance: string }>>({})
  const [savingDefaultId, setSavingDefaultId] = useState<string | null>(null)
  const [universalLateRate, setUniversalLateRate] = useState('1000')
  const [savingLateRate, setSavingLateRate] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [])

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  async function fetchData() {
    setLoading(true)

    const [{ data: empData, error: empError }, { data: salaryData, error: salaryError }, { data: defData }] = await Promise.all([
      supabase.from('employees')
        .select(`id, full_name, employee_type, branches (name), positions (name)`)
        .eq('is_active', true)
        .order('full_name'),
      supabase.from('salary_components')
        .select('employee_id, base_salary, effective_date')
        .order('effective_date', { ascending: false }),
      supabase.from('salary_defaults').select('id, label, base_salary, position_allowance, meal_allowance, late_penalty_per_minute').order('label'),
    ])

    if (empError) { console.error(empError); setLoading(false); return }
    if (salaryError) console.error(salaryError)

    const combined: EmployeeWithSalary[] = (empData || []).map((emp: any) => {
      const latestSalary = salaryData?.find(s => s.employee_id === emp.id)
      return {
        id: emp.id,
        full_name: emp.full_name,
        branch_name: emp.branches?.name || '-',
        position_name: emp.positions?.name || '-',
        employee_type: emp.employee_type,
        base_salary: latestSalary?.base_salary || null,
        effective_date: latestSalary?.effective_date || null
      }
    })

    setEmployees(combined)
    const defs = (defData as SalaryDefault[]) || []
    setDefaults(defs)
    setApplyDefaultId(prev => prev || defs[0]?.id || '')
    const formInit: typeof defaultForm = {}
    defs.forEach(d => { formInit[d.id] = { base_salary: String(d.base_salary), position_allowance: String(d.position_allowance), meal_allowance: String(d.meal_allowance) } })
    setDefaultForm(formInit)
    if (defs[0]) setUniversalLateRate(String(defs[0].late_penalty_per_minute))
    setLoading(false)
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)
  }

  const translateType = (type: string) => {
    switch (type) {
      case 'permanent': return 'Karyawan Tetap'
      case 'training': return 'Training'
      case 'driver': return 'Driver'
      case 'freelance': return 'Freelance'
      case 'contract': return 'Kontrak'
      default: return type
    }
  }

  const filteredEmployees = employees.filter(e => e.full_name.toLowerCase().includes(searchTerm.toLowerCase()))

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleSelectAll() {
    if (selectedIds.length === filteredEmployees.length) setSelectedIds([])
    else setSelectedIds(filteredEmployees.map(e => e.id))
  }

  async function saveDefault(id: string) {
    const f = defaultForm[id]
    if (!f) return
    setSavingDefaultId(id)
    const { error } = await supabase.from('salary_defaults').update({
      base_salary: Number(f.base_salary) || 0,
      position_allowance: Number(f.position_allowance) || 0,
      meal_allowance: Number(f.meal_allowance) || 0,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) showMsg('error', 'Gagal menyimpan gaji standar: ' + error.message)
    else { showMsg('success', 'Gaji standar diperbarui. Ini TIDAK mengubah gaji karyawan yang sudah diatur — pakai "Terapkan Gaji Standar" untuk itu.'); await fetchData() }
    setSavingDefaultId(null)
  }

  async function saveUniversalLateRate() {
    setSavingLateRate(true)
    // Berlaku untuk SEMUA baris Gaji Standar sekaligus — memang cuma 1 tarif untuk semua staff,
    // bukan per-label. Tidak menyentuh salary_components siapa pun; perhitungan gaji langsung
    // baca dari sini (lihat lib penggajian), jadi begitu disimpan langsung berlaku bulan berjalan.
    const { error } = await supabase.from('salary_defaults').update({ late_penalty_per_minute: Number(universalLateRate) || 0 })
    if (error) showMsg('error', 'Gagal menyimpan tarif keterlambatan: ' + error.message)
    else showMsg('success', 'Tarif keterlambatan universal diperbarui — langsung berlaku untuk semua staff.')
    await fetchData()
    setSavingLateRate(false)
  }

  async function applyDefaultToSelected() {
    const def = defaults.find(d => d.id === applyDefaultId)
    if (!def) { showMsg('error', 'Pilih gaji standar dulu.'); return }
    if (selectedIds.length === 0) { showMsg('error', 'Pilih karyawan dulu.'); return }
    setApplying(true)

    let successCount = 0
    let failCount = 0
    for (const empId of selectedIds) {
      // Cari baris salary_components dengan effective_date PERSIS sama — kalau ada, koreksi baris
      // itu (dianggap revisi hari yang sama); kalau tidak, tambah baris riwayat baru. Ini juga
      // sekalian membenahi bug lama: form edit per-karyawan dulu selalu menimpa baris terakhir
      // walau tanggal efektifnya beda.
      const { data: existing } = await supabase.from('salary_components')
        .select('id, special_allowance')
        .eq('employee_id', empId).eq('effective_date', applyDate).maybeSingle()

      // Kalau baris baru (bukan koreksi hari yang sama), bawa serta tunjangan khusus &
      // tarif lembur dari baris terakhir karyawan ini — bukan di-reset ke 0. Modal
      // konfirmasi eksplisit bilang "tunjangan khusus masing-masing tidak ikut berubah".
      let carrySpecial = 0
      let carryOvertime = 0
      if (!existing) {
        const { data: latest } = await supabase.from('salary_components')
          .select('special_allowance, overtime_rate_per_hour')
          .eq('employee_id', empId)
          .order('effective_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (latest) {
          carrySpecial = Number(latest.special_allowance) || 0
          carryOvertime = Number(latest.overtime_rate_per_hour) || 0
        }
      }

      const payload = {
        employee_id: empId,
        effective_date: applyDate,
        base_salary: def.base_salary,
        position_allowance: def.position_allowance,
        meal_allowance: def.meal_allowance,
      }
      const { error } = existing
        ? await supabase.from('salary_components').update(payload).eq('id', existing.id)
        : await supabase.from('salary_components').insert([{ ...payload, special_allowance: carrySpecial, overtime_rate_per_hour: carryOvertime }])

      if (error) failCount++
      else successCount++
    }

    setApplying(false)
    setShowApplyModal(false)
    setSelectedIds([])
    if (failCount === 0) showMsg('success', `Gaji standar diterapkan ke ${successCount} karyawan.`)
    else showMsg('error', `${successCount} berhasil, ${failCount} gagal diterapkan.`)
    await fetchData()
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Komponen Gaji</h1>
          <p className="text-sm text-slate-500">Kelola daftar gaji pokok, tunjangan, dan potongan untuk setiap karyawan.</p>
        </div>
        <button onClick={() => setShowDefaultEditor(v => !v)}
          className="text-sm text-blue-600 hover:underline font-medium whitespace-nowrap">
          {showDefaultEditor ? 'Tutup' : 'Kelola'} Gaji Standar
        </button>
      </div>

      {message && (
        <div className={`p-3 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {showDefaultEditor && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Gaji Standar</h2>
          <p className="text-xs text-slate-500 mb-4">Acuan untuk mengisi form karyawan baru dan tombol &quot;Terapkan Gaji Standar&quot; di bawah. Mengubah angka di sini TIDAK otomatis mengubah gaji karyawan yang sudah diatur sebelumnya.</p>
          <div className="space-y-4">
            {defaults.map(d => {
              const f = defaultForm[d.id] || { base_salary: '0', position_allowance: '0', meal_allowance: '0' }
              return (
                <div key={d.id} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                  <div className="sm:col-span-1">
                    <label className="text-xs font-medium text-slate-500 block mb-1">Label</label>
                    <p className="text-sm font-semibold text-slate-800">{d.label}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 block mb-1">Gaji Pokok</label>
                    <input type="number" value={f.base_salary} onChange={e => setDefaultForm(p => ({ ...p, [d.id]: { ...f, base_salary: e.target.value } }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 block mb-1">Tunjangan Jabatan</label>
                    <input type="number" value={f.position_allowance} onChange={e => setDefaultForm(p => ({ ...p, [d.id]: { ...f, position_allowance: e.target.value } }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-slate-500 block mb-1">Tunjangan Tetap</label>
                      <input type="number" value={f.meal_allowance} onChange={e => setDefaultForm(p => ({ ...p, [d.id]: { ...f, meal_allowance: e.target.value } }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
                    </div>
                    <button onClick={() => saveDefault(d.id)} disabled={savingDefaultId === d.id}
                      className="self-end px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition disabled:opacity-50">
                      {savingDefaultId === d.id ? '...' : 'Simpan'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div className="sm:col-span-1">
              <p className="text-sm font-semibold text-slate-800">Tarif Keterlambatan</p>
              <p className="text-xs text-slate-500">Berlaku untuk semua staff, bukan per orang</p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Rp / menit</label>
              <input type="number" value={universalLateRate} onChange={e => setUniversalLateRate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
            </div>
            <button onClick={saveUniversalLateRate} disabled={savingLateRate}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition disabled:opacity-50 w-fit">
              {savingLateRate ? '...' : 'Simpan Tarif Universal'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Cari nama karyawan..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <svg className="w-4 h-4 absolute left-3 top-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          {selectedIds.length > 0 && (
            <button onClick={() => setShowApplyModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition whitespace-nowrap">
              Terapkan Gaji Standar ({selectedIds.length})
            </button>
          )}
        </div>

        {/* Tabel */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 w-10 text-center">
                  <input type="checkbox" checked={selectedIds.length > 0 && selectedIds.length === filteredEmployees.length}
                    onChange={toggleSelectAll} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jabatan & Cabang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status Tipe</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Gaji Pokok Saat Ini</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data karyawan...</td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ditemukan karyawan.</td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.id} className={`hover:bg-slate-50 transition ${selectedIds.includes(emp.id) ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => toggleSelect(emp.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-800">{emp.full_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-700">{emp.position_name}</div>
                      <div className="text-xs text-slate-500">{emp.branch_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {translateType(emp.employee_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {emp.base_salary !== null ? (
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{formatRupiah(emp.base_salary)}</div>
                          <div className="text-[10px] text-slate-400">Efektif: {new Date(emp.effective_date!).toLocaleDateString('id-ID')}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-red-500 italic">Belum Diatur</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/penggajian/komponen/${emp.id}`}
                        className="inline-flex items-center px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition shadow-sm"
                      >
                        Atur Komponen & Histori
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showApplyModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Terapkan Gaji Standar</h2>
              <p className="text-xs text-slate-500 mb-4 pb-3 border-b border-slate-100">
                Akan menimpa gaji pokok, tunjangan jabatan, dan tunjangan tetap {selectedIds.length} karyawan terpilih. Tunjangan khusus masing-masing (kalau ada) tidak ikut berubah.
              </p>
              {defaults.length > 1 && (
                <>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Pakai Gaji Standar</label>
                  <select value={applyDefaultId} onChange={e => setApplyDefaultId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4 bg-white">
                    {defaults.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </>
              )}
              <label className="block text-sm font-medium text-slate-700 mb-1">Efektif Mulai Tanggal</label>
              <input type="date" value={applyDate} onChange={e => setApplyDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4" />

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowApplyModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                  Batal
                </button>
                <button type="button" onClick={applyDefaultToSelected} disabled={applying}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                  {applying ? 'Menerapkan...' : 'Terapkan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
