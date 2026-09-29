'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient } from '@/lib/previewMode'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import {
  Branch, Dept, Emp, audienceLabels, fmtDate, fmtDateTime, signedPhotoUrls,
} from '@/lib/meeting'
import TaskFormModal, { EditableDailyTask } from '@/components/dailyTasks/TaskFormModal'
import ReportModal from '@/components/dailyTasks/ReportModal'
import TemplateManagerModal from '@/components/dailyTasks/TemplateManagerModal'
import { DailyTaskTemplate, LogRow, PhotoMode, PHOTO_MODE_LABEL } from '@/components/dailyTasks/types'

type AudRow = { branch_id: string | null; department_id: string | null; employee_id: string | null }
type Task = {
  id: string; task_type: 'once' | 'daily'
  due_date: string | null; is_active: boolean; audience_all: boolean
  created_at: string
  daily_task_templates: { title: string; description: string | null; photo_mode: PhotoMode }
  daily_task_audiences: AudRow[]
}
type Phase = 'before_only' | 'done' | null
type MyProgress = {
  task_id: string; title: string; description: string | null; task_type: 'once' | 'daily'
  due_date: string | null; photo_mode: PhotoMode
  work_days: number | null; done_days: number | null
  today_phase: Phase; today_done_count: number | null
  has_logged_once: boolean; once_phase: Phase; once_done_count: number | null; last_log_date: string | null
}
type AdminProgressRow = {
  employee_id: string; full_name: string; branch_name: string | null
  work_days: number | null; done_days: number | null
  today_phase: Phase; today_done_count: number | null
  has_logged_once: boolean; once_phase: Phase; once_done_count: number | null; last_log_date: string | null
}

export default function TugasHarianPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Dept[]>([])
  const [employees, setEmployees] = useState<Emp[]>([])
  const [templates, setTemplates] = useState<DailyTaskTemplate[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Admin state
  const [tasks, setTasks] = useState<Task[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTask, setEditTask] = useState<EditableDailyTask | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [progressRows, setProgressRows] = useState<AdminProgressRow[]>([])
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [logsByEmployee, setLogsByEmployee] = useState<Record<string, LogRow[]>>({})
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [invalidateFor, setInvalidateFor] = useState<LogRow | null>(null)
  const [invalidateReason, setInvalidateReason] = useState('')

  // Employee state
  const [myProgress, setMyProgress] = useState<MyProgress[]>([])
  const [loadingMine, setLoadingMine] = useState(true)
  const [reportModal, setReportModal] = useState<{ taskId: string; title: string; photoMode: PhotoMode; step: 'single' | 'before' | 'after' } | null>(null)
  const [myLogs, setMyLogs] = useState<Record<string, LogRow[]>>({})
  const [myExpanded, setMyExpanded] = useState<string | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  function refreshBadge() {
    window.dispatchEvent(new Event('daily-task-badge-refresh'))
  }

  const fetchTemplates = useCallback(async () => {
    const { data, error } = await supabase.from('daily_task_templates').select('id,title,description,photo_mode,is_active').order('title')
    if (error) console.error('daily_task_templates:', error.message)
    setTemplates((data as DailyTaskTemplate[]) || [])
  }, [supabase])

  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true)
    const { data, error } = await supabase.from('daily_tasks')
      .select('id,task_type,due_date,is_active,audience_all,created_at,daily_task_templates(title,description,photo_mode),daily_task_audiences(branch_id,department_id,employee_id)')
      .order('created_at', { ascending: false })
    if (error) console.error('daily_tasks:', error.message)
    setTasks((data as unknown as Task[]) || [])
    setLoadingTasks(false)
  }, [supabase])

  const fetchMine = useCallback(async () => {
    setLoadingMine(true)
    const { data, error } = await supabase.rpc('get_my_daily_task_progress')
    if (error) console.error('get_my_daily_task_progress:', error.message)
    setMyProgress((data as MyProgress[]) || [])
    setLoadingMine(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const preview = isPreviewModeClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
      const admin = !!userData && ['owner', 'hr'].includes(userData.role) && !preview
      setIsAdmin(admin)
      if (admin) {
        const [bRes, dRes, eRes] = await Promise.all([
          supabase.from('branches').select('id,name').order('name'),
          supabase.from('departments').select('id,name').order('name'),
          supabase.from('employees').select('id,full_name,branch_id,department_id').eq('is_active', true).order('full_name'),
        ])
        setBranches((bRes.data as Branch[]) || [])
        setDepartments((dRes.data as Dept[]) || [])
        setEmployees((eRes.data as Emp[]) || [])
        await Promise.all([fetchTasks(), fetchTemplates()])
      } else {
        await fetchMine()
      }
      setReady(true)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshExpanded() {
    if (!expanded) return
    const { data } = await supabase.rpc('get_daily_task_progress_admin', { p_task_id: expanded })
    setProgressRows((data as AdminProgressRow[]) || [])
    const { data: logs } = await supabase.from('daily_task_logs')
      .select('id,employee_id,log_date,before_content,before_photo_paths,before_submitted_at,after_content,after_photo_paths,after_submitted_at,phase,is_invalid,invalid_reason')
      .eq('task_id', expanded).order('log_date', { ascending: false })
    const grouped: Record<string, LogRow[]> = {}
    ;(logs as LogRow[] || []).forEach(l => { grouped[l.employee_id] = [...(grouped[l.employee_id] ?? []), l] })
    setLogsByEmployee(grouped)
    if (logs && logs.length > 0) {
      const urls = await signedPhotoUrls(supabase, (logs as LogRow[]).flatMap(l => [...l.before_photo_paths, ...l.after_photo_paths]))
      setPhotoUrls(prev => ({ ...prev, ...urls }))
    }
  }

  async function toggleExpand(task: Task) {
    if (expanded === task.id) { setExpanded(null); return }
    setExpanded(task.id)
    setExpandedEmp(null)
    setLoadingProgress(true)
    const { data, error } = await supabase.rpc('get_daily_task_progress_admin', { p_task_id: task.id })
    if (error) { showMessage('error', 'Gagal memuat progres: ' + error.message); setLoadingProgress(false); return }
    setProgressRows((data as AdminProgressRow[]) || [])
    const { data: logs } = await supabase.from('daily_task_logs')
      .select('id,employee_id,log_date,before_content,before_photo_paths,before_submitted_at,after_content,after_photo_paths,after_submitted_at,phase,is_invalid,invalid_reason')
      .eq('task_id', task.id).order('log_date', { ascending: false })
    const grouped: Record<string, LogRow[]> = {}
    ;(logs as LogRow[] || []).forEach(l => { grouped[l.employee_id] = [...(grouped[l.employee_id] ?? []), l] })
    setLogsByEmployee(grouped)
    setPhotoUrls(await signedPhotoUrls(supabase, (logs as LogRow[] || []).flatMap(l => [...l.before_photo_paths, ...l.after_photo_paths])))
    setLoadingProgress(false)
  }

  async function confirmInvalidate() {
    if (!invalidateFor) return
    if (invalidateReason.trim().length < 3) { showMessage('error', 'Alasan wajib diisi.'); return }
    const { error } = await supabase.rpc('review_daily_task_log', { p_log_id: invalidateFor.id, p_invalid: true, p_reason: invalidateReason.trim() })
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    setInvalidateFor(null); setInvalidateReason('')
    showMessage('success', 'Laporan ditandai tidak valid.')
    await refreshExpanded()
  }

  async function unmarkInvalid(log: LogRow) {
    const { error } = await supabase.rpc('review_daily_task_log', { p_log_id: log.id, p_invalid: false })
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    showMessage('success', 'Ditandai valid kembali.')
    await refreshExpanded()
  }

  async function handleDelete(task: Task) {
    if (!window.confirm(`Hapus tugas "${task.daily_task_templates.title}"? Semua laporan di dalamnya ikut terhapus.`)) return
    const { error } = await supabase.from('daily_tasks').delete().eq('id', task.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Tugas dihapus.'); if (expanded === task.id) setExpanded(null); fetchTasks() }
  }

  async function toggleMyLogs(taskId: string) {
    if (myExpanded === taskId) { setMyExpanded(null); return }
    setMyExpanded(taskId)
    const { data: logs } = await supabase.from('daily_task_logs')
      .select('id,employee_id,log_date,before_content,before_photo_paths,before_submitted_at,after_content,after_photo_paths,after_submitted_at,phase,is_invalid,invalid_reason')
      .eq('task_id', taskId).order('log_date', { ascending: false })
    setMyLogs(prev => ({ ...prev, [taskId]: (logs as LogRow[]) || [] }))
    if (logs && logs.length > 0) {
      const urls = await signedPhotoUrls(supabase, (logs as LogRow[]).flatMap(l => [...l.before_photo_paths, ...l.after_photo_paths]))
      setPhotoUrls(prev => ({ ...prev, ...urls }))
    }
  }

  function openReport(taskId: string, title: string, photoMode: PhotoMode, step: 'single' | 'before' | 'after') {
    setReportModal({ taskId, title, photoMode, step })
  }

  function PhotoThumb({ path, label }: { path: string; label: string }) {
    if (!photoUrls[path]) return null
    return (
      <button type="button" onClick={() => openLightbox(photoUrls[path], label)} className="flex flex-col items-center gap-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrls[path]} alt={label} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
      </button>
    )
  }

  function LogCard({ log }: { log: LogRow }) {
    const isBeforeAfter = log.after_content != null || log.phase === 'before_only'
    return (
      <div className={`rounded-lg border px-3 py-2 ${log.is_invalid ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
        <p className="text-[11px] text-slate-400 mb-1">
          {fmtDate(log.log_date)}
          {log.is_invalid && <span className="ml-1.5 font-semibold text-red-600">TIDAK VALID</span>}
          {log.phase === 'before_only' && <span className="ml-1.5 font-semibold text-amber-600">MENUNGGU SESUDAH</span>}
        </p>
        {!isBeforeAfter ? (
          <>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{log.before_content}</p>
            {log.before_photo_paths.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5">{log.before_photo_paths.map(p => <PhotoThumb key={p} path={p} label="Foto bukti" />)}</div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Sebelum · {fmtDateTime(log.before_submitted_at)}</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{log.before_content}</p>
              <div className="flex flex-wrap gap-2 mt-1.5">{log.before_photo_paths.map(p => <PhotoThumb key={p} path={p} label="Foto sebelum" />)}</div>
            </div>
            <div>
              {log.after_content != null ? (
                <>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Sesudah · {log.after_submitted_at ? fmtDateTime(log.after_submitted_at) : ''}</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{log.after_content}</p>
                  <div className="flex flex-wrap gap-2 mt-1.5">{log.after_photo_paths.map(p => <PhotoThumb key={p} path={p} label="Foto sesudah" />)}</div>
                </>
              ) : (
                <p className="text-xs text-amber-600 italic">Belum kirim foto sesudah.</p>
              )}
            </div>
          </div>
        )}
        {log.is_invalid && log.invalid_reason && <p className="text-xs text-red-600 mt-1">Alasan: {log.invalid_reason}</p>}
      </div>
    )
  }

  if (!ready) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">📋 Tugas & Laporan</h1>
          <p className="text-sm text-slate-500">
            {isAdmin ? 'Minta laporan rutin atau sekali jalan dari karyawan/divisi tertentu.' : 'Tugas yang ditujukan untuk Anda. Lapor tepat waktu untuk penilaian kinerja.'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setShowTemplates(true)}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg shadow-sm transition">
              📚 Master Judul
            </button>
            <button onClick={() => { setEditTask(null); setShowForm(true) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition">
              <span className="text-base leading-none">+</span> Tugas Baru
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>
      )}

      {isAdmin ? (
        loadingTasks ? (
          <div className="py-10 text-center text-slate-500">Memuat...</div>
        ) : tasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            Belum ada tugas. {templates.length === 0 ? 'Buat dulu judulnya di "Master Judul", lalu' : 'Klik'} &quot;Tugas Baru&quot; untuk mulai.
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(t => {
              const tpl = t.daily_task_templates
              const tujuan = t.audience_all ? ['Semua karyawan'] : audienceLabels(t.daily_task_audiences, branches, departments, employees)
              return (
                <div key={t.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700">{t.task_type === 'daily' ? '🔁 RUTIN' : '1️⃣ SEKALI JALAN'}</span>
                          {!t.is_active && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-600">NONAKTIF</span>}
                          {tpl.photo_mode !== 'none' && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">📷 {PHOTO_MODE_LABEL[tpl.photo_mode]}</span>}
                        </div>
                        <h2 className="text-base font-semibold text-slate-800">{tpl.title}</h2>
                        {tpl.description && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{tpl.description}</p>}
                        <p className="text-xs text-slate-500 mt-1.5">
                          Ditujukan: {tujuan.join(', ') || '-'}
                          {t.due_date && <> · Tenggat {fmtDate(t.due_date)}</>}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => { setEditTask({ id: t.id, due_date: t.due_date, is_active: t.is_active }); setShowForm(true) }} className="text-xs px-2.5 py-1 rounded border font-medium text-blue-600 border-blue-200 hover:bg-blue-50">Edit</button>
                        <button onClick={() => handleDelete(t)} className="text-xs px-2.5 py-1 rounded border font-medium text-red-600 border-red-200 hover:bg-red-50">Hapus</button>
                      </div>
                    </div>
                    <button onClick={() => toggleExpand(t)} className="mt-3 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 transition">
                      {expanded === t.id ? 'Tutup Progres ▲' : 'Lihat Progres ▼'}
                    </button>
                  </div>

                  {expanded === t.id && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                      {loadingProgress ? (
                        <div className="py-6 text-center text-slate-400 text-sm">Memuat progres...</div>
                      ) : progressRows.length === 0 ? (
                        <div className="py-6 text-center text-slate-400 text-sm">Tidak ada karyawan pada target tugas ini.</div>
                      ) : (
                        <div className="space-y-2">
                          {progressRows.map(r => {
                            const logs = logsByEmployee[r.employee_id] ?? []
                            const isOpen = expandedEmp === r.employee_id
                            const behind = t.task_type === 'daily' && r.work_days !== null && r.done_days !== null && r.done_days < r.work_days
                            return (
                              <div key={r.employee_id} className="bg-white border border-slate-200 rounded-lg">
                                <button onClick={() => setExpandedEmp(isOpen ? null : r.employee_id)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50 transition">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">{r.full_name} <span className="font-normal text-slate-400 text-xs">{r.branch_name}</span></p>
                                    <p className="text-[11px] text-slate-400">{r.last_log_date ? `Terakhir selesai ${fmtDate(r.last_log_date)}` : 'Belum pernah selesai lapor'}</p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {t.task_type === 'daily' ? (
                                      <span className={`text-sm font-bold px-2 py-0.5 rounded ${behind ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{r.done_days}/{r.work_days}</span>
                                    ) : (
                                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${r.once_phase === 'done' ? 'bg-green-100 text-green-700' : r.once_phase === 'before_only' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                        {r.once_phase === 'done' ? '✓ Selesai' : r.once_phase === 'before_only' ? 'Menunggu Sesudah' : 'Belum lapor'}
                                      </span>
                                    )}
                                    <span className="text-slate-400 text-xs">{isOpen ? '▲' : '▼'}</span>
                                  </div>
                                </button>
                                {isOpen && (
                                  <div className="border-t border-slate-100 p-3 space-y-2">
                                    {logs.length === 0 ? (
                                      <p className="text-xs text-slate-400">Belum ada laporan.</p>
                                    ) : logs.map(log => (
                                      <div key={log.id}>
                                        <LogCard log={log} />
                                        <div className="mt-1 ml-1">
                                          {log.is_invalid ? (
                                            <button onClick={() => unmarkInvalid(log)} className="text-xs text-blue-600 hover:underline">Tandai valid lagi</button>
                                          ) : (
                                            <button onClick={() => setInvalidateFor(log)} className="text-xs text-red-600 hover:underline">Tandai tidak valid</button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : (
        loadingMine ? (
          <div className="py-10 text-center text-slate-500">Memuat...</div>
        ) : myProgress.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada tugas untuk Anda. 👍</div>
        ) : (
          <div className="space-y-3">
            {myProgress.map(p => {
              const logs = myLogs[p.task_id] ?? []
              const isOpen = myExpanded === p.task_id
              const phase = p.task_type === 'daily' ? p.today_phase : p.once_phase
              const doneCount = p.task_type === 'daily' ? p.today_done_count : p.once_done_count
              return (
                <div key={p.task_id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700">{p.task_type === 'daily' ? '🔁 RUTIN' : '1️⃣ SEKALI JALAN'}</span>
                    {p.photo_mode !== 'none' && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">📷 {PHOTO_MODE_LABEL[p.photo_mode]}</span>}
                    {phase === 'before_only' && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500 text-white">MENUNGGU SESUDAH</span>}
                  </div>
                  <h2 className="text-lg font-semibold text-slate-800">{p.title}</h2>
                  {p.description && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{p.description}</p>}
                  <p className="text-xs text-slate-500 mt-1.5">
                    {p.due_date && <>Tenggat {fmtDate(p.due_date)} · </>}
                    {p.last_log_date ? `Terakhir selesai ${fmtDate(p.last_log_date)}` : 'Belum pernah selesai lapor'}
                  </p>

                  {p.task_type === 'daily' && p.work_days !== null && p.done_days !== null && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-semibold text-slate-700">Progres periode ini</span>
                        <span className="font-bold text-slate-800">{p.done_days}/{p.work_days}</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500" style={{ width: `${p.work_days > 0 ? Math.min(100, (p.done_days / p.work_days) * 100) : 0}%` }} />
                      </div>
                    </div>
                  )}

                  {p.photo_mode === 'before_after' && !!doneCount && (
                    <p className="text-sm text-green-700 font-medium mt-3">✓ {doneCount} rangkaian selesai {p.task_type === 'daily' ? 'hari ini' : ''}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 items-center">
                    {p.photo_mode === 'before_after' ? (
                      phase === 'before_only' ? (
                        <button onClick={() => openReport(p.task_id, p.title, p.photo_mode, 'after')}
                          className="px-5 py-3 rounded-xl text-base font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition">✅ Kirim Foto Sesudah</button>
                      ) : (
                        <button onClick={() => openReport(p.task_id, p.title, p.photo_mode, 'before')}
                          className="px-5 py-3 rounded-xl text-base font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition">
                          📷 {doneCount ? 'Tambah Rangkaian Baru' : 'Kirim Foto Sebelum'}
                        </button>
                      )
                    ) : phase === 'done' ? (
                      <span className="text-sm text-green-700 font-medium">✓ {p.task_type === 'daily' ? 'Sudah lapor hari ini' : 'Sudah dilaporkan'}</span>
                    ) : (
                      <button onClick={() => openReport(p.task_id, p.title, p.photo_mode, 'single')}
                        className="px-5 py-3 rounded-xl text-base font-bold bg-green-600 hover:bg-green-700 text-white shadow-sm transition">
                        {p.task_type === 'daily' ? '✅ Lapor Hari Ini' : '✅ Kirim Laporan'}
                      </button>
                    )}
                    <button onClick={() => toggleMyLogs(p.task_id)} className="text-xs text-blue-600 hover:underline">
                      {isOpen ? 'Sembunyikan riwayat' : 'Lihat riwayat laporan'}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      {logs.length === 0 ? <p className="text-xs text-slate-400">Belum ada laporan.</p> : logs.map(log => <LogCard key={log.id} log={log} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {showForm && (
        <TaskFormModal
          editing={editTask} templates={templates} branches={branches} departments={departments} employees={employees}
          onClose={() => setShowForm(false)}
          onManageTemplates={() => { setShowForm(false); setShowTemplates(true) }}
          onSaved={() => { setShowForm(false); showMessage('success', editTask ? 'Tugas diperbarui.' : 'Tugas dibuat.'); fetchTasks() }}
        />
      )}

      {showTemplates && (
        <TemplateManagerModal templates={templates} onClose={() => setShowTemplates(false)} onChanged={fetchTemplates} />
      )}

      {reportModal && (
        <ReportModal taskId={reportModal.taskId} taskTitle={reportModal.title} photoMode={reportModal.photoMode} step={reportModal.step}
          onClose={() => setReportModal(null)}
          onSaved={() => { setReportModal(null); showMessage('success', reportModal.step === 'before' ? 'Foto Sebelum terkirim. Lanjutkan dengan foto Sesudah setelah selesai.' : 'Laporan terkirim. Terima kasih!'); fetchMine(); refreshBadge() }}
        />
      )}

      {invalidateFor && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-800">Tandai laporan tidak valid</h2>
            <p className="text-sm text-slate-500 mb-3">{fmtDate(invalidateFor.log_date)}</p>
            <textarea value={invalidateReason} onChange={e => setInvalidateReason(e.target.value)} rows={3} placeholder="Kenapa laporan ini tidak valid?"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setInvalidateFor(null); setInvalidateReason('') }} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
              <button disabled={invalidateReason.trim().length < 3} onClick={confirmInvalidate}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">Tandai Tidak Valid</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
