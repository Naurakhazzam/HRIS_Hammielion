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
  fin_bank_accounts: { bank_name: string; account_number: string | null; account_type: string } | null
}
type PendingCashIn = {
  id: string
  amount: number
  payment_method: string
  transaction_date: string
  branches: { name: string } | null
  input_user: { email: string } | null
  fin_bank_accounts: { bank_name: string; account_number: string | null; account_type: string } | null
}
type PendingHpp = {
  id: string
  hpp_amount: number
  notes: string | null
  entry_date: string
  branches: { name: string } | null
  input_user: { email: string } | null
}
type PendingModal = {
  id: string
  jenis: 'Modal Awal' | 'Snapshot Bulanan'
  table: 'fin_branch_capital_baseline' | 'fin_branch_capital_snapshot'
  tanggal: string
  cash_amount: number | null
  inventory_value: number
  asset_value: number
  notes: string | null
  branches: { name: string } | null
  input_user: { email: string } | null
}
type PendingAset = {
  id: string
  jenis: 'Aset' | 'Kontrak Sewa'
  table: 'fin_assets' | 'fin_asset_contracts'
  nama: string
  branchName: string | null
  jumlah: number
  notes: string | null
  input_user: { email: string } | null
}

type Tab = 'kas_keluar' | 'kas_masuk' | 'hpp' | 'modal_cabang' | 'aset'
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
  const [modalItems, setModalItems] = useState<PendingModal[]>([])
  const [asetItems, setAsetItems] = useState<PendingAset[]>([])

  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [coRes, ciRes, hpRes, baseRes, snapRes, assetRes, contractRes] = await Promise.all([
      supabase.from('fin_cash_out')
        .select('id, amount, description, transaction_date, branches(name), fin_cash_out_categories(label), input_user:users!fin_cash_out_input_by_fkey(email), fin_bank_accounts(bank_name, account_number, account_type)')
        .eq('status', 'pending').order('transaction_date', { ascending: false }),
      supabase.from('fin_cash_in')
        .select('id, amount, payment_method, transaction_date, branches(name), input_user:users!fin_cash_in_input_by_fkey(email), fin_bank_accounts(bank_name, account_number, account_type)')
        .eq('status', 'pending').order('transaction_date', { ascending: false }),
      supabase.from('fin_hpp_entries')
        .select('id, hpp_amount, notes, entry_date, branches(name), input_user:users!fin_hpp_entries_input_by_fkey(email)')
        .eq('status', 'pending').order('entry_date', { ascending: false }),
      supabase.from('fin_branch_capital_baseline')
        .select('id, baseline_date, cash_amount, inventory_value, asset_value, notes, branches(name), input_user:users!fin_branch_capital_baseline_input_by_fkey(email)')
        .eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('fin_branch_capital_snapshot')
        .select('id, snapshot_period, inventory_value, asset_value, notes, branches(name), input_user:users!fin_branch_capital_snapshot_input_by_fkey(email)')
        .eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('fin_assets')
        .select('id, name, acquisition_value, notes, branches(name), input_user:users!fin_assets_input_by_fkey(email)')
        .eq('approval_status', 'pending').order('created_at', { ascending: false }),
      supabase.from('fin_asset_contracts')
        .select('id, contract_type, rent_amount, notes, fin_assets(name, branches(name)), input_user:users!fin_asset_contracts_input_by_fkey(email)')
        .eq('approval_status', 'pending').order('created_at', { ascending: false }),
    ])
    if (coRes.error) console.error('Detail error kas_keluar:', JSON.stringify(coRes.error, null, 2))
    else setCashOut((coRes.data as unknown as PendingCashOut[]) || [])
    if (ciRes.error) console.error('Detail error kas_masuk:', JSON.stringify(ciRes.error, null, 2))
    else setCashIn((ciRes.data as unknown as PendingCashIn[]) || [])
    if (hpRes.error) console.error('Detail error hpp:', JSON.stringify(hpRes.error, null, 2))
    else setHpp((hpRes.data as unknown as PendingHpp[]) || [])

    if (baseRes.error) console.error('Detail error baseline:', JSON.stringify(baseRes.error, null, 2))
    if (snapRes.error) console.error('Detail error snapshot:', JSON.stringify(snapRes.error, null, 2))
    const baseItems: PendingModal[] = ((baseRes.data as unknown[]) || []).map((r) => {
      const row = r as { id: string; baseline_date: string; cash_amount: number; inventory_value: number; asset_value: number; notes: string | null; branches: { name: string } | null; input_user: { email: string } | null }
      return { id: row.id, jenis: 'Modal Awal', table: 'fin_branch_capital_baseline', tanggal: row.baseline_date, cash_amount: row.cash_amount, inventory_value: row.inventory_value, asset_value: row.asset_value, notes: row.notes, branches: row.branches, input_user: row.input_user }
    })
    const snapItems: PendingModal[] = ((snapRes.data as unknown[]) || []).map((r) => {
      const row = r as { id: string; snapshot_period: string; inventory_value: number; asset_value: number; notes: string | null; branches: { name: string } | null; input_user: { email: string } | null }
      return { id: row.id, jenis: 'Snapshot Bulanan', table: 'fin_branch_capital_snapshot', tanggal: row.snapshot_period, cash_amount: null, inventory_value: row.inventory_value, asset_value: row.asset_value, notes: row.notes, branches: row.branches, input_user: row.input_user }
    })
    setModalItems([...baseItems, ...snapItems])

    if (assetRes.error) console.error('Detail error aset:', JSON.stringify(assetRes.error, null, 2))
    if (contractRes.error) console.error('Detail error kontrak:', JSON.stringify(contractRes.error, null, 2))
    const assetItemsList: PendingAset[] = ((assetRes.data as unknown[]) || []).map((r) => {
      const row = r as { id: string; name: string; acquisition_value: number; notes: string | null; branches: { name: string } | null; input_user: { email: string } | null }
      return { id: row.id, jenis: 'Aset', table: 'fin_assets', nama: row.name, branchName: row.branches?.name || null, jumlah: row.acquisition_value, notes: row.notes, input_user: row.input_user }
    })
    const contractItemsList: PendingAset[] = ((contractRes.data as unknown[]) || []).map((r) => {
      const row = r as { id: string; contract_type: string; rent_amount: number; notes: string | null; fin_assets: { name: string; branches: { name: string } | null } | null; input_user: { email: string } | null }
      return { id: row.id, jenis: 'Kontrak Sewa', table: 'fin_asset_contracts', nama: `${row.contract_type} — ${row.fin_assets?.name || ''}`, branchName: row.fin_assets?.branches?.name || null, jumlah: row.rent_amount, notes: row.notes, input_user: row.input_user }
    })
    setAsetItems([...assetItemsList, ...contractItemsList])

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

  const LABEL_BY_TAB: Record<Tab, string> = { kas_keluar: 'Kas Keluar', kas_masuk: 'Kas Masuk', hpp: 'HPP', modal_cabang: 'Modal Cabang', aset: 'Aset & Kontrak' }
  // Tabel & kolom status per tab sederhana (single-table)
  const SIMPLE_TABLE_BY_TAB: Partial<Record<Tab, string>> = { kas_keluar: 'fin_cash_out', kas_masuk: 'fin_cash_in', hpp: 'fin_hpp_entries' }

  async function processEntries(ids: string[], newStatus: 'approved' | 'rejected') {
    if (!myUserId || ids.length === 0) return
    const verb = newStatus === 'approved' ? 'menyetujui' : 'menolak'
    if (!confirm(`Yakin ingin ${verb} ${ids.length} entri ${LABEL_BY_TAB[tab]}?`)) return

    setProcessing(true)

    // Tab modal_cabang & aset menggabungkan 2 tabel sumber (beda nama tabel, dan aset pakai kolom approval_status)
    // Kelompokkan per (table, statusColumn) supaya bisa update batch per grup.
    const groups = new Map<string, string[]>() // key = `${table}|${statusCol}` -> ids

    if (tab === 'modal_cabang') {
      for (const id of ids) {
        const item = modalItems.find(m => m.id === id)
        if (!item) continue
        const key = `${item.table}|status`
        groups.set(key, [...(groups.get(key) || []), id])
      }
    } else if (tab === 'aset') {
      for (const id of ids) {
        const item = asetItems.find(a => a.id === id)
        if (!item) continue
        const key = `${item.table}|approval_status`
        groups.set(key, [...(groups.get(key) || []), id])
      }
    } else {
      const table = SIMPLE_TABLE_BY_TAB[tab]!
      groups.set(`${table}|status`, ids)
    }

    let anyError: string | null = null
    for (const [key, groupIds] of groups) {
      const [table, statusCol] = key.split('|')
      const payload: Record<string, unknown> = { verified_by: myUserId, verified_at: new Date().toISOString() }
      payload[statusCol] = newStatus
      const { error } = await supabase.from(table).update(payload).in('id', groupIds)
      if (error) anyError = error.message
    }

    if (anyError) {
      showMessage('error', 'Gagal memproses: ' + anyError)
    } else {
      showMessage('success', `${ids.length} entri ${LABEL_BY_TAB[tab]} berhasil ${newStatus === 'approved' ? 'disetujui' : 'ditolak'}.`)
      setSelectedIds([])
      fetchAll()
    }
    setProcessing(false)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const currentList: { id: string }[] =
    tab === 'kas_keluar' ? cashOut :
    tab === 'kas_masuk' ? cashIn :
    tab === 'hpp' ? hpp :
    tab === 'modal_cabang' ? modalItems :
    asetItems
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

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-6 flex-wrap">
        {(['kas_keluar', 'kas_masuk', 'hpp', 'modal_cabang', 'aset'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {LABEL_BY_TAB[t]} ({
              t === 'kas_keluar' ? cashOut.length :
              t === 'kas_masuk' ? cashIn.length :
              t === 'hpp' ? hpp.length :
              t === 'modal_cabang' ? modalItems.length :
              asetItems.length
            })
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
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{tab === 'aset' ? 'Nama/Aset' : 'Tanggal'}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                {tab === 'kas_keluar' && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>}
                {tab === 'kas_masuk' && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Metode</th>}
                {tab === 'modal_cabang' && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jenis</th>}
                {tab === 'aset' && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jenis</th>}
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Jumlah</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Keterangan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Input Oleh</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td></tr>
              ) : currentList.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada entri yang menunggu verifikasi.</td></tr>
              ) : tab === 'kas_keluar' ? cashOut.map(en => (
                <tr key={en.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.includes(en.id)} onChange={() => toggleSelect(en.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{new Date(en.transaction_date).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.branches?.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {en.fin_cash_out_categories?.label}
                    {en.fin_bank_accounts && (
                      <div className="text-xs text-slate-400 mt-0.5">
                        {en.fin_bank_accounts.account_type === 'tunai' ? en.fin_bank_accounts.bank_name : `${en.fin_bank_accounts.bank_name} — ${en.fin_bank_accounts.account_number}`}
                      </div>
                    )}
                  </td>
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
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {PAYMENT_LABEL[en.payment_method] || en.payment_method}
                    {en.fin_bank_accounts && (
                      <div className="text-xs text-slate-400 mt-0.5">
                        {en.fin_bank_accounts.account_type === 'tunai' ? en.fin_bank_accounts.bank_name : `${en.fin_bank_accounts.bank_name} — ${en.fin_bank_accounts.account_number}`}
                      </div>
                    )}
                  </td>
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
              )) : tab === 'hpp' ? hpp.map(en => (
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
              )) : tab === 'modal_cabang' ? modalItems.map(en => (
                <tr key={en.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.includes(en.id)} onChange={() => toggleSelect(en.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {en.jenis === 'Snapshot Bulanan'
                      ? new Date(en.tanggal).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
                      : new Date(en.tanggal).toLocaleDateString('id-ID')}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.branches?.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.jenis}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">
                    {en.cash_amount !== null ? `${formatRupiah(en.cash_amount)} (cash) + ` : ''}{formatRupiah(en.inventory_value)} (brg) + {formatRupiah(en.asset_value)} (aset)
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{en.notes || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{en.input_user?.email || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => processEntries([en.id], 'approved')} disabled={processing} className="px-2 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded text-xs font-medium transition">Setujui</button>
                      <button onClick={() => processEntries([en.id], 'rejected')} disabled={processing} className="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-medium transition">Tolak</button>
                    </div>
                  </td>
                </tr>
              )) : asetItems.map(en => (
                <tr key={en.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.includes(en.id)} onChange={() => toggleSelect(en.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{en.nama}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.branchName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{en.jenis}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(en.jumlah)}</td>
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
