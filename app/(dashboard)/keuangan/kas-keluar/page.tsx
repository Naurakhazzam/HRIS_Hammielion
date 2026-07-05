'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Category = { code: string; label: string; affects_net_profit: boolean }
type MyCashOut = {
  id: string
  amount: number
  description: string | null
  transaction_date: string
  status: string
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function InputKasKeluarPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [myBranchName, setMyBranchName] = useState<string>('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [recent, setRecent] = useState<MyCashOut[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [formData, setFormData] = useState({
    branch_id: '',
    category: '',
    amount: '',
    transaction_date: new Date().toISOString().split('T')[0],
    description: '',
  })

  const isSupervisor = role === 'supervisor'
  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchRecent = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('fin_cash_out')
      .select('id, amount, description, transaction_date, status, branches(name), fin_cash_out_categories(label)')
      .eq('input_by', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setRecent(data as unknown as MyCashOut[])
  }, [supabase])

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
            setFormData(f => ({ ...f, branch_id: emp.branch_id }))
          }
        }
      }

      const [bRes, cRes] = await Promise.all([
        supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
        supabase.from('fin_cash_out_categories').select('code, label, affects_net_profit').eq('is_active', true).order('label'),
      ])
      if (bRes.data) setBranches(bRes.data)
      if (cRes.data) setCategories(cRes.data)

      await fetchRecent(user.id)
      setLoading(false)
    }
    init()
  }, [supabase, fetchRecent])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId) return

    const branchId = isSupervisor ? myBranchId : formData.branch_id
    if (!branchId) { showMessage('error', 'Cabang wajib dipilih.'); return }
    if (!formData.category) { showMessage('error', 'Kategori wajib dipilih.'); return }
    const amountNum = parseFloat(formData.amount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Jumlah tidak valid.'); return }

    setSubmitting(true)
    const { error } = await supabase.from('fin_cash_out').insert({
      branch_id: branchId,
      category: formData.category,
      amount: amountNum,
      description: formData.description || null,
      transaction_date: formData.transaction_date,
      input_by: myUserId,
      status: 'pending',
    })

    if (error) {
      showMessage('error', 'Gagal menyimpan: ' + error.message)
    } else {
      showMessage('success', 'Kas keluar berhasil dicatat, menunggu verifikasi tim finance pusat.')
      setFormData(f => ({ ...f, amount: '', description: '' }))
      fetchRecent(myUserId)
    }
    setSubmitting(false)
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

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Input Kas Keluar</h1>
        <p className="text-sm text-slate-500">Catat pengeluaran manual (sewa, operasional, restock, pembayaran supplier, dll). Entri akan berstatus &quot;Menunggu&quot; sampai diverifikasi tim finance pusat.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Form Kas Keluar</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
              {isSupervisor ? (
                <div className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-600">{myBranchName || '—'}</div>
              ) : (
                <select
                  required
                  value={formData.branch_id}
                  onChange={e => setFormData({ ...formData, branch_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="">-- Pilih Cabang --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kategori <span className="text-red-500">*</span></label>
              <select
                required
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">-- Pilih Kategori --</option>
                {categories.map(c => <option key={c.code} value={c.code}>{c.label}{!c.affects_net_profit ? ' (tidak masuk laba/rugi)' : ''}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal <span className="text-red-500">*</span></label>
              <input
                type="date" required
                value={formData.transaction_date}
                onChange={e => setFormData({ ...formData, transaction_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jumlah (Rp) <span className="text-red-500">*</span></label>
              <input
                type="number" required min="1" step="1"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                placeholder="Contoh: 500000"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                placeholder="Opsional"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !myUserId}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : 'Simpan (Menunggu Verifikasi)'}
            </button>
            {isAdmin && (
              <p className="text-xs text-slate-400">Anda login sebagai {role}. Entri manual tetap berstatus &quot;Menunggu&quot; walau Anda bisa menyetujuinya sendiri di halaman Verifikasi.</p>
            )}
          </form>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="font-semibold text-slate-800 text-sm">10 Input Terakhir Saya</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Jumlah</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada input.</td></tr>
                ) : recent.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-sm text-slate-600">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{r.branches?.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{r.fin_cash_out_categories?.label}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(r.amount)}</td>
                    <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
