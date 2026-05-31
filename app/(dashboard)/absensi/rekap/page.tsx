'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// --- Types ---
type Branch = { id: string; name: string }
type Department = { id: string; name: string }
type Employee = { id: string; full_name: string; branch_id: string; department_id: string }
type WorkSchedule = { id: string; name: string; check_in_time: string; check_out_time: string; applies_to_dept: string }
type Attendance = {
  id: string
  date: string
  check_in: string | null
  check_out: string | null
  late_minutes: number
  overtime_hours: number
  status: string
  notes: string | null
  employees: { full_name: string; branch_id: string; department_id: string; branches: { name: string }; departments: { name: string } }
}

export default function RekapAbsensiPage() {
  const [attendances, setAttendances] = useState<Attendance[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  
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

  // Edit keterlambatan
  const [editModal, setEditModal] = useState<Attendance | null>(null)
  const [editLateMins, setEditLateMins] = useState(0)
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Modal tambah keterangan tidak hadir
  const [absenModal, setAbsenModal] = useState(false)
  const [absenForm, setAbsenForm] = useState({ employee_id: '', date: '', status: 'absent', notes: '' })
  const [absenSaving, setAbsenSaving] = useState(false)
  
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
    const [bRes, dRes, eRes, sRes] = await Promise.all([
      supabase.from('branches').select('id, name').order('name'),
      supabase.from('departments').select('id, name').order('name'),
      supabase.from('employees').select('id, full_name, branch_id, department_id').eq('is_active', true).order('full_name'),
      supabase.from('work_schedules').select('id, name, check_in_time, check_out_time, applies_to_dept')
    ])
    if (bRes.data) setBranches(bRes.data)
    if (dRes.data) setDepartments(dRes.data)
    if (eRes.data) setEmployees(eRes.data)
    if (sRes.data) setSchedules(sRes.data)
  }

  // Cari jadwal berdasarkan department_id karyawan
  function getScheduleForDept(deptId: string): WorkSchedule | null {
    return schedules.find(s => s.applies_to_dept === deptId) ?? null
  }

  // Format jam: "07:00:00" → "07:00"
  function fmtTime(t: string | null | undefined): string {
    if (!t) return '—'
    return t.substring(0, 5)
  }

  async function fetchAttendances() {
    setLoading(true)
    let query = supabase
      .from('attendances')
      .select(`
        id, date, check_in, check_out, late_minutes, overtime_hours, status, notes,
        employees!inner(full_name, branch_id, department_id, branches(name), departments(name))
      `)
      .order('date', { ascending: true })
      .order('employees(full_name)')

    // Filter By Period — cut-off sistem: 26 bulan lalu s/d 25 bulan ini
    // Contoh: filter "2026-05" → ambil data 26 Apr – 25 Mei 2026
    if (filterMonth) {
      const [year, month] = filterMonth.split('-').map(Number)
      const pad = (n: number) => String(n).padStart(2, '0')
      const prevMonth = month === 1 ? 12 : month - 1
      const prevYear  = month === 1 ? year - 1 : year
      const firstDay  = `${prevYear}-${pad(prevMonth)}-26`
      const lastDay   = `${year}-${pad(month)}-25`
      query = query.gte('date', firstDay).lte('date', lastDay)
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

  async function handleSaveAbsen(e: React.FormEvent) {
    e.preventDefault()
    if (!absenForm.employee_id || !absenForm.date) { showMessage('error', 'Lengkapi data karyawan dan tanggal.'); return }
    setAbsenSaving(true)
    const { error } = await supabase.from('attendances').upsert({
      employee_id: absenForm.employee_id,
      date: absenForm.date,
      check_in: null,
      check_out: null,
      late_minutes: 0,
      overtime_hours: 0,
      status: absenForm.status,
      notes: absenForm.notes || null,
    }, { onConflict: 'employee_id,date' })
    if (error) {
      showMessage('error', 'Gagal menyimpan: ' + error.message)
    } else {
      showMessage('success', 'Keterangan tidak hadir berhasil disimpan.')
      setAbsenModal(false)
      fetchAttendances()
    }
    setAbsenSaving(false)
  }

  async function handleEditLate(e: React.FormEvent) {
    e.preventDefault()
    if (!editModal) return
    if (!editNotes.trim()) { showMessage('error', 'Wajib isi alasan penyesuaian.'); return }
    setEditSaving(true)
    const { error } = await supabase
      .from('attendances')
      .update({ late_minutes: editLateMins, notes: editNotes })
      .eq('id', editModal.id)
    if (error) {
      showMessage('error', 'Gagal menyimpan: ' + error.message)
    } else {
      showMessage('success', 'Keterlambatan berhasil disesuaikan.')
      setEditModal(null)
      fetchAttendances()
    }
    setEditSaving(false)
  }

  // Label status — didefinisikan di luar JSX agar tidak konflik dengan TypeScript generic
  const STATUS_LABEL: {[k: string]: string} = {
    present: 'Hadir', absent: 'Alpha', sick: 'Sakit', permission: 'Izin', leave: 'Libur'
  }

  // Summary kalkulasi dari data yang sedang ditampilkan
  const totalTelat   = attendances.reduce((s, a) => s + (a.late_minutes ?? 0), 0)
  const totalLembur  = attendances.reduce((s, a) => s + Number(a.overtime_hours ?? 0), 0)
  const totalHadir   = attendances.filter(a => a.status === 'present').length
  const totalAlpha   = attendances.filter(a => a.status === 'absent').length
  const totalSakit   = attendances.filter(a => a.status === 'sick').length
  const totalIzin    = attendances.filter(a => a.status === 'permission').length
  const totalLibur   = attendances.filter(a => a.status === 'leave').length

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
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Rekap Absensi</h1>
          <p className="text-sm text-slate-500">Pantau kehadiran harian dan hitung keterlambatan/lembur.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setAbsenModal(true); setAbsenForm({ employee_id: filterEmployee || '', date: new Date().toISOString().split('T')[0], status: 'absent', notes: '' }) }}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
          >
            📋 Keterangan Tidak Hadir
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
          >
            {showForm ? 'Batal Input' : '+ Input Hadir Manual'}
          </button>
        </div>
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

      {/* Summary Cards */}
      {!loading && attendances.length > 0 && (
        <div className="space-y-3 mb-6">
          {/* Baris 1: Kehadiran */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white rounded-xl border border-green-200 shadow-sm p-3">
              <p className="text-xs font-medium text-green-600 uppercase mb-1">✅ Hadir</p>
              <p className="text-2xl font-bold text-green-700">{totalHadir} <span className="text-xs font-normal text-green-500">hari</span></p>
            </div>
            <div className="bg-red-50 rounded-xl border border-red-200 shadow-sm p-3">
              <p className="text-xs font-medium text-red-600 uppercase mb-1">⛔ Alpha</p>
              <p className="text-2xl font-bold text-red-700">{totalAlpha} <span className="text-xs font-normal text-red-500">hari</span></p>
              <p className="text-xs text-red-400">→ dipotong</p>
            </div>
            <div className="bg-blue-50 rounded-xl border border-blue-200 shadow-sm p-3">
              <p className="text-xs font-medium text-blue-600 uppercase mb-1">🤒 Sakit</p>
              <p className="text-2xl font-bold text-blue-700">{totalSakit} <span className="text-xs font-normal text-blue-500">hari</span></p>
            </div>
            <div className="bg-yellow-50 rounded-xl border border-yellow-200 shadow-sm p-3">
              <p className="text-xs font-medium text-yellow-600 uppercase mb-1">📝 Izin</p>
              <p className="text-2xl font-bold text-yellow-700">{totalIzin} <span className="text-xs font-normal text-yellow-500">hari</span></p>
            </div>
            <div className="bg-slate-50 rounded-xl border border-slate-200 shadow-sm p-3">
              <p className="text-xs font-medium text-slate-500 uppercase mb-1">🏖️ Libur</p>
              <p className="text-2xl font-bold text-slate-600">{totalLibur} <span className="text-xs font-normal text-slate-400">hari</span></p>
            </div>
          </div>
          {/* Baris 2: Telat & Lembur */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-orange-50 rounded-xl border border-orange-200 shadow-sm p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-orange-600 uppercase mb-1">⏰ Total Keterlambatan</p>
                <p className="text-xl font-bold text-orange-700">{totalTelat} menit</p>
              </div>
              <p className="text-sm text-orange-500">{Math.floor(totalTelat/60)}j {totalTelat%60}m</p>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-200 shadow-sm p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-amber-600 uppercase mb-1">🌙 Total Lembur</p>
                <p className="text-xl font-bold text-amber-700">{totalLembur} jam</p>
              </div>
              <p className="text-sm text-amber-500">{totalLembur * 60} menit</p>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Tabel Data */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500 flex-shrink-0 w-12">Periode:</label>
              <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
                className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 outline-none block w-full p-2" />
            </div>
            {filterMonth && (() => {
              const [y, m] = filterMonth.split('-').map(Number)
              const pad = (n: number) => String(n).padStart(2,'0')
              const pm = m===1?12:m-1; const py = m===1?y-1:y
              return <p className="text-xs text-slate-400 pl-14">📅 {py}-{pad(pm)}-26 s/d {y}-{pad(m)}-25</p>
            })()}
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
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Jadwal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Masuk</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Pulang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Terlambat</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Lembur</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat rekap absensi...</td>
                </tr>
              ) : attendances.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data absensi untuk filter ini.</td>
                </tr>
              ) : (
                attendances.map((att) => {
                  const sched = getScheduleForDept((att.employees as any)?.department_id)
                  return (
                  <tr key={att.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800 whitespace-nowrap">
                      {new Date(att.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-800">{att.employees?.full_name}</div>
                      <div className="text-xs text-slate-500">{att.employees?.branches?.name} &bull; {att.employees?.departments?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {sched ? (
                        <div>
                          <div className="text-xs font-semibold text-blue-700">{sched.name}</div>
                          <div className="text-xs text-slate-400">{fmtTime(sched.check_in_time)} – {fmtTime(sched.check_out_time)}</div>
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
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
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        att.status === 'present'    ? 'bg-green-100 text-green-800' :
                        att.status === 'absent'     ? 'bg-red-100 text-red-800' :
                        att.status === 'sick'       ? 'bg-blue-100 text-blue-800' :
                        att.status === 'permission' ? 'bg-yellow-100 text-yellow-800' :
                        att.status === 'leave'      ? 'bg-slate-100 text-slate-600' :
                        'bg-purple-100 text-purple-800'
                      }`}>
                        {STATUS_LABEL[att.status] ?? att.status}
                      </span>
                      {att.notes && <div className="text-xs text-slate-400 mt-0.5 italic">{att.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {att.status === 'present' && att.late_minutes > 0 && (
                        <button
                          onClick={() => { setEditModal(att); setEditLateMins(att.late_minutes); setEditNotes('') }}
                          className="px-2.5 py-1 text-xs font-medium bg-orange-50 border border-orange-200 text-orange-700 rounded-lg hover:bg-orange-100 transition"
                        >
                          Sesuaikan
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    {/* Modals */}
    {/* Modal Sesuaikan Keterlambatan */}
    {editModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={e => { if (e.target === e.currentTarget) setEditModal(null) }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-700">Sesuaikan Keterlambatan</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {editModal.employees?.full_name} — {new Date(editModal.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
          </div>
          <form onSubmit={handleEditLate} className="px-6 py-5 space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-600">
              <span>Tercatat masuk: </span>
              <strong>{formatTimeStr(editModal.check_in)}</strong>
              <span className="mx-2">·</span>
              <span>Telat tersimpan: </span>
              <strong className="text-red-600">{editModal.late_minutes} menit</strong>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Menit Telat Setelah Penyesuaian <span className="text-red-500">*</span>
              </label>
              <input type="number" min="0" required value={editLateMins}
                onChange={e => setEditLateMins(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <p className="text-xs text-slate-400 mt-1">Isi 0 jika ingin menghapus keterlambatan sepenuhnya.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Alasan Penyesuaian <span className="text-red-500">*</span>
              </label>
              <input type="text" required value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                placeholder="Contoh: Izin terlambat karena keperluan keluarga"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditModal(null)}
                className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
              <button type="submit" disabled={editSaving}
                className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                {editSaving ? 'Menyimpan...' : 'Simpan Penyesuaian'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    {/* Modal Keterangan Tidak Hadir */}
    {absenModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={e => { if (e.target === e.currentTarget) setAbsenModal(false) }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-700">Tambah Keterangan Tidak Hadir</h2>
              <p className="text-xs text-slate-500 mt-0.5">Catat alasan ketidakhadiran karyawan</p>
            </div>
            <button onClick={() => setAbsenModal(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
          </div>
          <form onSubmit={handleSaveAbsen} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Karyawan <span className="text-red-500">*</span></label>
              <select required value={absenForm.employee_id} onChange={e => setAbsenForm({...absenForm, employee_id: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Pilih Karyawan --</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal <span className="text-red-500">*</span></label>
              <input type="date" required value={absenForm.date} onChange={e => setAbsenForm({...absenForm, date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Keterangan <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { val: 'absent',     label: '⛔ Alpha',   cls: 'border-red-300 text-red-700 bg-red-50' },
                  { val: 'sick',       label: '🤒 Sakit',   cls: 'border-blue-300 text-blue-700 bg-blue-50' },
                  { val: 'permission', label: '📝 Izin',    cls: 'border-yellow-300 text-yellow-700 bg-yellow-50' },
                  { val: 'leave',      label: '🏖️ Libur',   cls: 'border-slate-300 text-slate-700 bg-slate-50' },
                ].map(opt => (
                  <button key={opt.val} type="button"
                    onClick={() => setAbsenForm({...absenForm, status: opt.val})}
                    className={`py-2.5 text-sm font-medium rounded-lg border-2 transition ${absenForm.status === opt.val ? opt.cls + ' ring-2 ring-offset-1 ring-blue-400' : 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-red-500 mt-1.5">⛔ Alpha → dipotong dari gaji | Lainnya → tidak dipotong</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Catatan (opsional)</label>
              <input type="text" value={absenForm.notes} onChange={e => setAbsenForm({...absenForm, notes: e.target.value})}
                placeholder="Contoh: Sakit demam, ada surat dokter"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setAbsenModal(false)}
                className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
              <button type="submit" disabled={absenSaving || !absenForm.employee_id || !absenForm.date}
                className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                {absenSaving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  )
}
