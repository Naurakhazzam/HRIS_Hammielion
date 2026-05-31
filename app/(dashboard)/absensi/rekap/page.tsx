'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// --- Types ---
type Branch = { id: string; name: string }
type Department = { id: string; name: string }
type Employee = { id: string; full_name: string; branch_id: string; department_id: string }
type Attendance = {
  id: string
  date: string
  check_in: string | null
  check_out: string | null
  late_minutes: number
  overtime_hours: number
  status: string
  notes: string | null
  employees: { full_name: string; branches: { name: string }; departments: { name: string } }
}

export default function RekapAbsensiPage() {
  const [attendances, setAttendances] = useState<Attendance[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  
  const [loading, setLoading] = useState(true)
  
  // Filters
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().substring(0, 7)) // YYYY-MM
  const [filterBranch, setFilterBranch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')

  // Form State
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  // Form Data
  const [formBranchId, setFormBranchId] = useState('')
  const [formData, setFormData] = useState({
    employee_id: '',
    date: new Date().toISOString().split('T')[0],
    check_in: '',
    check_out: '',
    status: 'present',
    notes: ''
  })

  const supabase = createClient()

  useEffect(() => {
    fetchReferenceData()
  }, [])

  useEffect(() => {
    fetchAttendances()
  }, [filterMonth, filterBranch, filterDept, filterEmployee])

  async function fetchReferenceData() {
    const [bRes, dRes, eRes] = await Promise.all([
      supabase.from('branches').select('id, name').order('name'),
      supabase.from('departments').select('id, name').order('name'),
      supabase.from('employees').select('id, full_name, branch_id, department_id').eq('is_active', true).order('full_name')
    ])
    
    if (bRes.data) setBranches(bRes.data)
    if (dRes.data) setDepartments(dRes.data)
    if (eRes.data) setEmployees(eRes.data)
  }

  async function fetchAttendances() {
    setLoading(true)
    let query = supabase
      .from('attendances')
      .select(`
        id, date, check_in, check_out, late_minutes, overtime_hours, status, notes,
        employees!inner(full_name, branch_id, department_id, branches(name), departments(name))
      `)
      .order('date', { ascending: false })
      .order('employees(full_name)')

    // Filter By Month (Y-m)
    if (filterMonth) {
      const startOfMonth = `${filterMonth}-01`
      // Get last day of month
      const [year, month] = filterMonth.split('-')
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
      const endOfMonth = `${filterMonth}-${lastDay}`
      
      query = query.gte('date', startOfMonth).lte('date', endOfMonth)
    }

    if (filterBranch) query = query.eq('employees.branch_id', filterBranch)
    if (filterDept) query = query.eq('employees.department_id', filterDept)
    if (filterEmployee) query = query.eq('employee_id', filterEmployee)

    const { data, error } = await query

    if (error) {
      showMessage('error', 'Gagal memuat rekap absensi: ' + error.message)
    } else {
      setAttendances((data as unknown as Attendance[]) || [])
    }
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  // Get Monday of the week for a given date
  function getMonday(d: Date) {
    d = new Date(d)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    return new Date(d.setDate(diff))
  }

  async function calculateLateAndOvertime(employeeId: string, date: string, checkInTime: string, checkOutTime: string) {
    // Get Employee Dept
    const { data: empData } = await supabase
      .from('employees')
      .select('department_id, departments(name)')
      .eq('id', employeeId)
      .single()

    if (!empData) return { late_minutes: 0, overtime_hours: 0 }

    // Check shift assignment for the week
    const mondayStr = getMonday(new Date(date)).toISOString().split('T')[0]
    let schedule = null

    const { data: shiftData } = await supabase
      .from('shift_assignments')
      .select('work_schedules(check_in_time, check_out_time)')
      .eq('employee_id', employeeId)
      .eq('week_start_date', mondayStr)
      .single()

    if (shiftData && shiftData.work_schedules) {
      // Note: type is tricky here since we selected related table. We access it directly.
      schedule = shiftData.work_schedules as unknown as {check_in_time: string, check_out_time: string}
    } else {
      // Fallback to department schedule
      const { data: schedData } = await supabase
        .from('work_schedules')
        .select('check_in_time, check_out_time')
        .eq('applies_to_dept', empData.department_id)
        .limit(1)
        .single()
      
      if (schedData) schedule = schedData
    }

    if (!schedule) return { late_minutes: 0, overtime_hours: 0 }

    let late_minutes = 0
    let overtime_hours = 0

    // Parse times. Using dummy date to calculate diffs.
    const actualIn = new Date(`1970-01-01T${checkInTime}:00Z`).getTime()
    const schedIn = new Date(`1970-01-01T${schedule.check_in_time}Z`).getTime()
    if (actualIn > schedIn) {
      late_minutes = Math.floor((actualIn - schedIn) / 60000)
    }

    // Overtime logic
    // PRD: Team Gudang always 0 overtime
    const isGudang = (empData.departments as unknown as {name: string})?.name === 'Team Gudang'
    if (!isGudang && checkOutTime) {
      const actualOut = new Date(`1970-01-01T${checkOutTime}:00Z`).getTime()
      const schedOut = new Date(`1970-01-01T${schedule.check_out_time}Z`).getTime()
      if (actualOut > schedOut) {
        overtime_hours = Math.floor((actualOut - schedOut) / 3600000 * 100) / 100
      }
    }

    return { late_minutes, overtime_hours }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    if (!formData.employee_id) {
      showMessage('error', 'Pilih karyawan terlebih dahulu.')
      setSubmitting(false)
      return
    }

    let lateMins = 0
    let overHrs = 0

    // Kalkulasi hanya jika status present dan ada jam masuk
    if (formData.status === 'present' && formData.check_in) {
      const calc = await calculateLateAndOvertime(
        formData.employee_id, 
        formData.date, 
        formData.check_in, 
        formData.check_out
      )
      lateMins = calc.late_minutes
      overHrs = calc.overtime_hours
    }

    // Konversi jam ke TIMESTAMPTZ (Format lokal digabung, lalu ubah ke ISO agar disimpan ke Supabase dengan TZ UTC)
    // Asumsi zona waktu lokal dari browser
    let checkInTz = null
    let checkOutTz = null
    
    if (formData.check_in) {
      checkInTz = new Date(`${formData.date}T${formData.check_in}:00`).toISOString()
    }
    if (formData.check_out) {
      checkOutTz = new Date(`${formData.date}T${formData.check_out}:00`).toISOString()
    }

    const { error } = await supabase
      .from('attendances')
      .insert([{
        employee_id: formData.employee_id,
        date: formData.date,
        check_in: checkInTz,
        check_out: checkOutTz,
        late_minutes: lateMins,
        overtime_hours: overHrs,
        status: formData.status,
        notes: formData.notes || null
      }])

    if (error) {
      // Tangani unique constraint
      if (error.code === '23505') {
        showMessage('error', 'Data absensi untuk karyawan ini pada tanggal tersebut sudah ada.')
      } else {
        showMessage('error', 'Gagal menyimpan absensi: ' + error.message)
      }
    } else {
      showMessage('success', 'Data absensi berhasil disimpan.')
      setShowForm(false)
      setFormData({
        employee_id: '', date: new Date().toISOString().split('T')[0],
        check_in: '', check_out: '', status: 'present', notes: ''
      })
      fetchAttendances()
    }
    setSubmitting(false)
  }

  // Format Helpers
  const formatTimeStr = (isoString: string | null) => {
    if (!isoString) return '-'
    const d = new Date(isoString)
    // Format to local HH:MM
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  }

  // Filter form employees
  const formEmployees = formBranchId 
    ? employees.filter(e => e.branch_id === formBranchId)
    : employees

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Rekap Absensi</h1>
          <p className="text-sm text-slate-500">Pantau kehadiran harian dan hitung keterlambatan/lembur.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
        >
          {showForm ? 'Batal Input' : '+ Input Manual'}
        </button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Form Input Manual */}
      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Input Absensi Manual</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Cabang (Filter)</label>
              <select value={formBranchId} onChange={(e) => setFormBranchId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">Semua Cabang</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Karyawan <span className="text-red-500">*</span></label>
              <select required value={formData.employee_id} onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Pilih Karyawan --</option>
                {formEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Tanggal <span className="text-red-500">*</span></label>
              <input type="date" required value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Status Kehadiran <span className="text-red-500">*</span></label>
              <select required value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="present">Hadir (Present)</option>
                <option value="absent">Mangkir (Absent)</option>
                <option value="leave">Cuti / Izin (Leave)</option>
                <option value="sick">Sakit (Sick)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Jam Masuk</label>
              <input type="time" value={formData.check_in} onChange={(e) => setFormData({...formData, check_in: e.target.value})} disabled={formData.status !== 'present'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Jam Pulang</label>
              <input type="time" value={formData.check_out} onChange={(e) => setFormData({...formData, check_out: e.target.value})} disabled={formData.status !== 'present'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100" />
            </div>

            <div className="space-y-1 lg:col-span-2">
              <label className="text-sm font-medium text-slate-700">Catatan Tambahan</label>
              <input type="text" value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} placeholder="Alasan terlambat, dll"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="md:col-span-2 lg:col-span-4 pt-4 border-t border-slate-100 flex justify-end gap-3">
              <div className="flex-1 hidden md:block">
                <p className="text-xs text-slate-500 italic mt-2">Sistem akan menghitung Keterlambatan dan Lembur secara otomatis berdasarkan jadwal Shift / Departemen.</p>
              </div>
              <button type="submit" disabled={submitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Menyimpan...' : 'Simpan Absensi'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter & Tabel Data */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 flex-shrink-0 w-12">Bulan:</label>
            <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
              className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 outline-none block w-full p-2" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 flex-shrink-0 w-12">Karyawan:</label>
            <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 outline-none block w-full p-2">
              <option value="">Semua Karyawan</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 flex-shrink-0 w-12">Cabang:</label>
            <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 outline-none block w-full p-2">
              <option value="">Semua Cabang</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 flex-shrink-0 w-12">Dept:</label>
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 outline-none block w-full p-2">
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
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Masuk</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Pulang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Terlambat</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Lembur</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat rekap absensi...</td>
                </tr>
              ) : attendances.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data absensi untuk filter ini.</td>
                </tr>
              ) : (
                attendances.map((att) => (
                  <tr key={att.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                      {new Date(att.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-800">{att.employees?.full_name}</div>
                      <div className="text-xs text-slate-500">{att.employees?.branches?.name} &bull; {att.employees?.departments?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-center font-medium text-emerald-600">{formatTimeStr(att.check_in)}</td>
                    <td className="px-4 py-3 text-sm text-center font-medium text-blue-600">{formatTimeStr(att.check_out)}</td>
                    <td className="px-4 py-3 text-center">
                      {att.late_minutes > 0 ? (
                        <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs font-semibold">{att.late_minutes} min</span>
                      ) : <span className="text-slate-400 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {att.overtime_hours > 0 ? (
                        <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-xs font-semibold">{att.overtime_hours} jam</span>
                      ) : <span className="text-slate-400 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${
                        att.status === 'present' ? 'bg-green-100 text-green-800' : 
                        att.status === 'absent' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {att.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
