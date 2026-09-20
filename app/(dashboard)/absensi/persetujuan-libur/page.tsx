'use client'

import { useState, useEffect } from 'react'
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

export default function PersetujuanLiburPage() {
  const supabase = createClient()
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showDecided, setShowDecided] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { fetchRequests() }, [showDecided]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchRequests() {
    setLoading(true)
    let query = supabase.from('roster_pick_requests')
      .select('id, requested_date, period_start, period_end, status, rejection_reason, created_at, employees(full_name, employee_code, branches(name))')
      .order('requested_date')
    if (!showDecided) query = query.eq('status', 'pending')
    const { data } = await query
    setRequests((data as unknown as RequestRow[]) || [])
    setLoading(false)
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

  // Berapa orang lain yang minta tanggal sama, dari yang SEDANG ditampilkan — bantu HR lihat
  // tanggal mana yang "ramai" sebelum memutuskan.
  const countByDate: Record<string, number> = {}
  requests.forEach(r => { if (r.status !== 'rejected') countByDate[r.requested_date] = (countByDate[r.requested_date] || 0) + 1 })

  const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
    pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800' },
    approved: { label: 'Disetujui', color: 'bg-green-100 text-green-800' },
    rejected: { label: 'Ditolak', color: 'bg-red-100 text-red-800' },
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Persetujuan Jadwal Libur</h1>
          <p className="text-sm text-slate-500">Pengajuan libur mandiri dari karyawan, untuk periode 26–25 mendatang.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showDecided} onChange={e => setShowDecided(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
          Tampilkan yang sudah diproses
        </label>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
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
                  const dateLabel = new Date(r.requested_date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })
                  const cluster = countByDate[r.requested_date] || 1
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.employees?.full_name}</div>
                        <div className="text-xs text-slate-400">{r.employees?.employee_code} · {r.employees?.branches?.name}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {dateLabel}
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
    </div>
  )
}
