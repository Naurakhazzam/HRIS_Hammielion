'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type HppEntry = {
  id: string
  branch_id: string
  entry_date: string
  hpp_amount: number
  notes: string | null
  status: string
  branches?: { name: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function HppPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [myBranchName, setMyBranchName] = useState<string>('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [rows, setRows] = useState<HppEntry[]>([])
  const [cashInRows, setCashInRows] = useState<{ amount: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editRowAmount, setEditRowAmount] = useState<string>('')
  const [editRowNotes, setEditRowNotes] = useState<string>('')

  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({ branch_id: '', entry_date: today, hpp_amount: '', notes: '' })

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
    const branchScope = !isAdmin ? myBranchId : (filterBranch || null)

    let hppQuery = supabase
      .from('fin_hpp_entries')
      .select('id, branch_id, entry_date, hpp_amount, notes, status, branches(name)')
      .gte('entry_date', startDate).lte('entry_date', endDate)
      .order('entry_date', { ascending: false })
    if (branchScope) hppQuery = hppQuery.eq('branch_id', branchScope)

    let cashInQuery = supabase
      .from('fin_cash_in')
      .select('amount')
      .eq('status', 'approved')
      .gte('transaction_date', startDate).lte('transaction_date', endDate)
    if (branchScope) cashInQuery = cashInQuery.eq('branch_id', branchScope)
    else if (!isAdmin && myBranchId) cashInQuery = cashInQuery.eq('branch_id', myBranchId)

    const [hppRes, cashInRes] = await Promise.all([hppQuery, cashInQuery])
    if (hppRes.error) console.error('Detail error:', JSON.stringify(hppRes.error, null, 2))
    else setRows((hppRes.data as unknown as HppEntry[]) || [])
    if (cashInRes.data) setCashInRows(cashInRes.data)
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
    const hppNum = parseFloat(form.hpp_amount)
    if (isNaN(hppNum) || hppNum <= 0) { showMessage('error', 'Nilai HPP tidak valid.'); return }

    setSubmitting(true)
    const { error } = await supabase.from('fin_hpp_entries').insert({
      branch_id: branchId, entry_date: form.entry_date, hpp_amount: hppNum,
      notes: form.notes || null, input_by: myUserId, status: 'pending',
    })
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else {
      showMessage('success', 'HPP harian berhasil dicatat, menunggu verifikasi.')
      setForm(f => ({ ...f, hpp_amount: '', notes: '' }))
      fetchRows()
    }
    setSubmitting(false)
  }

  function canEditRow(r: HppEntry) {
    if (r.status !== 'pending') return false
    if (isAdmin) return true
    if (isSupervisor) return r.branch_id === myBranchId
    return false
  }

  function startEditRow(r: HppEntry) {
    setEditingRowId(r.id)
    setEditRowAmount(String(r.hpp_amount))
    setEditRowNotes(r.notes || '')
  }

  async function saveEditRow(id: string) {
    const hppNum = parseFloat(editRowAmount)
    if (isNaN(hppNum) || hppNum <= 0) { showMessage('error', 'Nilai HPP tidak valid.'); return }
    const { error } = await supabase.from('fin_hpp_entries').update({ hpp_amount: hppNum, notes: editRowNotes || null }).eq('id', id)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Entri berhasil diperbarui.'); setEditingRowId(null); fetchRows() }
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800' }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  const totalHppApproved = rows.filter(r => r.status === 'approved').reduce((acc, r) => acc + Number(r.hpp_amount), 0)
  const totalCashInApproved = cashInRows.reduce((acc, r) => acc + Number(r.amount), 0)
  const labaKotor = totalCashInApproved - totalHppApproved

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">HPP Manual (Harga Pokok Penjualan)</h1>
        <p className="text-sm text-slate-500">Input HPP per cabang, sumber dari sistem HPP eksternal. Bisa lebih dari satu entri per cabang per hari. Menunggu verifikasi tim finance pusat sebelum masuk laporan resmi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Input HPP Harian</h2>

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
              <input type="date" required value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Total HPP (Rp) <span className="text-red-500">*</span></label>
              <input type="number" required min="1" step="1" value={form.hpp_amount} onChange={e => setForm({ ...form, hpp_amount: e.target.value })}
                placeholder="Contoh: 6000000"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Catatan</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Opsional"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <button type="submit" disabled={submitting}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
              {submitting ? 'Menyimpan...' : 'Simpan (Menunggu Verifikasi)'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Kas Masuk Disetujui</p>
              <p className="text-lg font-bold text-slate-800">{formatRupiah(totalCashInApproved)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">HPP Disetujui</p>
              <p className="text-lg font-bold text-slate-800">{formatRupiah(totalHppApproved)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Laba Kotor (Bulan Ini)</p>
              <p className={`text-lg font-bold ${labaKotor >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(labaKotor)}</p>
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
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">HPP</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Catatan</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data.</td></tr>
                  ) : rows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm text-slate-600">{new Date(r.entry_date).toLocaleDateString('id-ID')}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{r.branches?.name}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">
                        {editingRowId === r.id ? (
                          <input type="number" min="1" step="1" value={editRowAmount} onChange={e => setEditRowAmount(e.target.value)}
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right" />
                        ) : formatRupiah(r.hpp_amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {editingRowId === r.id ? (
                          <input value={editRowNotes} onChange={e => setEditRowNotes(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                        ) : (r.notes || '—')}
                      </td>
                      <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                      <td className="px-4 py-3 text-center">
                        {editingRowId === r.id ? (
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => saveEditRow(r.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                            <button onClick={() => setEditingRowId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                          </div>
                        ) : canEditRow(r) ? (
                          <button onClick={() => startEditRow(r)} className="px-2 py-1 text-xs text-blue-600 hover:underline">Edit</button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
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
