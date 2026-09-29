'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AudienceValue, Branch, Dept, Emp, audienceIsEmpty, audienceToTargets, emptyAudience } from '@/lib/meeting'
import AudiencePicker from '@/components/meeting/AudiencePicker'
import { Cadence, CADENCE_HINT, CADENCE_LABEL, DailyTaskTemplate, PHOTO_MODE_LABEL, AssignmentMode } from './types'

export type EditableDailyTask = {
  id: string; due_date: string | null; is_active: boolean
}

type Props = {
  editing?: EditableDailyTask | null
  templates: DailyTaskTemplate[]
  branches: Branch[]
  departments: Dept[]
  employees: Emp[]
  onClose: () => void
  onSaved: () => void
  onManageTemplates: () => void
}

// Cerminan logika resolve target di RPC save_daily_task -- supaya pemilihan PIC per cabang
// (mode Tim) bisa dihitung di frontend sebelum submit, tanpa round-trip ke server.
function resolveTargetEmployees(audience: AudienceValue, employees: Emp[]): Emp[] {
  if (audience.all) return employees
  return employees.filter(e =>
    (e.branch_id && audience.branchIds.includes(e.branch_id)) ||
    (e.department_id && audience.departmentIds.includes(e.department_id)) ||
    audience.employeeIds.includes(e.id)
  )
}

export default function TaskFormModal({ editing, templates, branches, departments, employees, onClose, onSaved, onManageTemplates }: Props) {
  const supabase = createClient()
  const [templateId, setTemplateId] = useState('')
  const [cadence, setCadence] = useState<Cadence>('daily')
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('individual')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? '')
  const [isActive, setIsActive] = useState(editing?.is_active ?? true)
  const [audience, setAudience] = useState<AudienceValue>(emptyAudience)
  const [pics, setPics] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const activeTemplates = templates.filter(t => t.is_active)

  const branchesNeedingPic = useMemo(() => {
    if (assignmentMode !== 'team') return []
    const resolved = resolveTargetEmployees(audience, employees)
    const ids = Array.from(new Set(resolved.map(e => e.branch_id).filter((x): x is string => !!x)))
    return branches.filter(b => ids.includes(b.id))
  }, [assignmentMode, audience, employees, branches])

  const noBranchInTarget = useMemo(() => {
    if (assignmentMode !== 'team') return false
    return resolveTargetEmployees(audience, employees).some(e => !e.branch_id)
  }, [assignmentMode, audience, employees])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    setSaving(true)
    if (editing) {
      const { error: err } = await supabase.rpc('update_daily_task', {
        p_task_id: editing.id, p_due_date: dueDate || null, p_is_active: isActive,
      })
      setSaving(false)
      if (err) { setError('Gagal menyimpan: ' + err.message); return }
      onSaved(); return
    }

    if (!templateId) { setSaving(false); setError('Pilih dulu judul tugas dari master.'); return }
    if (cadence === 'once' && !dueDate) { setSaving(false); setError('Tugas Sekali Jalan wajib punya tenggat.'); return }
    if (audienceIsEmpty(audience)) { setSaving(false); setError('Pilih dulu tugas ini ditujukan untuk siapa.'); return }
    if (assignmentMode === 'team') {
      if (noBranchInTarget) { setSaving(false); setError('Ada karyawan target yang belum punya cabang -- mode Tim butuh cabang untuk menentukan PIC.'); return }
      if (branchesNeedingPic.length === 0) { setSaving(false); setError('Tidak ada cabang pada target ini.'); return }
      const missing = branchesNeedingPic.filter(b => !pics[b.id])
      if (missing.length > 0) { setSaving(false); setError(`Pilih dulu PIC untuk cabang: ${missing.map(b => b.name).join(', ')}.`); return }
    }

    const { error: err } = await supabase.rpc('save_daily_task', {
      p_template_id: templateId, p_cadence: cadence, p_assignment_mode: assignmentMode,
      p_due_date: cadence === 'once' ? dueDate : null,
      p_targets: audienceToTargets(audience),
      p_pics: assignmentMode === 'team' ? pics : {},
    })
    setSaving(false)
    if (err) { setError('Gagal membuat tugas: ' + err.message); return }
    onSaved()
  }

  const radio = (active: boolean) =>
    `flex-1 border rounded-lg px-3 py-2 text-left cursor-pointer transition ${active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`

  const selectedTemplate = templates.find(t => t.id === templateId)

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800 pb-2 border-b border-slate-100">
            {editing ? 'Edit Tugas' : 'Tugas Baru'}
          </h2>

          {!editing && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-700">Judul Tugas (dari master) <span className="text-red-500">*</span></label>
                <button type="button" onClick={onManageTemplates} className="text-xs text-blue-600 hover:underline">+ Kelola Master Judul</button>
              </div>
              {activeTemplates.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Belum ada judul di master. Klik &quot;Kelola Master Judul&quot; untuk membuatnya dulu.
                </p>
              ) : (
                <select value={templateId} onChange={e => setTemplateId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Pilih judul --</option>
                  {activeTemplates.map(t => <option key={t.id} value={t.id}>{t.title} ({PHOTO_MODE_LABEL[t.photo_mode]})</option>)}
                </select>
              )}
              {selectedTemplate?.description && <p className="text-xs text-slate-500 mt-1.5">{selectedTemplate.description}</p>}
            </div>
          )}

          {!editing && (
            <div>
              <p className="block text-xs font-medium text-slate-700 mb-1">Pengulangan</p>
              <div className="grid grid-cols-2 gap-2">
                {(['daily', 'weekly', 'monthly', 'once'] as Cadence[]).map(c => (
                  <label key={c} className={radio(cadence === c)}>
                    <input type="radio" className="hidden" checked={cadence === c} onChange={() => setCadence(c)} />
                    <span className="text-sm font-semibold text-slate-800">{CADENCE_LABEL[c]}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">{CADENCE_HINT[c]}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {!editing && (
            <div>
              <p className="block text-xs font-medium text-slate-700 mb-1">Mode Penugasan</p>
              <div className="flex gap-2">
                <label className={radio(assignmentMode === 'individual')}>
                  <input type="radio" className="hidden" checked={assignmentMode === 'individual'} onChange={() => setAssignmentMode('individual')} />
                  <span className="text-sm font-semibold text-slate-800">👤 Individu</span>
                  <span className="block text-xs text-slate-500">Setiap orang lapor sendiri-sendiri.</span>
                </label>
                <label className={radio(assignmentMode === 'team')}>
                  <input type="radio" className="hidden" checked={assignmentMode === 'team'} onChange={() => setAssignmentMode('team')} />
                  <span className="text-sm font-semibold text-slate-800">👥 Tim (per Cabang)</span>
                  <span className="block text-xs text-slate-500">1 PIC per cabang lapor, nilainya berlaku untuk seluruh tim di cabang itu.</span>
                </label>
              </div>
            </div>
          )}

          {(cadence === 'once' || editing) && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tenggat {cadence === 'once' && !editing && <span className="text-red-500">*</span>}</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          )}

          {editing && (
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
              Tugas aktif (nonaktifkan untuk menghentikan tanpa menghapus riwayat)
            </label>
          )}

          {!editing && (
            <div>
              <p className="block text-xs font-medium text-slate-700 mb-1">Ditugaskan ke</p>
              <AudiencePicker value={audience} onChange={setAudience} branches={branches} departments={departments} employees={employees} />
              <p className="text-xs text-slate-400 mt-1">Daftar orang ditetapkan saat tugas dibuat. Untuk mengganti siapa yang ditugaskan, hapus tugas lalu buat ulang.</p>
            </div>
          )}

          {!editing && assignmentMode === 'team' && !audienceIsEmpty(audience) && (
            <div>
              <p className="block text-xs font-medium text-slate-700 mb-1">PIC per Cabang <span className="text-red-500">*</span></p>
              {noBranchInTarget && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">Ada karyawan target yang belum punya cabang -- mode Tim butuh cabang.</p>
              )}
              {branchesNeedingPic.length === 0 ? (
                <p className="text-sm text-slate-400">Belum ada cabang pada target ini.</p>
              ) : (
                <div className="space-y-2">
                  {branchesNeedingPic.map(b => (
                    <div key={b.id} className="flex items-center gap-2">
                      <span className="text-sm text-slate-700 w-32 shrink-0 truncate">{b.name}</span>
                      <select value={pics[b.id] ?? ''} onChange={e => setPics(prev => ({ ...prev, [b.id]: e.target.value }))}
                        className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-sm bg-white">
                        <option value="">-- Pilih PIC --</option>
                        {employees.filter(e => e.branch_id === b.id).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <div className="p-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{error}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">Batal</button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
              {saving ? 'Menyimpan...' : editing ? 'Simpan' : 'Buat Tugas'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
