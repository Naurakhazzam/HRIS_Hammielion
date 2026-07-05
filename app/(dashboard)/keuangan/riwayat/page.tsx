'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Category = { code: string; label: string }
type CashOutRow = {
  id: string
  amount: number
  description: string | null
  transaction_date: string
  status: string
  source_table: string | null
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function RiwayatKasKeluarPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [myBranchName, setMyBranchName] = useState<string>('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [rows, setRows] = useState<CashOutRow[]>([])
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [filterMonth, setFilterMonth] = useState(defaultMonth)
  const [filterBranch, setFilterBranch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0]
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    let query = supabase
      .from('fin_cash_out')
      .select('id, amount, description, transaction_date, status, source_table, branches(name), fin_cash_out_categories(label)')
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
      const [bRes, cRes] = await Promise.all([
        supabase.from('branches').select('id, name').order('name'),
        supabase.from('fin_cash_out_categories').select('code, label').order('label'),
      ])
      if (bRes.data) setBranches(bRes.data)
      if (cRes.data) setCategories(cRes.data)
    }
    init()
  }, [supabase])

  useEffect(() => { fetchRows() }, [fetchRows])

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Riwayat Kas Keluar</h1>
        <p className="text-sm text-slate-500">Semua pengeluaran (manual & otomatis) per cabang, kategori, dan status.</p>
      </div>

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
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Sumber</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada data untuk filter ini.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{r.branches?.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{r.fin_cash_out_categories?.label}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(r.amount)}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{r.description || '—'}</td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">{r.source_table ? 'Otomatis' : 'Manual'}</td>
                  <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
