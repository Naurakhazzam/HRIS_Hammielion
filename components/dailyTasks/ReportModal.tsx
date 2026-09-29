'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadReportPhotos } from '@/lib/meeting'

type Props = {
  taskId: string
  taskTitle: string
  photoRequired: boolean
  onClose: () => void
  onSaved: () => void
}

export default function ReportModal({ taskId, taskTitle, photoRequired, onClose, onSaved }: Props) {
  const supabase = createClient()
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (content.trim().length < 5) { setError('Tulis laporan dulu (minimal 5 huruf).'); return }
    if (photoRequired && files.length === 0) { setError('Laporan ini wajib pakai foto. Tekan tombol foto dulu.'); return }
    setSaving(true)
    try {
      const paths = files.length > 0 ? await uploadReportPhotos(supabase, taskId, files) : []
      const { error: err } = await supabase.rpc('submit_daily_task_log', {
        p_task_id: taskId, p_content: content.trim(), p_photo_paths: paths,
      })
      if (err) throw new Error(err.message)
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim laporan')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md max-h-[92vh] overflow-y-auto">
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">📝 Lapor Tugas</h2>
            <p className="text-sm text-slate-500 mt-0.5">{taskTitle}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Apa yang sudah dikerjakan? <span className="text-red-500">*</span></label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={5}
              placeholder="Tulis dengan jelas apa yang sudah dilakukan..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              📷 Foto bukti {photoRequired ? <span className="text-red-500">* wajib</span> : <span className="text-slate-400 font-normal">(kalau ada)</span>}
            </label>
            <input type="file" accept="image/*" multiple
              onChange={e => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
              className="block w-full text-sm text-slate-600 file:mr-3 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium" />
            {files.length > 0 && <p className="text-xs text-slate-500 mt-1">{files.length} foto dipilih (maksimal 5)</p>}
          </div>
          {error && <div className="p-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 py-3 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition">Batal</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl shadow-sm transition disabled:opacity-50">
              {saving ? 'Mengirim...' : 'Kirim Laporan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
