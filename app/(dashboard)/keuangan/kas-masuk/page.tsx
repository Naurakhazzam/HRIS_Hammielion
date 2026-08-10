'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr, todayLocalStr } from '@/lib/date'

type Branch = { id: string; name: string }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_holder_name: string | null; branch_id: string | null; account_type: string }
type CashIn = {
  id: string
  branch_id: string
  transaction_date: string
  amount: number
  expense_amount: number
  cash_adjustment: number
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

  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editRowAccountId, setEditRowAccountId] = useState<string>('')
  const [editRowAmount, setEditRowAmount] = useState<string>('')
  const [editRowPaymentMethod, setEditRowPaymentMethod] = useState<string>('cash')
  const [editRowDescription, setEditRowDescription] = useState<string>('')
  const [editRowDate, setEditRowDate] = useState<string>('')
  const [editRowBranchId, setEditRowBranchId] = useState<string>('')
  const [editRowSelisihType, setEditRowSelisihType] = useState<'none' | 'plus' | 'minus'>('none')
  const [editRowSelisihAmount, setEditRowSelisihAmount] = useState<string>('')
  const [editRowExpenseAmount, setEditRowExpenseAmount] = useState<string>('')

  const today = todayLocalStr()
  const [form, setForm] = useState({
    branch_id: '', transaction_date: today, amount: '', payment_method: 'cash', description: '', account_id: '',
  })
  const [expenseAmount, setExpenseAmount] = useState('')
  const [selisihType, setSelisihType] = useState<'none' | 'plus' | 'minus'>('none')
  const [selisihAmount, setSelisihAmount] = useState('')

  const thisMonth = today.slice(0, 7)
  const [filterMonth, setFilterMonth] = useState(thisMonth)
  const [filterBranch, setFilterBranch] = useState('')

  const isSupervisor = role === 'supervisor'
  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = localDateStr(new Date(year, month - 1, 1))
    const endDate = localDateStr(new Date(year, month, 0))

    let query = supabase
      .from('fin_cash_in')
      .select('id, branch_id, transaction_date, amount, expense_amount, cash_adjustment, payment_method, description, status, account_id, branches(name), fin_bank_accounts(bank_name, account_number, account_holder_name, account_type)')
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

    const expenseNum = expenseAmount ? (parseFloat(expenseAmount) || 0) : 0
    if (expenseAmount && (isNaN(expenseNum) || expenseNum < 0)) {
      showMessage('error', 'Nominal pengeluaran tidak valid.')
      return
    }

    const selisihNum = selisihType === 'none' ? 0 : (parseFloat(selisihAmount) || 0)
    if (selisihType !== 'none' && (isNaN(selisihNum) || selisihNum <= 0)) {
      showMessage('error', 'Nominal selisih tidak valid.')
      return
    }
    const cashAdjustment = selisihType === 'plus' ? selisihNum : selisihType === 'minus' ? -selisihNum : 0
    if (amountNum - expenseNum + cashAdjustment < 0) {
      showMessage('error', 'Pengeluaran + selisih minus tidak boleh lebih besar dari omzet.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('fin_cash_in').insert({
      branch_id: branchId, transaction_date: form.transaction_date, amount: amountNum,
      expense_amount: expenseNum,
      cash_adjustment: cashAdjustment,
      payment_method: form.payment_method, description: form.description || null,
      account_id: form.account_id,
      input_by: myUserId, status: 'pending',
    })
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else {
      showMessage('success', 'Omzet harian berhasil dicatat, menunggu verifikasi.')
      setForm(f => ({ ...f, amount: '', description: '', account_id: '' }))
      setExpenseAmount('')
      setSelisihType('none')
      setSelisihAmount('')
      fetchRows()
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
  const totalPhysicalApprovedThisMonth = rows.filter(r => r.status === 'approved').reduce((acc, r) => acc + Number(r.amount) - Number(r.expense_amount) + Number(r.cash_adjustment), 0)

  function canEditRow(r: CashIn) {
    if (r.status !== 'pending') return false
    if (isAdmin) return true
    if (isSupervisor) return r.branch_id === myBranchId
    return false
  }

  function canDeleteRow(r: CashIn) {
    if (r.status !== 'pending' && r.status !== 'rejected') return false
    if (isAdmin) return true
    if (isSupervisor) return r.branch_id === myBranchId
    return false
  }

  async function handleDeleteRow(r: CashIn) {
    const ok = window.confirm(`Hapus entri omzet ${formatRupiah(r.amount)} tanggal ${new Date(r.transaction_date).toLocaleDateString('id-ID')}? Tindakan ini tidak bisa dibatalkan.`)
    if (!ok) return
    const { error } = await supabase.from('fin_cash_in').delete().eq('id', r.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Entri berhasil dihapus.'); fetchRows() }
  }

  function startEditRow(r: CashIn) {
    setEditingRowId(r.id)
    setEditRowAccountId(r.account_id || '')
    setEditRowAmount(String(r.amount))
    setEditRowPaymentMethod(r.payment_method)
    setEditRowDescription(r.description || '')
    setEditRowDate(r.transaction_date)
    setEditRowBranchId(r.branch_id)
    setEditRowSelisihType(r.cash_adjustment > 0 ? 'plus' : r.cash_adjustment < 0 ? 'minus' : 'none')
    setEditRowSelisihAmount(r.cash_adjustment !== 0 ? String(Math.abs(r.cash_adjustment)) : '')
    setEditRowExpenseAmount(r.expense_amount !== 0 ? String(r.expense_amount) : '')
  }

  async function saveEditRow(id: string) {
    const amountNum = parseFloat(editRowAmount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Jumlah tidak valid.'); return }
    if (!editRowAccountId) { showMessage('error', 'Pilih rekening/kas dulu.'); return }
    if (!editRowBranchId) { showMessage('error', 'Pilih cabang dulu.'); return }
    const expenseNum = editRowExpenseAmount ? (parseFloat(editRowExpenseAmount) || 0) : 0
    const selisihNum = editRowSelisihType === 'none' ? 0 : (parseFloat(editRowSelisihAmount) || 0)
    const cashAdjustment = editRowSelisihType === 'plus' ? selisihNum : editRowSelisihType === 'minus' ? -selisihNum : 0
    if (amountNum - expenseNum + cashAdjustment < 0) { showMessage('error', 'Pengeluaran + selisih minus tidak boleh lebih besar dari omzet.'); return }
    const { error } = await supabase.from('fin_cash_in')
      .update({ branch_id: editRowBranchId, transaction_date: editRowDate, amount: amountNum, expense_amount: expenseNum, cash_adjustment: cashAdjustment, payment_method: editRowPaymentMethod, description: editRowDescription || null, account_id: editRowAccountId })
      .eq('id', id)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Entri berhasil diperbarui.'); setEditingRowId(null); fetchRows() }
  }

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kas Masuk (Omzet Harian)</h1>
        <p className="text-sm text-slate-500">Input omzet penjualan per cabang. Bisa lebih dari satu entri per cabang per hari (mis. tunai dan transfer dicatat terpisah). Menunggu verifikasi tim finance pusat sebelum masuk laporan resmi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Input Omzet Harian</h2>

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
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-1">Pengeluaran (Opsional)</label>
              <p className="text-[11px] text-slate-400 mb-2">Uang yang dipakai langsung dari hasil kas hari itu (mengurangi uang fisik yang diterima).</p>
              <input type="number" min="0" step="1" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)}
                placeholder="Contoh: 100000"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-1">Plus Minus Kasir (Opsional)</label>
              <p className="text-[11px] text-slate-400 mb-2">Isi jika ada selisih hitung kasir (kurang/lebih saat hitung kas fisik).</p>
              <div className="flex gap-2 mb-2">
                {(['none', 'plus', 'minus'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setSelisihType(t)}
                    className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition ${
                      selisihType === t
                        ? t === 'plus' ? 'bg-green-600 text-white border-green-600' : t === 'minus' ? 'bg-red-600 text-white border-red-600' : 'bg-slate-700 text-white border-slate-700'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}>
                    {t === 'none' ? 'Tidak Ada' : t === 'plus' ? '+ Lebih' : '− Kurang'}
                  </button>
                ))}
              </div>
              {selisihType !== 'none' && (
                <input type="number" min="1" step="1" value={selisihAmount} onChange={e => setSelisihAmount(e.target.value)}
                  placeholder="Nominal selisih, contoh: 100000"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              )}
              {(() => {
                const amt = parseFloat(form.amount) || 0
                const exp = expenseAmount ? (parseFloat(expenseAmount) || 0) : 0
                const sel = selisihType === 'none' ? 0 : (parseFloat(selisihAmount) || 0)
                const adj = selisihType === 'plus' ? sel : selisihType === 'minus' ? -sel : 0
                if (exp === 0 && selisihType === 'none') return null
                return (
                  <p className="text-xs text-slate-500 mt-2">
                    Uang Fisik Diterima: <span className="font-bold text-slate-700">{formatRupiah(Math.max(0, amt - exp + adj))}</span>
                  </p>
                )
              })()}
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
            <button type="submit" disabled={submitting}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
              {submitting ? 'Menyimpan...' : 'Simpan (Menunggu Verifikasi)'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Omzet Disetujui — Bulan Ini</p>
              <p className="text-2xl font-bold text-green-700">{formatRupiah(totalApprovedThisMonth)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Uang Fisik Diterima — Bulan Ini</p>
              <p className="text-2xl font-bold text-slate-800">{formatRupiah(totalPhysicalApprovedThisMonth)}</p>
            </div>
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
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200 sticky top-0 z-10">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Tanggal</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Cabang</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white">Omzet</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white">Uang Fisik</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Metode</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Rekening</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Keterangan</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center bg-white">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center bg-white">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data.</td></tr>
                  ) : rows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {editingRowId === r.id ? (
                          <input type="date" value={editRowDate} onChange={e => setEditRowDate(e.target.value)}
                            className="px-2 py-1 border border-slate-300 rounded text-sm" />
                        ) : new Date(r.transaction_date).toLocaleDateString('id-ID')}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {editingRowId === r.id && isAdmin ? (
                          <select value={editRowBranchId} onChange={e => setEditRowBranchId(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        ) : r.branches?.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">
                        {editingRowId === r.id ? (
                          <input type="number" min="1" step="1" value={editRowAmount} onChange={e => setEditRowAmount(e.target.value)}
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right" />
                        ) : formatRupiah(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {editingRowId === r.id ? (
                          <div className="flex flex-col items-end gap-1">
                            <input type="number" min="0" step="1" value={editRowExpenseAmount} onChange={e => setEditRowExpenseAmount(e.target.value)}
                              placeholder="Pengeluaran"
                              className="w-24 px-2 py-1 border border-slate-300 rounded text-xs text-right" />
                            <div className="flex gap-1">
                              {(['none', 'plus', 'minus'] as const).map(t => (
                                <button key={t} type="button" onClick={() => setEditRowSelisihType(t)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition ${
                                    editRowSelisihType === t
                                      ? t === 'plus' ? 'bg-green-600 text-white border-green-600' : t === 'minus' ? 'bg-red-600 text-white border-red-600' : 'bg-slate-700 text-white border-slate-700'
                                      : 'bg-white text-slate-600 border-slate-300'
                                  }`}>
                                  {t === 'none' ? '=' : t === 'plus' ? '+' : '−'}
                                </button>
                              ))}
                            </div>
                            {editRowSelisihType !== 'none' && (
                              <input type="number" min="1" step="1" value={editRowSelisihAmount} onChange={e => setEditRowSelisihAmount(e.target.value)}
                                className="w-24 px-2 py-1 border border-slate-300 rounded text-xs text-right" />
                            )}
                          </div>
                        ) : (
                          <div>
                            <span className={`font-semibold ${(r.expense_amount > 0 || r.cash_adjustment < 0) ? 'text-red-600' : r.cash_adjustment > 0 ? 'text-green-600' : 'text-slate-800'}`}>
                              {formatRupiah(r.amount - r.expense_amount + r.cash_adjustment)}
                            </span>
                            {r.expense_amount !== 0 && (
                              <div className="text-[10px] text-slate-400">−{formatRupiah(r.expense_amount)} pengeluaran</div>
                            )}
                            {r.cash_adjustment !== 0 && (
                              <div className="text-[10px] text-slate-400">
                                {r.cash_adjustment > 0 ? '+' : '−'}{formatRupiah(Math.abs(r.cash_adjustment))} selisih kasir
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {editingRowId === r.id ? (
                          <select value={editRowPaymentMethod} onChange={e => setEditRowPaymentMethod(e.target.value)}
                            className="px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                            <option value="cash">Tunai</option>
                            <option value="transfer">Transfer</option>
                            <option value="campuran">Campuran</option>
                          </select>
                        ) : PAYMENT_LABEL[r.payment_method] || r.payment_method}
                      </td>
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
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {editingRowId === r.id ? (
                          <input value={editRowDescription} onChange={e => setEditRowDescription(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                        ) : (r.description || '—')}
                      </td>
                      <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                      <td className="px-4 py-3 text-center">
                        {editingRowId === r.id ? (
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => saveEditRow(r.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                            <button onClick={() => setEditingRowId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                          </div>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            {canEditRow(r) && (
                              <button onClick={() => startEditRow(r)} className="text-xs text-blue-600 hover:underline">Edit</button>
                            )}
                            {canDeleteRow(r) && (
                              <button onClick={() => handleDeleteRow(r)} className="text-xs text-red-600 hover:underline">Hapus</button>
                            )}
                            {!canEditRow(r) && !canDeleteRow(r) && (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </div>
                        )}
                      </td>
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
