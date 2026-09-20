'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type RequestRow = {
  id: string
  requested_date: string
  period_start: string
  period_end: string
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  created_at: string
  employees: { full_name: string; employee_code: string; branches: { name: string } | null } | null
}

type EmployeeMini = { full_name: string; employee_code: string; department_id: string | null } | null
type ChangeRequestRow = {
  id: string
  original_date: string
  requested_date: string
  counterpart_id: string | null
  counterpart_status: string | null
  status: 'pending_counterpart' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled'
  rejection_reason: string | null
  created_at: string
  requester: EmployeeMini
  counterpart: EmployeeMini
}

type WorkSchedule = { id: string; name: string; applies_to_dept: string }

const CHANGE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_counterpart: { label: 'Menunggu Rekan', color: 'bg-blue-100 text-blue-700' },
  pending_approval: { label: 'Menunggu Keputusan', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Disetujui', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Ditolak', color: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Dibatalkan', color: 'bg-slate-100 text-slate-500' },
}

export default function PersetujuanLiburPage() {
  const supabase = createClient()
  const [view, setView] = useState<'awal' | 'ganti'>('awal')

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showDecided, setShowDecided] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [changeRequests, setChangeRequests] = useState<ChangeRequestRow[]>([])
  const [loadingChange, setLoadingChange] = useState(true)
  const [showDecidedChange, setShowDecidedChange] = useState(false)
  const [busyChangeId, setBusyChangeId] = useState<string | null>(null)
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([])
  const [approveModal, setApproveModal] = useState<ChangeRequestRow | null>(null)
  const [requesterScheduleId, setRequesterScheduleId] = useState('')
  const [counterpartScheduleId, setCounterpartScheduleId] = useState('')
  const [rejectModal, setRejectModal] = useState<ChangeRequestRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { fetchRequests() }, [showDecided]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchChangeRequests(); fetchWorkSchedules() }, [showDecidedChange]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchRequests() {
    setLoading(true)
    let query = supabase.from('roster_pick_requests')
      .select('id, requested_date, period_start, period_end, status, rejection_reason, created_at, employees!roster_pick_requests_employee_id_fkey(full_name, employee_code, branches(name))')
      .order('requested_date')
    if (!showDecided) query = query.eq('status', 'pending')
    const { data, error } = await query
    if (error) console.error('Gagal memuat pengajuan jadwal libur awal:', JSON.stringify(error, null, 2))
    setRequests((data as unknown as RequestRow[]) || [])
    setLoading(false)
  }

  const fetchChangeRequests = useCallback(async () => {
    setLoadingChange(true)
    let query = supabase.from('roster_change_requests')
      .select('id, original_date, requested_date, counterpart_id, counterpart_status, status, rejection_reason, created_at, requester:employees!roster_change_requests_requester_id_fkey(full_name, employee_code, department_id), counterpart:employees!roster_change_requests_counterpart_id_fkey(full_name, employee_code, department_id)')
      .order('created_at')
    if (!showDecidedChange) query = query.eq('status', 'pending_approval')
    const { data, error } = await query
    if (error) console.error('Gagal memuat pengajuan ganti libur:', JSON.stringify(error, null, 2))
    setChangeRequests((data as unknown as ChangeRequestRow[]) || [])
    setLoadingChange(false)
  }, [supabase, showDecidedChange])

  async function fetchWorkSchedules() {
    const { data } = await supabase.from('work_schedules').select('id, name, applies_to_dept')
    setWorkSchedules((data as WorkSchedule[]) || [])
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function decide(id: string, approve: boolean) {
    let reason: string | null = null
    if (!approve) {
      reason = window.prompt('Alasan menolak pengajuan ini:') || ''
      if (!reason.trim()) { showMsg('error', 'Penolakan wajib disertai alasan.'); return }
    }
    setBusyId(id)
    const { error } = await supabase.rpc('decide_roster_pick_request', { p_request_id: id, p_approve: approve, p_reason: reason })
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else showMsg('success', approve ? 'Pengajuan disetujui, sudah masuk ke jadwal.' : 'Pengajuan ditolak.')
    await fetchRequests()
    setBusyId(null)
  }

  function openApproveModal(r: ChangeRequestRow) {
    setApproveModal(r)
    setRequesterScheduleId('')
    setCounterpartScheduleId('')
  }

  async function confirmApproveChange() {
    if (!approveModal) return
    if (!requesterScheduleId) { showMsg('error', 'Pilih jadwal kerja untuk pemohon dulu.'); return }
    if (approveModal.counterpart_id && !counterpartScheduleId) { showMsg('error', 'Pilih jadwal kerja untuk rekan dulu.'); return }
    setBusyChangeId(approveModal.id)
    const { error } = await supabase.rpc('decide_day_off_change', {
      p_request_id: approveModal.id,
      p_approve: true,
      p_reason: null,
      p_requester_schedule_id: requesterScheduleId,
      p_counterpart_schedule_id: approveModal.counterpart_id ? counterpartScheduleId : null,
    })
    if (error) showMsg('error', 'Gagal menyetujui: ' + error.message)
    else showMsg('success', 'Pengajuan ganti libur disetujui.')
    setApproveModal(null)
    await fetchChangeRequests()
    setBusyChangeId(null)
  }

  async function confirmRejectChange() {
    if (!rejectModal) return
    if (!rejectReason.trim()) { showMsg('error', 'Alasan penolakan wajib diisi.'); return }
    setBusyChangeId(rejectModal.id)
    const { error } = await supabase.rpc('decide_day_off_change', { p_request_id: rejectModal.id, p_approve: false, p_reason: rejectReason })
    if (error) showMsg('error', 'Gagal menolak: ' + error.message)
    else showMsg('success', 'Pengajuan ganti libur ditolak.')
    setRejectModal(null)
    setRejectReason('')
    await fetchChangeRequests()
    setBusyChangeId(null)
  }

  // Berapa orang lain yang minta tanggal sama, dari yang SEDANG ditampilkan — bantu HR lihat
  // tanggal mana yang "ramai" sebelum memutuskan.
  const countByDate: Record<string, number> = {}
  requests.forEach(r => { if (r.status !== 'rejected') countByDate[r.requested_date] = (countByDate[r.requested_date] || 0) + 1 })

  const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
    pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800' },
    approved: { label: 'Disetujui', color: 'bg-green-100 text-green-800' },
    rejected: { label: 'Ditolak', color: 'bg-red-100 text-red-800' },
  }

  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })
  const scheduleOptionsFor = (deptId: string | null | undefined) => workSchedules.filter(s => !deptId || s.applies_to_dept === deptId)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Persetujuan Jadwal Libur</h1>
          <p className="text-sm text-slate-500">Pengajuan libur mandiri dari karyawan.</p>
        </div>
      </div>

      <div className="inline-flex bg-slate-100 rounded-lg p-1 mb-6">
        <button onClick={() => setView('awal')} className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'awal' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Jadwal Libur Awal</button>
        <button onClick={() => setView('ganti')} className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'ganti' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Ganti Hari Libur</button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {view === 'awal' ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex justify-end">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showDecided} onChange={e => setShowDecided(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
              Tampilkan yang sudah diproses
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal Libur</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Memuat...</td></tr>
                ) : requests.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Belum ada pengajuan{showDecided ? '' : ' yang menunggu'}.</td></tr>
                ) : (
                  requests.map(r => {
                    const cfg = STATUS_CONFIG[r.status]
                    const cluster = countByDate[r.requested_date] || 1
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{r.employees?.full_name}</div>
                          <div className="text-xs text-slate-400">{r.employees?.employee_code} · {r.employees?.branches?.name}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {fmtDate(r.requested_date)}
                          {cluster > 1 && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">{cluster} orang tanggal ini</span>
                          )}
                          {r.status === 'rejected' && r.rejection_reason && (
                            <p className="text-xs text-red-500 mt-0.5 italic">Alasan tolak: {r.rejection_reason}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.status === 'pending' ? (
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => decide(r.id, true)} disabled={busyId === r.id}
                                className="text-xs bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 px-2.5 py-1 rounded font-medium transition disabled:opacity-50">
                                Setujui
                              </button>
                              <button onClick={() => decide(r.id, false)} disabled={busyId === r.id}
                                className="text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded font-medium transition disabled:opacity-50">
                                Tolak
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Selesai</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex justify-end">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showDecidedChange} onChange={e => setShowDecidedChange(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
              Tampilkan yang sudah diproses
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Pemohon</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Ganti Tanggal</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tukar Dengan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingChange ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Memuat...</td></tr>
                ) : changeRequests.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Belum ada pengajuan{showDecidedChange ? '' : ' yang menunggu keputusan'}.</td></tr>
                ) : (
                  changeRequests.map(r => {
                    const cfg = CHANGE_STATUS_CONFIG[r.status] || { label: r.status, color: 'bg-slate-100 text-slate-500' }
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{r.requester?.full_name}</div>
                          <div className="text-xs text-slate-400">{r.requester?.employee_code}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {fmtDate(r.original_date)} <span className="text-slate-400">→</span> {fmtDate(r.requested_date)}
                          {r.status === 'rejected' && r.rejection_reason && (
                            <p className="text-xs text-red-500 mt-0.5 italic">Alasan tolak: {r.rejection_reason}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {r.counterpart ? (
                            <>
                              <div>{r.counterpart.full_name}</div>
                              <div className="text-xs text-slate-400">{r.counterpart_status === 'accepted' ? 'sudah menerima' : r.counterpart_status === 'declined' ? 'menolak' : 'menunggu respon'}</div>
                            </>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.status === 'pending_approval' ? (
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => openApproveModal(r)} disabled={busyChangeId === r.id}
                                className="text-xs bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 px-2.5 py-1 rounded font-medium transition disabled:opacity-50">
                                Setujui
                              </button>
                              <button onClick={() => { setRejectModal(r); setRejectReason('') }} disabled={busyChangeId === r.id}
                                className="text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded font-medium transition disabled:opacity-50">
                                Tolak
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">{r.status === 'pending_counterpart' ? 'Belum siap' : 'Selesai'}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {approveModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Setujui Ganti Libur</h2>
              <p className="text-xs text-slate-500 mb-4 pb-3 border-b border-slate-100">
                Tanggal yang kembali jadi hari kerja butuh jadwal shift — pilih dulu sebelum menyetujui.
              </p>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Jadwal kerja {approveModal.requester?.full_name} di {fmtDate(approveModal.original_date)} <span className="text-red-500">*</span>
              </label>
              <select value={requesterScheduleId} onChange={e => setRequesterScheduleId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4 bg-white">
                <option value="">— Pilih jadwal —</option>
                {scheduleOptionsFor(approveModal.requester?.department_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              {approveModal.counterpart_id && (
                <>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Jadwal kerja {approveModal.counterpart?.full_name} di {fmtDate(approveModal.requested_date)} <span className="text-red-500">*</span>
                  </label>
                  <select value={counterpartScheduleId} onChange={e => setCounterpartScheduleId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4 bg-white">
                    <option value="">— Pilih jadwal —</option>
                    {scheduleOptionsFor(approveModal.counterpart?.department_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setApproveModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                  Batal
                </button>
                <button type="button" onClick={confirmApproveChange} disabled={busyChangeId === approveModal.id}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                  {busyChangeId === approveModal.id ? 'Memproses...' : 'Setujui'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Tolak Pengajuan Ganti Libur</h2>
              <label className="block text-sm font-medium text-slate-700 mb-1 mt-2">Alasan Ditolak <span className="text-red-500">*</span></label>
              <textarea
                required
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Contoh: Bentrok dengan kebutuhan operasional cabang."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setRejectModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                  Batal
                </button>
                <button type="button" onClick={confirmRejectChange} disabled={!rejectReason.trim() || busyChangeId === rejectModal.id}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                  {busyChangeId === rejectModal.id ? 'Memproses...' : 'Tolak Pengajuan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
