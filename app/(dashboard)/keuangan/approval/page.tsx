'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type PendingCashOut = {
  id: string
  amount: number
  description: string | null
  transaction_date: string
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
  input_user: { email: string } | null
}
type PendingCashIn = {
  id: string
  amount: number
  payment_method: string
  transaction_date: string
  branches: { name: string } | null
  input_user: { email: string } | null
}
type PendingHpp = {
  id: string
  hpp_amount: number
  notes: string | null
  entry_date: string
  branches: { name: string } | null
  input_user: { email: string } | null
}

type Tab = 'kas_keluar' | 'kas_masuk' | 'hpp'
const ADMIN_ROLES = ['owner', 'hr', 'finance']
const PAYMENT_LABEL: Record<string, string> = { cash: 'Tunai', transfer: 'Transfer', campuran: 'Campuran' }

export default function ApprovalKasKeluarPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('kas_keluar')
  const [cashOut, setCashOut] = useState<PendingCashOut[]>([])
  const [cashIn, setCashIn] = useState<PendingCashIn[]>([])
  const [hpp, setHpp] = useState<PendingHpp[]>([])

  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [coRes, ciRes, hpRes] = await Promise.all([
      supabase.from('fin_cash_out')
        .select('id, amount, description, transaction_date, branches(name), fin_cash_out_categories(label), input_user:users!fin_cash_out_input_by_fkey(email)')
        .eq('status', 'pending').order('transaction_date', { ascending: false }),
      supabase.from('fin_cash_in')
        .select('id, amount, payment_method, transaction_date, branches(name), input_user:users!fin_cash_in_input_by_fkey(email)')
        .eq('status', 'pending').order('transaction_date', { ascending: false }),
      supabase.from('fin_hpp_entries')
        .select('id, hpp_amount, notes, entry_date, branches(name), input_user:users!fin_hpp_entries_input_by_fkey(email)')
        .eq('status', 'pending').order('entry_date', { ascending: false }),
    ])
    if (coRes.error) console.error('Detail error kas_keluar:', JSON.stringify(coRes.error, null, 2))
    else setCashOut((coRes.data as unknown as PendingCashOut[]) || [])
    if (ciRes.error) console.error('Detail error kas_masuk:', JSON.stringify(ciRes.error, null, 2))
    else setCashIn((ciRes.data as unknown as PendingCashIn[]) || [])
    if (hpRes.error) console.error('Detail error hpp:', JSON.stringify(hpRes.error, null, 2))
    else setHpp((hpRes.data as unknown as PendingHpp[]) || [])
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

  useEffect(() => { if (isAdmin) fetchAll() }, [isAdmin, fetchAll])
  useEffect(() => { setSelectedIds([]) }, [tab])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  const TABLE_BY_TAB: Record<Tab, string> = { kas_keluar: 'fin_cash_out', kas_masuk: 'fin_cash_in', hpp: 'fin_hpp_entries' }
  const LABEL_BY_TAB: Record<Tab, string> = { kas_keluar: 'Kas Keluar', kas_masuk: 'Kas Masuk', hpp: 'HPP' }

  async function processEntries(ids: string[], newStatus: 'approved' | 'rejected') {
    if (!myUserId || ids.length === 0) return
    const verb = newStatus === 'approved' ? 'menyetujui' : 'menolak'
    if (!confirm(`Yakin ingin ${verb} ${ids.length} entri ${LABEL_BY_TAB[tab]}?`)) return

    setProcessing(true)
    const { error } = await supabase
      .from(TABLE_BY_TAB[tab])
      .update({ status: newStatus, verified_by: myUserId, verified_at: new Date().toISOString() })
      .in('id', ids)

    if (error) {
      showMessage('error', 'Gagal memproses: ' + error.message)
    } else {
      showMessage('success', `${ids.length} entri ${LABEL_BY_TAB[tab]} berhasil ${newStatus === 'approved' ? 'disetujui' : 'ditolak'}.`)
      setSelectedIds([])
      fetchAll()
    }
    setProcessing(false)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const currentList = tab === 'kas_keluar' ? cashOut : tab === 'kas_masuk' ? cashIn : hpp
  const currentIds = currentList.map((en) => en.id)

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIds(e.target.checked ? currentIds : [])
  }
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman verifikasi.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Verifikasi Keuangan</h1>
        <p className="text-sm text-slate-500">Tinjau entri manual dari semua cabang sebelum masuk laporan resmi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-6">
        {(['kas_keluar', 'kas_masuk', 'hpp'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {LABEL_BY_TAB[t]} ({t === 'kas_keluar' ? cashOut.length : t === 'kas_masuk' ? cashIn.length : hpp.length})
          </button>
        ))}
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
                    checked={selectedIds.length > 0 && selectedIds.length === currentIds.length}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                {tab === 'kas_keluar' && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>}
                {tab === 'kas_masuk' && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Metode</th>}
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Jumlah</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Keterangan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Input Oleh</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
              ) : currentList.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada entri yang menunggu verifikasi.</td></tr>
              ) : tab === 'kas_keluar' ? cashOut.map(en => (
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
                      <button onClick={() => processEntries([en.id], 'approved')} disabled={processing} className="px-2 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded text-xs font-medium transition">Setujui</button>
                      <button onClick={() => processEntries([en.id], 'rejected')} disabled={processing} className="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-medium transition">Tolak</button>
                    </div>
                  </td>
                </tr>
              )) : tab === 'kas_masuk' ? cashIn.map(en => (
                <tr key={en.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.includes(en.id)} onChange={() => toggleSelect(en.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(en.transaction_date).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.branches?.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{PAYMENT_LABEL[en.payment_method] || en.payment_method}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(en.amount)}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">—</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{en.input_user?.email || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => processEntries([en.id], 'approved')} disabled={processing} className="px-2 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded text-xs font-medium transition">Setujui</button>
                      <button onClick={() => processEntries([en.id], 'rejected')} disabled={processing} className="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-medium transition">Tolak</button>
                    </div>
                  </td>
                </tr>
              )) : hpp.map(en => (
                <tr key={en.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.includes(en.id)} onChange={() => toggleSelect(en.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(en.entry_date).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.branches?.name}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(en.hpp_amount)}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{en.notes || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{en.input_user?.email || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => processEntries([en.id], 'approved')} disabled={processing} className="px-2 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded text-xs font-medium transition">Setujui</button>
                      <button onClick={() => processEntries([en.id], 'rejected')} disabled={processing} className="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-medium transition">Tolak</button>
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
