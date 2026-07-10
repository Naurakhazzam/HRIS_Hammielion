'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Category = { code: string; label: string }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_type: string }
type CashOutRow = {
  id: string
  branch_id: string
  amount: number
  description: string | null
  transaction_date: string
  category: string
  status: string
  source_table: string | null
  account_id: string | null
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
  fin_bank_accounts: { bank_name: string; account_number: string | null; account_type: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function RiwayatKasKeluarPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [myBranchName, setMyBranchName] = useState<string>('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [rows, setRows] = useState<CashOutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editRowAccountId, setEditRowAccountId] = useState<string>('')
  const [editRowDate, setEditRowDate] = useState<string>('')
  const [editRowCategory, setEditRowCategory] = useState<string>('')
  const [editRowAmount, setEditRowAmount] = useState<string>('')
  const [editRowDescription, setEditRowDescription] = useState<string>('')
  const [editRowBranchId, setEditRowBranchId] = useState<string>('')

  const today = new Date()
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [filterMonth, setFilterMonth] = useState(defaultMonth)
  const [filterBranch, setFilterBranch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const isAdmin = ADMIN_ROLES.includes(role)
  const isSupervisor = role === 'supervisor'

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0]
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    let query = supabase
      .from('fin_cash_out')
      .select('id, branch_id, amount, description, transaction_date, category, status, source_table, account_id, branches(name), fin_cash_out_categories(label), fin_bank_accounts(bank_name, account_number, account_type)')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false })

    if (!isAdmin && myBranchId) query = query.eq('branch_id', myBranchId)
    if (isAdmin && filterBranch) query = query.eq('branch_id', filterBranch)
    if (filterCategory) query = query.eq('category', filterCategory)
    if (filterStatus) query = query.eq('status', filterStatus)

    const { data, error } = await query
    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
    } else {
      setRows((data as unknown as CashOutRow[]) || [])
    }
    setLoading(false)
  }, [supabase, filterMonth, filterBranch, filterCategory, filterStatus, isAdmin, myBranchId])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: userRow } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (userRow) {
        setRole(userRow.role)
        if (userRow.employee_id) {
          const { data: emp } = await supabase.from('employees').select('branch_id, branches(name)').eq('id', userRow.employee_id).single()
          if (emp) {
            setMyBranchId(emp.branch_id)
            setMyBranchName((emp as unknown as { branches: { name: string } | null }).branches?.name || '')
          }
        }
      }
      const [bRes, cRes, baRes] = await Promise.all([
        supabase.from('branches').select('id, name').order('name'),
        supabase.from('fin_cash_out_categories').select('code, label').order('label'),
        supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_type').eq('is_active', true).order('account_type').order('bank_name'),
      ])
      if (bRes.data) setBranches(bRes.data)
      if (cRes.data) setCategories(cRes.data)
      if (baRes.data) setBankAccounts(baRes.data)
    }
    init()
  }, [supabase])

  useEffect(() => { fetchRows() }, [fetchRows])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  const totalAll = rows.reduce((acc, r) => acc + Number(r.amount), 0)
  const totalApproved = rows.filter(r => r.status === 'approved').reduce((acc, r) => acc + Number(r.amount), 0)
  const countPending = rows.filter(r => r.status === 'pending').length

  function canEditRow(r: CashOutRow) {
    if (r.status !== 'pending') return false
    if (r.source_table) return false // entri otomatis (payroll/driver/kasbon/dll) tidak boleh diubah manual
    // Catatan: saat ini hanya owner/hr/finance yang punya izin UPDATE di fin_cash_out (RLS).
    // Supervisor belum diberi izin edit di sini (beda dengan Kas Masuk) - lihat CHANGELOG Sesi 19/20.
    return isAdmin
  }

  function canDeleteRow(r: CashOutRow) {
    return role === 'owner' && r.status === 'pending' && !r.source_table
  }

  async function handleDeleteRow(r: CashOutRow) {
    const ok = window.confirm(`Hapus entri pengeluaran ${formatRupiah(r.amount)} tanggal ${new Date(r.transaction_date).toLocaleDateString('id-ID')}? Tindakan ini tidak bisa dibatalkan.`)
    if (!ok) return
    const { error } = await supabase.from('fin_cash_out').delete().eq('id', r.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Entri berhasil dihapus.'); fetchRows() }
  }

  function startEditRow(r: CashOutRow) {
    setEditingRowId(r.id)
    setEditRowAccountId(r.account_id || '')
    setEditRowDate(r.transaction_date)
    setEditRowCategory(r.category)
    setEditRowAmount(String(r.amount))
    setEditRowDescription(r.description || '')
    setEditRowBranchId(r.branch_id)
  }

  async function saveEditRow(id: string) {
    const amountNum = parseFloat(editRowAmount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Jumlah tidak valid.'); return }
    if (!editRowAccountId) { showMessage('error', 'Pilih rekening/kas dulu.'); return }
    if (!editRowCategory) { showMessage('error', 'Pilih kategori dulu.'); return }
    if (!editRowBranchId) { showMessage('error', 'Pilih cabang dulu.'); return }
    const { error } = await supabase.from('fin_cash_out')
      .update({
        branch_id: editRowBranchId,
        transaction_date: editRowDate,
        category: editRowCategory,
        amount: amountNum,
        description: editRowDescription || null,
        account_id: editRowAccountId,
      })
      .eq('id', id)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Entri berhasil diperbarui.'); setEditingRowId(null); fetchRows() }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Riwayat Kas Keluar</h1>
        <p className="text-sm text-slate-500">Semua pengeluaran (manual & otomatis) per cabang, kategori, dan status.</p>
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-4">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Entri</p>
          <p className="text-xl font-bold text-slate-800">{rows.length}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Nominal</p>
          <p className="text-xl font-bold text-slate-800">{formatRupiah(totalAll)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Disetujui</p>
          <p className="text-xl font-bold text-green-700">{formatRupiah(totalApproved)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Menunggu</p>
          <p className="text-xl font-bold text-yellow-700">{countPending} entri</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Bulan</label>
            <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Cabang</label>
            {isAdmin ? (
              <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                className="w-48 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white">
                <option value="">Semua Cabang</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : (
              <div className="px-2 py-1.5 text-sm text-slate-600">{myBranchName || '—'}</div>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Kategori</label>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="w-48 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white">
              <option value="">Semua Kategori</option>
              {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="w-40 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white">
              <option value="">Semua Status</option>
              <option value="pending">Menunggu</option>
              <option value="approved">Disetujui</option>
              <option value="rejected">Ditolak</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Jumlah</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Keterangan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Rekening/Kas</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Sumber</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada data untuk filter ini.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {editingRowId === r.id ? (
                      <input type="date" value={editRowDate} onChange={e => setEditRowDate(e.target.value)}
                        className="px-2 py-1 border border-slate-300 rounded text-sm" />
                    ) : new Date(r.transaction_date).toLocaleDateString('id-ID')}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {editingRowId === r.id ? (
                      <select value={editRowBranchId} onChange={e => setEditRowBranchId(e.target.value)}
                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    ) : r.branches?.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {editingRowId === r.id ? (
                      <select value={editRowCategory} onChange={e => setEditRowCategory(e.target.value)}
                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                        {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    ) : r.fin_cash_out_categories?.label}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">
                    {editingRowId === r.id ? (
                      <input type="number" min="1" step="1" value={editRowAmount} onChange={e => setEditRowAmount(e.target.value)}
                        className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right" />
                    ) : formatRupiah(r.amount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {editingRowId === r.id ? (
                      <input value={editRowDescription} onChange={e => setEditRowDescription(e.target.value)}
                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                    ) : (r.description || '—')}
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
                      r.fin_bank_accounts.account_type === 'tunai' ? r.fin_bank_accounts.bank_name : `${r.fin_bank_accounts.bank_name} — ${r.fin_bank_accounts.account_number}`
                    ) : <span className="text-red-500">Belum diisi</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">{r.source_table ? 'Otomatis' : 'Manual'}</td>
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
  )
}
