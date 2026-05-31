'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Employee = {
  id: string
  employee_code: string
  full_name: string
  employee_type: string
  loyalitas_per_month: number
  loyalitas_duration_months: number
  branches: { name: string } | null
  positions: { name: string } | null
}

type LoyalitasBalance = {
  id: string
  employee_id: string
  total_withheld: number
  status: 'active' | 'released' | 'forfeited'
  notes: string | null
  released_at: string | null
  start_month: number | null
  start_year: number | null
  cycle_number: number
}

type Transaction = {
  id: string
  type: string
  amount: number
  notes: string | null
  created_at: string
  employees: { full_name: string } | null
}

const fmtRp = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:    { label: 'Berjalan',   color: 'bg-blue-100 text-blue-700' },
  released:  { label: 'Dicairkan', color: 'bg-green-100 text-green-700' },
  forfeited: { label: 'Hangus',    color: 'bg-red-100 text-red-700' },
}

export default function TabunganLoyalitasPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [balances, setBalances] = useState<LoyalitasBalance[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [activeTab, setActiveTab] = useState<'setup' | 'saldo' | 'histori'>('saldo')
  const [loading, setLoading] = useState(true)
  const [myRole, setMyRole] = useState('')
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Edit setup per karyawan
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNominal, setEditNominal] = useState('')
  const [editDurasi, setEditDurasi] = useState('')
  const [saving, setSaving] = useState(false)

  // Modal cairkan / hanguskan
  const [actionModal, setActionModal] = useState<{ emp: Employee; bal: LoyalitasBalance; type: 'release' | 'forfeit' } | null>(null)
  const [actionNotes, setActionNotes] = useState('')
  const [actionSubmitting, setActionSubmitting] = useState(false)

  const supabase = createClient()

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: me } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (me) { setMyRole(me.role); setMyEmployeeId(me.employee_id) }
    }
    await Promise.all([fetchEmployees(), fetchBalances(), fetchTransactions()])
    setLoading(false)
  }

  async function fetchEmployees() {
    const { data } = await supabase
      .from('employees')
      .select('id, employee_code, full_name, employee_type, loyalitas_per_month, loyalitas_duration_months, branches(name), positions(name)')
      .eq('is_active', true)
      .eq('employee_type', 'permanent')
      .order('full_name')
    setEmployees((data as unknown as Employee[]) || [])
  }

  async function fetchBalances() {
    const { data } = await supabase.from('loyalitas_balances').select('*')
    setBalances(data || [])
  }

  async function fetchTransactions() {
    const { data } = await supabase
      .from('loyalitas_transactions')
      .select('id, type, amount, notes, created_at, employees!loyalitas_transactions_employee_id_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(50)
    setTransactions((data as unknown as Transaction[]) || [])
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  function getBalance(employeeId: string): LoyalitasBalance | null {
    return balances.find(b => b.employee_id === employeeId && b.status === 'active') || null
  }

  // Hitung bulan ke-berapa dan kapan cair
  function getCycleInfo(emp: Employee, bal: LoyalitasBalance | null): {
    monthsElapsed: number; monthsLeft: number; payoutLabel: string; progressPct: number
  } | null {
    if (!bal || !bal.start_month || !bal.start_year || emp.loyalitas_duration_months <= 0) return null
    const now = new Date()
    const elapsed = (now.getFullYear() - bal.start_year) * 12 + (now.getMonth() + 1 - bal.start_month)
    const duration = emp.loyalitas_duration_months
    const monthsElapsed = Math.max(0, elapsed)
    const monthsLeft = Math.max(0, duration - monthsElapsed)
    const payoutDate = new Date(bal.start_year, bal.start_month - 1 + duration, 1)
    const payoutLabel = `${MONTHS[payoutDate.getMonth()]} ${payoutDate.getFullYear()}`
    const progressPct = Math.min(100, Math.round((monthsElapsed / duration) * 100))
    return { monthsElapsed, monthsLeft, payoutLabel, progressPct }
  }

  async function handleSaveSetup(emp: Employee) {
    const nominal = parseFloat(editNominal)
    const durasi  = parseInt(editDurasi)
    if (isNaN(nominal) || nominal < 0) { showMsg('error', 'Nominal tidak valid.'); return }
    if (isNaN(durasi) || durasi < 1)   { showMsg('error', 'Durasi minimal 1 bulan.'); return }
    setSaving(true)
    const { error } = await supabase.from('employees').update({
      loyalitas_per_month: nominal,
      loyalitas_duration_months: durasi,
    }).eq('id', emp.id)
    if (error) { showMsg('error', 'Gagal: ' + error.message) }
    else { showMsg('success', `Setup tabungan loyalitas ${emp.full_name} disimpan.`); setEditingId(null); fetchEmployees() }
    setSaving(false)
  }

  async function handleAction(e: React.FormEvent) {
    e.preventDefault()
    if (!actionModal) return
    setActionSubmitting(true)
    const { emp, bal, type } = actionModal
    const newStatus = type === 'release' ? 'released' : 'forfeited'

    const { error: balErr } = await supabase.from('loyalitas_balances').update({
      status: newStatus, notes: actionNotes || null,
      released_at: new Date().toISOString(), released_by: myEmployeeId || null,
      updated_at: new Date().toISOString()
    }).eq('id', bal.id)

    if (balErr) { showMsg('error', 'Gagal: ' + balErr.message); setActionSubmitting(false); return }

    await supabase.from('loyalitas_transactions').insert({
      employee_id: emp.id, type: type === 'release' ? 'release' : 'forfeit',
      amount: bal.total_withheld, notes: actionNotes || null, created_by: myEmployeeId || null
    })

    showMsg('success', `Tabungan loyalitas ${emp.full_name} berhasil di-${type === 'release' ? 'cairkan' : 'hanguskan'}.`)
    setActionModal(null); setActionNotes('')
    await Promise.all([fetchBalances(), fetchTransactions()])
    setActionSubmitting(false)
  }

  const canApprove = ['owner', 'hr'].includes(myRole)
  const totalAktif  = balances.filter(b => b.status === 'active').reduce((s, b) => s + Number(b.total_withheld), 0)
  const totalCair   = balances.filter(b => b.status === 'released').reduce((s, b) => s + Number(b.total_withheld), 0)
  const totalHangus = balances.filter(b => b.status === 'forfeited').reduce((s, b) => s + Number(b.total_withheld), 0)

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Tabungan Loyalitas</h1>
        <p className="text-sm text-slate-500">Dana simpanan loyalitas karyawan tetap — dicairkan otomatis saat durasi kontrak terpenuhi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
          <p className="text-xs font-medium text-blue-600 uppercase mb-1">Total Terkumpul (Aktif)</p>
          <p className="text-xl font-bold text-blue-800">{fmtRp(totalAktif)}</p>
          <p className="text-xs text-blue-500 mt-1">{balances.filter(b => b.status === 'active').length} karyawan</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-4">
          <p className="text-xs font-medium text-green-600 uppercase mb-1">Total Dicairkan</p>
          <p className="text-xl font-bold text-green-800">{fmtRp(totalCair)}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4">
          <p className="text-xs font-medium text-red-600 uppercase mb-1">Total Hangus</p>
          <p className="text-xl font-bold text-red-800">{fmtRp(totalHangus)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        {(['saldo', 'setup', 'histori'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab === 'saldo' ? '💰 Saldo Karyawan' : tab === 'setup' ? '⚙️ Setup' : '📋 Histori'}
          </button>
        ))}
      </div>

      {/* ── Tab Saldo ── */}
      {activeTab === 'saldo' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">Saldo Tabungan Loyalitas per Karyawan</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">Memuat...</div>
            ) : employees.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">Belum ada karyawan tetap.</div>
            ) : employees.map(emp => {
              const bal = getBalance(emp.id)
              const cycle = getCycleInfo(emp, bal)
              return (
                <div key={emp.id} className="px-5 py-4 hover:bg-slate-50/50 transition">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-slate-800">{emp.full_name}</div>
                      <div className="text-xs text-slate-400">{emp.employee_code} · {emp.positions?.name} · {emp.branches?.name}</div>
                      {emp.loyalitas_per_month > 0 && (
                        <div className="text-xs text-slate-500 mt-1">
                          {fmtRp(emp.loyalitas_per_month)}/bulan · durasi {emp.loyalitas_duration_months} bulan
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-blue-700">{fmtRp(bal ? Number(bal.total_withheld) : 0)}</div>
                      <div className="text-xs text-slate-400">tertabung</div>
                    </div>
                  </div>

                  {/* Progress bar & info pencairan */}
                  {cycle && bal && bal.status === 'active' && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Bulan ke-{cycle.monthsElapsed} dari {emp.loyalitas_duration_months}</span>
                        {cycle.monthsLeft > 0
                          ? <span className="text-orange-600 font-medium">Cair {cycle.payoutLabel} ({cycle.monthsLeft} bulan lagi)</span>
                          : <span className="text-green-600 font-bold">✅ Siap dicairkan — {cycle.payoutLabel}</span>
                        }
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${cycle.progressPct >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                          style={{ width: `${cycle.progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Aksi */}
                  {canApprove && bal && bal.status === 'active' && bal.total_withheld > 0 && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => { setActionModal({ emp, bal, type: 'release' }); setActionNotes('') }}
                        className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition">
                        Cairkan Manual
                      </button>
                      <button onClick={() => { setActionModal({ emp, bal, type: 'forfeit' }); setActionNotes('') }}
                        className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition">
                        Hanguskan
                      </button>
                    </div>
                  )}
                  {bal && bal.status !== 'active' && (
                    <span className={`inline-block mt-2 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_CONFIG[bal.status]?.color}`}>
                      {STATUS_CONFIG[bal.status]?.label}
                      {bal.released_at && ` — ${new Date(bal.released_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Tab Setup ── */}
      {activeTab === 'setup' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">Setup Tabungan per Karyawan</span>
            <p className="text-xs text-slate-400 mt-0.5">Nominal dipotong tiap bulan dari gaji. Saat durasi tercapai, saldo otomatis masuk sebagai pendapatan di slip gaji.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white border-b border-slate-200">
                <tr>
                  {['Karyawan', 'Cabang', 'Tabungan/Bulan', 'Durasi Pencairan', 'Aksi'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map(emp => {
                  const isEditing = editingId === emp.id
                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{emp.full_name}</div>
                        <div className="text-xs text-slate-400">{emp.employee_code}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{emp.branches?.name || '—'}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input type="number" min="0" value={editNominal} onChange={e => setEditNominal(e.target.value)}
                            className="w-32 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="0" />
                        ) : (
                          <span className={`font-medium ${emp.loyalitas_per_month > 0 ? 'text-slate-800' : 'text-slate-400 italic text-xs'}`}>
                            {emp.loyalitas_per_month > 0 ? fmtRp(emp.loyalitas_per_month) + '/bln' : 'Belum diset'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input type="number" min="1" value={editDurasi} onChange={e => setEditDurasi(e.target.value)}
                              className="w-20 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                              placeholder="12" />
                            <span className="text-xs text-slate-500">bulan</span>
                          </div>
                        ) : (
                          <span className={`font-medium ${emp.loyalitas_duration_months > 0 ? 'text-slate-800' : 'text-slate-400 italic text-xs'}`}>
                            {emp.loyalitas_duration_months > 0 ? `${emp.loyalitas_duration_months} bulan` : 'Belum diset'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button onClick={() => handleSaveSetup(emp)} disabled={saving}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition disabled:opacity-50">
                              {saving ? '...' : 'Simpan'}
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded transition">
                              Batal
                            </button>
                          </div>
                        ) : canApprove ? (
                          <button onClick={() => { setEditingId(emp.id); setEditNominal(String(emp.loyalitas_per_month || 0)); setEditDurasi(String(emp.loyalitas_duration_months || 12)) }}
                            className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 transition">
                            Edit
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab Histori ── */}
      {activeTab === 'histori' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">Histori Transaksi Tabungan Loyalitas</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white border-b border-slate-200">
                <tr>
                  {['Karyawan', 'Tipe', 'Nominal', 'Catatan', 'Tanggal'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Belum ada transaksi.</td></tr>
                ) : transactions.map(tx => {
                  const typeConfig: Record<string, { label: string; color: string }> = {
                    deduction:  { label: 'Tabung',    color: 'bg-blue-100 text-blue-700' },
                    release:    { label: 'Cair',      color: 'bg-green-100 text-green-700' },
                    auto_release: { label: 'Cair Otomatis', color: 'bg-emerald-100 text-emerald-700' },
                    forfeit:    { label: 'Hangus',    color: 'bg-red-100 text-red-600' },
                  }
                  const cfg = typeConfig[tx.type] || { label: tx.type, color: 'bg-slate-100 text-slate-600' }
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{(tx.employees as any)?.full_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{fmtRp(tx.amount)}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{tx.notes || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {new Date(tx.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Cairkan / Hanguskan */}
      {actionModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">
                {actionModal.type === 'release' ? '✅ Cairkan Tabungan Loyalitas' : '❌ Hanguskan Tabungan Loyalitas'}
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                {actionModal.emp.full_name} — <span className="font-bold text-slate-700">{fmtRp(actionModal.bal.total_withheld)}</span>
              </p>
              {actionModal.type === 'release' ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-700">
                  Dana akan dicairkan manual. Saldo akan direset ke nol dan siklus baru dimulai.
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
                  Dana akan hangus. Tindakan ini tidak dapat dibatalkan.
                </div>
              )}
              <form onSubmit={handleAction} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Catatan / Alasan <span className="text-red-500">*</span></label>
                  <textarea required rows={3} value={actionNotes} onChange={e => setActionNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    placeholder={actionModal.type === 'release' ? 'Contoh: Kontrak selesai, karyawan resign prosedural' : 'Contoh: Karyawan keluar tanpa pemberitahuan'} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setActionModal(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={actionSubmitting}
                    className={`px-6 py-2 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50 ${actionModal.type === 'release' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                    {actionSubmitting ? 'Memproses...' : actionModal.type === 'release' ? 'Konfirmasi Cairkan' : 'Konfirmasi Hanguskan'}
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
