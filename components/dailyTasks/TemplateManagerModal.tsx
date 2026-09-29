'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DailyTaskTemplate, PhotoMode, PHOTO_MODE_LABEL } from './types'

type Props = {
  templates: DailyTaskTemplate[]
  onClose: () => void
  onChanged: () => void
}

const emptyForm = { title: '', description: '', photo_mode: 'none' as PhotoMode, is_active: true }

export default function TemplateManagerModal({ templates, onClose, onChanged }: Props) {
  const supabase = createClient()
  const [editing, setEditing] = useState<DailyTaskTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowForm(true)
  }

  function openEdit(t: DailyTaskTemplate) {
    setEditing(t)
    setForm({ title: t.title, description: t.description ?? '', photo_mode: t.photo_mode, is_active: t.is_active })
    setError('')
    setShowForm(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Judul wajib diisi.'); return }
    setSaving(true)
    const { error: err } = await supabase.rpc('save_daily_task_template', {
      p_id: editing?.id ?? null, p_title: form.title.trim(), p_description: form.description.trim() || null,
      p_photo_mode: form.photo_mode, p_is_active: form.is_active,
    })
    setSaving(false)
    if (err) { setError('Gagal menyimpan: ' + err.message); return }
    setShowForm(false)
    onChanged()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
            <h2 className="text-lg font-semibold text-slate-800">📚 Master Judul Tugas</h2>
            <button onClick={openNew} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg">+ Judul Baru</button>
          </div>

          {templates.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Belum ada judul di master.</p>
          ) : (
            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.id} className={`border rounded-lg px-3 py-2 ${t.is_active ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{t.title}{!t.is_active && <span className="ml-1.5 text-xs font-normal text-slate-400">(nonaktif)</span>}</p>
                      {t.description && <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>}
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">{PHOTO_MODE_LABEL[t.photo_mode]}</span>
                    </div>
                    <button onClick={() => openEdit(t)} className="text-xs text-blue-600 hover:underline shrink-0">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={onClose} className="mt-4 w-full py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">Tutup</button>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <form onSubmit={save} className="space-y-4">
              <h3 className="text-base font-semibold text-slate-800">{editing ? 'Edit Judul' : 'Judul Baru'}</h3>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Judul <span className="text-red-500">*</span></label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Contoh: Cek CCTV pagi"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Penjelasan</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kebutuhan Foto</label>
                <select value={form.photo_mode} onChange={e => setForm({ ...form, photo_mode: e.target.value as PhotoMode })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                  <option value="none">Tanpa foto</option>
                  <option value="single">1 foto bebas</option>
                  <option value="before_after">Sebelum & Sesudah (2 tahap)</option>
                </select>
              </div>
              {editing && (
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
                  Aktif (nonaktifkan supaya tidak bisa dipilih untuk tugas baru)
                </label>
              )}
              {error && <div className="p-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{error}</div>}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
                <button type="submit" disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
