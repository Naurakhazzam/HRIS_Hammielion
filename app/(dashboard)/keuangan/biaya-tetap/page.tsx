'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Category = { code: string; label: string }
type RecurringCost = {
  id: string
  branch_id: string
  category: string
  description: string
  daily_amount: number
  start_date: string
  end_date: string | null
  is_active: boolean
  last_generated_period: string | null
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

export default function BiayaTetapPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [roleLoading, setRoleLoading] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)

  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<RecurringCost[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({
    branch_id: '', category: '', description: '', daily_amount: '',
    start_date: new Date().toISOString().split('T')[0], end_date: '',
  })

  const isAdmin = ADMIN_ROLES.includes(role)
  const now = new Date()
  const thisMonthDays = daysInMonth(now.getFullYear(), now.getMonth() + 1)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fin_recurring_costs')
      .select('*, branches(name), fin_cash_out_categories(label)')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) console.error('Detail error:', JSON.stringify(error, null, 2))
    else setItems((data as unknown as RecurringCost[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setMyUserId(user.id)
        const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (userRow) setRole(userRow.role)
      }
      const [bRes, cRes] = await Promise.all([
        supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
        supabase.from('fin_cash_out_categories').select('code, label').eq('is_active', true).order('label'),
      ])
      if (bRes.data) setBranches(bRes.data)
      if (cRes.data) setCategories(cRes.data)
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  useEffect(() => { if (isAdmin) fetchItems() }, [isAdmin, fetchItems])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.branch_id || !form.category || !form.description.trim()) { showMessage('error', 'Cabang, kategori, dan deskripsi wajib diisi.'); return }
    const dailyNum = parseFloat(form.daily_amount)
    if (isNaN(dailyNum) || dailyNum <= 0) { showMessage('error', 'Nominal harian tidak valid.'); return }

    setSubmitting(true)
    const { error } = await supabase.from('fin_recurring_costs').insert({
      branch_id: form.branch_id,
      category: form.category,
      description: form.description.trim(),
      daily_amount: dailyNum,
      start_date: form.start_date,
      end_date: form.end_date || null,
      created_by: myUserId,
    })
    if (error) {
      showMessage('error', 'Gagal menambah item: ' + error.message)
    } else {
      showMessage('success', 'Biaya tetap berkala berhasil ditambahkan. Akan otomatis di-generate ke kas keluar tiap tanggal 1.')
      setForm({ branch_id: '', category: '', description: '', daily_amount: '', start_date: new Date().toISOString().split('T')[0], end_date: '' })
      fetchItems()
    }
    setSubmitting(false)
  }

  async function toggleActive(item: RecurringCost) {
    if (!confirm(`${item.is_active ? 'Nonaktifkan' : 'Aktifkan kembali'} "${item.description}"? Histori kas keluar yang sudah ter-generate tidak akan berubah.`)) return
    const { error } = await supabase.from('fin_recurring_costs').update({ is_active: !item.is_active }).eq('id', item.id)
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else fetchItems()
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman pengaturan biaya tetap berkala.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Biaya Tetap Berkala</h1>
        <p className="text-sm text-slate-500">Item di sini otomatis di-generate ke Kas Keluar (langsung disetujui) setiap tanggal 1, sebesar nominal harian × jumlah hari kalender bulan tersebut.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Item</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
              <select required value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Pilih Cabang --</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kategori <span className="text-red-500">*</span></label>
              <select required value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Pilih Kategori --</option>
                {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi <span className="text-red-500">*</span></label>
              <input type="text" required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Contoh: Sewa Toko Depan"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nominal Harian (Rp) <span className="text-red-500">*</span></label>
              <input type="number" required min="1" step="1" value={form.daily_amount} onChange={e => setForm({ ...form, daily_amount: e.target.value })}
                placeholder="Contoh: 100000"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              {form.daily_amount && !isNaN(parseFloat(form.daily_amount)) && (
                <p className="text-xs text-slate-400 mt-1">≈ {formatRupiah(parseFloat(form.daily_amount) * thisMonthDays)} / bulan ini ({thisMonthDays} hari)</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mulai Berlaku <span className="text-red-500">*</span></label>
              <input type="date" required value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Berakhir (opsional)</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <button type="submit" disabled={submitting}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
              {submitting ? 'Menyimpan...' : 'Tambah Item'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Deskripsi</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Harian</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Estimasi/Bulan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Terakhir Generate</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada item biaya tetap.</td></tr>
                ) : items.map(item => (
                  <tr key={item.id} className={`hover:bg-slate-50 transition ${!item.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{item.description}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{item.branches?.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{item.fin_cash_out_categories?.label}</td>
                    <td className="px-4 py-3 text-sm text-right text-slate-600">{formatRupiah(item.daily_amount)}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(item.daily_amount * thisMonthDays)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {item.last_generated_period ? new Date(item.last_generated_period).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }) : 'Belum pernah'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(item)}
                        className={`px-2 py-1 rounded text-xs font-semibold transition ${item.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                        {item.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
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
