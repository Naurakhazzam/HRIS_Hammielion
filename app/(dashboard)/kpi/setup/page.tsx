'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import {
  AudienceValue, Branch, Dept, Emp, audienceIsEmpty, audienceLabels, audienceToTargets, emptyAudience,
} from '@/lib/meeting'
import AudiencePicker from '@/components/meeting/AudiencePicker'

type SourceType = 'manual' | 'task_completion' | 'punctuality' | 'attendance'

const SOURCE_LABEL: Record<SourceType, string> = {
  manual: '✍️ Manual (HR isi skor tiap periode)',
  task_completion: '🔁 Kepatuhan Tugas Rutin',
  punctuality: '⏰ Tepat Waktu',
  attendance: '✅ Kehadiran',
}
const SOURCE_HINT: Record<SourceType, string> = {
  manual: 'HR/Owner mengisi satu angka 0-100 untuk kriteria ini setiap periode.',
  task_completion: 'Dihitung otomatis dari penyelesaian Tugas Rutin (menu Tugas & Laporan).',
  punctuality: 'Dihitung otomatis: % hari hadir tanpa telat.',
  attendance: 'Dihitung otomatis: 100% dikurangi izin/sakit/alpha di luar jatah 4x/periode.',
}

type AudRow = { branch_id: string | null; department_id: string | null; employee_id: string | null }
type Criteria = {
  id: string; title: string; description: string | null; source_type: SourceType
  weight_percent: number; audience_all: boolean; is_active: boolean
  kpi_criteria_audiences: AudRow[]
}

const emptyForm = { title: '', description: '', source_type: 'manual' as SourceType, weight_percent: '20', is_active: true }

export default function KPISetupPage() {
  const supabase = createClient()
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Dept[]>([])
  const [employees, setEmployees] = useState<Emp[]>([])
  const [criteria, setCriteria] = useState<Criteria[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Criteria | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [audience, setAudience] = useState<AudienceValue>(emptyAudience)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
    const role = userData?.role || ''
    setCurrentUserRole(role)
    if (role === 'owner' || role === 'hr') {
      const [bRes, dRes, eRes] = await Promise.all([
        supabase.from('branches').select('id,name').order('name'),
        supabase.from('departments').select('id,name').order('name'),
        supabase.from('employees').select('id,full_name,branch_id,department_id').eq('is_active', true).order('full_name'),
      ])
      setBranches((bRes.data as Branch[]) || [])
      setDepartments((dRes.data as Dept[]) || [])
      setEmployees((eRes.data as Emp[]) || [])
      await fetchCriteria()
    }
    setLoading(false)
  }

  async function fetchCriteria() {
    const { data, error: err } = await supabase.from('kpi_criteria')
      .select('id,title,description,source_type,weight_percent,audience_all,is_active,kpi_criteria_audiences(branch_id,department_id,employee_id)')
      .order('title')
    if (err) console.error('kpi_criteria:', err.message)
    setCriteria((data as unknown as Criteria[]) || [])
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setAudience(emptyAudience)
    setError('')
    setShowForm(true)
  }

  function openEdit(c: Criteria) {
    setEditing(c)
    setForm({ title: c.title, description: c.description ?? '', source_type: c.source_type, weight_percent: String(c.weight_percent), is_active: c.is_active })
    setAudience(c.audience_all
      ? { ...emptyAudience, all: true }
      : {
          all: false,
          branchIds: c.kpi_criteria_audiences.filter(a => a.branch_id).map(a => a.branch_id as string),
          departmentIds: c.kpi_criteria_audiences.filter(a => a.department_id).map(a => a.department_id as string),
          employeeIds: c.kpi_criteria_audiences.filter(a => a.employee_id).map(a => a.employee_id as string),
        })
    setError('')
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Judul kriteria wajib diisi.'); return }
    if (audienceIsEmpty(audience)) { setError('Pilih dulu kriteria ini berlaku untuk siapa.'); return }
    setSaving(true)
    const { error: err } = await supabase.rpc('save_kpi_criteria', {
      p_id: editing?.id ?? null,
      p_title: form.title.trim(),
      p_description: form.description.trim() || null,
      p_source_type: form.source_type,
      p_weight_percent: parseFloat(form.weight_percent) || 0,
      p_is_active: form.is_active,
      p_targets: audienceToTargets(audience),
    })
    setSaving(false)
    if (err) { setError('Gagal menyimpan: ' + err.message); return }
    setShowForm(false)
    showMessage('success', editing ? 'Kriteria diperbarui.' : 'Kriteria ditambahkan.')
    fetchCriteria()
  }

  async function toggleStatus(c: Criteria) {
    const { error: err } = await supabase.from('kpi_criteria').update({ is_active: !c.is_active }).eq('id', c.id)
    if (err) showMessage('error', 'Gagal mengubah status: ' + err.message)
    else { showMessage('success', 'Status diperbarui.'); fetchCriteria() }
  }

  async function handleDelete(c: Criteria) {
    if (!window.confirm(`Hapus kriteria "${c.title}"? Semua skor manual untuk kriteria ini juga ikut terhapus.`)) return
    const { error: err } = await supabase.from('kpi_criteria').delete().eq('id', c.id)
    if (err) showMessage('error', 'Gagal menghapus: ' + err.message)
    else { showMessage('success', 'Kriteria dihapus.'); fetchCriteria() }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">Memuat...</span>
        </div>
      </div>
    )
  }

  if (currentUserRole !== 'owner' && currentUserRole !== 'hr') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <span className="text-4xl mb-3">🔒</span>
        <h2 className="text-xl font-bold text-slate-700">Akses Ditolak</h2>
        <p>Anda tidak memiliki akses ke halaman ini.</p>
        <Link href="/dashboard" className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">Kembali ke Dashboard</Link>
      </div>
    )
  }

  const allWeightTotal = criteria.filter(c => c.is_active && c.audience_all).reduce((a, c) => a + Number(c.weight_percent), 0)

  return (
    <div className="space-y-6">
      <div className="mb-2 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Kriteria KPI</h1>
          <p className="text-sm text-slate-500">Kriteria bisa ditargetkan ke cabang/divisi/karyawan tertentu, atau semua karyawan.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/kpi" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">Kembali ke Dashboard KPI</Link>
          <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition">+ Kriteria Baru</button>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>
      )}

      {allWeightTotal > 100 && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
          ⚠️ Total bobot kriteria aktif untuk &quot;Semua karyawan&quot; sudah {allWeightTotal}% (lebih dari 100%). Bukan error, tapi cek lagi supaya bobotnya masuk akal.
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-bold text-slate-800">Daftar Kriteria KPI</h2>
        </div>
        {criteria.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada kriteria KPI yang disetup.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {criteria.map(c => {
              const tujuan = c.audience_all ? 'Semua karyawan' : (audienceLabels(c.kpi_criteria_audiences, branches, departments, employees).join(', ') || '-')
              return (
                <div key={c.id} className={`px-4 py-3 flex items-start justify-between gap-3 ${!c.is_active ? 'opacity-60 bg-slate-50/50' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span className="text-sm font-semibold text-slate-800">{c.title}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">{SOURCE_LABEL[c.source_type]}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">Bobot {c.weight_percent}%</span>
                      {!c.is_active && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">NONAKTIF</span>}
                    </div>
                    {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">Berlaku untuk: {tujuan}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => openEdit(c)} className="text-xs px-2.5 py-1 rounded border font-medium text-blue-600 border-blue-200 hover:bg-blue-50">Edit</button>
                    <button onClick={() => toggleStatus(c)} className={`text-xs px-2.5 py-1 rounded border font-medium ${c.is_active ? 'text-slate-600 border-slate-200 hover:bg-slate-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}>{c.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                    <button onClick={() => handleDelete(c)} className="text-xs px-2.5 py-1 rounded border font-medium text-red-600 border-red-200 hover:bg-red-50">Hapus</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[92vh] overflow-y-auto">
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800 pb-2 border-b border-slate-100">{editing ? 'Edit Kriteria' : 'Kriteria Baru'}</h2>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Judul Kriteria <span className="text-red-500">*</span></label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Contoh: Kerapian Toko"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Penjelasan</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sumber Penilaian</label>
                <select value={form.source_type} onChange={e => setForm({ ...form, source_type: e.target.value as SourceType })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                  {(Object.keys(SOURCE_LABEL) as SourceType[]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">{SOURCE_HINT[form.source_type]}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Bobot (%) <span className="text-red-500">*</span></label>
                <input type="number" min="0" max="100" value={form.weight_percent} onChange={e => setForm({ ...form, weight_percent: e.target.value })}
                  className="w-32 px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <p className="block text-xs font-medium text-slate-700 mb-1">Berlaku untuk</p>
                <AudiencePicker value={audience} onChange={setAudience} branches={branches} departments={departments} employees={employees} />
              </div>
              {editing && (
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
                  Aktif
                </label>
              )}
              {error && <div className="p-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{error}</div>}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
                <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {saving ? 'Menyimpan...' : editing ? 'Simpan' : 'Buat Kriteria'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
