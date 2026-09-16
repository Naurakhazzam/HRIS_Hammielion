'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr, todayLocalStr } from '@/lib/date'

const ADMIN_ROLES = ['owner', 'hr', 'finance']
const TYPE_LABEL: Record<string, string> = { bank: 'Rekening Bank', tunai: 'Kas Tunai' }

type Account = {
  id: string
  bank_name: string
  account_number: string | null
  account_holder_name: string | null
  account_type: string
  opening_balance: number
  opening_balance_date: string
  is_active: boolean
  settlement_account_id: string | null
}
type CashflowSummaryRow = {
  account_id: string
  period_in: number
  period_out: number
  cumulative_in: number
  cumulative_out: number
  pending_cumulative_in: number
  pending_cumulative_out: number
}

type AccountFlow = Account & {
  periodIn: number
  periodOut: number
  saldoBerjalan: number
  // Saldo Proyeksi = Saldo Berjalan (Real) + transaksi Pending rekening ini KALAU semua ikut
  // disetujui — bukan angka resmi, cuma gambaran "kalau semua beres diverifikasi, segini".
  saldoProyeksi: number
}

export default function CashFlowPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [roleLoading, setRoleLoading] = useState(true)
  const [loading, setLoading] = useState(true)

  const today = todayLocalStr()
  const [filterMonth, setFilterMonth] = useState(today.slice(0, 7))

  const [flows, setFlows] = useState<AccountFlow[]>([])
  const [groups, setGroups] = useState<{ root: AccountFlow; members: AccountFlow[]; totalSaldo: number; totalSaldoProyeksi: number; totalPeriodIn: number; totalPeriodOut: number }[]>([])
  const [unlinkedIn, setUnlinkedIn] = useState(0)
  const [unlinkedOut, setUnlinkedOut] = useState(0)
  const [unlinkedCount, setUnlinkedCount] = useState(0)
  // Transaksi status 'pending' (belum diverifikasi Finance) — TIDAK ikut dihitung di Saldo
  // Berjalan (sengaja), tapi perlu ditampilkan supaya jelas kenapa saldo kelihatan lebih besar
  // dari yang sebenarnya sudah keluar/masuk secara riil.
  const [pendingIn, setPendingIn] = useState(0)
  const [pendingOut, setPendingOut] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingSupplierOut, setPendingSupplierOut] = useState(0)
  const [asOf, setAsOf] = useState('')

  const isAdmin = ADMIN_ROLES.includes(role)

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

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = localDateStr(new Date(year, month - 1, 1))
    const endDate = localDateStr(new Date(year, month, 0))

    // Penjumlahan dilakukan di database (RPC, SQL SUM) — BUKAN tarik semua baris fin_cash_in/
    // fin_cash_out ke browser lalu jumlahkan di JS. Supabase default cuma kirim maksimal 1000
    // baris per query; tabel ini sudah lebih dari itu, jadi cara lama diam-diam memotong sebagian
    // transaksi (tanpa error) dan bikin Saldo Berjalan salah/tidak konsisten. Lihat migrasi
    // 033_fix_cashflow_aggregation_rpc.sql.
    const [accRes, summaryRes, unlinkedRes, pendingRes] = await Promise.all([
      supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_holder_name, account_type, opening_balance, opening_balance_date, is_active, settlement_account_id').order('account_type').order('bank_name'),
      supabase.rpc('get_account_cashflow_summary', { p_period_start: startDate, p_period_end: endDate }),
      supabase.rpc('get_unlinked_cashflow_summary', { p_period_start: startDate, p_period_end: endDate }).single(),
      supabase.rpc('get_pending_cashflow_summary', { p_period_start: startDate, p_period_end: endDate }).single(),
    ])

    if (accRes.error) console.error('Detail error accounts:', JSON.stringify(accRes.error, null, 2))
    if (summaryRes.error) console.error('Detail error cashflow summary:', JSON.stringify(summaryRes.error, null, 2))
    if (unlinkedRes.error) console.error('Detail error unlinked summary:', JSON.stringify(unlinkedRes.error, null, 2))
    if (pendingRes.error) console.error('Detail error pending summary:', JSON.stringify(pendingRes.error, null, 2))

    const accounts = (accRes.data as Account[]) || []
    const summaryByAccount = new Map(((summaryRes.data as CashflowSummaryRow[]) || []).map(r => [r.account_id, r]))

    const flowList: AccountFlow[] = accounts.map(acc => {
      const s = summaryByAccount.get(acc.id)
      const periodIn = Number(s?.period_in || 0)
      const periodOut = Number(s?.period_out || 0)
      const cumulativeIn = Number(s?.cumulative_in || 0)
      const cumulativeOut = Number(s?.cumulative_out || 0)
      const pendingCumIn = Number(s?.pending_cumulative_in || 0)
      const pendingCumOut = Number(s?.pending_cumulative_out || 0)
      const saldoBerjalan = Number(acc.opening_balance) + cumulativeIn - cumulativeOut

      return {
        ...acc,
        periodIn,
        periodOut,
        saldoBerjalan,
        saldoProyeksi: saldoBerjalan + pendingCumIn - pendingCumOut,
      }
    })

    const unlinked = unlinkedRes.data as { unlinked_in: number; unlinked_out: number; unlinked_count: number } | null
    setUnlinkedIn(Number(unlinked?.unlinked_in || 0))
    setUnlinkedOut(Number(unlinked?.unlinked_out || 0))
    setUnlinkedCount(Number(unlinked?.unlinked_count || 0))

    const pending = pendingRes.data as { pending_in: number; pending_out: number; pending_count: number; pending_supplier_out: number } | null
    setPendingIn(Number(pending?.pending_in || 0))
    setPendingOut(Number(pending?.pending_out || 0))
    setPendingCount(Number(pending?.pending_count || 0))
    setPendingSupplierOut(Number(pending?.pending_supplier_out || 0))

    // Kelompokkan rekening yang "gabung saldo ke" rekening lain (mis. EDC/QRIS yang muara ke rekening bank utama)
    const byId = new Map(flowList.map(f => [f.id, f]))
    function resolveRoot(f: AccountFlow): AccountFlow {
      let cur = f
      const seen = new Set<string>()
      while (cur.settlement_account_id && byId.has(cur.settlement_account_id) && !seen.has(cur.id)) {
        seen.add(cur.id)
        cur = byId.get(cur.settlement_account_id)!
      }
      return cur
    }
    const groupMap = new Map<string, { root: AccountFlow; members: AccountFlow[]; totalSaldo: number; totalSaldoProyeksi: number; totalPeriodIn: number; totalPeriodOut: number }>()
    flowList.forEach(f => {
      const root = resolveRoot(f)
      const g = groupMap.get(root.id) || { root, members: [], totalSaldo: 0, totalSaldoProyeksi: 0, totalPeriodIn: 0, totalPeriodOut: 0 }
      g.members.push(f)
      g.totalSaldo += f.saldoBerjalan
      g.totalSaldoProyeksi += f.saldoProyeksi
      g.totalPeriodIn += f.periodIn
      g.totalPeriodOut += f.periodOut
      groupMap.set(root.id, g)
    })
    setGroups(Array.from(groupMap.values()).filter(g => g.members.length > 1))

    setFlows(flowList)
    setAsOf(new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))
    setLoading(false)
  }, [supabase, filterMonth])

  useEffect(() => { if (!roleLoading && isAdmin) fetchData() }, [roleLoading, isAdmin, fetchData])

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const totalSaldoBerjalan = flows.reduce((s, f) => s + f.saldoBerjalan, 0)
  const totalSaldoProyeksi = flows.reduce((s, f) => s + f.saldoProyeksi, 0)

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman Cash Flow per Rekening/Kas.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Cash Flow per Rekening/Kas</h1>
          <p className="text-sm text-slate-500">Saldo Berjalan = Saldo Awal + Uang Fisik Masuk (omzet − pengeluaran ± selisih kasir) − Kas Keluar (disetujui) sejak tanggal saldo awal masing-masing rekening/kas.</p>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Bulan</label>
          <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white" />
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-500">Memuat data...</div>
      ) : (
        <>
          {unlinkedCount > 0 && (
            <div className="mb-6 p-4 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-sm">
              <p className="font-medium mb-1">⚠ Ada transaksi bulan ini yang belum terhubung ke rekening/kas manapun.</p>
              <p>
                {unlinkedIn > 0 && <>Kas Masuk belum terhubung: <strong>{formatRupiah(unlinkedIn)}</strong>. </>}
                {unlinkedOut > 0 && <>Kas Keluar belum terhubung: <strong>{formatRupiah(unlinkedOut)}</strong>. </>}
                Angka di tabel bawah <strong>tidak termasuk</strong> transaksi ini. Isi manual lewat halaman Riwayat Kas Masuk/Kas Keluar supaya laporan lengkap.
              </p>
            </div>
          )}

          {pendingCount > 0 && (
            <div className="mb-6 p-4 rounded-lg border bg-orange-50 border-orange-200 text-orange-800 text-sm">
              <p className="font-medium mb-1">⏳ Ada {pendingCount} transaksi bulan ini yang masih menunggu verifikasi Finance — belum ikut dihitung di Saldo Berjalan.</p>
              <p>
                {pendingIn > 0 && <>Kas Masuk pending: <strong>{formatRupiah(pendingIn)}</strong>. </>}
                {pendingOut > 0 && <>Kas Keluar pending: <strong>{formatRupiah(pendingOut)}</strong></>}
                {pendingSupplierOut > 0 && <> (termasuk <strong>{formatRupiah(pendingSupplierOut)}</strong> pembayaran supplier)</>}
                . Saldo yang tampil di bawah jadi terlihat lebih besar dari yang sebenarnya sudah keluar/masuk secara riil. Verifikasi dulu di{' '}
                <a href="/keuangan/approval" className="underline font-medium">Verifikasi Keuangan</a> supaya angkanya lengkap.
              </p>
            </div>
          )}

          <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-blue-200">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-lg font-bold text-slate-800">Total Saldo (Semua Rekening/Kas)</h2>
              <span className="text-xs text-slate-400">per {asOf}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase mb-1">Saldo Real (Sudah Diverifikasi)</p>
                <p className={`text-2xl font-bold ${totalSaldoBerjalan >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(totalSaldoBerjalan)}</p>
              </div>
              <div>
                <p className="text-xs text-orange-500 font-medium uppercase mb-1">Saldo Proyeksi (Kalau Pending Disetujui)</p>
                <p className={`text-2xl font-bold ${totalSaldoProyeksi >= 0 ? 'text-orange-700' : 'text-red-700'}`}>{formatRupiah(totalSaldoProyeksi)}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2">Saldo Real = akumulasi transaksi yang sudah diverifikasi Finance sampai akhir bulan yang dipilih. Saldo Proyeksi = Saldo Real ditambah semua transaksi yang masih Pending, seandainya semuanya disetujui — bukan angka resmi, cuma gambaran.</p>
          </div>

          {groups.length > 0 && (
            <div className="mb-6 bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-indigo-100 bg-indigo-50">
                <h2 className="text-sm font-bold text-indigo-800">Saldo Riil per Kantong (Rekening yang Digabung)</h2>
                <p className="text-xs text-indigo-500">Rekening yang ditandai &quot;Gabung Saldo Ke&quot; di Setup Kas &amp; Rekening (mis. EDC/QRIS yang muaranya ke satu rekening bank) dijumlahkan otomatis di sini — tidak perlu hitung manual.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kantong (Rekening Tujuan)</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Digabung Dari</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Kas Masuk (Bulan Ini)</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Kas Keluar (Bulan Ini)</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Saldo Real (Gabungan)</th>
                      <th className="px-4 py-3 text-xs font-semibold text-orange-500 uppercase text-right">Saldo Proyeksi (Gabungan)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groups.map(g => (
                      <tr key={g.root.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{g.root.bank_name}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{g.members.map(m => m.bank_name).join(' + ')}</td>
                        <td className="px-4 py-3 text-sm text-right text-green-700">{formatRupiah(g.totalPeriodIn)}</td>
                        <td className="px-4 py-3 text-sm text-right text-red-700">{formatRupiah(g.totalPeriodOut)}</td>
                        <td className={`px-4 py-3 text-sm text-right font-bold ${g.totalSaldo >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(g.totalSaldo)}</td>
                        <td className={`px-4 py-3 text-sm text-right font-bold ${g.totalSaldoProyeksi >= 0 ? 'text-orange-700' : 'text-red-700'}`}>{formatRupiah(g.totalSaldoProyeksi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Rekening/Kas</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Saldo Awal</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Per Tanggal</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Kas Masuk (Bulan Ini)</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Kas Keluar (Bulan Ini)</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Saldo Real</th>
                    <th className="px-4 py-3 text-xs font-semibold text-orange-500 uppercase text-right">Saldo Proyeksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada rekening/kas. Tambahkan di Setup Kas & Rekening.</td></tr>
                  ) : flows.map(f => (
                    <tr key={f.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm">
                        <span className="font-medium text-slate-800">
                          {f.account_type === 'tunai' ? f.bank_name : `${f.bank_name} — ${f.account_number}`}
                        </span>
                        {!f.is_active && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Nonaktif</span>}
                        <div className="text-xs text-slate-400">
                          {TYPE_LABEL[f.account_type] || f.account_type}
                          {f.settlement_account_id && (
                            <span className="ml-1 text-indigo-500">→ digabung ke {flows.find(x => x.id === f.settlement_account_id)?.bank_name || '—'}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-600">{formatRupiah(f.opening_balance)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{new Date(f.opening_balance_date).toLocaleDateString('id-ID')}</td>
                      <td className="px-4 py-3 text-sm text-right text-green-700">{formatRupiah(f.periodIn)}</td>
                      <td className="px-4 py-3 text-sm text-right text-red-700">{formatRupiah(f.periodOut)}</td>
                      <td className={`px-4 py-3 text-sm text-right font-bold ${f.saldoBerjalan >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(f.saldoBerjalan)}</td>
                      <td className={`px-4 py-3 text-sm text-right font-bold ${f.saldoProyeksi >= 0 ? 'text-orange-700' : 'text-red-700'}`}>{formatRupiah(f.saldoProyeksi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400 mt-3">Hanya menghitung entri berstatus &quot;Disetujui&quot;. Saldo Berjalan dihitung kumulatif sejak tanggal Saldo Awal masing-masing rekening/kas sampai akhir bulan yang dipilih (bukan cuma bulan berjalan).</p>
        </>
      )}
    </div>
  )
}
