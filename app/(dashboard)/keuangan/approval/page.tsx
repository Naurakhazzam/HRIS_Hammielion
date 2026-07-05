'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type PendingCashOut = {
  id: string
  branch_id: string
  amount: number
  description: string | null
  transaction_date: string
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
  input_user: { email: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function ApprovalKasKeluarPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  const [entries, setEntries] = useState<PendingCashOut[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fin_cash_out')
      .select('id, branch_id, amount, description, transaction_date, branches(name), fin_cash_out_categories(label), input_user:users!fin_cash_out_input_by_fkey(email)')
      .eq('status', 'pending')
      .order('transaction_date', { ascending: false })

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
    } else {
      setEntries((data as unknown as PendingCashOut[]) || [])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setRoleLoading(false); return }
      setMyUserId(user.id)
      const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
      if (userRow) setRole(userRow.role)
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  useEffect(() => {
    if (isAdmin) fetchEntries()
  }, [isAdmin, fetchEntries])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function processEntries(ids: string[], newStatus: 'approved' | 'rejected') {
    if (!myUserId || ids.length === 0) return
    const verb = newStatus === 'approved' ? 'menyetujui' : 'menolak'
    if (!confirm(`Yakin ingin ${verb} ${ids.length} entri kas keluar?`)) return

    setProcessing(true)
    const { error } = await supabase
      .from('fin_cash_out')
      .update({ status: newStatus, verified_by: myUserId, verified_at: new Date().toISOString() })
      .in('id', ids)

    if (error) {
      showMessage('error', 'Gagal memproses: ' + error.message)
    } else {
      showMessage('success', `${ids.length} entri berhasil ${newStatus === 'approved' ? 'disetujui' : 'ditolak'}.`)
      setSelectedIds([])
      fetchEntries()
    }
    setProcessing(false)
  }

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIds(e.target.checked ? entries.map(en => en.id) : [])
  }
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const totalPending = entries.reduce((acc, e) => acc + Number(e.amount), 0)

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman verifikasi kas keluar.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Verifikasi Kas Keluar</h1>
        <p className="text-sm text-slate-500">Tinjau entri kas keluar manual dari semua cabang sebelum masuk laporan resmi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-4">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Menunggu Verifikasi</p>
          <p className="text-xl font-bold text-slate-800">{entries.length}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Nominal</p>
          <p className="text-xl font-bold text-yellow-700">{formatRupiah(totalPending)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center gap-4">
          <span className="text-sm text-slate-500">{selectedIds.length > 0 ? `${selectedIds.length} dipilih` : 'Pilih entri untuk memproses massal'}</span>
          {selectedIds.length > 0 && (
            <div className="flex gap-2">
              <button onClick={() => processEntries(selectedIds, 'approved')} disabled={processing}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition disabled:opacity-50">
                Setujui ({selectedIds.length})
              </button>
              <button onClick={() => processEntries(selectedIds, 'rejected')} disabled={processing}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition disabled:opacity-50">
                Tolak ({selectedIds.length})
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 w-10 text-center">
                  <input type="checkbox" onChange={handleSelectAll}
                    checked={selectedIds.length > 0 && selectedIds.length === entries.length}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Jumlah</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Keterangan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Input Oleh</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada entri yang menunggu verifikasi.</td></tr>
              ) : entries.map(en => (
                <tr key={en.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.includes(en.id)} onChange={() => toggleSelect(en.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(en.transaction_date).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.branches?.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.fin_cash_out_categories?.label}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(en.amount)}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{en.description || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{en.input_user?.email || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => processEntries([en.id], 'approved')} disabled={processing}
                        className="px-2 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded text-xs font-medium transition">Setujui</button>
                      <button onClick={() => processEntries([en.id], 'rejected')} disabled={processing}
                        className="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-medium transition">Tolak</button>
                    </div>
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
