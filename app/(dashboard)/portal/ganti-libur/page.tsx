'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { todayLocalStr, localDateStr } from '@/lib/date'

type OwnDayOff = { date: string }
type Colleague = { employee_id: string; full_name: string; employee_code: string }
type MyRequest = {
  id: string
  original_date: string
  requested_date: string
  counterpart_id: string | null
  counterpart_name: string | null
  counterpart_status: string | null
  status: string
  rejection_reason: string | null
  created_at: string
}
type IncomingSwap = {
  id: string
  requester_name: string
  requester_code: string
  original_date: string
  requested_date: string
  created_at: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_counterpart: { label: 'Menunggu Respon Rekan', color: 'bg-blue-100 text-blue-700' },
  pending_approval: { label: 'Menunggu HR/Owner', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Disetujui', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Ditolak', color: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Dibatalkan', color: 'bg-slate-100 text-slate-500' },
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })
}

// H-2: pengajuan minimal 2 hari sebelum tanggal yang PALING DEKAT (lama atau baru).
function minAllowedFutureDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return localDateStr(d)
}

export default function GantiLiburPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [ownDayOffs, setOwnDayOffs] = useState<OwnDayOff[]>([])
  const [myRequests, setMyRequests] = useState<MyRequest[]>([])
  const [incomingSwaps, setIncomingSwaps] = useState<IncomingSwap[]>([])

  const [originalDate, setOriginalDate] = useState('')
  const [newDate, setNewDate] = useState('')
  const [collision, setCollision] = useState<Colleague[]>([])
  const [collisionChecked, setCollisionChecked] = useState(false)
  const [selectedCounterpart, setSelectedCounterpart] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const minFuture = minAllowedFutureDate()

  const fetchData = useCallback(async (empId: string) => {
    const today = todayLocalStr()
    const [{ data: offs }, { data: reqs }, { data: incoming }] = await Promise.all([
      supabase.from('employee_roster')
        .select('date')
        .eq('employee_id', empId).eq('is_day_off', true)
        .gt('date', today).order('date'),
      supabase.rpc('get_my_day_off_change_requests'),
      supabase.rpc('get_incoming_day_off_swap_requests'),
    ])
    // Hanya tampilkan hari libur yang secara teori masih bisa diajukan (H-2 dari tanggal itu
    // sendiri) — kalau kurang dari itu, pengajuan pasti ditolak RPC, jadi tidak usah ditawarkan.
    setOwnDayOffs(((offs as OwnDayOff[]) || []).filter(o => o.date >= minFuture))
    setMyRequests((reqs as MyRequest[]) || [])
    setIncomingSwaps((incoming as IncomingSwap[]) || [])
  }, [supabase, minFuture])

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: userData } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
    if (!userData) return
    setEmployeeId(userData.employee_id)
    await fetchData(userData.employee_id)
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  async function checkCollision(dateStr: string) {
    setNewDate(dateStr)
    setSelectedCounterpart('')
    setCollisionChecked(false)
    setCollision([])
    if (!dateStr) return
    const { data, error } = await supabase.rpc('get_branch_dayoff_colleagues', { p_date: dateStr })
    if (!error) {
      setCollision((data as Colleague[]) || [])
      setCollisionChecked(true)
    }
  }

  async function submitRequest() {
    if (!originalDate || !newDate) { showMessage('error', 'Pilih tanggal libur lama dan tanggal baru dulu.'); return }
    if (collision.length > 0 && !selectedCounterpart) { showMessage('error', 'Tanggal itu sudah jadi libur rekan — pilih siapa yang diajak tukar.'); return }
    setSubmitting(true)
    const { error } = await supabase.rpc('request_day_off_change', {
      p_original_date: originalDate,
      p_requested_date: newDate,
      p_counterpart_id: selectedCounterpart || null,
    })
    if (error) {
      showMessage('error', 'Gagal mengajukan: ' + error.message)
    } else {
      showMessage('success', collision.length > 0 ? 'Diajukan — menunggu respon rekan yang diajak tukar.' : 'Diajukan — menunggu persetujuan HR/Owner.')
      setOriginalDate(''); setNewDate(''); setCollision([]); setCollisionChecked(false); setSelectedCounterpart('')
    }
    await fetchData(employeeId)
    setSubmitting(false)
  }

  async function respond(id: string, accept: boolean) {
    if (!confirm(accept ? 'Terima permintaan tukar libur ini?' : 'Tolak permintaan tukar libur ini?')) return
    setRespondingId(id)
    const { error } = await supabase.rpc('respond_day_off_swap', { p_request_id: id, p_accept: accept })
    if (error) showMessage('error', 'Gagal merespon: ' + error.message)
    else showMessage('success', accept ? 'Diterima — diteruskan ke HR/Owner untuk keputusan akhir.' : 'Ditolak, pengajuan rekan dibatalkan.')
    await fetchData(employeeId)
    setRespondingId(null)
  }

  async function cancelRequest(id: string) {
    if (!confirm('Batalkan pengajuan ganti libur ini?')) return
    const { error } = await supabase.from('roster_change_requests').delete().eq('id', id)
    if (error) showMessage('error', 'Gagal membatalkan: ' + error.message)
    else showMessage('success', 'Pengajuan dibatalkan.')
    await fetchData(employeeId)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  const hasActiveRequest = myRequests.some(r => r.status === 'pending_counterpart' || r.status === 'pending_approval')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Ganti Hari Libur</h1>
        <p className="text-sm text-slate-500">Ubah hari libur yang sudah disetujui ke tanggal lain. Kalau tanggal baru sudah jadi libur rekan, ini jadi pengajuan tukar — perlu rekan itu setuju dulu sebelum diproses HR/Owner. Pengajuan minimal 2 hari sebelum tanggal yang paling dekat (baik tanggal lama maupun baru).</p>
      </div>

      {message && (
        <div className={`p-3 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {incomingSwaps.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-amber-800 mb-3">🔔 Permintaan Tukar Libur dari Rekan — Perlu Respon Anda</h2>
          <div className="space-y-3">
            {incomingSwaps.map(s => (
              <div key={s.id} className="bg-white border border-amber-100 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-sm text-slate-700">
                  <p><strong>{s.requester_name}</strong> ({s.requester_code}) ingin menukar hari libur dengan Anda:</p>
                  <p className="text-xs text-slate-500 mt-1">Anda melepas libur <strong>{fmtDate(s.requested_date)}</strong>, dan mendapat ganti libur <strong>{fmtDate(s.original_date)}</strong> sebagai gantinya.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => respond(s.id, true)} disabled={respondingId === s.id}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50">Terima</button>
                  <button onClick={() => respond(s.id, false)} disabled={respondingId === s.id}
                    className="text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50">Tolak</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Ajukan Ganti Hari Libur</h2>
        {hasActiveRequest ? (
          <p className="text-sm text-slate-500 italic">Anda masih punya pengajuan yang sedang diproses — batalkan dulu di daftar bawah kalau ingin mengajukan yang baru.</p>
        ) : ownDayOffs.length === 0 ? (
          <p className="text-sm text-slate-500 italic">Tidak ada hari libur yang sudah disetujui yang masih bisa diajukan gantinya (minimal H-2).</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Libur yang Mau Diganti</label>
              <select value={originalDate} onChange={e => setOriginalDate(e.target.value)}
                className="w-full sm:w-80 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">— Pilih tanggal —</option>
                {ownDayOffs.map(o => <option key={o.date} value={o.date}>{fmtDate(o.date)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Libur Baru yang Diinginkan</label>
              <input type="date" value={newDate} min={minFuture} onChange={e => checkCollision(e.target.value)}
                className="w-full sm:w-80 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {collisionChecked && collision.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700 mb-2">⚠️ Tanggal itu sudah jadi hari libur rekan berikut — pilih siapa yang diajak tukar (dia akan mendapat tanggal libur lama Anda sebagai gantinya, dan harus setuju dulu):</p>
                <div className="space-y-1.5">
                  {collision.map(c => (
                    <label key={c.employee_id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="radio" name="counterpart" value={c.employee_id} checked={selectedCounterpart === c.employee_id}
                        onChange={() => setSelectedCounterpart(c.employee_id)} className="text-blue-600" />
                      {c.full_name} ({c.employee_code})
                    </label>
                  ))}
                </div>
              </div>
            )}
            {collisionChecked && collision.length === 0 && (
              <p className="text-xs text-green-600">✓ Tanggal itu masih kosong — bisa langsung diajukan ke HR/Owner tanpa perlu tukar.</p>
            )}

            <button onClick={submitRequest} disabled={submitting || !originalDate || !newDate}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition disabled:opacity-50">
              {submitting ? 'Mengajukan...' : 'Ajukan Ganti Libur'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700">Riwayat Pengajuan Saya</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {myRequests.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Belum ada pengajuan.</p>
          ) : myRequests.map(r => {
            const cfg = STATUS_CONFIG[r.status] || { label: r.status, color: 'bg-slate-100 text-slate-600' }
            return (
              <div key={r.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="text-sm text-slate-700">
                  <p>{fmtDate(r.original_date)} <span className="text-slate-400">→</span> {fmtDate(r.requested_date)}</p>
                  {r.counterpart_name && (
                    <p className="text-xs text-slate-500 mt-0.5">Tukar dengan {r.counterpart_name} — {r.counterpart_status === 'accepted' ? 'sudah diterima' : r.counterpart_status === 'declined' ? 'ditolak rekan' : 'menunggu respon'}</p>
                  )}
                  {r.status === 'rejected' && r.rejection_reason && (
                    <p className="text-xs text-red-500 mt-0.5 italic">Alasan HR: {r.rejection_reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                  {(r.status === 'pending_counterpart' || r.status === 'pending_approval') && (
                    <button onClick={() => cancelRequest(r.id)} className="text-xs text-red-500 hover:underline">Batalkan</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
