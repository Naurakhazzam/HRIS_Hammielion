'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AudienceValue, Branch, Dept, Emp, audienceIsEmpty, audienceToTargets, emptyAudience } from '@/lib/meeting'
import AudiencePicker from '@/components/meeting/AudiencePicker'
import { DailyTaskTemplate, PHOTO_MODE_LABEL } from './types'

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

export default function TaskFormModal({ editing, templates, branches, departments, employees, onClose, onSaved, onManageTemplates }: Props) {
  const supabase = createClient()
  const [templateId, setTemplateId] = useState('')
  const [taskType, setTaskType] = useState<'once' | 'daily'>('daily')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? '')
  const [isActive, setIsActive] = useState(editing?.is_active ?? true)
  const [audience, setAudience] = useState<AudienceValue>(emptyAudience)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const activeTemplates = templates.filter(t => t.is_active)

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
    if (taskType === 'once' && !dueDate) { setSaving(false); setError('Tugas jenis Sekali wajib punya tenggat.'); return }
    if (audienceIsEmpty(audience)) { setSaving(false); setError('Pilih dulu tugas ini ditujukan untuk siapa.'); return }

    const { error: err } = await supabase.rpc('save_daily_task', {
      p_template_id: templateId, p_task_type: taskType,
      p_due_date: taskType === 'once' ? dueDate : null,
      p_targets: audienceToTargets(audience),
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
              <p className="block text-xs font-medium text-slate-700 mb-1">Jenis Tugas</p>
              <div className="flex gap-2">
                <label className={radio(taskType === 'daily')}>
                  <input type="radio" className="hidden" checked={taskType === 'daily'} onChange={() => setTaskType('daily')} />
                  <span className="text-sm font-semibold text-slate-800">🔁 Rutin (Harian)</span>
                  <span className="block text-xs text-slate-500">Berulang tiap hari kerja, X/Y per periode, terhubung ke KPI.</span>
                </label>
                <label className={radio(taskType === 'once')}>
                  <input type="radio" className="hidden" checked={taskType === 'once'} onChange={() => setTaskType('once')} />
                  <span className="text-sm font-semibold text-slate-800">1️⃣ Sekali Jalan</span>
                  <span className="block text-xs text-slate-500">Ada tenggat, satu laporan saja. Tidak memengaruhi KPI.</span>
                </label>
              </div>
            </div>
          )}

          {(taskType === 'once' || editing) && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tenggat {taskType === 'once' && !editing && <span className="text-red-500">*</span>}</label>
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
