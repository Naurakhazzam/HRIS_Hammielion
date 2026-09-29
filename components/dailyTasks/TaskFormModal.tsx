'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AudienceValue, Branch, Dept, Emp, audienceIsEmpty, audienceToTargets, emptyAudience } from '@/lib/meeting'
import AudiencePicker from '@/components/meeting/AudiencePicker'

export type EditableDailyTask = {
  id: string; title: string; description: string | null; task_type: 'once' | 'daily'
  due_date: string | null; photo_required: boolean; is_active: boolean
}

type Props = {
  editing?: EditableDailyTask | null
  branches: Branch[]
  departments: Dept[]
  employees: Emp[]
  onClose: () => void
  onSaved: () => void
}

export default function TaskFormModal({ editing, branches, departments, employees, onClose, onSaved }: Props) {
  const supabase = createClient()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [taskType, setTaskType] = useState<'once' | 'daily'>(editing?.task_type ?? 'daily')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? '')
  const [photoRequired, setPhotoRequired] = useState(editing?.photo_required ?? false)
  const [isActive, setIsActive] = useState(editing?.is_active ?? true)
  const [audience, setAudience] = useState<AudienceValue>(emptyAudience)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('Judul tugas wajib diisi.'); return }
    if (taskType === 'once' && !dueDate) { setError('Tugas jenis Sekali wajib punya tenggat.'); return }

    setSaving(true)
    if (editing) {
      const { error: err } = await supabase.rpc('update_daily_task', {
        p_task_id: editing.id, p_title: title.trim(), p_description: description.trim() || null,
        p_due_date: taskType === 'once' ? (dueDate || null) : null,
        p_photo_required: photoRequired, p_is_active: isActive,
      })
      setSaving(false)
      if (err) { setError('Gagal menyimpan: ' + err.message); return }
      onSaved(); return
    }

    if (audienceIsEmpty(audience)) { setSaving(false); setError('Pilih dulu tugas ini ditujukan untuk siapa.'); return }
    const { error: err } = await supabase.rpc('save_daily_task', {
      p_title: title.trim(), p_description: description.trim() || null, p_task_type: taskType,
      p_due_date: taskType === 'once' ? dueDate : null, p_photo_required: photoRequired,
      p_targets: audienceToTargets(audience),
    })
    setSaving(false)
    if (err) { setError('Gagal membuat tugas: ' + err.message); return }
    onSaved()
  }

  const radio = (active: boolean) =>
    `flex-1 border rounded-lg px-3 py-2 text-left cursor-pointer transition ${active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800 pb-2 border-b border-slate-100">
            {editing ? 'Edit Tugas' : 'Tugas Baru'}
          </h2>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Judul Tugas <span className="text-red-500">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Contoh: Cek CCTV pagi"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Penjelasan</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
          </div>

          {!editing && (
            <div>
              <p className="block text-xs font-medium text-slate-700 mb-1">Jenis Tugas</p>
              <div className="flex gap-2">
                <label className={radio(taskType === 'daily')}>
                  <input type="radio" className="hidden" checked={taskType === 'daily'} onChange={() => setTaskType('daily')} />
                  <span className="text-sm font-semibold text-slate-800">🔁 Harian</span>
                  <span className="block text-xs text-slate-500">Berulang tiap hari kerja, dihitung X/Y per periode gajian.</span>
                </label>
                <label className={radio(taskType === 'once')}>
                  <input type="radio" className="hidden" checked={taskType === 'once'} onChange={() => setTaskType('once')} />
                  <span className="text-sm font-semibold text-slate-800">1️⃣ Sekali</span>
                  <span className="block text-xs text-slate-500">Ada tenggat, satu laporan saja, selesai.</span>
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(taskType === 'once' || editing?.task_type === 'once') && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tenggat <span className="text-red-500">*</span></label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            )}
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={photoRequired} onChange={e => setPhotoRequired(e.target.checked)} className="rounded" />
              📷 Laporan wajib foto
            </label>
          </div>

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
