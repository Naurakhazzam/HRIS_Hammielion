'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient } from '@/lib/previewMode'
import { Branch, Dept, Emp } from '@/lib/meeting'
import MeetingNotes from '@/components/meeting/MeetingNotes'
import MeetingTasks from '@/components/meeting/MeetingTasks'

type Badge = { unread_notes: number; my_tasks: number; to_review: number; total: number }

export default function CatatanMeetingPage() {
  const supabase = createClient()
  const [ready, setReady] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Dept[]>([])
  const [employees, setEmployees] = useState<Emp[]>([])
  const [badge, setBadge] = useState<Badge>({ unread_notes: 0, my_tasks: 0, to_review: 0, total: 0 })
  const [tab, setTab] = useState<'catatan' | 'tugas'>('catatan')
  const [noteFilter, setNoteFilter] = useState<string | null>(null)

  const isAdmin = ['owner', 'hr'].includes(role) && !preview

  const refreshBadge = useCallback(async () => {
    const { data } = await supabase.rpc('get_meeting_badge_count')
    if (data) setBadge(data as Badge)
    window.dispatchEvent(new Event('meeting-badge-refresh'))
  }, [supabase])

  useEffect(() => {
    async function init() {
      setPreview(isPreviewModeClient())
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setMyUserId(user.id)
      const [uRes, bRes, dRes, eRes] = await Promise.all([
        supabase.from('users').select('role, employee_id').eq('id', user.id).single(),
        supabase.from('branches').select('id,name').order('name'),
        supabase.from('departments').select('id,name').order('name'),
        supabase.from('employees').select('id,full_name,branch_id,department_id').eq('is_active', true).order('full_name'),
      ])
      if (uRes.data) { setRole(uRes.data.role); setMyEmployeeId(uRes.data.employee_id ?? null) }
      setBranches((bRes.data as Branch[]) || [])
      setDepartments((dRes.data as Dept[]) || [])
      setEmployees((eRes.data as Emp[]) || [])
      await refreshBadge()
      setReady(true)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tabBadge = isAdmin ? badge.to_review : badge.my_tasks
  const tabBtn = (key: 'catatan' | 'tugas', label: string, n: number) => (
    <button onClick={() => { setTab(key); if (key === 'catatan') setNoteFilter(null) }}
      className={`relative px-5 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition ${tab === key ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
      {label}
      {n > 0 && <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-xs font-bold">{n}</span>}
    </button>
  )

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">📝 Catatan Meeting</h1>
        <p className="text-sm text-slate-500">
          {isAdmin
            ? 'Hasil rapat untuk dibaca karyawan, lengkap dengan tugas dan laporannya.'
            : 'Hasil rapat dan tugas untuk Anda. Baca catatan baru, lalu kerjakan tugas yang diberikan.'}
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-5">
        {tabBtn('catatan', '📝 Catatan', isAdmin ? 0 : badge.unread_notes)}
        {tabBtn('tugas', isAdmin ? '📌 Tugas & Laporan' : '📌 Tugas Saya', tabBadge)}
      </div>

      {!ready ? (
        <div className="py-10 text-center text-slate-500">Memuat...</div>
      ) : tab === 'catatan' ? (
        <MeetingNotes
          isAdmin={isAdmin} myUserId={myUserId} myRole={role} myEmployeeId={myEmployeeId}
          branches={branches} departments={departments} employees={employees}
          onChanged={refreshBadge}
          onOpenTasks={id => { setNoteFilter(id); setTab('tugas') }}
        />
      ) : (
        <MeetingTasks
          isAdmin={isAdmin} myEmployeeId={myEmployeeId}
          branches={branches} departments={departments} employees={employees}
          noteFilter={noteFilter} clearNoteFilter={() => setNoteFilter(null)}
          onChanged={refreshBadge}
        />
      )}
    </div>
  )
}
