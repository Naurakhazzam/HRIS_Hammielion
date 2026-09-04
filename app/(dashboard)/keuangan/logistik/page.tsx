'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr, todayLocalStr } from '@/lib/date'

const ADMIN_ROLES = ['owner', 'hr', 'finance']
const LOGISTIK_BRANCH_ID = 'ff5cd917-39cb-4b83-ab85-3481f4f082e4'

type CashInRow = {
  id: string
  transaction_date: string
  amount: number
  expense_amount: number
  cash_adjustment: number
  description: string | null
  status: string
  fin_bank_accounts?: { bank_name: string; account_number: string | null } | null
}
type CashOutRow = {
  id: string
  transaction_date: string
  amount: number
  description: string | null
  status: string
  fin_bank_accounts?: { bank_name: string; account_number: string | null } | null
  fin_cash_out_categories?: { label: string } | null
}

export default function LogistikPage() {
  const supabase = createClient()

  const [role, setRole] = useState('')
  const [roleLoading, setRoleLoading] = useState(true)
  const [loading, setLoading] = useState(true)

  const today = todayLocalStr()
  // Tujuan halaman ini: laporan FULL (semua periode) — filter bulan bersifat opsional untuk drill-down.
  const [viewMode, setViewMode] = useState<'all' | 'month'>('all')
  const [filterMonth, setFilterMonth] = useState(today.slice(0, 7))

  const [pemasukan, setPemasukan] = useState<CashInRow[]>([])
  const [pengeluaran, setPengeluaran] = useState<CashOutRow[]>([])
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

    let inQuery = supabase.from('fin_cash_in')
      .select('id, transaction_date, amount, expense_amount, cash_adjustment, description, status, fin_bank_accounts(bank_name, account_number)')
      .eq('branch_id', LOGISTIK_BRANCH_ID)
      .order('transaction_date', { ascending: false })
    let outQuery = supabase.from('fin_cash_out')
      .select('id, transaction_date, amount, description, status, fin_bank_accounts(bank_name, account_number), fin_cash_out_categories(label)')
      .eq('branch_id', LOGISTIK_BRANCH_ID)
      .order('transaction_date', { ascending: false })

    if (viewMode === 'month') {
      const [year, month] = filterMonth.split('-').map(Number)
      const startDate = localDateStr(new Date(year, month - 1, 1))
      const endDate = localDateStr(new Date(year, month, 0))
      inQuery = inQuery.gte('transaction_date', startDate).lte('transaction_date', endDate)
      outQuery = outQuery.gte('transaction_date', startDate).lte('transaction_date', endDate)
    }

    const [inRes, outRes] = await Promise.all([inQuery, outQuery])

    if (inRes.error) console.error('Detail error pemasukan:', JSON.stringify(inRes.error, null, 2))
    if (outRes.error) console.error('Detail error pengeluaran:', JSON.stringify(outRes.error, null, 2))

    setPemasukan((inRes.data as unknown as CashInRow[]) || [])
    setPengeluaran((outRes.data as unknown as CashOutRow[]) || [])
    setAsOf(new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))
    setLoading(false)
  }, [supabase, viewMode, filterMonth])

  useEffect(() => { if (!roleLoading && isAdmin) fetchData() }, [roleLoading, isAdmin, fetchData])

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', revisi: 'bg-blue-100 text-blue-800' }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', revisi: '🔄 Revisi' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  const totalPemasukan = pemasukan.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.amount) - Number(r.expense_amount || 0) + Number(r.cash_adjustment || 0), 0)
  const totalPengeluaran = pengeluaran.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.amount), 0)
  const sisaSaldo = totalPemasukan - totalPengeluaran
  const pendingCount = pemasukan.filter(r => r.status === 'pending').length + pengeluaran.filter(r => r.status === 'pending').length

  const periodLabel = viewMode === 'all' ? 'Semua Periode' : new Date(filterMonth + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman Logistik.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Logistik — Pendapatan &amp; Pengeluaran</h1>
          <p className="text-sm text-slate-500">Laporan penuh uang Logistik, dipisah dari cabang lain. Pendapatan = sewa yang dibayar cabang-cabang lain ke Logistik (toko, motor, mobil, parkir, dll). Pengeluaran = biaya operasional Logistik sendiri.</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            <button onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Semua Periode
            </button>
            <button onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === 'month' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Per Bulan
            </button>
          </div>
          {viewMode === 'month' && (
            <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white" />
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-500">Memuat data...</div>
      ) : (
        <>
          {pendingCount > 0 && (
            <div className="mb-6 p-4 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-sm">
              ⚠ Ada {pendingCount} entri berstatus &quot;Menunggu&quot; untuk periode ini — belum dihitung ke Total &amp; Sisa Saldo di bawah sampai disetujui.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Pendapatan — {periodLabel}</p>
              <p className="text-xl font-bold text-green-700">{formatRupiah(totalPemasukan)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Pengeluaran — {periodLabel}</p>
              <p className="text-xl font-bold text-red-700">{formatRupiah(totalPengeluaran)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border-2 border-blue-200">
              <div className="flex justify-between items-center mb-1">
                <p className="text-xs text-slate-500 font-medium uppercase">Sisa Saldo</p>
                <span className="text-[10px] text-slate-400">per {asOf}</span>
              </div>
              <p className={`text-xl font-bold ${sisaSaldo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{formatRupiah(sisaSaldo)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Pendapatan − Pengeluaran (disetujui), {viewMode === 'all' ? 'akumulasi sejak awal' : `khusus ${periodLabel}`}.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-green-50">
                <h2 className="text-sm font-bold text-green-800">💰 Pendapatan Logistik — {periodLabel}</h2>
                <p className="text-xs text-green-600">Sewa dari cabang lain (toko, kendaraan, parkir, dll) yang masuk ke rekening Logistik.</p>
              </div>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200">
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase sticky top-0 bg-white">Tanggal</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase sticky top-0 bg-white">Keterangan</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase sticky top-0 bg-white">Rekening</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right sticky top-0 bg-white">Nominal</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-center sticky top-0 bg-white">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pemasukan.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pendapatan untuk periode ini.</td></tr>
                    ) : pemasukan.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-700">{r.description || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{r.fin_bank_accounts ? (r.fin_bank_accounts.account_number ? `${r.fin_bank_accounts.bank_name} — ${r.fin_bank_accounts.account_number}` : r.fin_bank_accounts.bank_name) : '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-semibold text-green-700 whitespace-nowrap">{formatRupiah(Number(r.amount) - Number(r.expense_amount || 0) + Number(r.cash_adjustment || 0))}</td>
                        <td className="px-4 py-2.5 text-center">{statusBadge(r.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {pemasukan.length > 0 && (
                    <tfoot>
                      <tr className="bg-green-50 border-t border-green-200">
                        <td colSpan={3} className="px-4 py-2.5 text-sm font-bold text-green-800 text-right">Total (Disetujui)</td>
                        <td className="px-4 py-2.5 text-sm text-right font-bold text-green-800">{formatRupiah(totalPemasukan)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-red-50">
                <h2 className="text-sm font-bold text-red-800">💸 Pengeluaran Logistik — {periodLabel}</h2>
                <p className="text-xs text-red-600">Biaya operasional Logistik sendiri (bukan sewa yang dibayar ke cabang lain).</p>
              </div>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200">
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase sticky top-0 bg-white">Tanggal</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase sticky top-0 bg-white">Kategori</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase sticky top-0 bg-white">Keterangan</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase sticky top-0 bg-white">Rekening</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right sticky top-0 bg-white">Nominal</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-center sticky top-0 bg-white">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pengeluaran.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pengeluaran untuk periode ini.</td></tr>
                    ) : pengeluaran.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{r.fin_cash_out_categories?.label || '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-700">{r.description || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{r.fin_bank_accounts ? (r.fin_bank_accounts.account_number ? `${r.fin_bank_accounts.bank_name} — ${r.fin_bank_accounts.account_number}` : r.fin_bank_accounts.bank_name) : '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-semibold text-red-700 whitespace-nowrap">{formatRupiah(r.amount)}</td>
                        <td className="px-4 py-2.5 text-center">{statusBadge(r.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {pengeluaran.length > 0 && (
                    <tfoot>
                      <tr className="bg-red-50 border-t border-red-200">
                        <td colSpan={4} className="px-4 py-2.5 text-sm font-bold text-red-800 text-right">Total (Disetujui)</td>
                        <td className="px-4 py-2.5 text-sm text-right font-bold text-red-800">{formatRupiah(totalPengeluaran)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 mt-4">Data diambil dari Kas Masuk &amp; Kas Keluar cabang Logistik. Hanya entri berstatus &quot;Disetujui&quot; yang dihitung ke Total &amp; Sisa Saldo — entri Menunggu/Ditolak tetap ditampilkan di tabel supaya kelihatan, tapi tidak masuk hitungan.</p>
        </>
      )}
    </div>
  )
}
