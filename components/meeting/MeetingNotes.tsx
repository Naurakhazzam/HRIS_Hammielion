'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  AudienceValue, Branch, Dept, Emp, audienceIsEmpty, audienceLabels, emptyAudience, fmtDateTime,
} from '@/lib/meeting'
import AudiencePicker from './AudiencePicker'
import TaskFormModal from './TaskFormModal'

type AudRow = { id: string; branch_id: string | null; department_id: string | null; employee_id: string | null }
type Note = {
  id: string; title: string; meeting_date: string; content: string | null; follow_up: string | null
  note_type: 'pembahasan' | 'aturan'; status: 'draft' | 'published'
  audience_all: boolean; internal_only: boolean; silent: boolean
  published_at: string | null; created_by: string; created_at: string
  users: { employees: { full_name: string } | null } | null
  meeting_note_audiences: AudRow[]
  meeting_tasks: { id: string; title: string }[]
}
type ReadRow = { employee_id: string; full_name: string; branch_name: string | null; read_at: string | null }

const emptyForm = { title: '', meeting_date: '', note_type: 'pembahasan' as 'pembahasan' | 'aturan', content: '', follow_up: '', internal_only: false, silent: false }

type Props = {
  isAdmin: boolean
  myUserId: string | null
  myRole: string
  myEmployeeId: string | null
  branches: Branch[]
  departments: Dept[]
  employees: Emp[]
  onChanged: () => void
  onOpenTasks: (noteId: string) => void
}

export default function MeetingNotes({ isAdmin, myUserId, myRole, myEmployeeId, branches, departments, employees, onChanged, onOpenTasks }: Props) {
  const supabase = createClient()
  const [notes, setNotes] = useState<Note[]>([])
  const [reads, setReads] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'draft' | 'internal' | 'published' | 'unread'>('all')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [audience, setAudience] = useState<AudienceValue>(emptyAudience)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const [taskNote, setTaskNote] = useState<Note | null>(null)
  const [readModal, setReadModal] = useState<{ note: Note; rows: ReadRow[] } | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('meeting_notes')
      .select('id,title,meeting_date,content,follow_up,note_type,status,audience_all,internal_only,silent,published_at,created_by,created_at,users(employees(full_name)),meeting_note_audiences(id,branch_id,department_id,employee_id),meeting_tasks(id,title)')
      .order('meeting_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) console.error('meeting_notes:', error.message)
    setNotes((data as unknown as Note[]) || [])
    if (myEmployeeId) {
      const { data: r } = await supabase.from('meeting_note_reads').select('note_id').eq('employee_id', myEmployeeId)
      setReads(new Set((r || []).map((x: { note_id: string }) => x.note_id)))
    }
    setLoading(false)
  }, [supabase, myEmployeeId])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  const canManage = (n: Note) => isAdmin && (myRole === 'owner' || n.created_by === myUserId)
  const isUnread = (n: Note) => !isAdmin && n.status === 'published' && !n.silent && !n.internal_only && !reads.has(n.id)

  function openNew() {
    setEditing(null)
    setForm({ ...emptyForm, meeting_date: today })
    setAudience(emptyAudience)
    setFormError('')
    setShowModal(true)
  }

  function openEdit(n: Note) {
    setEditing(n)
    setForm({
      title: n.title, meeting_date: n.meeting_date, note_type: n.note_type, content: n.content || '',
      follow_up: n.follow_up || '', internal_only: n.internal_only, silent: n.silent,
    })
    setAudience({
      all: n.audience_all,
      branchIds: n.meeting_note_audiences.filter(a => a.branch_id).map(a => a.branch_id!),
      departmentIds: n.meeting_note_audiences.filter(a => a.department_id).map(a => a.department_id!),
      employeeIds: n.meeting_note_audiences.filter(a => a.employee_id).map(a => a.employee_id!),
    })
    setFormError('')
    setShowModal(true)
  }

  async function save(publish: boolean) {
    if (!myUserId) return
    setFormError('')
    if (!form.title.trim() || !form.meeting_date) { setFormError('Judul dan tanggal meeting wajib diisi.'); return }
    if (publish && !form.internal_only && audienceIsEmpty(audience)) {
      setFormError('Pilih dulu catatan ini ditujukan untuk siapa, atau centang "Internal Owner/HR saja".'); return
    }
    setSubmitting(true)
    const wasPublished = editing?.status === 'published'
    const status = publish || wasPublished ? 'published' : 'draft'
    const payload = {
      title: form.title.trim(), meeting_date: form.meeting_date, note_type: form.note_type,
      content: form.content.trim() || null, follow_up: form.follow_up.trim() || null,
      internal_only: form.internal_only, audience_all: form.internal_only ? false : audience.all,
      silent: form.silent, status,
      published_at: status === 'published' ? (editing?.published_at ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    }

    let noteId = editing?.id
    if (editing) {
      const { error } = await supabase.from('meeting_notes').update(payload).eq('id', editing.id)
      if (error) { setSubmitting(false); setFormError('Gagal menyimpan: ' + error.message); return }
    } else {
      const { data, error } = await supabase.from('meeting_notes').insert({ ...payload, created_by: myUserId }).select('id').single()
      if (error || !data) { setSubmitting(false); setFormError('Gagal menyimpan: ' + (error?.message ?? '')); return }
      noteId = data.id
    }

    const { error: delErr } = await supabase.from('meeting_note_audiences').delete().eq('note_id', noteId!)
    if (delErr) { setSubmitting(false); setFormError('Catatan tersimpan, tapi gagal memperbarui daftar tujuan: ' + delErr.message); return }
    if (!form.internal_only && !audience.all) {
      const rows = [
        ...audience.branchIds.map(id => ({ note_id: noteId, branch_id: id })),
        ...audience.departmentIds.map(id => ({ note_id: noteId, department_id: id })),
        ...audience.employeeIds.map(id => ({ note_id: noteId, employee_id: id })),
      ]
      if (rows.length > 0) {
        const { error: audErr } = await supabase.from('meeting_note_audiences').insert(rows)
        if (audErr) { setSubmitting(false); setFormError('Catatan tersimpan, tapi gagal menyimpan tujuan: ' + audErr.message); return }
      }
    }

    setSubmitting(false)
    setShowModal(false)
    showMessage('success', publish ? 'Catatan dipublikasikan.' : editing ? 'Perubahan disimpan.' : 'Draf disimpan.')
    fetchNotes()
    onChanged()
  }

  async function handleDelete(n: Note) {
    if (!window.confirm(`Hapus catatan "${n.title}"? Semua tugas dan laporan di dalamnya ikut terhapus.`)) return
    const { error } = await supabase.from('meeting_notes').delete().eq('id', n.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Catatan dihapus.'); fetchNotes(); onChanged() }
  }

  async function markRead(n: Note) {
    setMarkingId(n.id)
    const { error } = await supabase.rpc('mark_meeting_note_read', { p_note_id: n.id })
    setMarkingId(null)
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    setReads(prev => new Set(prev).add(n.id))
    onChanged()
  }

  async function openReadStatus(n: Note) {
    const { data, error } = await supabase.rpc('get_meeting_note_read_status', { p_note_id: n.id })
    if (error) { showMessage('error', 'Gagal memuat: ' + error.message); return }
    setReadModal({ note: n, rows: (data as ReadRow[]) || [] })
  }

  const filtered = notes.filter(n => {
    if (filter === 'draft' && n.status !== 'draft') return false
    if (filter === 'internal' && !n.internal_only) return false
    if (filter === 'published' && !(n.status === 'published' && !n.internal_only)) return false
    if (filter === 'unread' && !isUnread(n)) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return n.title.toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q) || (n.follow_up || '').toLowerCase().includes(q)
  })
  const unreadCount = notes.filter(isUnread).length

  const filterBtn = (key: typeof filter, label: string) => (
    <button key={key} onClick={() => setFilter(key)}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition ${filter === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          {filterBtn('all', 'Semua')}
          {isAdmin ? (
            <>
              {filterBtn('published', 'Dipublikasikan')}
              {filterBtn('draft', 'Draf')}
              {filterBtn('internal', '🔒 Internal')}
            </>
          ) : filterBtn('unread', `Belum dibaca${unreadCount > 0 ? ` (${unreadCount})` : ''}`)}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari catatan..."
            className="w-full sm:w-56 px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
        </div>
        {isAdmin && (
          <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition">
            <span className="text-base leading-none">+</span> Catatan Baru
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>
      )}

      {loading && notes.length === 0 ? (
        <div className="py-10 text-center text-slate-500">Memuat...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
          {notes.length === 0 ? (isAdmin ? 'Belum ada catatan meeting. Klik "Catatan Baru" untuk mulai.' : 'Belum ada catatan meeting untuk Anda.') : 'Tidak ada catatan yang cocok.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(n => {
            const unread = isUnread(n)
            const tujuan = n.internal_only ? null
              : n.audience_all ? ['Semua karyawan']
              : audienceLabels(n.meeting_note_audiences, branches, departments, employees)
            return (
              <div key={n.id} className={`bg-white rounded-xl shadow-sm border p-5 ${unread ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      {unread && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white">BARU</span>}
                      {n.status === 'draft' && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700">DRAF</span>}
                      {n.internal_only && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700">🔒 INTERNAL OWNER/HR</span>}
                      {n.note_type === 'aturan' && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-700">📌 ATURAN / SOP</span>}
                    </div>
                    <h2 className="text-lg font-semibold text-slate-800 leading-snug">{n.title}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(n.meeting_date + 'T00:00:00+07:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}
                      {n.users?.employees?.full_name && <> · dicatat oleh {n.users.employees.full_name}</>}
                    </p>
                    {tujuan && tujuan.length > 0 && (
                      <p className="text-xs text-slate-500 mt-1"><span className="font-medium">Ditujukan untuk:</span> {tujuan.join(', ')}</p>
                    )}
                  </div>
                  {canManage(n) && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => openEdit(n)} className="text-xs px-2.5 py-1 rounded border font-medium transition text-blue-600 border-blue-200 hover:bg-blue-50">Edit</button>
                      <button onClick={() => handleDelete(n)} className="text-xs px-2.5 py-1 rounded border font-medium transition text-red-600 border-red-200 hover:bg-red-50">Hapus</button>
                    </div>
                  )}
                </div>

                {n.content && <p className="text-base text-slate-700 whitespace-pre-wrap mb-2">{n.content}</p>}
                {n.follow_up && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <p className="text-xs font-semibold text-amber-800 mb-0.5">Tindak Lanjut</p>
                    <p className="text-sm text-amber-700 whitespace-pre-wrap">{n.follow_up}</p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {n.meeting_tasks.length > 0 && (
                    <button onClick={() => onOpenTasks(n.id)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition">
                      📌 {n.meeting_tasks.length} tugas dalam catatan ini
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => setTaskNote(n)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 transition">
                      ➕ Tambah Tugas
                    </button>
                  )}
                  {isAdmin && n.status === 'published' && !n.internal_only && !n.silent && (
                    <button onClick={() => openReadStatus(n)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 transition">
                      👁 Cek siapa yang sudah baca
                    </button>
                  )}
                  {!isAdmin && unread && (
                    <button onClick={() => markRead(n)} disabled={markingId === n.id}
                      className="w-full sm:w-auto px-6 py-3 rounded-xl text-base font-bold bg-green-600 hover:bg-green-700 text-white shadow-sm transition disabled:opacity-50">
                      {markingId === n.id ? 'Menyimpan...' : '✅ Sudah Saya Baca'}
                    </button>
                  )}
                  {!isAdmin && !unread && n.status === 'published' && !n.silent && reads.has(n.id) && (
                    <span className="text-xs text-green-600 font-medium">✓ Sudah Anda baca</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[92vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800 pb-2 border-b border-slate-100">
                {editing ? 'Edit Catatan Meeting' : 'Catatan Meeting Baru'}
                {editing?.status === 'draft' && <span className="ml-2 text-xs font-normal text-slate-400">(draf)</span>}
              </h2>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Judul <span className="text-red-500">*</span></label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Contoh: Rapat Evaluasi Bulanan"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Meeting <span className="text-red-500">*</span></label>
                  <input type="date" value={form.meeting_date} onChange={e => setForm({ ...form, meeting_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenis</label>
                  <select value={form.note_type} onChange={e => setForm({ ...form, note_type: e.target.value as 'pembahasan' | 'aturan' })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                    <option value="pembahasan">Pembahasan</option>
                    <option value="aturan">📌 Aturan / SOP</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Ditujukan untuk</label>
                <label className="flex items-center gap-2 text-sm text-purple-700 mb-2 cursor-pointer">
                  <input type="checkbox" checked={form.internal_only} onChange={e => setForm({ ...form, internal_only: e.target.checked })} className="rounded" />
                  🔒 Internal Owner/HR saja (karyawan tidak bisa melihat)
                </label>
                {!form.internal_only && <AudiencePicker value={audience} onChange={setAudience} branches={branches} departments={departments} employees={employees} />}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Isi Catatan</label>
                <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={5} placeholder="Poin-poin pembahasan..."
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tindak Lanjut</label>
                <textarea value={form.follow_up} onChange={e => setForm({ ...form, follow_up: e.target.value })} rows={3} placeholder="Apa yang perlu ditindaklanjuti... (tugas resmi dibuat lewat tombol Tambah Tugas setelah catatan disimpan)"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
              {!form.internal_only && (
                <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={form.silent} onChange={e => setForm({ ...form, silent: e.target.checked })} className="rounded" />
                  Publikasikan tanpa notifikasi (tidak memunculkan angka merah di menu karyawan)
                </label>
              )}

              {formError && <div className="p-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{formError}</div>}

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">Batal</button>
                {editing?.status === 'published' ? (
                  <button type="button" disabled={submitting} onClick={() => save(true)}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                    {submitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={submitting} onClick={() => save(false)}
                      className="px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg transition disabled:opacity-50">
                      Simpan sebagai Draf
                    </button>
                    <button type="button" disabled={submitting} onClick={() => save(true)}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                      {submitting ? 'Menyimpan...' : 'Publikasikan'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {taskNote && (
        <TaskFormModal
          noteId={taskNote.id} noteTitle={taskNote.title}
          defaultAudience={{
            all: taskNote.audience_all,
            branchIds: taskNote.meeting_note_audiences.filter(a => a.branch_id).map(a => a.branch_id!),
            departmentIds: taskNote.meeting_note_audiences.filter(a => a.department_id).map(a => a.department_id!),
            employeeIds: taskNote.meeting_note_audiences.filter(a => a.employee_id).map(a => a.employee_id!),
          }}
          branches={branches} departments={departments} employees={employees}
          onClose={() => setTaskNote(null)}
          onSaved={() => { setTaskNote(null); showMessage('success', 'Tugas dibuat. Karyawan yang ditugaskan akan melihat angka merah di menu.'); fetchNotes(); onChanged() }}
        />
      )}

      {readModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => setReadModal(null)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-base font-semibold text-slate-800">{readModal.note.title}</h2>
              <p className="text-sm text-slate-500 mb-3">
                Sudah baca <span className="font-semibold text-green-600">{readModal.rows.filter(r => r.read_at).length}</span> dari {readModal.rows.length} orang
              </p>
              <ul className="divide-y divide-slate-100 text-sm">
                {readModal.rows.map(r => (
                  <li key={r.employee_id} className="py-2 flex items-center justify-between gap-2">
                    <span>{r.full_name}<span className="text-xs text-slate-400 ml-1.5">{r.branch_name}</span></span>
                    {r.read_at
                      ? <span className="text-xs text-green-600 shrink-0">✓ {fmtDateTime(r.read_at)}</span>
                      : <span className="text-xs text-red-500 font-medium shrink-0">Belum baca</span>}
                  </li>
                ))}
              </ul>
              <button onClick={() => setReadModal(null)} className="mt-4 w-full py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
