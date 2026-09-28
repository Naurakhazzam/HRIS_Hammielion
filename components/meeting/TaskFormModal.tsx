'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AudienceValue, Branch, Dept, Emp, audienceIsEmpty, audienceToTargets, emptyAudience, expandAudience } from '@/lib/meeting'
import AudiencePicker from './AudiencePicker'

export type EditableTask = {
  id: string; title: string; description: string | null; due_date: string | null; photo_required: boolean
  task_type: 'team' | 'individual'; report_mode: 'once' | 'recurring'
}

type Props = {
  noteId: string
  noteTitle: string
  defaultAudience?: AudienceValue
  editing?: EditableTask | null
  branches: Branch[]
  departments: Dept[]
  employees: Emp[]
  onClose: () => void
  onSaved: () => void
}

export default function TaskFormModal({ noteId, noteTitle, defaultAudience, editing, branches, departments, employees, onClose, onSaved }: Props) {
  const supabase = createClient()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [taskType, setTaskType] = useState<'team' | 'individual'>(editing?.task_type ?? 'individual')
  const [reportMode, setReportMode] = useState<'once' | 'recurring'>(editing?.report_mode ?? 'once')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? '')
  const [photoRequired, setPhotoRequired] = useState(editing?.photo_required ?? false)
  const [audience, setAudience] = useState<AudienceValue>(defaultAudience && !audienceIsEmpty(defaultAudience) ? defaultAudience : emptyAudience)
  const [pics, setPics] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const members = useMemo(() => expandAudience(audience, employees), [audience, employees])
  const groups = useMemo(() => {
    const map = new Map<string, Emp[]>()
    members.forEach(m => { if (m.branch_id) map.set(m.branch_id, [...(map.get(m.branch_id) ?? []), m]) })
    return Array.from(map.entries()).map(([branchId, list]) => ({ branchId, name: branches.find(b => b.id === branchId)?.name ?? 'Cabang', list }))
  }, [members, branches])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('Judul tugas wajib diisi.'); return }

    setSaving(true)
    if (editing) {
      const { error: err } = await supabase.from('meeting_tasks').update({
        title: title.trim(), description: description.trim() || null, due_date: dueDate || null,
        photo_required: photoRequired, updated_at: new Date().toISOString(),
      }).eq('id', editing.id)
      setSaving(false)
      if (err) { setError('Gagal menyimpan: ' + err.message); return }
      onSaved(); return
    }

    if (members.length === 0) { setSaving(false); setError('Pilih dulu siapa yang ditugaskan.'); return }
    if (taskType === 'team') {
      if (members.some(m => !m.branch_id)) { setSaving(false); setError('Ada karyawan tanpa cabang, tugas tim butuh cabang untuk menentukan PIC.'); return }
      const missing = groups.find(g => !pics[g.branchId])
      if (missing) { setSaving(false); setError(`Pilih PIC untuk cabang ${missing.name}.`); return }
      const picIds = groups.map(g => pics[g.branchId])
      if (new Set(picIds).size !== picIds.length) { setSaving(false); setError('Satu orang tidak bisa jadi PIC untuk dua cabang.'); return }
    }

    const { error: err } = await supabase.rpc('save_meeting_task', {
      p_note_id: noteId, p_title: title.trim(), p_description: description.trim() || null,
      p_task_type: taskType, p_report_mode: reportMode, p_due_date: dueDate || null,
      p_photo_required: photoRequired, p_targets: audienceToTargets(audience),
      p_pics: taskType === 'team' ? pics : {},
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
          <div className="pb-2 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Tugas' : 'Tugas Baru'}</h2>
            <p className="text-xs text-slate-400">Dari catatan: {noteTitle}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Judul Tugas <span className="text-red-500">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Contoh: Perbaikan rel Toko Depan"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Penjelasan</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
          </div>

          {!editing && (
            <>
              <div>
                <p className="block text-xs font-medium text-slate-700 mb-1">Jenis Tugas</p>
                <div className="flex gap-2">
                  <label className={radio(taskType === 'individual')}>
                    <input type="radio" className="hidden" checked={taskType === 'individual'} onChange={() => setTaskType('individual')} />
                    <span className="text-sm font-semibold text-slate-800">👤 Individu</span>
                    <span className="block text-xs text-slate-500">Setiap orang yang ditugaskan melapor sendiri-sendiri.</span>
                  </label>
                  <label className={radio(taskType === 'team')}>
                    <input type="radio" className="hidden" checked={taskType === 'team'} onChange={() => setTaskType('team')} />
                    <span className="text-sm font-semibold text-slate-800">👥 Tim</span>
                    <span className="block text-xs text-slate-500">Satu PIC per cabang yang melapor untuk timnya.</span>
                  </label>
                </div>
              </div>
              <div>
                <p className="block text-xs font-medium text-slate-700 mb-1">Jenis Laporan</p>
                <div className="flex gap-2">
                  <label className={radio(reportMode === 'once')}>
                    <input type="radio" className="hidden" checked={reportMode === 'once'} onChange={() => setReportMode('once')} />
                    <span className="text-sm font-semibold text-slate-800">1️⃣ Sekali saja</span>
                    <span className="block text-xs text-slate-500">Satu laporan akhir, lalu direview.</span>
                  </label>
                  <label className={radio(reportMode === 'recurring')}>
                    <input type="radio" className="hidden" checked={reportMode === 'recurring'} onChange={() => setReportMode('recurring')} />
                    <span className="text-sm font-semibold text-slate-800">🔁 Berulang</span>
                    <span className="block text-xs text-slate-500">Boleh lapor progres berkali-kali, lalu satu laporan akhir.</span>
                  </label>
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tenggat</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={photoRequired} onChange={e => setPhotoRequired(e.target.checked)} className="rounded" />
              📷 Laporan akhir wajib foto
            </label>
          </div>

          {!editing && (
            <>
              <div>
                <p className="block text-xs font-medium text-slate-700 mb-1">Ditugaskan ke</p>
                <AudiencePicker value={audience} onChange={setAudience} branches={branches} departments={departments} employees={employees} />
              </div>

              {taskType === 'team' && groups.length > 0 && (
                <div>
                  <p className="block text-xs font-medium text-slate-700 mb-1">PIC per cabang <span className="text-red-500">*</span></p>
                  <div className="space-y-2">
                    {groups.map(g => {
                      const inGroup = new Set(g.list.map(m => m.id))
                      return (
                        <div key={g.branchId} className="border border-slate-200 rounded-lg p-3">
                          <p className="text-sm font-semibold text-slate-700">{g.name} <span className="text-xs font-normal text-slate-400">({g.list.length} orang)</span></p>
                          <select value={pics[g.branchId] ?? ''} onChange={e => setPics({ ...pics, [g.branchId]: e.target.value })}
                            className="mt-1.5 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                            <option value="">-- Pilih PIC --</option>
                            <optgroup label={`Anggota ${g.name}`}>
                              {g.list.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                            </optgroup>
                            <optgroup label="Karyawan lain">
                              {employees.filter(e => !inGroup.has(e.id)).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                            </optgroup>
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-400">Daftar orang ditetapkan saat tugas dibuat. Untuk mengganti siapa yang ditugaskan, hapus tugas lalu buat ulang.</p>
            </>
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
