'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Branch, Dept, Emp, MemberStatus, STATUS_LABEL, STATUS_STYLE, fmtDate, fmtDateTime, lateInfo, signedPhotoUrls,
} from '@/lib/meeting'
import TaskFormModal, { EditableTask } from './TaskFormModal'
import ReportModal from './ReportModal'

type MemberRow = {
  id: string; task_id: string; employee_id: string; group_branch_id: string | null; is_pic: boolean
  status: MemberStatus; first_final_at: string | null; last_final_at: string | null; approved_at: string | null
  review_note: string | null; revision_count: number
  employees: { full_name: string } | null
}
type TaskRow = {
  id: string; note_id: string; title: string; description: string | null
  task_type: 'team' | 'individual'; report_mode: 'once' | 'recurring'
  due_date: string | null; photo_required: boolean; created_at: string
  meeting_notes: { title: string } | null
  meeting_task_members: MemberRow[]
}
type ReportRow = {
  id: string; task_id: string; member_id: string; reporter_id: string; kind: 'progress' | 'final'
  content: string; photo_paths: string[]; created_at: string
  employees: { full_name: string } | null
}
type Unit = { key: string; task: TaskRow; reporter: MemberRow; members: MemberRow[]; label: string }

type Props = {
  isAdmin: boolean
  myEmployeeId: string | null
  branches: Branch[]
  departments: Dept[]
  employees: Emp[]
  noteFilter: string | null
  clearNoteFilter: () => void
  onChanged: () => void
}

function buildUnits(task: TaskRow, branches: Branch[]): Unit[] {
  const members = task.meeting_task_members
  if (task.task_type === 'individual') {
    return members.map(m => ({ key: m.id, task, reporter: m, members: [m], label: m.employees?.full_name ?? '-' }))
  }
  const groups = new Map<string, MemberRow[]>()
  members.forEach(m => { const k = m.group_branch_id ?? 'none'; groups.set(k, [...(groups.get(k) ?? []), m]) })
  const units: Unit[] = []
  groups.forEach((list, k) => {
    const pic = list.find(m => m.is_pic)
    if (!pic) return
    units.push({ key: pic.id, task, reporter: pic, members: list, label: branches.find(b => b.id === k)?.name ?? 'Tim' })
  })
  return units
}

export default function MeetingTasks({ isAdmin, myEmployeeId, branches, departments, employees, noteFilter, clearNoteFilter, onChanged }: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [adminFilter, setAdminFilter] = useState<'all' | 'review' | 'open' | 'late' | 'done'>('all')

  const [reportModal, setReportModal] = useState<{ memberId: string; title: string; kind: 'progress' | 'final'; photoRequired: boolean } | null>(null)
  const [editTask, setEditTask] = useState<TaskRow | null>(null)
  const [revisionFor, setRevisionFor] = useState<Unit | null>(null)
  const [revisionNote, setRevisionNote] = useState('')
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [tRes, rRes] = await Promise.all([
      supabase.from('meeting_tasks')
        .select('id,note_id,title,description,task_type,report_mode,due_date,photo_required,created_at,meeting_notes(title),meeting_task_members(id,task_id,employee_id,group_branch_id,is_pic,status,first_final_at,last_final_at,approved_at,review_note,revision_count,employees!meeting_task_members_employee_id_fkey(full_name))')
        .order('created_at', { ascending: false }),
      supabase.from('meeting_task_reports')
        .select('id,task_id,member_id,reporter_id,kind,content,photo_paths,created_at,employees(full_name)')
        .order('created_at', { ascending: true }),
    ])
    if (tRes.error) console.error('meeting_tasks:', tRes.error.message)
    if (rRes.error) console.error('meeting_task_reports:', rRes.error.message)
    const rows = ((tRes.data as unknown as TaskRow[]) || []).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    const reps = (rRes.data as unknown as ReportRow[]) || []
    setTasks(rows)
    setReports(reps)
    setPhotoUrls(await signedPhotoUrls(supabase, reps.flatMap(r => r.photo_paths)))
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  const allUnits = useMemo(
    () => tasks.filter(t => !noteFilter || t.note_id === noteFilter).flatMap(t => buildUnits(t, branches)),
    [tasks, branches, noteFilter])

  function refreshAfterChange(msg?: string) {
    if (msg) showMessage('success', msg)
    fetchAll()
    onChanged()
  }

  async function review(unit: Unit, approve: boolean, note?: string) {
    setReviewingId(unit.reporter.id)
    const { error } = await supabase.rpc('review_meeting_task_member', { p_member_id: unit.reporter.id, p_approve: approve, p_note: note ?? null })
    setReviewingId(null)
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    setRevisionFor(null); setRevisionNote('')
    refreshAfterChange(approve ? 'Laporan disetujui.' : 'Diminta revisi. Karyawan akan diberi tahu lewat angka merah di menu.')
  }

  async function deleteTask(t: TaskRow) {
    if (!window.confirm(`Hapus tugas "${t.title}"? Semua laporan di dalamnya ikut terhapus.`)) return
    const { error } = await supabase.from('meeting_tasks').delete().eq('id', t.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else refreshAfterChange('Tugas dihapus.')
  }

  function ReportsList({ unit }: { unit: Unit }) {
    const list = reports.filter(r => r.member_id === unit.reporter.id)
    if (list.length === 0) return null
    return (
      <div className="mt-2 space-y-2">
        {list.map(r => (
          <div key={r.id} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <p className="text-[11px] text-slate-400 mb-0.5">
              <span className={`font-semibold ${r.kind === 'final' ? 'text-green-700' : 'text-blue-700'}`}>{r.kind === 'final' ? '✅ Laporan selesai' : '📝 Progres'}</span>
              {' · '}{fmtDateTime(r.created_at)}{r.employees?.full_name ? ` · ${r.employees.full_name}` : ''}
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.content}</p>
            {r.photo_paths.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {r.photo_paths.map(p => photoUrls[p] ? (
                  <a key={p} href={photoUrls[p]} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrls[p]} alt="Foto bukti" className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                  </a>
                ) : null)}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  function TaskMeta({ task, unit }: { task: TaskRow; unit: Unit }) {
    const late = lateInfo(task.due_date, unit.reporter.first_final_at)
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`px-2 py-0.5 rounded-full border font-semibold ${STATUS_STYLE[unit.reporter.status]}`}>{STATUS_LABEL[unit.reporter.status]}</span>
        {late.late && <span className="px-2 py-0.5 rounded-full bg-red-600 text-white font-bold">⏰ {late.label.toUpperCase()}</span>}
        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{task.task_type === 'team' ? '👥 Tim' : '👤 Individu'}</span>
        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{task.report_mode === 'recurring' ? '🔁 Lapor berulang' : '1️⃣ Lapor sekali'}</span>
        {task.photo_required && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">📷 Wajib foto</span>}
        {task.due_date && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Tenggat {fmtDate(task.due_date)}</span>}
      </div>
    )
  }

  // ======================= TAMPILAN KARYAWAN =======================
  if (!isAdmin) {
    const mine = allUnits.filter(u => u.reporter.employee_id === myEmployeeId)
    const infoOnly = allUnits.filter(u => u.task.task_type === 'team' && u.reporter.employee_id !== myEmployeeId && u.members.some(m => m.employee_id === myEmployeeId))
    const todo = mine.filter(u => ['open', 'in_progress', 'revision'].includes(u.reporter.status))
    const waiting = mine.filter(u => u.reporter.status === 'submitted')
    const done = mine.filter(u => u.reporter.status === 'approved')

    const card = (u: Unit, canReport: boolean) => {
      const t = u.task
      const m = u.reporter
      return (
        <div key={u.key} className={`bg-white rounded-xl shadow-sm border p-5 ${m.status === 'revision' ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'}`}>
          <h3 className="text-lg font-semibold text-slate-800 leading-snug">{t.title}</h3>
          <p className="text-xs text-slate-400 mb-2">Dari catatan: {t.meeting_notes?.title ?? '-'}
            {t.task_type === 'team' && <> · Tim {u.label} · PIC: <span className="font-medium text-slate-600">{m.employees?.full_name}</span></>}
          </p>
          <TaskMeta task={t} unit={u} />
          {t.description && <p className="text-base text-slate-700 whitespace-pre-wrap mt-3">{t.description}</p>}
          {m.status === 'revision' && m.review_note && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-red-700">↩ Perlu diperbaiki</p>
              <p className="text-sm text-red-700 whitespace-pre-wrap">{m.review_note}</p>
            </div>
          )}
          {m.status === 'approved' && m.approved_at && <p className="mt-3 text-sm text-green-700 font-medium">✓ Disetujui {fmtDate(m.approved_at)}</p>}
          <ReportsList unit={u} />
          {canReport && ['open', 'in_progress', 'revision'].includes(m.status) && (
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              {t.report_mode === 'recurring' && (
                <button onClick={() => setReportModal({ memberId: m.id, title: t.title, kind: 'progress', photoRequired: t.photo_required })}
                  className="px-5 py-3 rounded-xl text-base font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition">📝 Laporan Progres</button>
              )}
              <button onClick={() => setReportModal({ memberId: m.id, title: t.title, kind: 'final', photoRequired: t.photo_required })}
                className="px-5 py-3 rounded-xl text-base font-bold bg-green-600 hover:bg-green-700 text-white shadow-sm transition">
                {t.report_mode === 'recurring' ? '✅ Laporan Selesai' : '✅ Kirim Laporan'}
              </button>
            </div>
          )}
          {m.status === 'submitted' && <p className="mt-3 text-sm text-amber-700">Laporan sudah dikirim, menunggu diperiksa Owner/HR.</p>}
        </div>
      )
    }

    const section = (title: string, list: Unit[], canReport = true) => list.length > 0 && (
      <div className="mb-6">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">{title} ({list.length})</h2>
        <div className="space-y-3">{list.map(u => card(u, canReport))}</div>
      </div>
    )

    return (
      <div>
        {noteFilter && (
          <div className="mb-4 flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <span className="text-blue-800">Menampilkan tugas dari satu catatan saja.</span>
            <button onClick={clearNoteFilter} className="font-semibold text-blue-700 underline">Tampilkan semua</button>
          </div>
        )}
        {message && <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>}
        {loading && tasks.length === 0 ? <div className="py-10 text-center text-slate-500">Memuat...</div>
          : (mine.length === 0 && infoOnly.length === 0) ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada tugas untuk Anda. 👍</div>
          ) : (
            <>
              {section('Perlu dikerjakan', todo)}
              {section('Menunggu diperiksa', waiting)}
              {section('Tugas tim (PIC yang melapor)', infoOnly, false)}
              {section('Selesai', done)}
            </>
          )}
        {reportModal && (
          <ReportModal memberId={reportModal.memberId} taskTitle={reportModal.title} kind={reportModal.kind}
            photoRequired={reportModal.photoRequired} onClose={() => setReportModal(null)}
            onSaved={() => { setReportModal(null); refreshAfterChange('Laporan terkirim. Terima kasih!') }} />
        )}
      </div>
    )
  }

  // ======================= TAMPILAN OWNER / HR =======================
  const isLateUnit = (u: Unit) => lateInfo(u.task.due_date, u.reporter.first_final_at).late
  const matches = (u: Unit) => {
    switch (adminFilter) {
      case 'review': return u.reporter.status === 'submitted'
      case 'open': return u.reporter.status !== 'approved'
      case 'late': return isLateUnit(u)
      case 'done': return u.reporter.status === 'approved'
      default: return true
    }
  }
  const counts = {
    review: allUnits.filter(u => u.reporter.status === 'submitted').length,
    open: allUnits.filter(u => u.reporter.status !== 'approved').length,
    late: allUnits.filter(isLateUnit).length,
    done: allUnits.filter(u => u.reporter.status === 'approved').length,
  }
  const visibleTasks = tasks
    .filter(t => !noteFilter || t.note_id === noteFilter)
    .map(t => ({ task: t, units: buildUnits(t, branches) }))
    .filter(x => x.units.some(matches))

  const chip = (key: typeof adminFilter, label: string, n?: number) => (
    <button key={key} onClick={() => setAdminFilter(key)}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition ${adminFilter === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
      {label}{n !== undefined && n > 0 ? ` (${n})` : ''}
    </button>
  )

  return (
    <div>
      {noteFilter && (
        <div className="mb-4 flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span className="text-blue-800">Menampilkan tugas dari satu catatan saja.</span>
          <button onClick={clearNoteFilter} className="font-semibold text-blue-700 underline">Tampilkan semua</button>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {chip('all', 'Semua')}
        {chip('review', '⏳ Menunggu review', counts.review)}
        {chip('open', 'Belum selesai', counts.open)}
        {chip('late', '⏰ Telat', counts.late)}
        {chip('done', 'Selesai', counts.done)}
      </div>
      {message && <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>}

      {loading && tasks.length === 0 ? <div className="py-10 text-center text-slate-500">Memuat...</div>
        : visibleTasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            {tasks.length === 0 ? 'Belum ada tugas. Buat dari halaman Catatan lewat tombol "Tambah Tugas".' : 'Tidak ada tugas yang cocok dengan filter ini.'}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleTasks.map(({ task, units }) => {
              const doneN = units.filter(u => u.reporter.status === 'approved').length
              return (
                <div key={task.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-800">{task.title}</h3>
                      <p className="text-xs text-slate-400">Dari catatan: {task.meeting_notes?.title ?? '-'} · Selesai {doneN} dari {units.length} {task.task_type === 'team' ? 'tim' : 'orang'}
                        {task.due_date && <> · Tenggat {fmtDate(task.due_date)}</>}
                        {' · '}{task.task_type === 'team' ? '👥 Tim' : '👤 Individu'} · {task.report_mode === 'recurring' ? '🔁 Berulang' : '1️⃣ Sekali'}{task.photo_required ? ' · 📷 Wajib foto' : ''}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setEditTask(task)} className="text-xs px-2.5 py-1 rounded border font-medium text-blue-600 border-blue-200 hover:bg-blue-50">Edit</button>
                      <button onClick={() => deleteTask(task)} className="text-xs px-2.5 py-1 rounded border font-medium text-red-600 border-red-200 hover:bg-red-50">Hapus</button>
                    </div>
                  </div>
                  {task.description && <p className="text-sm text-slate-600 whitespace-pre-wrap mt-2">{task.description}</p>}

                  <div className="mt-3 space-y-2">
                    {units.filter(matches).map(u => {
                      const m = u.reporter
                      return (
                        <div key={u.key} className="border border-slate-200 rounded-lg p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">
                                {task.task_type === 'team' ? <>👥 Tim {u.label} <span className="font-normal text-slate-500">· PIC {m.employees?.full_name}</span></> : <>👤 {m.employees?.full_name}</>}
                              </p>
                              {task.task_type === 'team' && (
                                <p className="text-[11px] text-slate-400">Anggota: {u.members.map(x => x.employees?.full_name).filter(Boolean).join(', ')}</p>
                              )}
                            </div>
                            <TaskMeta task={task} unit={u} />
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {m.first_final_at ? <>Laporan akhir pertama: {fmtDateTime(m.first_final_at)}</> : 'Belum ada laporan akhir'}
                            {m.approved_at && <> · Disetujui {fmtDateTime(m.approved_at)}</>}
                            {m.revision_count > 0 && <> · Direvisi {m.revision_count}x</>}
                          </p>
                          {m.status === 'revision' && m.review_note && <p className="text-xs text-red-600 mt-1">Catatan revisi: {m.review_note}</p>}
                          <ReportsList unit={u} />
                          {m.status === 'submitted' && (
                            <div className="mt-3 flex gap-2">
                              <button disabled={reviewingId === m.id} onClick={() => review(u, true)}
                                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">✓ Setujui</button>
                              <button disabled={reviewingId === m.id} onClick={() => { setRevisionFor(u); setRevisionNote('') }}
                                className="px-4 py-1.5 rounded-lg text-sm font-semibold border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">↩ Minta Revisi</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {editTask && (
        <TaskFormModal
          noteId={editTask.note_id} noteTitle={editTask.meeting_notes?.title ?? ''}
          editing={editTask as EditableTask}
          branches={branches} departments={departments} employees={employees}
          onClose={() => setEditTask(null)}
          onSaved={() => { setEditTask(null); refreshAfterChange('Tugas diperbarui.') }}
        />
      )}

      {revisionFor && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-800">Minta revisi</h2>
            <p className="text-sm text-slate-500 mb-3">{revisionFor.task.title} — {revisionFor.label}</p>
            <textarea value={revisionNote} onChange={e => setRevisionNote(e.target.value)} rows={4} placeholder="Apa yang perlu diperbaiki?"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setRevisionFor(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
              <button disabled={revisionNote.trim().length < 3 || reviewingId === revisionFor.reporter.id} onClick={() => review(revisionFor, false, revisionNote.trim())}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">Kirim</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
