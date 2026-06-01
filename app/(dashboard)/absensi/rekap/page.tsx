'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Department = { id: string; name: string }
type Employee = { id: string; full_name: string; branch_id: string; department_id: string; join_date: string | null }
type WorkSchedule = { id: string; name: string; check_in_time: string; check_out_time: string; applies_to_dept: string }
type Attendance = {
  id: string; date: string; check_in: string | null; check_out: string | null
  late_minutes: number; overtime_hours: number; status: string; notes: string | null
  employees: { full_name: string; branch_id: string; department_id: string; branches: { name: string }; departments: { name: string } }
}

const STATUS_LABEL: { [k: string]: string } = { present:'Hadir', absent:'Alpha', sick:'Sakit', permission:'Izin', leave:'Libur' }
const STATUS_COLOR: { [k: string]: string } = {
  present:'bg-green-100 text-green-800', absent:'bg-red-100 text-red-800',
  sick:'bg-blue-100 text-blue-800', permission:'bg-yellow-100 text-yellow-800', leave:'bg-slate-100 text-slate-600'
}
// Baris dengan notes "Belum Masuk (Training)" ditampilkan khusus
function getStatusDisplay(att: { status: string; notes: string | null }) {
  if (att.status === 'absent' && att.notes === 'Belum Masuk (Training)') {
    return { label: 'Belum Masuk (Training)', color: 'bg-purple-100 text-purple-700' }
  }
  return { label: STATUS_LABEL[att.status] ?? att.status, color: STATUS_COLOR[att.status] ?? 'bg-purple-100 text-purple-800' }
}

type EditLog = {
  id: string
  created_at: string
  reason: string
  old_check_in: string | null; old_check_out: string | null
  old_status: string; old_late_minutes: number; old_overtime_hours: number
  new_check_in: string | null; new_check_out: string | null
  new_status: string; new_late_minutes: number; new_overtime_hours: number
  editor: { full_name: string } | null
}

export default function RekapAbsensiPage() {
  const supabase = createClient()
  const [attendances, setAttendances] = useState<Attendance[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().substring(0, 7))
  const [filterBranch, setFilterBranch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Role user ──
  const [myRole, setMyRole] = useState('')
  const [myUserId, setMyUserId] = useState('')

  // ── Modal Edit universal (menggantikan editModal lama) ──
  const [editModal, setEditModal] = useState<Attendance | null>(null)
  const [editForm, setEditForm] = useState({
    check_in: '', check_out: '', status: 'present',
    late_minutes: 0, overtime_hours: 0, reason: ''
  })
  const [editSaving, setEditSaving] = useState(false)
  const [editLogs, setEditLogs] = useState<EditLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  const [absenModal, setAbsenModal] = useState(false)
  const [absenForm, setAbsenForm] = useState({ employee_id: '', date: '', status: 'absent', notes: '' })
  const [absenSaving, setAbsenSaving] = useState(false)
  const [formBranchId, setFormBranchId] = useState('')
  const [formData, setFormData] = useState({ employee_id:'', date:new Date().toISOString().split('T')[0], check_in:'', check_out:'', status:'present', notes:'' })

  useEffect(() => { fetchReferenceData(); fetchMyRole() }, [])
  useEffect(() => { fetchAttendances() }, [filterMonth, filterBranch, filterDept, filterEmployee])

  async function fetchMyRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setMyUserId(user.id)
      const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
      if (data) setMyRole(data.role)
    }
  }

  async function fetchReferenceData() {
    const [bRes,dRes,eRes,sRes] = await Promise.all([
      supabase.from('branches').select('id,name').order('name'),
      supabase.from('departments').select('id,name').order('name'),
      supabase.from('employees').select('id,full_name,branch_id,department_id,join_date').eq('is_active',true).order('full_name'),
      supabase.from('work_schedules').select('id,name,check_in_time,check_out_time,applies_to_dept'),
    ])
    if (bRes.data) setBranches(bRes.data)
    if (dRes.data) setDepartments(dRes.data)
    if (eRes.data) setEmployees(eRes.data)
    if (sRes.data) setSchedules(sRes.data)
  }

  async function fetchAttendances() {
    setLoading(true)
    let q = supabase.from('attendances')
      .select('id,date,check_in,check_out,late_minutes,overtime_hours,status,notes,employees!inner(full_name,branch_id,department_id,branches(name),departments(name))')
      .order('date', { ascending: true })
    if (filterMonth) {
      const p = filterMonth.split('-'); const y=parseInt(p[0]); const m=parseInt(p[1])
      const pad = (n: number) => String(n).padStart(2,'0')
      const pm=m===1?12:m-1; const py=m===1?y-1:y
      q = q.gte('date', py+'-'+pad(pm)+'-26').lte('date', y+'-'+pad(m)+'-25')
    }
    if (filterBranch) q = q.eq('employees.branch_id', filterBranch)
    if (filterDept) q = q.eq('employees.department_id', filterDept)
    if (filterEmployee) q = q.eq('employee_id', filterEmployee)
    const { data, error } = await q
    if (error) showMsg('error','Gagal memuat: '+error.message)
    else setAttendances((data as unknown as Attendance[])||[])
    setLoading(false)
  }

  function showMsg(type: 'success'|'error', text: string) {
    setMessage({ type, text }); window.scrollTo({top:0,behavior:'smooth'}); setTimeout(()=>setMessage(null),5000)
  }
  function getScheduleForDept(deptId: string): WorkSchedule|null { return schedules.find(s=>s.applies_to_dept===deptId)??null }
  function fmtTime(t: string|null|undefined): string { return t?t.substring(0,5):'—' }
  const fmtTs = (iso: string|null) => iso ? new Date(iso).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '-'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSubmitting(true)
    if (!formData.employee_id) { showMsg('error','Pilih karyawan.'); setSubmitting(false); return }
    const ci = formData.check_in ? new Date(formData.date+'T'+formData.check_in+':00').toISOString() : null
    const co = formData.check_out ? new Date(formData.date+'T'+formData.check_out+':00').toISOString() : null
    const { error } = await supabase.from('attendances').insert([{ employee_id:formData.employee_id, date:formData.date, check_in:ci, check_out:co, late_minutes:0, overtime_hours:0, status:formData.status, notes:formData.notes||null }])
    if (error) showMsg('error', error.code==='23505'?'Data tanggal ini sudah ada.':'Gagal: '+error.message)
    else { showMsg('success','Absensi disimpan.'); setShowForm(false); setFormData({employee_id:'',date:new Date().toISOString().split('T')[0],check_in:'',check_out:'',status:'present',notes:''}); fetchAttendances() }
    setSubmitting(false)
  }

  async function handleSaveAbsen(e: React.FormEvent) {
    e.preventDefault()
    if (!absenForm.employee_id||!absenForm.date) { showMsg('error','Lengkapi data.'); return }
    setAbsenSaving(true)
    const { error } = await supabase.from('attendances').upsert(
      { employee_id:absenForm.employee_id, date:absenForm.date, check_in:null, check_out:null, late_minutes:0, overtime_hours:0, status:absenForm.status, notes:absenForm.notes||null },
      { onConflict:'employee_id,date' }
    )
    if (error) showMsg('error','Gagal: '+error.message)
    else { showMsg('success','Keterangan disimpan.'); setAbsenModal(false); fetchAttendances() }
    setAbsenSaving(false)
  }

  function openEditModal(att: Attendance) {
    const toTime = (iso: string | null) => {
      if (!iso) return ''
      const d = new Date(iso)
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    }
    setEditModal(att)
    setEditForm({
      check_in: toTime(att.check_in),
      check_out: toTime(att.check_out),
      status: att.status,
      late_minutes: att.late_minutes,
      overtime_hours: Number(att.overtime_hours),
      reason: ''
    })
    fetchEditLogs(att.id)
  }

  async function fetchEditLogs(attendanceId: string) {
    setLoadingLogs(true)
    setEditLogs([])
    const { data } = await supabase
      .from('attendance_edit_logs')
      .select('*')
      .eq('attendance_id', attendanceId)
      .order('created_at', { ascending: false })

    if (data && data.length > 0) {
      // Ambil user_id → employee_id dari tabel users
      const userIds = [...new Set(data.map((d: any) => d.edited_by_user_id))]
      const { data: users } = await supabase
        .from('users')
        .select('id, employee_id')
        .in('id', userIds)

      const empIds = (users || []).map((u: any) => u.employee_id).filter(Boolean)
      const { data: emps } = await supabase.from('employees').select('id, full_name').in('id', empIds)

      const empMap: Record<string, string> = {}
      ;(emps || []).forEach((e: any) => { empMap[e.id] = e.full_name })

      const userEmpMap: Record<string, string> = {}
      ;(users || []).forEach((u: any) => { userEmpMap[u.id] = empMap[u.employee_id] ?? 'Unknown' })

      const logs: EditLog[] = data.map((d: any) => ({
        ...d,
        editor: { full_name: userEmpMap[d.edited_by_user_id] ?? 'Unknown' }
      }))
      setEditLogs(logs)
    } else {
      setEditLogs([])
    }
    setLoadingLogs(false)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editModal) return
    if (!editForm.reason.trim()) { showMsg('error', 'Wajib isi alasan perubahan.'); return }
    setEditSaving(true)

    const newCi = editForm.check_in ? new Date(editModal.date + 'T' + editForm.check_in + ':00').toISOString() : null
    const newCo = editForm.check_out ? new Date(editModal.date + 'T' + editForm.check_out + ':00').toISOString() : null

    // Update attendance
    const { error } = await supabase.from('attendances').update({
      check_in: newCi,
      check_out: newCo,
      status: editForm.status,
      late_minutes: editForm.late_minutes,
      overtime_hours: editForm.overtime_hours,
    }).eq('id', editModal.id)

    if (error) { showMsg('error', 'Gagal: ' + error.message); setEditSaving(false); return }

    // Simpan log
    await supabase.from('attendance_edit_logs').insert({
      attendance_id: editModal.id,
      edited_by_user_id: myUserId,
      old_check_in: editModal.check_in,
      old_check_out: editModal.check_out,
      old_status: editModal.status,
      old_late_minutes: editModal.late_minutes,
      old_overtime_hours: editModal.overtime_hours,
      new_check_in: newCi,
      new_check_out: newCo,
      new_status: editForm.status,
      new_late_minutes: editForm.late_minutes,
      new_overtime_hours: editForm.overtime_hours,
      reason: editForm.reason.trim(),
    })

    showMsg('success', 'Absensi berhasil diperbarui.')
    setEditModal(null)
    fetchAttendances()
    setEditSaving(false)
  }

  // Exclude record "Belum Masuk (Training)" lama & tanggal sebelum join_date dari semua hitungan
  const selectedEmpJoinDate = filterEmployee ? (employees.find(e => e.id === filterEmployee)?.join_date ?? null) : null
  const validAtts = attendances.filter(a => {
    if (a.status === 'absent' && a.notes === 'Belum Masuk (Training)') return false
    if (selectedEmpJoinDate && a.date < selectedEmpJoinDate) return false
    return true
  })

  const totalTelat  = validAtts.reduce((s,a)=>s+(a.late_minutes??0),0)
  const totalLembur = Math.round(validAtts.reduce((s,a)=>s+Number(a.overtime_hours??0),0) * 100) / 100
  const totalHadir  = validAtts.filter(a=>a.status==='present').length
  const totalAlpha  = validAtts.filter(a=>a.status==='absent').length
  const totalSakit  = validAtts.filter(a=>a.status==='sick').length
  const totalIzinDB  = validAtts.filter(a=>a.status==='permission').length
  const totalLiburDB = validAtts.filter(a=>a.status==='leave').length
  const formEmps = formBranchId ? employees.filter(e=>e.branch_id===formBranchId) : employees

  const getPeriodLabel = () => {
    if (!filterMonth) return ''
    const p=filterMonth.split('-'); const y=parseInt(p[0]); const m=parseInt(p[1])
    const pad = (n: number) => String(n).padStart(2,'0')
    const pm=m===1?12:m-1; const py=m===1?y-1:y
    return py+'-'+pad(pm)+'-26 s/d '+y+'-'+pad(m)+'-25'
  }

  // Generate semua tanggal dalam periode (26 bulan lalu s/d 25 bulan ini)
  const generatePeriodDates = (): string[] => {
    if (!filterMonth) return []
    const p=filterMonth.split('-'); const y=parseInt(p[0]); const m=parseInt(p[1])
    const pm=m===1?12:m-1; const py=m===1?y-1:y
    const start = new Date(py, pm-1, 26)
    const end   = new Date(y,  m-1,  25)
    const dates: string[] = []
    const cur = new Date(start)
    const pad = (n: number) => String(n).padStart(2, '0')
    while (cur <= end) {
      dates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`)
      cur.setDate(cur.getDate()+1)
    }
    return dates
  }

  // Buat map date → attendance untuk lookup cepat
  const attendanceByDate = attendances.reduce((map, att) => {
    const key = att.date
    if (!map[key]) map[key] = []
    map[key].push(att)
    return map
  }, {} as Record<string, Attendance[]>)

  // Hitung hari kosong (auto-libur) jika filter karyawan aktif
  const emptyDays  = filterEmployee
    ? generatePeriodDates().filter(d => {
        if (selectedEmpJoinDate && d < selectedEmpJoinDate) return false  // sebelum bergabung
        return !(attendanceByDate[d]?.length > 0)
      }).length
    : 0
  const autoLibur  = Math.min(emptyDays, 4)
  const autoIzin   = Math.max(emptyDays - 4, 0)
  const totalLibur = totalLiburDB + autoLibur
  const totalIzin  = totalIzinDB + autoIzin

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Rekap Absensi</h1>
          <p className="text-sm text-slate-500">Pantau kehadiran harian dan hitung keterlambatan/lembur.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>{setAbsenModal(true);setAbsenForm({employee_id:filterEmployee||'',date:new Date().toISOString().split('T')[0],status:'absent',notes:''})}} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">Keterangan Tidak Hadir</button>
          <button onClick={()=>setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">{showForm?'Batal':'+ Input Hadir Manual'}</button>
        </div>
      </div>

      {message && <div className={`p-4 mb-6 rounded-lg border ${message.type==='success'?'bg-green-50 border-green-200 text-green-700':'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>}

      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Input Absensi Manual</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Cabang</label>
              <select value={formBranchId} onChange={e=>setFormBranchId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none bg-white">
                <option value="">Semua</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Karyawan *</label>
              <select required value={formData.employee_id} onChange={e=>setFormData({...formData,employee_id:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none bg-white">
                <option value="">-- Pilih --</option>
                {formEmps.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Tanggal *</label>
              <input type="date" required value={formData.date} onChange={e=>setFormData({...formData,date:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Status *</label>
              <select required value={formData.status} onChange={e=>setFormData({...formData,status:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none bg-white">
                <option value="present">Hadir</option><option value="absent">Alpha</option>
                <option value="leave">Libur/Cuti</option><option value="sick">Sakit</option><option value="permission">Izin</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Jam Masuk</label>
              <input type="time" value={formData.check_in} onChange={e=>setFormData({...formData,check_in:e.target.value})} disabled={formData.status!=='present'} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none disabled:bg-slate-100" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Jam Pulang</label>
              <input type="time" value={formData.check_out} onChange={e=>setFormData({...formData,check_out:e.target.value})} disabled={formData.status!=='present'} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none disabled:bg-slate-100" />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <label className="text-sm font-medium text-slate-700">Catatan</label>
              <input type="text" value={formData.notes} onChange={e=>setFormData({...formData,notes:e.target.value})} placeholder="Opsional" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
            </div>
            <div className="lg:col-span-4 flex justify-end">
              <button type="submit" disabled={submitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">{submitting?'Menyimpan...':'Simpan'}</button>
            </div>
          </form>
        </div>
      )}

      {!loading && attendances.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white rounded-xl border border-green-200 shadow-sm p-3"><p className="text-xs font-medium text-green-600 uppercase mb-1">Hadir</p><p className="text-2xl font-bold text-green-700">{totalHadir} <span className="text-xs font-normal">hari</span></p></div>
            <div className="bg-red-50 rounded-xl border border-red-200 shadow-sm p-3"><p className="text-xs font-medium text-red-600 uppercase mb-1">Alpha</p><p className="text-2xl font-bold text-red-700">{totalAlpha} <span className="text-xs font-normal">hari</span></p><p className="text-xs text-red-400">dipotong</p></div>
            <div className="bg-blue-50 rounded-xl border border-blue-200 shadow-sm p-3"><p className="text-xs font-medium text-blue-600 uppercase mb-1">Sakit</p><p className="text-2xl font-bold text-blue-700">{totalSakit} <span className="text-xs font-normal">hari</span></p></div>
            <div className="bg-yellow-50 rounded-xl border border-yellow-200 shadow-sm p-3"><p className="text-xs font-medium text-yellow-600 uppercase mb-1">Izin</p><p className="text-2xl font-bold text-yellow-700">{totalIzin} <span className="text-xs font-normal">hari</span></p></div>
            <div className="bg-slate-50 rounded-xl border border-slate-200 shadow-sm p-3"><p className="text-xs font-medium text-slate-500 uppercase mb-1">Libur</p><p className="text-2xl font-bold text-slate-600">{totalLibur} <span className="text-xs font-normal">hari</span></p></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-orange-50 rounded-xl border border-orange-200 shadow-sm p-3 flex items-center justify-between">
              <div><p className="text-xs font-medium text-orange-600 uppercase mb-1">Total Keterlambatan</p><p className="text-xl font-bold text-orange-700">{totalTelat} menit</p></div>
              <p className="text-sm text-orange-500">{Math.floor(totalTelat/60)}j {totalTelat%60}m</p>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-200 shadow-sm p-3 flex items-center justify-between">
              <div><p className="text-xs font-medium text-amber-600 uppercase mb-1">Total Lembur</p><p className="text-xl font-bold text-amber-700">{totalLembur} jam</p></div>
              <p className="text-sm text-amber-500">{Math.round(totalLembur*60)} menit</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Periode</label>
            <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg outline-none block w-full p-2" />
            {filterMonth && <p className="text-xs text-slate-400 mt-1">{getPeriodLabel()}</p>}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Karyawan</label>
            <select value={filterEmployee} onChange={e=>setFilterEmployee(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg outline-none block w-full p-2">
              <option value="">Semua Karyawan</option>
              {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Cabang</label>
            <select value={filterBranch} onChange={e=>setFilterBranch(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg outline-none block w-full p-2">
              <option value="">Semua Cabang</option>
              {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Departemen</label>
            <select value={filterDept} onChange={e=>setFilterDept(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg outline-none block w-full p-2">
              <option value="">Semua Departemen</option>
              {departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Jadwal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Masuk</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Pulang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Telat</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Lembur</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
              ) : filterEmployee ? (
                // Mode per karyawan: tampilkan SEMUA tanggal dalam periode
                generatePeriodDates().map(dateStr => {
                  const dayAtts = attendanceByDate[dateStr] || []
                  const dateObj  = new Date(dateStr + 'T00:00:00')
                  const dateLabel = dateObj.toLocaleDateString('id-ID', { weekday:'short', day:'2-digit', month:'short' })
                  const emp = employees.find(e => e.id === filterEmployee)

                  // Tanggal sebelum join_date → tampilkan "Belum Bergabung", abaikan dari semua hitungan
                  if (emp?.join_date && dateStr < emp.join_date) {
                    return (
                      <tr key={dateStr} className="bg-slate-50/20">
                        <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{dateLabel}</td>
                        <td className="px-4 py-3"><div className="text-sm text-slate-300">{emp?.full_name}</div></td>
                        <td colSpan={6} className="px-4 py-3 text-center">
                          <span className="text-xs text-slate-300 italic">—</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-400">Belum Bergabung</span>
                        </td>
                      </tr>
                    )
                  }

                  if (dayAtts.length === 0) {
                    // Tanggal tanpa data — default tampil sebagai Libur
                    const sched = emp ? getScheduleForDept(emp.department_id) : null
                    return (
                      <tr key={dateStr} className="hover:bg-slate-50 transition bg-slate-50/40">
                        <td className="px-4 py-3 text-sm font-semibold text-slate-500 whitespace-nowrap">{dateLabel}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-500">{emp?.full_name ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {sched ? (
                            <div>
                              <div className="text-xs font-semibold text-blue-300">{sched.name}</div>
                              <div className="text-xs text-slate-300">{fmtTime(sched.check_in_time)} – {fmtTime(sched.check_out_time)}</div>
                            </div>
                          ) : <span className="text-slate-200 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center"><span className="text-slate-300 text-xs">—</span></td>
                        <td className="px-4 py-3 text-center"><span className="text-slate-300 text-xs">—</span></td>
                        <td className="px-4 py-3 text-center"><span className="text-slate-300 text-xs">—</span></td>
                        <td className="px-4 py-3 text-center"><span className="text-slate-300 text-xs">—</span></td>
                        <td className="px-4 py-3 text-center">
                          <span className="bg-slate-100 text-slate-500 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium">Libur</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp && (
                            <button
                              onClick={() => {
                                setAbsenModal(true)
                                setAbsenForm({ employee_id: emp.id, date: dateStr, status: 'leave', notes: '' })
                              }}
                              className="px-2.5 py-1 text-xs font-medium bg-slate-100 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-200 transition"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  }

                  // Tanggal dengan data — render tiap record normal
                  return dayAtts.map(att => {
                    const deptId = (att.employees as any)?.department_id
                    const sched  = getScheduleForDept(deptId)
                    return (
                      <tr key={att.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-semibold text-slate-800 whitespace-nowrap">{dateLabel}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-800">{att.employees?.full_name}</div>
                          <div className="text-xs text-slate-500">{att.employees?.branches?.name} · {att.employees?.departments?.name}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {sched ? (
                            <div>
                              <div className="text-xs font-semibold text-blue-700">{sched.name}</div>
                              <div className="text-xs text-slate-400">{fmtTime(sched.check_in_time)} – {fmtTime(sched.check_out_time)}</div>
                            </div>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-center font-medium text-emerald-600">{fmtTs(att.check_in)}</td>
                        <td className="px-4 py-3 text-sm text-center font-medium text-blue-600">{fmtTs(att.check_out)}</td>
                        <td className="px-4 py-3 text-center">
                          {att.late_minutes > 0 ? <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs font-semibold">{att.late_minutes} mnt</span> : <span className="text-slate-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {att.overtime_hours > 0 ? <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-xs font-semibold">{att.overtime_hours} jam</span> : <span className="text-slate-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => { const s = getStatusDisplay(att); return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.color}`}>{s.label}</span> })()}
                          {att.notes && att.notes !== 'Belum Masuk (Training)' && <div className="text-xs text-slate-400 mt-0.5 italic">{att.notes}</div>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {['hr','owner','finance'].includes(myRole) && (
                            <button onClick={() => openEditModal(att)} className="px-2.5 py-1 text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 transition">Edit</button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                })
              ) : attendances.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data absensi.</td></tr>
              ) : (
                // Mode semua karyawan: tampilkan hanya yang ada data
                attendances.map(att => {
                  const deptId = (att.employees as any)?.department_id
                  const sched = getScheduleForDept(deptId)
                  return (
                    <tr key={att.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm font-semibold text-slate-800 whitespace-nowrap">{new Date(att.date+'T00:00:00').toLocaleDateString('id-ID',{weekday:'short',day:'2-digit',month:'short'})}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">{att.employees?.full_name}</div>
                        <div className="text-xs text-slate-500">{att.employees?.branches?.name} · {att.employees?.departments?.name}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {sched ? (
                          <div>
                            <div className="text-xs font-semibold text-blue-700">{sched.name}</div>
                            <div className="text-xs text-slate-400">{fmtTime(sched.check_in_time)} – {fmtTime(sched.check_out_time)}</div>
                          </div>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-medium text-emerald-600">{fmtTs(att.check_in)}</td>
                      <td className="px-4 py-3 text-sm text-center font-medium text-blue-600">{fmtTs(att.check_out)}</td>
                      <td className="px-4 py-3 text-center">
                        {att.late_minutes > 0 ? <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs font-semibold">{att.late_minutes} mnt</span> : <span className="text-slate-300 text-xs">-</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {att.overtime_hours > 0 ? <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-xs font-semibold">{att.overtime_hours} jam</span> : <span className="text-slate-300 text-xs">-</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[att.status]??'bg-purple-100 text-purple-800'}`}>{STATUS_LABEL[att.status]??att.status}</span>
                        {att.notes && <div className="text-xs text-slate-400 mt-0.5 italic">{att.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {['hr','owner','finance'].includes(myRole) && (
                          <button onClick={() => openEditModal(att)} className="px-2.5 py-1 text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 transition">Edit</button>
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

      {editModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-6">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-bold text-slate-700">✏️ Edit Absensi</h2>
                <p className="text-xs text-slate-500 mt-0.5">{editModal.employees?.full_name} — {new Date(editModal.date+'T00:00:00').toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})}</p>
              </div>
              <button onClick={()=>setEditModal(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <form onSubmit={handleEditSave} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Jam Masuk</label>
                  <input type="time" value={editForm.check_in} onChange={e=>setEditForm({...editForm,check_in:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Jam Pulang</label>
                  <input type="time" value={editForm.check_out} onChange={e=>setEditForm({...editForm,check_out:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editForm.status} onChange={e=>setEditForm({...editForm,status:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="present">Hadir</option>
                  <option value="permission">Izin</option>
                  <option value="sick">Sakit</option>
                  <option value="absent">Alpha</option>
                  <option value="leave">Libur</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Menit Telat</label>
                  <input type="number" min="0" value={editForm.late_minutes} onChange={e=>setEditForm({...editForm,late_minutes:Math.max(0,parseInt(e.target.value)||0)})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Lembur (jam)</label>
                  <input type="number" min="0" step="0.5" value={editForm.overtime_hours} onChange={e=>setEditForm({...editForm,overtime_hours:Math.max(0,parseFloat(e.target.value)||0)})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alasan Perubahan <span className="text-red-500">*</span></label>
                <input type="text" required value={editForm.reason} onChange={e=>setEditForm({...editForm,reason:e.target.value})} placeholder="Contoh: Koreksi jam masuk, mesin absen error" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={()=>setEditModal(null)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
                <button type="submit" disabled={editSaving} className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">{editSaving?'Menyimpan...':'Simpan Perubahan'}</button>
              </div>
            </form>

            {/* Histori Edit */}
            <div className="border-t border-slate-200 px-6 py-4">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-3">Riwayat Perubahan</p>
              {loadingLogs ? (
                <p className="text-xs text-slate-400">Memuat histori...</p>
              ) : editLogs.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Belum pernah diedit.</p>
              ) : (
                <div className="space-y-3 max-h-48 overflow-y-auto">
                  {editLogs.map(log => (
                    <div key={log.id} className="text-xs bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-slate-700">{log.editor?.full_name ?? '—'}</span>
                        <span className="text-slate-400">{new Date(log.created_at).toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
                      </div>
                      <div className="text-slate-500 italic mb-1">"{log.reason}"</div>
                      <div className="space-y-0.5 text-slate-500">
                        {log.old_status !== log.new_status && <div>Status: <span className="line-through text-red-400">{STATUS_LABEL[log.old_status]}</span> → <span className="text-green-600">{STATUS_LABEL[log.new_status]}</span></div>}
                        {log.old_late_minutes !== log.new_late_minutes && <div>Telat: <span className="line-through text-red-400">{log.old_late_minutes} mnt</span> → <span className="text-green-600">{log.new_late_minutes} mnt</span></div>}
                        {log.old_overtime_hours !== log.new_overtime_hours && <div>Lembur: <span className="line-through text-red-400">{log.old_overtime_hours} jam</span> → <span className="text-green-600">{log.new_overtime_hours} jam</span></div>}
                        {log.old_check_in !== log.new_check_in && <div>Masuk: <span className="line-through text-red-400">{log.old_check_in ? new Date(log.old_check_in).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—'}</span> → <span className="text-green-600">{log.new_check_in ? new Date(log.new_check_in).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—'}</span></div>}
                        {log.old_check_out !== log.new_check_out && <div>Pulang: <span className="line-through text-red-400">{log.old_check_out ? new Date(log.old_check_out).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—'}</span> → <span className="text-green-600">{log.new_check_out ? new Date(log.new_check_out).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—'}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {absenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-bold text-slate-700">Tambah Keterangan Tidak Hadir</h2>
                <p className="text-xs text-slate-500 mt-0.5">Alpha dipotong gaji. Sakit/Izin/Libur tidak dipotong.</p>
              </div>
              <button onClick={()=>setAbsenModal(false)} className="text-slate-400 hover:text-slate-600">x</button>
            </div>
            <form onSubmit={handleSaveAbsen} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Karyawan *</label>
                <select required value={absenForm.employee_id} onChange={e=>setAbsenForm({...absenForm,employee_id:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">-- Pilih Karyawan --</option>
                  {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal *</label>
                <input type="date" required value={absenForm.date} onChange={e=>setAbsenForm({...absenForm,date:e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Keterangan *</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { val:'leave',      label:'Libur',      active:'border-slate-400 bg-slate-50 text-slate-700' },
                    { val:'absent',     label:'Alpha',      active:'border-red-400 bg-red-50 text-red-700' },
                    { val:'sick',       label:'Sakit',      active:'border-blue-400 bg-blue-50 text-blue-700' },
                    { val:'permission', label:'Izin',       active:'border-yellow-400 bg-yellow-50 text-yellow-700' },
                  ].map(({val,label,active})=>(
                    <button key={val} type="button"
                      onClick={()=>setAbsenForm({...absenForm, status:val})}
                      className={'py-2.5 text-sm font-medium rounded-lg border-2 transition '+(absenForm.status===val ? active : 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Catatan (opsional)</label>
                <input type="text" value={absenForm.notes} onChange={e=>setAbsenForm({...absenForm,notes:e.target.value})} placeholder="Contoh: Sakit demam" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={()=>setAbsenModal(false)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
                <button type="submit" disabled={absenSaving||!absenForm.employee_id||!absenForm.date} className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">{absenSaving?'Menyimpan...':'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
