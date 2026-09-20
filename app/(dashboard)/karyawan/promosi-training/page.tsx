'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type CandidateRow = {
  id: string
  eligible_since: string
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  decided_at: string | null
  created_at: string
  employees: { full_name: string; employee_code: string; join_date: string; branches: { name: string } | null; positions: { name: string } | null } | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Menunggu Verifikasi', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Disetujui — Sudah Tetap', color: 'bg-green-100 text-green-800' },
  rejected: { label: 'Ditunda', color: 'bg-red-100 text-red-800' },
}

export default function PromosiTrainingPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<CandidateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showDecided, setShowDecided] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { fetchRows() }, [showDecided]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchRows() {
    setLoading(true)
    let query = supabase.from('training_promotion_candidates')
      .select('id, eligible_since, status, rejection_reason, decided_at, created_at, employees!training_promotion_candidates_employee_id_fkey(full_name, employee_code, join_date, branches(name), positions(name))')
      .order('eligible_since')
    if (!showDecided) query = query.eq('status', 'pending')
    const { data, error } = await query
    if (error) console.error('Gagal memuat kandidat promosi training:', JSON.stringify(error, null, 2))
    setRows((data as unknown as CandidateRow[]) || [])
    setLoading(false)
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  async function decide(id: string, approve: boolean) {
    let reason: string | null = null
    if (!approve) {
      reason = window.prompt('Alasan menunda promosi ini (misal: masih evaluasi kinerja):') || ''
      if (!reason.trim()) { showMsg('error', 'Penundaan wajib disertai alasan.'); return }
    } else if (!confirm('Setujui promosi ini? Status karyawan akan langsung berubah jadi Staff Tetap (permanent).')) {
      return
    }
    setBusyId(id)
    const { error } = await supabase.rpc('decide_training_promotion', { p_id: id, p_approve: approve, p_reason: reason })
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else showMsg('success', approve ? 'Karyawan berhasil dipromosikan jadi Staff Tetap.' : 'Promosi ditunda.')
    await fetchRows()
    setBusyId(null)
  }

  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Promosi Training → Staff Tetap</h1>
          <p className="text-sm text-slate-500">Karyawan training yang masa kerjanya sudah lewat 3 periode (26–25) muncul di sini otomatis setiap hari, menunggu verifikasi sebelum benar-benar jadi staff tetap.</p>
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
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal Bergabung</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Memenuhi Syarat Sejak</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Memuat...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Belum ada kandidat{showDecided ? '' : ' yang menunggu verifikasi'}.</td></tr>
              ) : (
                rows.map(r => {
                  const cfg = STATUS_CONFIG[r.status]
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.employees?.full_name}</div>
                        <div className="text-xs text-slate-400">{r.employees?.employee_code} · {r.employees?.positions?.name} · {r.employees?.branches?.name}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.employees?.join_date ? fmtDate(r.employees.join_date) : '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{fmtDate(r.eligible_since)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                        {r.status === 'rejected' && r.rejection_reason && (
                          <p className="text-xs text-red-500 mt-0.5 italic">{r.rejection_reason}</p>
                        )}
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
                              Tunda
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
