'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Category = { code: string; label: string; affects_net_profit: boolean; is_active: boolean; created_at: string }

const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function KategoriKasKeluarPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [roleLoading, setRoleLoading] = useState(true)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({ code: '', label: '', affects_net_profit: true })
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editAffects, setEditAffects] = useState(true)

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('fin_cash_out_categories').select('*').order('created_at')
    if (error) console.error('Detail error:', JSON.stringify(error, null, 2))
    else setCategories(data || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (userRow) setRole(userRow.role)
      }
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const code = form.code.trim().toLowerCase().replace(/\s+/g, '_')
    if (!code || !form.label.trim()) { showMessage('error', 'Kode dan label wajib diisi.'); return }

    setSubmitting(true)
    const { error } = await supabase.from('fin_cash_out_categories').insert({
      code, label: form.label.trim(), affects_net_profit: form.affects_net_profit,
    })
    if (error) {
      showMessage('error', 'Gagal menambah kategori: ' + error.message)
    } else {
      showMessage('success', `Kategori "${form.label}" berhasil ditambahkan.`)
      setForm({ code: '', label: '', affects_net_profit: true })
      fetchCategories()
    }
    setSubmitting(false)
  }

  function startEdit(c: Category) {
    setEditingCode(c.code)
    setEditLabel(c.label)
    setEditAffects(c.affects_net_profit)
  }

  async function saveEdit(code: string) {
    const { error } = await supabase.from('fin_cash_out_categories')
      .update({ label: editLabel, affects_net_profit: editAffects })
      .eq('code', code)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Kategori berhasil diperbarui.'); setEditingCode(null); fetchCategories() }
  }

  async function toggleActive(c: Category) {
    const { error } = await supabase.from('fin_cash_out_categories').update({ is_active: !c.is_active }).eq('code', c.code)
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else fetchCategories()
  }

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman pengaturan kategori.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kategori Kas Keluar</h1>
        <p className="text-sm text-slate-500">Kategori bisa ditambah kapan saja tanpa perlu update sistem. Kategori dengan &quot;tidak masuk laba/rugi&quot; (mis. restock) tetap tercatat di kas keluar tapi dikecualikan dari perhitungan Laba Bersih.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Kategori</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kode (unik, tanpa spasi) <span className="text-red-500">*</span></label>
              <input type="text" required value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                placeholder="Contoh: listrik_gudang"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Label <span className="text-red-500">*</span></label>
              <input type="text" required value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="Contoh: Listrik Gudang"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.affects_net_profit}
                onChange={e => setForm({ ...form, affects_net_profit: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              Masuk perhitungan Laba Bersih
            </label>
            <p className="text-xs text-slate-400">Matikan hanya untuk kategori seperti restock/modal barang.</p>
            <button type="submit" disabled={submitting}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
              {submitting ? 'Menyimpan...' : 'Tambah Kategori'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kode</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Label</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Laba/Rugi</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat...</td></tr>
                ) : categories.map(c => (
                  <tr key={c.code} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">{c.code}</td>
                    <td className="px-4 py-3 text-sm">
                      {editingCode === c.code ? (
                        <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                      ) : (
                        <span className="font-medium text-slate-800">{c.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editingCode === c.code ? (
                        <input type="checkbox" checked={editAffects} onChange={e => setEditAffects(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      ) : (
                        <span className={`text-xs px-2 py-0.5 rounded ${c.affects_net_profit ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                          {c.affects_net_profit ? 'Masuk' : 'Dikecualikan'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(c)}
                        className={`px-2 py-1 rounded text-xs font-semibold transition ${c.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                        {c.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editingCode === c.code ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(c.code)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                          <button onClick={() => setEditingCode(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(c)} className="px-2 py-1 text-xs text-blue-600 hover:underline">Edit</button>
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
  )
}
