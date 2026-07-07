'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_holder_name: string | null; branch_id: string | null; account_type: string }
type CashIn = {
  id: string
  branch_id: string
  transaction_date: string
  amount: number
  payment_method: string
  description: string | null
  status: string
  account_id: string | null
  branches?: { name: string } | null
  fin_bank_accounts?: { bank_name: string; account_number: string | null; account_holder_name: string | null; account_type: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']
const PAYMENT_LABEL: Record<string, string> = { cash: 'Tunai', transfer: 'Transfer', campuran: 'Campuran' }

export default function KasMasukPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [myBranchName, setMyBranchName] = useState<string>('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [rows, setRows] = useState<CashIn[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [existingEntry, setExistingEntry] = useState<CashIn | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editRowAccountId, setEditRowAccountId] = useState<string>('')

  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    branch_id: '', transaction_date: today, amount: '', payment_method: 'cash', description: '', account_id: '',
  })

  const thisMonth = today.slice(0, 7)
  const [filterMonth, setFilterMonth] = useState(thisMonth)
  const [filterBranch, setFilterBranch] = useState('')

  const isSupervisor = role === 'supervisor'
  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0]
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    let query = supabase
      .from('fin_cash_in')
      .select('id, branch_id, transaction_date, amount, payment_method, description, status, account_id, branches(name), fin_bank_accounts(bank_name, account_number, account_holder_name, account_type)')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false })

    if (!isAdmin && myBranchId) query = query.eq('branch_id', myBranchId)
    if (isAdmin && filterBranch) query = query.eq('branch_id', filterBranch)

    const { data, error } = await query
    if (error) console.error('Detail error:', JSON.stringify(error, null, 2))
    else setRows((data as unknown as CashIn[]) || [])
    setLoading(false)
  }, [supabase, filterMonth, filterBranch, isAdmin, myBranchId])

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setMyUserId(user.id)
      const { data: userRow } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (userRow) {
        setRole(userRow.role)
        if (userRow.employee_id) {
          const { data: emp } = await supabase.from('employees').select('branch_id, branches(name)').eq('id', userRow.employee_id).single()
          if (emp) {
            setMyBranchId(emp.branch_id)
            setMyBranchName((emp as unknown as { branches: { name: string } | null }).branches?.name || '')
            setForm(f => ({ ...f, branch_id: emp.branch_id }))
          }
        }
      }
      const { data: bRes } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      if (bRes) setBranches(bRes)
      const { data: baRes } = await supabase
        .from('fin_bank_accounts')
        .select('id, bank_name, account_number, account_holder_name, branch_id, account_type')
        .eq('is_active', true)
        .order('account_type').order('bank_name')
      if (baRes) setBankAccounts(baRes)
      setLoading(false)
    }
    init()
  }, [supabase])

  useEffect(() => { fetchRows() }, [fetchRows])

  // Cek apakah sudah ada entri untuk cabang + tanggal yang dipilih di form
  const checkExisting = useCallback(async () => {
    const branchId = isSupervisor ? myBranchId : form.branch_id
    if (!branchId || !form.transaction_date) { setExistingEntry(null); return }
    const { data } = await supabase
      .from('fin_cash_in')
      .select('id, branch_id, transaction_date, amount, payment_method, description, status, account_id')
      .eq('branch_id', branchId)
      .eq('transaction_date', form.transaction_date)
      .maybeSingle()
    setExistingEntry((data as unknown as CashIn) || null)
    if (data) {
      setForm(f => ({ ...f, amount: String(data.amount), payment_method: data.payment_method, description: data.description || '', account_id: data.account_id || '' }))
    }
  }, [supabase, isSupervisor, myBranchId, form.branch_id, form.transaction_date])

  useEffect(() => { checkExisting() }, [form.branch_id, form.transaction_date, myBranchId]) // eslint-disable-line react-hooks/exhaustive-deps

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId) return
    const branchId = isSupervisor ? myBranchId : form.branch_id
    if (!branchId) { showMessage('error', 'Cabang wajib dipilih.'); return }
    const amountNum = parseFloat(form.amount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Jumlah tidak valid.'); return }

    if (!form.account_id) {
      showMessage('error', 'Rekening/kas tujuan wajib dipilih.')
      return
    }

    if (existingEntry && existingEntry.status !== 'pending') {
      showMessage('error', `Entri tanggal ini sudah "${existingEntry.status === 'approved' ? 'disetujui' : 'ditolak'}", tidak bisa diubah dari sini. Hubungi finance pusat untuk revisi.`)
      return
    }

    setSubmitting(true)
    if (existingEntry) {
      const { error } = await supabase.from('fin_cash_in')
        .update({ amount: amountNum, payment_method: form.payment_method, description: form.description || null, account_id: form.account_id })
        .eq('id', existingEntry.id)
      if (error) showMessage('error', 'Gagal memperbarui: ' + error.message)
      else { showMessage('success', 'Omzet harian berhasil diperbarui.'); fetchRows(); checkExisting() }
    } else {
      const { error } = await supabase.from('fin_cash_in').insert({
        branch_id: branchId, transaction_date: form.transaction_date, amount: amountNum,
        payment_method: form.payment_method, description: form.description || null,
        account_id: form.account_id,
        input_by: myUserId, status: 'pending',
      })
      if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
      else { showMessage('success', 'Omzet harian berhasil dicatat, menunggu verifikasi.'); fetchRows(); checkExisting() }
    }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800' }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  const totalApprovedThisMonth = rows.filter(r => r.status === 'approved').reduce((acc, r) => acc + Number(r.amount), 0)

  function startEditRow(r: CashIn) {
    setEditingRowId(r.id)
    setEditRowAccountId(r.account_id || '')
  }

  async function saveEditRow(id: string) {
    if (!editRowAccountId) { showMessage('error', 'Pilih rekening/kas dulu.'); return }
    const { error } = await supabase.from('fin_cash_in').update({ account_id: editRowAccountId }).eq('id', id)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Rekening/kas entri berhasil diperbarui.'); setEditingRowId(null); fetchRows() }
  }

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kas Masuk (Omzet Harian)</h1>
        <p className="text-sm text-slate-500">Input omzet penjualan penuh per cabang, satu angka agregat per hari. Menunggu verifikasi tim finance pusat sebelum masuk laporan resmi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Input Omzet Harian</h2>

          {existingEntry && (
            <div className={`mb-4 p-3 rounded-lg text-xs border ${existingEntry.status === 'pending' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
              {existingEntry.status === 'pending'
                ? 'Sudah ada entri untuk tanggal ini (menunggu). Menyimpan lagi akan memperbarui entri tersebut.'
                : `Entri tanggal ini sudah "${existingEntry.status === 'approved' ? 'disetujui' : 'ditolak'}" — tidak bisa diubah dari sini.`}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
              {isSupervisor ? (
                <div className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-600">{myBranchName || '—'}</div>
              ) : (
                <select required value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Pilih Cabang --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal <span className="text-red-500">*</span></label>
              <input type="date" required value={form.transaction_date} onChange={e => setForm({ ...form, transaction_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Total Omzet (Rp) <span className="text-red-500">*</span></label>
              <input type="number" required min="1" step="1" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                placeholder="Contoh: 8000000"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Metode</label>
              <select value={form.payment_method}
                onChange={e => setForm({ ...form, payment_method: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="cash">Tunai</option>
                <option value="transfer">Transfer</option>
                <option value="campuran">Campuran</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Rekening/Kas Tujuan <span className="text-red-500">*</span></label>
              <select required value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Pilih Rekening/Kas --</option>
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}${a.account_holder_name ? ` a.n. ${a.account_holder_name}` : ''}`}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">Rekening/kas manapun bisa dipilih, tidak harus milik cabang transaksi ini.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Opsional"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <button type="submit" disabled={submitting || (!!existingEntry && existingEntry.status !== 'pending')}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
              {submitting ? 'Menyimpan...' : existingEntry ? 'Perbarui Entri' : 'Simpan (Menunggu Verifikasi)'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Omzet Disetujui — Bulan Ini</p>
            <p className="text-2xl font-bold text-green-700">{formatRupiah(totalApprovedThisMonth)}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Bulan</label>
                <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                  className="px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white" />
              </div>
              {isAdmin && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Cabang</label>
                  <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                    className="w-48 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white">
                    <option value="">Semua Cabang</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Jumlah</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Metode</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Rekening</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                    {isAdmin && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data.</td></tr>
                  ) : rows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm text-slate-600">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{r.branches?.name}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(r.amount)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{PAYMENT_LABEL[r.payment_method] || r.payment_method}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {editingRowId === r.id ? (
                          <select value={editRowAccountId} onChange={e => setEditRowAccountId(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                            <option value="">-- Pilih --</option>
                            {bankAccounts.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}`}
                              </option>
                            ))}
                          </select>
                        ) : r.fin_bank_accounts ? (
                          r.fin_bank_accounts.account_type === 'tunai'
                            ? r.fin_bank_accounts.bank_name
                            : `${r.fin_bank_accounts.bank_name} — ${r.fin_bank_accounts.account_number}`
                        ) : <span className="text-red-500">Belum diisi</span>}
                      </td>
                      <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-center">
                          {editingRowId === r.id ? (
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => saveEditRow(r.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                              <button onClick={() => setEditingRowId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                            </div>
                          ) : (
                            <button onClick={() => startEditRow(r)} className="px-2 py-1 text-xs text-blue-600 hover:underline">Edit</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
