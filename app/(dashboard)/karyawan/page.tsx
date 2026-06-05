'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

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
  // Data Pribadi
  birth_date: string | null
  birth_place: string | null
  gender: string | null
  address: string | null
  religion: string | null
  marital_status: string | null
  dependants: number | null
  // Data Administrasi
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  // Data Darurat
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation: string | null
  // Data Kepegawaian
  education: string | null
  photo_url: string | null
  branches: { id: string; name: string }
  departments: { id: string; name: string }
  positions: { id: string; name: string; department_id: string }
}

const emptyForm = {
  full_name: '', employee_code: '', nik: '', phone: '',
  branch_id: '', department_id: '', position_id: '',
  employee_type: 'permanent', join_date: new Date().toISOString().split('T')[0],
  kpi_bonus_max: '0',
  birth_date: '', birth_place: '', gender: '', address: '',
  religion: '', marital_status: '', dependants: '0',
  bank_name: '', bank_account_number: '', bank_account_name: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
  education: '', photo_url: ''
}

const GENDER_OPTIONS = [{ value: 'male', label: 'Laki-laki' }, { value: 'female', label: 'Perempuan' }]
const RELIGION_OPTIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu']
const MARITAL_OPTIONS = [
  { value: 'single', label: 'Belum Menikah' },
  { value: 'married', label: 'Menikah' },
  { value: 'divorced', label: 'Cerai' },
  { value: 'widowed', label: 'Janda/Duda' },
]
const EDUCATION_OPTIONS = ['SD', 'SMP', 'SMA/SMK', 'D1', 'D2', 'D3', 'S1', 'S2', 'S3']

export default function KaryawanPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [positions, setPositions] = useState<Position[]>([])

  const [loading, setLoading] = useState(true)
  const [filterBranch, setFilterBranch] = useState('')
  const [filterDept, setFilterDept] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [formData, setFormData] = useState(emptyForm)

  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editSubmitting, setEditSubmitting] = useState(false)

  // Detail modal
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null)

  // Photo upload
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null)
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const editPhotoRef = useRef<HTMLInputElement>(null)

  const supabase = createClient()

  useEffect(() => { fetchReferenceData() }, [])
  useEffect(() => { fetchEmployees() }, [filterBranch, filterDept])

  async function fetchReferenceData() {
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
      .select('*, branches(id,name), departments(id,name), positions(id,name,department_id)')
      .order('full_name')
    if (filterBranch) query = query.eq('branch_id', filterBranch)
    if (filterDept) query = query.eq('department_id', filterDept)
    const { data, error } = await query
    if (error) showMessage('error', 'Gagal memuat data: ' + error.message)
    else setEmployees((data as unknown as Employee[]) || [])
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function generateEmployeeCode(): Promise<string> {
    const { data } = await supabase
      .from('employees').select('employee_code').like('employee_code', 'EMP-%')
      .order('employee_code', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      const num = parseInt(data[0].employee_code.replace('EMP-', ''), 10)
      if (!isNaN(num)) return `EMP-${String(num + 1).padStart(3, '0')}`
    }
    return 'EMP-001'
  }

  async function uploadPhoto(file: File, employeeCode: string): Promise<string | null> {
    const ext = file.name.split('.').pop()
    const path = `${employeeCode}_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('employee-photos').upload(path, file, { upsert: true })
    if (error) { console.error('Upload error:', error); return null }
    const { data } = supabase.storage.from('employee-photos').getPublicUrl(path)
    return data.publicUrl
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>, isEdit = false) {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    if (isEdit) { setEditPhotoFile(file); setEditPhotoPreview(preview) }
    else { setPhotoFile(file); setPhotoPreview(preview) }
  }

  function formToPayload(f: typeof emptyForm) {
    return {
      full_name: f.full_name, employee_code: f.employee_code,
      nik: f.nik || null, phone: f.phone || null,
      branch_id: f.branch_id, department_id: f.department_id, position_id: f.position_id,
      employee_type: f.employee_type, join_date: f.join_date,
      kpi_bonus_max: parseFloat(f.kpi_bonus_max) || 0,
      birth_date: f.birth_date || null, birth_place: f.birth_place || null,
      gender: f.gender || null, address: f.address || null,
      religion: f.religion || null, marital_status: f.marital_status || null,
      dependants: parseInt(f.dependants) || 0,
      bank_name: f.bank_name || null,
      bank_account_number: f.bank_account_number || null,
      bank_account_name: f.bank_account_name || null,
      emergency_contact_name: f.emergency_contact_name || null,
      emergency_contact_phone: f.emergency_contact_phone || null,
      emergency_contact_relation: f.emergency_contact_relation || null,
      education: f.education || null,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    if (!formData.branch_id || !formData.department_id || !formData.position_id) {
      showMessage('error', 'Harap isi Cabang, Departemen, dan Jabatan.')
      setSubmitting(false); return
    }
    const payload: any = formToPayload(formData)
    if (photoFile) {
      const url = await uploadPhoto(photoFile, formData.employee_code)
      if (url) payload.photo_url = url
    }
    const { error } = await supabase.from('employees').insert([payload])
    if (error) { showMessage('error', 'Gagal menambah karyawan: ' + error.message) }
    else {
      showMessage('success', 'Karyawan berhasil ditambahkan.')
      setShowForm(false); setFormData(emptyForm)
      setPhotoFile(null); setPhotoPreview(null)
      fetchEmployees()
    }
    setSubmitting(false)
  }

  function openEditModal(emp: Employee) {
    setEditEmployee(emp)
    setEditPhotoFile(null)
    setEditPhotoPreview(emp.photo_url || null)
    setEditForm({
      full_name: emp.full_name, employee_code: emp.employee_code,
      nik: emp.nik || '', phone: emp.phone || '',
      branch_id: emp.branches?.id || '', department_id: emp.departments?.id || '',
      position_id: emp.positions?.id || '', employee_type: emp.employee_type,
      join_date: emp.join_date || '', kpi_bonus_max: String(emp.kpi_bonus_max || 0),
      birth_date: emp.birth_date || '', birth_place: emp.birth_place || '',
      gender: emp.gender || '', address: emp.address || '',
      religion: emp.religion || '', marital_status: emp.marital_status || '',
      dependants: String(emp.dependants || 0),
      bank_name: emp.bank_name || '', bank_account_number: emp.bank_account_number || '',
      bank_account_name: emp.bank_account_name || '',
      emergency_contact_name: emp.emergency_contact_name || '',
      emergency_contact_phone: emp.emergency_contact_phone || '',
      emergency_contact_relation: emp.emergency_contact_relation || '',
      education: emp.education || '', photo_url: emp.photo_url || ''
    })
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editEmployee) return
    setEditSubmitting(true)
    const payload: any = formToPayload(editForm)
    if (editPhotoFile) {
      const url = await uploadPhoto(editPhotoFile, editForm.employee_code)
      if (url) payload.photo_url = url
    }
    const { error } = await supabase.from('employees').update(payload).eq('id', editEmployee.id)
    if (error) { showMessage('error', 'Gagal mengupdate: ' + error.message) }
    else { showMessage('success', 'Data karyawan berhasil diupdate.'); setEditEmployee(null); fetchEmployees() }
    setEditSubmitting(false)
  }

  async function toggleStatus(id: string, cur: boolean) {
    const { error } = await supabase.from('employees').update({ is_active: !cur }).eq('id', id)
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else { showMessage('success', 'Status berhasil diubah'); fetchEmployees() }
  }

  async function handleDelete(emp: Employee) {
    if (!confirm(`Hapus karyawan "${emp.full_name}"?\n\nTindakan ini tidak dapat dibatalkan.`)) return
    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', `"${emp.full_name}" berhasil dihapus.`); fetchEmployees() }
  }

  const filteredPositionsFor = (deptId: string) => positions.filter(p => p.department_id === deptId)
  const translateType = (t: string) => ({ permanent: 'Karyawan Tetap', driver: 'Driver', freelance: 'Freelance', training: 'Training', contract: 'Kontrak' }[t] || t)
  const translateMarital = (v: string) => MARITAL_OPTIONS.find(x => x.value === v)?.label || v
  const translateGender = (v: string) => GENDER_OPTIONS.find(x => x.value === v)?.label || v

  // ── Komponen Form Field ──────────────────────────────────────────────────────
  const FormField = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="text-sm font-medium text-slate-700">{label} {required && <span className="text-red-500">*</span>}</label>
      {children}
    </div>
  )

  const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
  const selectClass = inputClass + " bg-white"

  // ── Render Form ──────────────────────────────────────────────────────────────
  const renderForm = (f: typeof emptyForm, setF: (v: any) => void, isEdit = false) => {
    const photoPreviewSrc = isEdit ? editPhotoPreview : photoPreview
    const photoInputRef = isEdit ? editPhotoRef : photoRef
    return (
      <div className="space-y-6">
        {/* Foto */}
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
            {photoPreviewSrc
              ? <img src={photoPreviewSrc} alt="foto" className="w-full h-full object-cover" />
              : <span className="text-3xl text-slate-300">👤</span>
            }
          </div>
          <div>
            <button type="button" onClick={() => photoInputRef.current?.click()}
              className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition">
              {photoPreviewSrc ? 'Ganti Foto' : 'Upload Foto'}
            </button>
            <p className="text-xs text-slate-400 mt-1">JPG, PNG. Maks 2MB.</p>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => handlePhotoChange(e, isEdit)} />
          </div>
        </div>

        {/* ─ Data Kepegawaian ─ */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">Data Kepegawaian</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FormField label="Nama Lengkap" required>
              <input type="text" required value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Kode Karyawan" required>
              <input type="text" required value={f.employee_code} onChange={e => setF({ ...f, employee_code: e.target.value })} className={inputClass + ' uppercase'} />
            </FormField>
            <FormField label="Tipe Karyawan" required>
              <select required value={f.employee_type} onChange={e => setF({ ...f, employee_type: e.target.value })} className={selectClass}>
                <option value="permanent">Karyawan Tetap</option>
                <option value="driver">Sopir (Driver)</option>
                <option value="freelance">Borongan / Freelance</option>
                <option value="training">Training</option>
                <option value="contract">Kontrak</option>
              </select>
            </FormField>
            <FormField label="Cabang" required>
              <select required value={f.branch_id} onChange={e => setF({ ...f, branch_id: e.target.value })} className={selectClass}>
                <option value="">-- Pilih Cabang --</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FormField>
            <FormField label="Departemen" required>
              <select required value={f.department_id} onChange={e => setF({ ...f, department_id: e.target.value, position_id: '' })} className={selectClass}>
                <option value="">-- Pilih Departemen --</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FormField>
            <FormField label="Jabatan" required>
              <select required value={f.position_id} onChange={e => {
                const selectedPos = positions.find(p => p.id === e.target.value)
                const autoType = selectedPos?.name?.toLowerCase() === 'driver' ? 'driver' : f.employee_type
                setF({ ...f, position_id: e.target.value, employee_type: autoType })
              }} disabled={!f.department_id} className={selectClass + (!f.department_id ? ' disabled:bg-slate-100' : '')}>
                <option value="">{f.department_id ? '-- Pilih Jabatan --' : 'Pilih Dept Dahulu'}</option>
                {filteredPositionsFor(f.department_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="Tanggal Bergabung" required>
              <input type="date" required value={f.join_date} onChange={e => setF({ ...f, join_date: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Pendidikan Terakhir">
              <select value={f.education} onChange={e => setF({ ...f, education: e.target.value })} className={selectClass}>
                <option value="">-- Pilih --</option>
                {EDUCATION_OPTIONS.map(ed => <option key={ed} value={ed}>{ed}</option>)}
              </select>
            </FormField>
            <FormField label="Nominal Bonus KPI Maks (Rp)">
              <input type="number" min="0" value={f.kpi_bonus_max} onChange={e => setF({ ...f, kpi_bonus_max: e.target.value })} className={inputClass} />
            </FormField>
          </div>
        </div>

        {/* ─ Data Pribadi ─ */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">Data Pribadi</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FormField label="NIK (KTP)">
              <input type="text" value={f.nik} onChange={e => setF({ ...f, nik: e.target.value })} maxLength={16} className={inputClass} />
            </FormField>
            <FormField label="Tempat Lahir">
              <input type="text" value={f.birth_place} onChange={e => setF({ ...f, birth_place: e.target.value })} className={inputClass} placeholder="Kota kelahiran" />
            </FormField>
            <FormField label="Tanggal Lahir">
              <input type="date" value={f.birth_date} onChange={e => setF({ ...f, birth_date: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Jenis Kelamin">
              <select value={f.gender} onChange={e => setF({ ...f, gender: e.target.value })} className={selectClass}>
                <option value="">-- Pilih --</option>
                {GENDER_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </FormField>
            <FormField label="Agama">
              <select value={f.religion} onChange={e => setF({ ...f, religion: e.target.value })} className={selectClass}>
                <option value="">-- Pilih --</option>
                {RELIGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </FormField>
            <FormField label="Status Pernikahan">
              <select value={f.marital_status} onChange={e => setF({ ...f, marital_status: e.target.value })} className={selectClass}>
                <option value="">-- Pilih --</option>
                {MARITAL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </FormField>
            <FormField label="Jumlah Tanggungan">
              <input type="number" min="0" value={f.dependants} onChange={e => setF({ ...f, dependants: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Nomor HP">
              <input type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="0812..." className={inputClass} />
            </FormField>
            <div className="md:col-span-2 lg:col-span-1 space-y-1">
              <label className="text-sm font-medium text-slate-700">Alamat Domisili</label>
              <textarea value={f.address} onChange={e => setF({ ...f, address: e.target.value })} rows={2} className={inputClass} placeholder="Alamat lengkap" />
            </div>
          </div>
        </div>

        {/* ─ Data Rekening ─ */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">Data Rekening Bank</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="Nama Bank">
              <input type="text" value={f.bank_name} onChange={e => setF({ ...f, bank_name: e.target.value })} placeholder="BCA / BRI / Mandiri..." className={inputClass} />
            </FormField>
            <FormField label="Nomor Rekening">
              <input type="text" value={f.bank_account_number} onChange={e => setF({ ...f, bank_account_number: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Nama Pemilik Rekening">
              <input type="text" value={f.bank_account_name} onChange={e => setF({ ...f, bank_account_name: e.target.value })} className={inputClass} />
            </FormField>
          </div>
        </div>

        {/* ─ Kontak Darurat ─ */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">Kontak Darurat</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="Nama Kontak">
              <input type="text" value={f.emergency_contact_name} onChange={e => setF({ ...f, emergency_contact_name: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Nomor Telepon">
              <input type="tel" value={f.emergency_contact_phone} onChange={e => setF({ ...f, emergency_contact_phone: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Hubungan">
              <input type="text" value={f.emergency_contact_relation} onChange={e => setF({ ...f, emergency_contact_relation: e.target.value })} placeholder="Ayah / Ibu / Suami / Istri..." className={inputClass} />
            </FormField>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Data Karyawan</h1>
          <p className="text-sm text-slate-500">Kelola informasi seluruh karyawan perusahaan.</p>
        </div>
        <button
          onClick={async () => {
            if (!showForm) {
              const code = await generateEmployeeCode()
              setFormData({ ...emptyForm, employee_code: code, join_date: new Date().toISOString().split('T')[0] })
            }
            setShowForm(!showForm)
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm"
        >
          {showForm ? 'Batal Tambah' : '+ Tambah Karyawan'}
        </button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Form Tambah */}
      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-5 pb-2 border-b border-slate-100">Form Tambah Karyawan Baru</h2>
          <form onSubmit={handleSubmit}>
            {renderForm(formData, setFormData, false)}
            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">Batal</button>
              <button type="submit" disabled={submitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Menyimpan...' : 'Simpan Data'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter & Tabel */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500">Cabang:</label>
            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 block w-full p-2">
              <option value="">Semua Cabang</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500">Dept:</label>
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 block w-full p-2">
              <option value="">Semua Departemen</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jabatan / Dept</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tipe</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data karyawan.</td></tr>
              ) : (
                employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {emp.photo_url
                            ? <img src={emp.photo_url} alt={emp.full_name} className="w-full h-full object-cover" />
                            : <span className="text-slate-400 text-sm">👤</span>
                          }
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-800">{emp.full_name}</div>
                          <div className="text-xs text-slate-400">{emp.employee_code}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-700">{emp.positions?.name}</div>
                      <div className="text-xs text-slate-500">{emp.departments?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{emp.branches?.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{translateType(emp.employee_type)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${emp.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {emp.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDetailEmployee(emp)}
                          className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded transition">
                          Detail
                        </button>
                        <button onClick={() => openEditModal(emp)}
                          className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition">
                          Edit
                        </button>
                        <button onClick={() => toggleStatus(emp.id, emp.is_active)}
                          className={`text-xs px-2.5 py-1 rounded font-medium transition ${emp.is_active ? 'text-orange-600 hover:bg-orange-50 border border-orange-200' : 'text-green-600 hover:bg-green-50 border border-green-200'}`}>
                          {emp.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button onClick={() => handleDelete(emp)}
                          className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">
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

      {/* Modal Detail */}
      {detailEmployee && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-700">Detail Karyawan</h2>
              <button onClick={() => setDetailEmployee(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition">✕ Tutup</button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-slate-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {detailEmployee.photo_url
                    ? <img src={detailEmployee.photo_url} alt={detailEmployee.full_name} className="w-full h-full object-cover" />
                    : <span className="text-3xl">👤</span>
                  }
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{detailEmployee.full_name}</h3>
                  <p className="text-sm text-slate-500">{detailEmployee.employee_code} · {detailEmployee.positions?.name} · {detailEmployee.branches?.name}</p>
                  <span className={`inline-flex mt-1 items-center px-2 py-0.5 rounded text-xs font-medium ${detailEmployee.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {detailEmployee.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
              </div>

              {/* Grid Info */}
              {[
                { title: 'Data Kepegawaian', rows: [
                  ['Tipe', translateType(detailEmployee.employee_type)],
                  ['Departemen', detailEmployee.departments?.name],
                  ['Tanggal Bergabung', detailEmployee.join_date ? new Date(detailEmployee.join_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'],
                  ['Pendidikan', detailEmployee.education || '-'],
                ]},
                { title: 'Data Pribadi', rows: [
                  ['NIK', detailEmployee.nik || '-'],
                  ['Tempat, Tgl Lahir', [detailEmployee.birth_place, detailEmployee.birth_date ? new Date(detailEmployee.birth_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : ''].filter(Boolean).join(', ') || '-'],
                  ['Jenis Kelamin', translateGender(detailEmployee.gender || '') || '-'],
                  ['Agama', detailEmployee.religion || '-'],
                  ['Status Pernikahan', translateMarital(detailEmployee.marital_status || '') || '-'],
                  ['Tanggungan', String(detailEmployee.dependants ?? 0) + ' orang'],
                  ['No. HP', detailEmployee.phone || '-'],
                  ['Alamat', detailEmployee.address || '-'],
                ]},
                { title: 'Rekening Bank', rows: [
                  ['Bank', detailEmployee.bank_name || '-'],
                  ['No. Rekening', detailEmployee.bank_account_number || '-'],
                  ['Atas Nama', detailEmployee.bank_account_name || '-'],
                ]},
                { title: 'Kontak Darurat', rows: [
                  ['Nama', detailEmployee.emergency_contact_name || '-'],
                  ['No. Telepon', detailEmployee.emergency_contact_phone || '-'],
                  ['Hubungan', detailEmployee.emergency_contact_relation || '-'],
                ]},
              ].map(section => (
                <div key={section.title}>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{section.title}</h4>
                  <div className="bg-slate-50 rounded-xl divide-y divide-slate-100">
                    {section.rows.map(([label, val]) => (
                      <div key={label} className="flex px-4 py-2.5 text-sm">
                        <span className="text-slate-500 w-40 shrink-0">{label}</span>
                        <span className="font-medium text-slate-800">: {val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit */}
      {editEmployee && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-4xl my-4">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">Edit Karyawan — {editEmployee.full_name}</h2>
              <button onClick={() => setEditEmployee(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition">✕ Tutup</button>
            </div>
            <div className="p-6">
              <form onSubmit={handleEditSubmit}>
                {renderForm(editForm, setEditForm, true)}
                <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end gap-3">
                  <button type="button" onClick={() => setEditEmployee(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">Batal</button>
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
