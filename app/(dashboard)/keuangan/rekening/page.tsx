'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type BankAccount = {
  id: string
  branch_id: string | null
  bank_name: string
  account_number: string | null
  account_holder_name: string | null
  account_type: string
  is_active: boolean
  created_at: string
  branches?: { name: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']
const TYPE_LABEL: Record<string, string> = { bank: 'Rekening Bank', tunai: 'Kas Tunai' }

export default function RekeningPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [roleLoading, setRoleLoading] = useState(true)
  const [branches, setBranches] = useState<Branch[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({ branch_id: '', bank_name: '', account_number: '', account_holder_name: '', account_type: 'bank' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBankName, setEditBankName] = useState('')
  const [editAccountNumber, setEditAccountNumber] = useState('')
  const [editHolderName, setEditHolderName] = useState('')
  const [editBranchId, setEditBranchId] = useState('')

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fin_bank_accounts')
      .select('id, branch_id, bank_name, account_number, account_holder_name, account_type, is_active, created_at, branches(name)')
      .order('account_type').order('created_at')
    if (error) console.error('Detail error:', JSON.stringify(error, null, 2))
    else setAccounts((data as unknown as BankAccount[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (userRow) setRole(userRow.role)
      }
      const { data: bRes } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      if (bRes) setBranches(bRes)
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.bank_name.trim()) {
      showMessage('error', 'Nama wajib diisi.')
      return
    }
    if (form.account_type === 'bank' && !form.account_number.trim()) {
      showMessage('error', 'Nomor rekening wajib diisi untuk jenis rekening bank.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('fin_bank_accounts').insert({
      branch_id: form.branch_id || null,
      bank_name: form.bank_name.trim(),
      account_number: form.account_type === 'bank' ? form.account_number.trim() : null,
      account_holder_name: form.account_holder_name.trim() || null,
      account_type: form.account_type,
    })
    if (error) {
      showMessage('error', 'Gagal menambah: ' + error.message)
    } else {
      showMessage('success', `"${form.bank_name}" berhasil ditambahkan.`)
      setForm({ branch_id: '', bank_name: '', account_number: '', account_holder_name: '', account_type: 'bank' })
      fetchAccounts()
    }
    setSubmitting(false)
  }

  function startEdit(a: BankAccount) {
    setEditingId(a.id)
    setEditBankName(a.bank_name)
    setEditAccountNumber(a.account_number || '')
    setEditHolderName(a.account_holder_name || '')
    setEditBranchId(a.branch_id || '')
  }

  async function saveEdit(id: string, accountType: string) {
    const { error } = await supabase.from('fin_bank_accounts')
      .update({
        bank_name: editBankName,
        account_number: accountType === 'bank' ? editAccountNumber : null,
        account_holder_name: editHolderName || null,
        branch_id: editBranchId || null,
      })
      .eq('id', id)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Rekening berhasil diperbarui.'); setEditingId(null); fetchAccounts() }
  }

  async function toggleActive(a: BankAccount) {
    const { error } = await supabase.from('fin_bank_accounts').update({ is_active: !a.is_active }).eq('id', a.id)
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else fetchAccounts()
  }

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman pengaturan rekening & kas.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Kas & Rekening</h1>
        <p className="text-sm text-slate-500">Daftar rekening bank dan kas tunai, dipakai sebagai sumber/tujuan dana di Kas Masuk dan Kas Keluar — supaya arus kas per rekening/kas bisa dipantau. Rekening bisa ditambah kapan saja tanpa perlu update sistem. &quot;Cabang&quot; hanya label pemilik, bukan pembatas — saat input transaksi, admin tetap bisa memilih rekening cabang mana pun. Kas tunai diperlakukan sebagai satu kesatuan (tidak dipisah per cabang).</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Rekening/Kas</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jenis <span className="text-red-500">*</span></label>
              <select value={form.account_type} onChange={e => setForm({ ...form, account_type: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="bank">Rekening Bank</option>
                <option value="tunai">Kas Tunai</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">{form.account_type === 'tunai' ? 'Nama Kas' : 'Nama Bank'} <span className="text-red-500">*</span></label>
              <input type="text" required value={form.bank_name}
                onChange={e => setForm({ ...form, bank_name: e.target.value })}
                placeholder={form.account_type === 'tunai' ? 'Contoh: Kas Tunai Cabang X' : 'Contoh: BCA'}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            {form.account_type === 'bank' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Rekening <span className="text-red-500">*</span></label>
                <input type="text" required value={form.account_number}
                  onChange={e => setForm({ ...form, account_number: e.target.value })}
                  placeholder="Contoh: 1234567890"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Pemilik Rekening</label>
              <input type="text" value={form.account_holder_name}
                onChange={e => setForm({ ...form, account_holder_name: e.target.value })}
                placeholder="Opsional"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang Pemilik (label saja)</label>
              <select value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Tidak terikat cabang --</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <button type="submit" disabled={submitting}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
              {submitting ? 'Menyimpan...' : 'Tambah Rekening'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jenis</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">No. Rekening</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Pemilik</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat...</td></tr>
                ) : accounts.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada rekening.</td></tr>
                ) : accounts.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-xs">
                      <span className={`px-2 py-0.5 rounded ${a.account_type === 'tunai' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                        {TYPE_LABEL[a.account_type] || a.account_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {editingId === a.id ? (
                        <input value={editBankName} onChange={e => setEditBankName(e.target.value)}
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                      ) : (
                        <span className="font-medium text-slate-800">{a.bank_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 font-mono">
                      {editingId === a.id ? (
                        a.account_type === 'bank' ? (
                          <input value={editAccountNumber} onChange={e => setEditAccountNumber(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                        ) : <span className="text-slate-400">—</span>
                      ) : (
                        a.account_number || <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {editingId === a.id ? (
                        <input value={editHolderName} onChange={e => setEditHolderName(e.target.value)}
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                      ) : (
                        a.account_holder_name || '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {editingId === a.id ? (
                        <select value={editBranchId} onChange={e => setEditBranchId(e.target.value)}
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                          <option value="">-- Tidak terikat --</option>
                          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      ) : (
                        a.branches?.name || <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(a)}
                        className={`px-2 py-1 rounded text-xs font-semibold transition ${a.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                        {a.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editingId === a.id ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(a.id, a.account_type)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(a)} className="px-2 py-1 text-xs text-blue-600 hover:underline">Edit</button>
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
