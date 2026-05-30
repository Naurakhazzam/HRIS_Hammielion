'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type KasbonRequest = {
  id: string
  employee_id: string
  amount_requested: number
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'lunas'
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
  deduction_per_month: number
  deduction_start_month: number | null
  deduction_start_year: number | null
  total_deducted: number
  created_at: string
  employees: {
    full_name: string
    employee_code: string
    departments: { name: string } | null
  }
}

type KasbonDeduction = {
  id: string
  kasbon_request_id: string
  employee_id: string
  deduction_month: number
  deduction_year: number
  amount: number
  status: 'pending' | 'deducted'
  deducted_at: string | null
  kasbon_requests: {
    employees: { full_name: string; employee_code: string }
  }
}

type Employee = {
  id: string
  full_name: string
  employee_code: string
  kasbon_limit: number
  departments: { name: string } | null
}

const fmtRp = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember']

export default function KasbonPage() {
  const [activeTab, setActiveTab] = useState<'pengajuan' | 'limit' | 'riwayat'>('pengajuan')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kasbon Karyawan</h1>
        <p className="text-sm text-slate-500">Kelola pengajuan, limit, dan riwayat potongan kasbon.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${
          message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        {(['pengajuan', 'limit', 'riwayat'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab === 'pengajuan' ? 'Pengajuan' : tab === 'limit' ? 'Limit Karyawan' : 'Riwayat Potongan'}
          </button>
        ))}
      </div>

      {activeTab === 'pengajuan' && <TabPengajuan showMessage={showMessage} />}
      {activeTab === 'limit' && <TabLimit showMessage={showMessage} />}
      {activeTab === 'riwayat' && <TabRiwayat showMessage={showMessage} />}
    </div>
  )
}

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:  { label: 'Pending',   className: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Disetujui', className: 'bg-blue-100 text-blue-700' },
  rejected: { label: 'Ditolak',   className: 'bg-red-100 text-red-600' },
  lunas:    { label: 'Lunas',     className: 'bg-green-100 text-green-700' },
}

// ─── TAB 1: PENGAJUAN ────────────────────────────────────────────────────────
function TabPengajuan({ showMessage }: { showMessage: (t: 'success' | 'error', msg: string) => void }) {
  const supabase = createClient()
  const [requests, setRequests] = useState<KasbonRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Modal state
  const [modalApprove, setModalApprove] = useState<KasbonRequest | null>(null)
  const [modalReject, setModalReject] = useState<KasbonRequest | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const today = new Date()
  const [approveForm, setApproveForm] = useState({
    deduction_per_month: '',
    deduction_start_month: today.getMonth() + 1,
    deduction_start_year: today.getFullYear()
  })
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
    fetchRequests()
  }, [])

  async function fetchRequests() {
    setLoading(true)
    const { data, error } = await supabase
      .from('kasbon_requests')
      .select('*, employees(full_name, employee_code, departments(name))')
      .order('created_at', { ascending: false })
    if (error) { showMessage('error', 'Gagal memuat data: ' + error.message) }
    else { setRequests((data as unknown as KasbonRequest[]) || []) }
    setLoading(false)
  }

  const filtered = filterStatus === 'all' ? requests : requests.filter(r => r.status === filterStatus)

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault()
    if (!modalApprove || !currentUserId) return
    const dpm = Number(approveForm.deduction_per_month)
    if (!dpm || dpm <= 0) { showMessage('error', 'Masukkan cicilan yang valid.'); return }
    setSubmitting(true)

    const { error } = await supabase.from('kasbon_requests').update({
      status: 'approved',
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
      deduction_per_month: dpm,
      deduction_start_month: approveForm.deduction_start_month,
      deduction_start_year: approveForm.deduction_start_year
    }).eq('id', modalApprove.id)

    if (error) { showMessage('error', 'Gagal menyetujui: ' + error.message); setSubmitting(false); return }

    // Auto-generate kasbon_deductions
    const totalCicilan = Math.ceil(modalApprove.amount_requested / dpm)
    const inserts = []
    for (let i = 0; i < totalCicilan; i++) {
      const bulan = ((approveForm.deduction_start_month - 1 + i) % 12) + 1
      const tahun = approveForm.deduction_start_year + Math.floor((approveForm.deduction_start_month - 1 + i) / 12)
      const isLast = i === totalCicilan - 1
      const amount = isLast ? modalApprove.amount_requested - (dpm * (totalCicilan - 1)) : dpm
      inserts.push({ kasbon_request_id: modalApprove.id, employee_id: modalApprove.employee_id, deduction_month: bulan, deduction_year: tahun, amount, status: 'pending' })
    }
    await supabase.from('kasbon_deductions').insert(inserts)

    showMessage('success', `Kasbon disetujui. ${totalCicilan} cicilan otomatis dibuat.`)
    setModalApprove(null)
    setApproveForm({ deduction_per_month: '', deduction_start_month: today.getMonth() + 1, deduction_start_year: today.getFullYear() })
    fetchRequests()
    setSubmitting(false)
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault()
    if (!modalReject) return
    setSubmitting(true)
    const { error } = await supabase.from('kasbon_requests').update({
      status: 'rejected', rejection_reason: rejectReason
    }).eq('id', modalReject.id)
    if (error) showMessage('error', 'Gagal menolak: ' + error.message)
    else { showMessage('success', 'Pengajuan ditolak.'); setModalReject(null); setRejectReason(''); fetchRequests() }
    setSubmitting(false)
  }

  async function handleLunas(id: string) {
    if (!confirm('Tandai kasbon ini sebagai LUNAS?')) return
    const { error } = await supabase.from('kasbon_requests').update({ status: 'lunas' }).eq('id', id)
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else { showMessage('success', 'Kasbon ditandai lunas.'); fetchRequests() }
  }

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-2">
          {[['all','Semua'],['pending','Pending'],['approved','Disetujui'],['rejected','Ditolak'],['lunas','Lunas']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition border ${filterStatus === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {label} {val === 'all' ? `(${requests.length})` : `(${requests.filter(r => r.status === val).length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-500">Memuat data...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-500">Tidak ada pengajuan ditemukan.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Karyawan','Departemen','Nominal','Alasan','Tanggal Ajuan','Status','Aksi'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(r => {
                  const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="font-medium text-slate-800">{r.employees?.full_name}</p>
                        <p className="text-xs text-slate-500">{r.employees?.employee_code}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.employees?.departments?.name || '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{fmtRp(r.amount_requested)}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-[200px]">
                        <p className="truncate">{r.reason || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-2">
                          {r.status === 'pending' && (
                            <>
                              <button onClick={() => { setModalApprove(r); setApproveForm({ deduction_per_month: '', deduction_start_month: today.getMonth() + 1, deduction_start_year: today.getFullYear() }) }}
                                className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition">Setujui</button>
                              <button onClick={() => { setModalReject(r); setRejectReason('') }}
                                className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition">Tolak</button>
                            </>
                          )}
                          {r.status === 'approved' && (
                            <button onClick={() => handleLunas(r.id)}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition">Tandai Lunas</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Setujui */}
      {modalApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-1">Setujui Pengajuan Kasbon</h2>
            <p className="text-sm text-slate-500 mb-4">{modalApprove.employees?.full_name} — {fmtRp(modalApprove.amount_requested)}</p>
            <form onSubmit={handleApprove} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Potongan Gaji per Bulan (Rp) *</label>
                <input required type="number" min="1" value={approveForm.deduction_per_month}
                  onChange={e => setApproveForm({...approveForm, deduction_per_month: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Contoh: 500000" />
                {approveForm.deduction_per_month && (
                  <p className="text-xs text-slate-500 mt-1">
                    Estimasi: {Math.ceil(modalApprove.amount_requested / Number(approveForm.deduction_per_month))} cicilan
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Mulai Bulan *</label>
                  <select required value={approveForm.deduction_start_month}
                    onChange={e => setApproveForm({...approveForm, deduction_start_month: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Mulai Tahun *</label>
                  <input required type="number" value={approveForm.deduction_start_year}
                    onChange={e => setApproveForm({...approveForm, deduction_start_year: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModalApprove(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                <button type="submit" disabled={submitting}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                  {submitting ? 'Memproses...' : 'Konfirmasi Setujui'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tolak */}
      {modalReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-1">Tolak Pengajuan Kasbon</h2>
            <p className="text-sm text-slate-500 mb-4">{modalReject.employees?.full_name} — {fmtRp(modalReject.amount_requested)}</p>
            <form onSubmit={handleReject} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alasan Penolakan *</label>
                <textarea required rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  placeholder="Jelaskan alasan penolakan..." />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModalReject(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                <button type="submit" disabled={submitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                  {submitting ? 'Memproses...' : 'Konfirmasi Tolak'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TAB 2: LIMIT KARYAWAN ────────────────────────────────────────────────────
function TabLimit({ showMessage }: { showMessage: (t: 'success' | 'error', msg: string) => void }) {
  const supabase = createClient()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [activeRequests, setActiveRequests] = useState<{employee_id:string;amount_requested:number;total_deducted:number}[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: empData } = await supabase
      .from('employees')
      .select('id, full_name, employee_code, kasbon_limit, departments(name)')
      .eq('is_active', true)
      .order('full_name')
    if (empData) setEmployees(empData as unknown as Employee[])

    const { data: reqData } = await supabase
      .from('kasbon_requests')
      .select('employee_id, amount_requested, total_deducted')
      .eq('status', 'approved')
    if (reqData) setActiveRequests(reqData as any)
    setLoading(false)
  }

  const activeSaldo = (employeeId: string) => {
    return activeRequests
      .filter(r => r.employee_id === employeeId)
      .reduce((sum, r) => sum + (r.amount_requested - r.total_deducted), 0)
  }

  async function handleSaveLimit(id: string) {
    const val = Number(editValue)
    if (isNaN(val) || val < 0) { showMessage('error', 'Nilai limit tidak valid.'); return }
    setSaving(true)
    const { error } = await supabase.from('employees').update({ kasbon_limit: val }).eq('id', id)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Limit kasbon berhasil diperbarui.'); setEditingId(null); fetchData() }
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <span className="text-sm font-semibold text-slate-700">Limit Kasbon Karyawan</span>
      </div>
      {loading ? (
        <div className="p-10 text-center text-slate-500">Memuat data...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Kode','Nama','Departemen','Limit Kasbon','Saldo Aktif','Aksi'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map(emp => {
                const saldo = activeSaldo(emp.id)
                const isEditing = editingId === emp.id
                return (
                  <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{emp.employee_code}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{emp.full_name}</td>
                    <td className="px-4 py-3 text-slate-600">{emp.departments?.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">{fmtRp(emp.kasbon_limit || 0)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${saldo > 0 ? 'text-orange-600' : 'text-slate-500'}`}>
                        {fmtRp(saldo)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                            autoFocus />
                          <button onClick={() => handleSaveLimit(emp.id)} disabled={saving}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition disabled:opacity-50">
                            {saving ? '...' : 'Simpan'}
                          </button>
                          <button onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded transition">
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingId(emp.id); setEditValue(String(emp.kasbon_limit || 0)) }}
                          className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 transition">
                          Edit Limit
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── TAB 3: RIWAYAT POTONGAN ─────────────────────────────────────────────────
function TabRiwayat({ showMessage }: { showMessage: (t: 'success' | 'error', msg: string) => void }) {
  const supabase = createClient()
  const today = new Date()
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [deductions, setDeductions] = useState<KasbonDeduction[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  const yearOptions = Array.from({ length: 4 }, (_, i) => today.getFullYear() - i + 1)

  useEffect(() => { fetchDeductions() }, [filterMonth, filterYear])

  async function fetchDeductions() {
    setLoading(true)
    const { data, error } = await supabase
      .from('kasbon_deductions')
      .select('*, kasbon_requests(id, amount_requested, total_deducted, employees(full_name, employee_code))')
      .eq('deduction_month', filterMonth)
      .eq('deduction_year', filterYear)
      .order('status')
    if (error) showMessage('error', 'Gagal memuat: ' + error.message)
    else setDeductions((data as unknown as KasbonDeduction[]) || [])
    setLoading(false)
  }

  async function handleMarkDeducted(d: KasbonDeduction & { kasbon_requests: any }) {
    if (!confirm(`Tandai potongan ${fmtRp(d.amount)} untuk ${d.kasbon_requests?.employees?.full_name} sudah dipotong?`)) return
    setProcessing(d.id)

    const { error: dErr } = await supabase.from('kasbon_deductions').update({
      status: 'deducted', deducted_at: new Date().toISOString()
    }).eq('id', d.id)

    if (dErr) { showMessage('error', 'Gagal update: ' + dErr.message); setProcessing(null); return }

    const req = d.kasbon_requests
    if (req) {
      const newTotal = Number(req.total_deducted) + Number(d.amount)
      const updates: any = { total_deducted: newTotal }
      if (newTotal >= Number(req.amount_requested)) updates.status = 'lunas'
      await supabase.from('kasbon_requests').update(updates).eq('id', req.id)
    }

    showMessage('success', 'Potongan berhasil ditandai sudah dipotong.')
    fetchDeductions()
    setProcessing(null)
  }

  const totalPending = deductions.filter(d => d.status === 'pending').reduce((s,d) => s + Number(d.amount), 0)
  const totalDeducted = deductions.filter(d => d.status === 'deducted').reduce((s,d) => s + Number(d.amount), 0)

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Bulan</label>
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none min-w-[140px]">
            {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Tahun</label>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none min-w-[90px]">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={fetchDeductions}
          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-medium transition">
          🔄 Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">Total Cicilan</p>
          <p className="text-xl font-bold text-slate-800">{deductions.length}</p>
        </div>
        <div className="bg-yellow-50 rounded-xl border border-yellow-100 shadow-sm p-4">
          <p className="text-xs font-medium text-yellow-600 uppercase mb-1">Belum Dipotong</p>
          <p className="text-lg font-bold text-yellow-700">{fmtRp(totalPending)}</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 shadow-sm p-4">
          <p className="text-xs font-medium text-green-600 uppercase mb-1">Sudah Dipotong</p>
          <p className="text-lg font-bold text-green-700">{fmtRp(totalDeducted)}</p>
        </div>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-500">Memuat data...</div>
        ) : deductions.length === 0 ? (
          <div className="p-10 text-center text-slate-500">Tidak ada cicilan untuk periode ini.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Karyawan','Kode','Nominal Potongan','Status','Aksi'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deductions.map(d => {
                  const dd = d as any
                  const emp = dd.kasbon_requests?.employees
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{emp?.full_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{emp?.employee_code || '—'}</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{fmtRp(d.amount)}</td>
                      <td className="px-4 py-3">
                        {d.status === 'pending'
                          ? <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">Belum Dipotong</span>
                          : <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">Sudah Dipotong</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        {d.status === 'pending' && (
                          <button onClick={() => handleMarkDeducted(dd)} disabled={processing === d.id}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                            {processing === d.id ? 'Memproses...' : 'Tandai Sudah Dipotong'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
