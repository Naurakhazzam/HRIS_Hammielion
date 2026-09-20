'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { isPreviewModeClient } from '@/lib/previewMode'

type NotifItem = {
  key: string
  status: string
  label: string
  date: string
  href: string
}

const SEEN_KEY = 'notifSeenStatus_v1'

function loadSeenMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveSeenMap(map: Record<string, string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map))
  } catch { /* localStorage unavailable — abaikan, cuma memengaruhi badge "belum dibaca" */ }
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Disetujui', rejected: 'Ditolak', lunas: 'Lunas', cancelled: 'Dibatalkan',
}

export default function NotifikasiBell() {
  const supabase = createClient()
  const router = useRouter()
  const [show, setShow] = useState(false)
  const [items, setItems] = useState<NotifItem[]>([])
  const [seenMap, setSeenMap] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
    if (!userData) return

    const isPreview = isPreviewModeClient()
    const isEmployee = ['employee', 'supervisor'].includes(userData.role) || isPreview
    const isAdmin = ['owner', 'hr'].includes(userData.role) && !isPreview

    if (isAdmin) {
      setVisible(true)
      setSeenMap(loadSeenMap())
      const { data: candidates } = await supabase.from('training_promotion_candidates')
        .select('id, eligible_since, employees!training_promotion_candidates_employee_id_fkey(full_name)')
        .eq('status', 'pending')
        .order('eligible_since')
      const adminItems: NotifItem[] = ((candidates as unknown as { id: string; eligible_since: string; employees: { full_name: string } | null }[]) || []).map(r => ({
        key: `trainingpromo-${r.id}`,
        status: 'pending',
        label: `${r.employees?.full_name} siap dipromosikan jadi Staff Tetap — perlu verifikasi`,
        date: r.eligible_since,
        href: '/karyawan/promosi-training',
      }))
      setItems(adminItems)
    }

    if (!isEmployee || !userData.employee_id) return
    setVisible(true)
    setSeenMap(loadSeenMap())

    const [leaveRes, kasbonRes, myChangeRes, incomingSwapRes] = await Promise.all([
      supabase.from('leave_requests')
        .select('id, status, leave_type, start_date, created_at')
        .eq('employee_id', userData.employee_id)
        .neq('status', 'pending').neq('status', 'cancelled')
        .order('created_at', { ascending: false }).limit(15),
      supabase.from('kasbon_requests')
        .select('id, status, amount_requested, created_at')
        .eq('employee_id', userData.employee_id)
        .neq('status', 'pending')
        .order('created_at', { ascending: false }).limit(15),
      supabase.rpc('get_my_day_off_change_requests'),
      supabase.rpc('get_incoming_day_off_swap_requests'),
    ])

    const leaveItems: NotifItem[] = (leaveRes.data || []).map(r => ({
      key: `leave-${r.id}`,
      status: r.status,
      label: `Pengajuan Cuti/Izin — ${STATUS_LABEL[r.status] ?? r.status}`,
      date: r.created_at,
      href: '/cuti',
    }))
    const kasbonItems: NotifItem[] = (kasbonRes.data || []).map(r => ({
      key: `kasbon-${r.id}`,
      status: r.status,
      label: `Kasbon Rp${Number(r.amount_requested).toLocaleString('id-ID')} — ${STATUS_LABEL[r.status] ?? r.status}`,
      date: r.created_at,
      href: '/kasbon',
    }))
    // Ganti hari libur — status akhir pengajuan sendiri (approved/rejected/cancelled).
    const myChangeItems: NotifItem[] = ((myChangeRes.data as { id: string; status: string; created_at: string }[]) || [])
      .filter(r => r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled')
      .map(r => ({
        key: `daychange-${r.id}`,
        status: r.status,
        label: `Pengajuan Ganti Libur — ${STATUS_LABEL[r.status] ?? r.status}`,
        date: r.created_at,
        href: '/portal/ganti-libur',
      }))
    // Permintaan tukar dari rekan yang butuh respons — selalu dianggap "belum dibaca" selama masih pending.
    const incomingSwapItems: NotifItem[] = ((incomingSwapRes.data as { id: string; requester_name: string; created_at: string }[]) || []).map(r => ({
      key: `swapask-${r.id}`,
      status: 'pending',
      label: `${r.requester_name} minta tukar hari libur dengan Anda`,
      date: r.created_at,
      href: '/portal/ganti-libur',
    }))

    const all = [...leaveItems, ...kasbonItems, ...myChangeItems, ...incomingSwapItems].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20)
    setItems(all)
  }

  function toggle() {
    const next = !show
    setShow(next)
    if (next) {
      // Ditandai "sudah dibaca" begitu dropdown dibuka — bukan cuma cek badge, supaya
      // titik merah beneran hilang setelah karyawan lihat isinya.
      const map = { ...seenMap }
      items.forEach(it => { map[it.key] = it.status })
      saveSeenMap(map)
      setSeenMap(map)
    }
  }

  if (!visible) return null

  const unreadCount = items.filter(it => seenMap[it.key] !== it.status).length

  return (
    <div className="relative" ref={boxRef}>
      <button onClick={toggle} aria-label="Notifikasi" className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        )}
      </button>
      {show && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <span className="text-xs font-semibold text-slate-600">Notifikasi</span>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {items.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Belum ada notifikasi.</p>
            ) : items.map(it => (
              <button key={it.key} onClick={() => { setShow(false); router.push(it.href) }}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition">
                <p className="text-xs text-slate-700">{it.label}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{new Date(it.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
