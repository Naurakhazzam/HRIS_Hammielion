'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

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
}
type CashRow = { account_id: string | null; amount: number; transaction_date: string }

type AccountFlow = Account & {
  periodIn: number
  periodOut: number
  saldoBerjalan: number
}

export default function CashFlowPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [roleLoading, setRoleLoading] = useState(true)
  const [loading, setLoading] = useState(true)

  const today = new Date().toISOString().split('T')[0]
  const [filterMonth, setFilterMonth] = useState(today.slice(0, 7))

  const [flows, setFlows] = useState<AccountFlow[]>([])
  const [unlinkedIn, setUnlinkedIn] = useState(0)
  const [unlinkedOut, setUnlinkedOut] = useState(0)
  const [unlinkedCount, setUnlinkedCount] = useState(0)
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
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0]
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    const [accRes, cashInRes, cashOutRes] = await Promise.all([
      supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_holder_name, account_type, opening_balance, opening_balance_date, is_active').order('account_type').order('bank_name'),
      supabase.from('fin_cash_in').select('account_id, amount, transaction_date').eq('status', 'approved').lte('transaction_date', endDate),
      supabase.from('fin_cash_out').select('account_id, amount, transaction_date').eq('status', 'approved').lte('transaction_date', endDate),
    ])

    if (accRes.error) console.error('Detail error accounts:', JSON.stringify(accRes.error, null, 2))
    if (cashInRes.error) console.error('Detail error cash_in:', JSON.stringify(cashInRes.error, null, 2))
    if (cashOutRes.error) console.error('Detail error cash_out:', JSON.stringify(cashOutRes.error, null, 2))

    const accounts = (accRes.data as Account[]) || []
    const cashIn = (cashInRes.data as CashRow[]) || []
    const cashOut = (cashOutRes.data as CashRow[]) || []

    const flowList: AccountFlow[] = accounts.map(acc => {
      const inRows = cashIn.filter(r => r.account_id === acc.id)
      const outRows = cashOut.filter(r => r.account_id === acc.id)

      const periodIn = inRows.filter(r => r.transaction_date >= startDate && r.transaction_date <= endDate)
        .reduce((s, r) => s + Number(r.amount), 0)
      const periodOut = outRows.filter(r => r.transaction_date >= startDate && r.transaction_date <= endDate)
        .reduce((s, r) => s + Number(r.amount), 0)

      const cumulativeIn = inRows.filter(r => r.transaction_date >= acc.opening_balance_date && r.transaction_date <= endDate)
        .reduce((s, r) => s + Number(r.amount), 0)
      const cumulativeOut = outRows.filter(r => r.transaction_date >= acc.opening_balance_date && r.transaction_date <= endDate)
        .reduce((s, r) => s + Number(r.amount), 0)

      return {
        ...acc,
        periodIn,
        periodOut,
        saldoBerjalan: Number(acc.opening_balance) + cumulativeIn - cumulativeOut,
      }
    })

    const unlinkedInRows = cashIn.filter(r => !r.account_id && r.transaction_date >= startDate && r.transaction_date <= endDate)
    const unlinkedOutRows = cashOut.filter(r => !r.account_id && r.transaction_date >= startDate && r.transaction_date <= endDate)
    setUnlinkedIn(unlinkedInRows.reduce((s, r) => s + Number(r.amount), 0))
    setUnlinkedOut(unlinkedOutRows.reduce((s, r) => s + Number(r.amount), 0))
    setUnlinkedCount(unlinkedInRows.length + unlinkedOutRows.length)

    setFlows(flowList)
    setAsOf(new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))
    setLoading(false)
  }, [supabase, filterMonth])

  useEffect(() => { if (!roleLoading && isAdmin) fetchData() }, [roleLoading, isAdmin, fetchData])

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const totalSaldoBerjalan = flows.reduce((s, f) => s + f.saldoBerjalan, 0)

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
          <p className="text-sm text-slate-500">Saldo Berjalan = Saldo Awal + Kas Masuk − Kas Keluar (disetujui) sejak tanggal saldo awal masing-masing rekening/kas.</p>
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

          <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-blue-200">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-lg font-bold text-slate-800">Total Saldo Berjalan (Semua Rekening/Kas)</h2>
              <span className="text-xs text-slate-400">per {asOf}</span>
            </div>
            <p className={`text-2xl font-bold ${totalSaldoBerjalan >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(totalSaldoBerjalan)}</p>
            <p className="text-xs text-slate-400 mt-1">Akumulasi saldo berjalan sampai akhir bulan yang dipilih, dari seluruh rekening bank + kas tunai.</p>
          </div>

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
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Saldo Berjalan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada rekening/kas. Tambahkan di Setup Kas & Rekening.</td></tr>
                  ) : flows.map(f => (
                    <tr key={f.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm">
                        <span className="font-medium text-slate-800">
                          {f.account_type === 'tunai' ? f.bank_name : `${f.bank_name} — ${f.account_number}`}
                        </span>
                        {!f.is_active && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Nonaktif</span>}
                        <div className="text-xs text-slate-400">{TYPE_LABEL[f.account_type] || f.account_type}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-600">{formatRupiah(f.opening_balance)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{new Date(f.opening_balance_date).toLocaleDateString('id-ID')}</td>
                      <td className="px-4 py-3 text-sm text-right text-green-700">{formatRupiah(f.periodIn)}</td>
                      <td className="px-4 py-3 text-sm text-right text-red-700">{formatRupiah(f.periodOut)}</td>
                      <td className={`px-4 py-3 text-sm text-right font-bold ${f.saldoBerjalan >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(f.saldoBerjalan)}</td>
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
