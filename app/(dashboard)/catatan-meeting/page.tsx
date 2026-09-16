'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Note = {
  id: string
  title: string
  meeting_date: string
  participants: string | null
  content: string | null
  follow_up: string | null
  created_by: string
  created_at: string
  updated_at: string
  users: { employees: { full_name: string } | null } | null
}

const emptyForm = { title: '', meeting_date: '', participants: '', content: '', follow_up: '' }

export default function CatatanMeetingPage() {
  const supabase = createClient()

  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const isOwner = role === 'owner'

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('meeting_notes')
      .select('id, title, meeting_date, participants, content, follow_up, created_by, created_at, updated_at, users(employees(full_name))')
      .order('meeting_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) console.error('Detail error meeting_notes:', JSON.stringify(error, null, 2))
    setNotes((data as unknown as Note[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setMyUserId(user.id)
        const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (userRow) setRole(userRow.role)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  function canManage(note: Note) {
    return isOwner || note.created_by === myUserId
  }

  function openNewModal() {
    setEditingNote(null)
    setForm({ ...emptyForm, meeting_date: today })
    setShowModal(true)
  }

  function openEditModal(note: Note) {
    setEditingNote(note)
    setForm({
      title: note.title, meeting_date: note.meeting_date,
      participants: note.participants || '', content: note.content || '', follow_up: note.follow_up || '',
    })
    setShowModal(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId) return
    if (!form.title.trim() || !form.meeting_date) { showMessage('error', 'Judul dan tanggal meeting wajib diisi.'); return }

    setSubmitting(true)
    const payload = {
      title: form.title.trim(), meeting_date: form.meeting_date,
      participants: form.participants.trim() || null, content: form.content.trim() || null,
      follow_up: form.follow_up.trim() || null,
    }

    const { error } = editingNote
      ? await supabase.from('meeting_notes').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingNote.id)
      : await supabase.from('meeting_notes').insert({ ...payload, created_by: myUserId })

    setSubmitting(false)
    if (error) {
      showMessage('error', 'Gagal menyimpan: ' + error.message)
    } else {
      showMessage('success', editingNote ? 'Catatan berhasil diperbarui.' : 'Catatan berhasil disimpan.')
      setShowModal(false)
      fetchNotes()
    }
  }

  async function handleDelete(note: Note) {
    if (!window.confirm(`Hapus catatan "${note.title}"?`)) return
    const { error } = await supabase.from('meeting_notes').delete().eq('id', note.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Catatan dihapus.'); fetchNotes() }
  }

  const filtered = notes.filter(n => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return n.title.toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q) || (n.participants || '').toLowerCase().includes(q)
  })

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">📝 Catatan Meeting</h1>
          <p className="text-sm text-slate-500">Catatan hasil rapat internal — dibagikan ke sesama owner/HR/finance supaya tidak ada yang lupa.</p>
        </div>
        <button onClick={openNewModal}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition">
          <span className="text-base leading-none">+</span> Catatan Baru
        </button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari judul, isi, atau peserta..."
          className="w-full sm:w-80 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-500">Memuat...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
          {notes.length === 0 ? 'Belum ada catatan meeting. Klik "Catatan Baru" untuk mulai.' : 'Tidak ada catatan yang cocok dengan pencarian.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(n => (
            <div key={n.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">{n.title}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(n.meeting_date).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                    {n.users?.employees?.full_name && <> · dicatat oleh {n.users.employees.full_name}</>}
                  </p>
                </div>
                {canManage(n) && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEditModal(n)} className="text-xs px-2.5 py-1 rounded border font-medium transition text-blue-600 border-blue-200 hover:bg-blue-50">Edit</button>
                    <button onClick={() => handleDelete(n)} className="text-xs px-2.5 py-1 rounded border font-medium transition text-red-600 border-red-200 hover:bg-red-50">Hapus</button>
                  </div>
                )}
              </div>
              {n.participants && (
                <p className="text-xs text-slate-500 mb-2"><span className="font-medium">Peserta:</span> {n.participants}</p>
              )}
              {n.content && (
                <p className="text-sm text-slate-700 whitespace-pre-wrap mb-2">{n.content}</p>
              )}
              {n.follow_up && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800 mb-0.5">Tindak Lanjut</p>
                  <p className="text-sm text-amber-700 whitespace-pre-wrap">{n.follow_up}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal Catatan Baru / Edit */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">
                {editingNote ? 'Edit Catatan Meeting' : 'Catatan Meeting Baru'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Judul <span className="text-red-500">*</span></label>
                  <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="Contoh: Rapat Evaluasi Bulanan"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Meeting <span className="text-red-500">*</span></label>
                  <input type="date" required value={form.meeting_date} onChange={e => setForm({ ...form, meeting_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Peserta</label>
                  <input value={form.participants} onChange={e => setForm({ ...form, participants: e.target.value })}
                    placeholder="Contoh: Owner, HR, Kepala Cabang Tasik Kota"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Isi Catatan</label>
                  <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={5}
                    placeholder="Poin-poin pembahasan..."
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tindak Lanjut / To-Do</label>
                  <textarea value={form.follow_up} onChange={e => setForm({ ...form, follow_up: e.target.value })} rows={3}
                    placeholder="Apa yang perlu ditindaklanjuti..."
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={submitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                    {submitting ? 'Menyimpan...' : 'Simpan'}
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
