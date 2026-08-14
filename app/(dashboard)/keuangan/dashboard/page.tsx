'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr, todayLocalStr } from '@/lib/date'
import Link from 'next/link'
import InfoTooltip from '@/components/InfoTooltip'

const ADMIN_ROLES = ['owner', 'hr', 'finance']

type ReportGroup = { branch_id: string; report_group_label: string }
type GroupTotals = {
  label: string
  kasMasuk: number
  hpp: number
  biayaOperasional: number
  kasbonRealisasi: number
  labaKotor: number
  labaBersih: number
}
const EMPTY_TOTALS = { kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0, labaKotor: 0, labaBersih: 0 }

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function DashboardKeuanganPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  const today = todayLocalStr()
  const [filterMonth, setFilterMonth] = useState(today.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupTotals[]>([])
  const [prevGroups, setPrevGroups] = useState<GroupTotals[]>([])
  const [consolidated, setConsolidated] = useState<GroupTotals | null>(null)
  const [prevConsolidated, setPrevConsolidated] = useState<GroupTotals | null>(null)
  const [asOf, setAsOf] = useState<string>('')

  const isAdmin = ADMIN_ROLES.includes(role)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setRoleLoading(false); return }
      const { data: userRow } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (userRow) {
        setRole(userRow.role)
        if (userRow.employee_id) {
          const { data: emp } = await supabase.from('employees').select('branch_id').eq('id', userRow.employee_id).single()
          if (emp) setMyBranchId(emp.branch_id)
        }
      }
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  const computeTotals = useCallback(async (startDate: string, endDate: string, month: number, year: number): Promise<{ groups: GroupTotals[]; consolidated: GroupTotals }> => {
    const [groupsRes, cashInRes, hppRes, cashOutRes, kasbonRes] = await Promise.all([
      supabase.from('fin_branch_report_groups').select('branch_id, report_group_label'),
      supabase.from('fin_cash_in').select('branch_id, amount').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').gte('entry_date', startDate).lte('entry_date', endDate),
      supabase.from('fin_cash_out').select('branch_id, amount, fin_cash_out_categories(affects_net_profit)').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      // Kasbon yang terpotong dari gaji (dilunasi) periode ini — bukan kas keluar baru
      // (kasbon-nya sudah tercatat kas keluar saat dicairkan), tapi baru DI SINI beban
      // gajinya benar-benar diakui penuh. Tidak menyentuh fin_cash_out sama sekali.
      supabase.from('payrolls').select('kasbon_deduction, employees(branch_id)').eq('status', 'paid').eq('period_month', month).eq('period_year', year).gt('kasbon_deduction', 0),
    ])

    if (groupsRes.error) console.error('Detail error report_groups:', JSON.stringify(groupsRes.error, null, 2))
    if (cashInRes.error) console.error('Detail error cash_in:', JSON.stringify(cashInRes.error, null, 2))
    if (hppRes.error) console.error('Detail error hpp:', JSON.stringify(hppRes.error, null, 2))
    if (cashOutRes.error) console.error('Detail error cash_out:', JSON.stringify(cashOutRes.error, null, 2))
    if (kasbonRes.error) console.error('Detail error kasbon:', JSON.stringify(kasbonRes.error, null, 2))

    const branchToGroup = new Map<string, string>()
    for (const g of (groupsRes.data as ReportGroup[]) || []) branchToGroup.set(g.branch_id, g.report_group_label)

    const totalsByGroup = new Map<string, { kasMasuk: number; hpp: number; biayaOperasional: number; kasbonRealisasi: number }>()
    function ensure(label: string) {
      if (!totalsByGroup.has(label)) totalsByGroup.set(label, { kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0 })
      return totalsByGroup.get(label)!
    }

    for (const row of (cashInRes.data as { branch_id: string; amount: number }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (!label) continue
      ensure(label).kasMasuk += Number(row.amount)
    }
    for (const row of (hppRes.data as { branch_id: string; hpp_amount: number }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (!label) continue
      ensure(label).hpp += Number(row.hpp_amount)
    }
    for (const row of (cashOutRes.data as unknown as { branch_id: string; amount: number; fin_cash_out_categories: { affects_net_profit: boolean } | null }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (!label) continue
      // restock/kategori affects_net_profit=false TIDAK dihitung sebagai biaya operasional (mencegah hitung ganda dengan HPP)
      if (row.fin_cash_out_categories?.affects_net_profit !== false) {
        ensure(label).biayaOperasional += Number(row.amount)
      }
    }
    for (const row of (kasbonRes.data as unknown as { kasbon_deduction: number; employees: { branch_id: string } | null }[]) || []) {
      const branchId = row.employees?.branch_id
      const label = branchId ? branchToGroup.get(branchId) : undefined
      if (!label) continue
      ensure(label).kasbonRealisasi += Number(row.kasbon_deduction)
    }

    let groupList: GroupTotals[] = Array.from(totalsByGroup.entries()).map(([label, t]) => ({
      label,
      kasMasuk: t.kasMasuk,
      hpp: t.hpp,
      biayaOperasional: t.biayaOperasional,
      kasbonRealisasi: t.kasbonRealisasi,
      labaKotor: t.kasMasuk - t.hpp,
      labaBersih: t.kasMasuk - t.hpp - t.biayaOperasional - t.kasbonRealisasi,
    }))

    // Supervisor hanya melihat kelompok laporan cabangnya sendiri (RLS sudah membatasi baris yang kembali,
    // ini filter tambahan supaya kelompok lain yang kebetulan tanpa data tidak ikut tampil kosong)
    if (!isAdmin && myBranchId) {
      const myLabel = branchToGroup.get(myBranchId)
      groupList = groupList.filter(g => g.label === myLabel)
    }

    groupList.sort((a, b) => a.label.localeCompare(b.label))

    const totalKonsolidasi: GroupTotals = groupList.reduce((acc, g) => ({
      label: 'Total Konsolidasi',
      kasMasuk: acc.kasMasuk + g.kasMasuk,
      hpp: acc.hpp + g.hpp,
      biayaOperasional: acc.biayaOperasional + g.biayaOperasional,
      kasbonRealisasi: acc.kasbonRealisasi + g.kasbonRealisasi,
      labaKotor: acc.labaKotor + g.labaKotor,
      labaBersih: acc.labaBersih + g.labaBersih,
    }), { label: 'Total Konsolidasi', ...EMPTY_TOTALS })

    return { groups: groupList, consolidated: totalKonsolidasi }
  }, [supabase, isAdmin, myBranchId])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = localDateStr(new Date(year, month - 1, 1))
    const endDate = localDateStr(new Date(year, month, 0))

    const prevMonthStr = shiftMonth(filterMonth, -1)
    const [prevYear, prevMonth] = prevMonthStr.split('-').map(Number)
    const prevStartDate = localDateStr(new Date(prevYear, prevMonth - 1, 1))
    const prevEndDate = localDateStr(new Date(prevYear, prevMonth, 0))

    const [cur, prev] = await Promise.all([
      computeTotals(startDate, endDate, month, year),
      computeTotals(prevStartDate, prevEndDate, prevMonth, prevYear),
    ])

    setGroups(cur.groups)
    setConsolidated(cur.consolidated)
    setPrevGroups(prev.groups)
    setPrevConsolidated(prev.consolidated)
    setAsOf(new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))
    setLoading(false)
  }, [filterMonth, computeTotals])

  useEffect(() => { if (!roleLoading) fetchData() }, [roleLoading, fetchData])

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  function variance(cur: number, prev: number) {
    const diff = cur - prev
    const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : (cur !== 0 ? 100 : 0)
    return { diff, pct }
  }

  function VarianceBadge({ cur, prev }: { cur: number; prev: number }) {
    const { diff, pct } = variance(cur, prev)
    if (diff === 0 && prev === 0) return <span className="text-xs text-slate-400">—</span>
    const positive = diff >= 0
    return (
      <span className={`text-xs font-medium ${positive ? 'text-green-600' : 'text-red-600'}`}>
        {positive ? '▲' : '▼'} {formatRupiah(Math.abs(diff))} ({pct >= 0 ? '+' : ''}{pct.toFixed(0)}%)
      </span>
    )
  }

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Dashboard Keuangan</h1>
          <p className="text-sm text-slate-500">Laba Kotor & Laba Bersih live berdasarkan data yang sudah disetujui. Laba Kotor = Kas Masuk − HPP. Laba Bersih = Laba Kotor − Biaya Operasional (restock dikecualikan) − Realisasi Kasbon dari gaji yang lunas.</p>
          <p className="text-xs text-slate-400 mt-1">
            Ini ringkasan cepat bulan berjalan. Butuh laporan mingguan atau file unduhan (CSV) untuk pajak/arsip? Buka{' '}
            <Link href="/keuangan/laporan" className="text-blue-600 hover:underline font-medium">Laporan Resmi</Link>.
          </p>
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
          {isAdmin && consolidated && prevConsolidated && (
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-blue-200">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-bold text-slate-800">Total Konsolidasi (Seluruh Bisnis)</h2>
                <span className="text-xs text-slate-400">per {asOf}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Kas Masuk</p>
                  <p className="text-lg font-semibold text-slate-800">{formatRupiah(consolidated.kasMasuk)}</p>
                  <VarianceBadge cur={consolidated.kasMasuk} prev={prevConsolidated.kasMasuk} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">HPP</p>
                  <p className="text-lg font-semibold text-slate-800">{formatRupiah(consolidated.hpp)}</p>
                  <VarianceBadge cur={consolidated.hpp} prev={prevConsolidated.hpp} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Laba Kotor</p>
                  <p className="text-lg font-semibold text-blue-700">{formatRupiah(consolidated.labaKotor)}</p>
                  <VarianceBadge cur={consolidated.labaKotor} prev={prevConsolidated.labaKotor} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-center">Biaya Operasional
                    <InfoTooltip text="Tidak termasuk pembelian stok/restock ke supplier (Gudang/Hammielion) — itu sudah dihitung di HPP, supaya tidak dihitung dobel." />
                  </p>
                  <p className="text-lg font-semibold text-slate-800">{formatRupiah(consolidated.biayaOperasional)}</p>
                  <VarianceBadge cur={consolidated.biayaOperasional} prev={prevConsolidated.biayaOperasional} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-center">Realisasi Kasbon
                    <InfoTooltip text="Uang kasbon sudah keluar duluan saat dicairkan ke karyawan. Di sini dihitung SEBAGAI BIAYA baru saat gajinya benar-benar lunas dan potongannya jalan — bukan dihitung dua kali, cuma waktu pengakuannya beda." />
                  </p>
                  <p className="text-lg font-semibold text-amber-700">{formatRupiah(consolidated.kasbonRealisasi)}</p>
                  <VarianceBadge cur={consolidated.kasbonRealisasi} prev={prevConsolidated.kasbonRealisasi} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Laba Bersih</p>
                  <p className={`text-lg font-bold ${consolidated.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(consolidated.labaBersih)}</p>
                  <VarianceBadge cur={consolidated.labaBersih} prev={prevConsolidated.labaBersih} />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">Dibanding bulan sebelumnya ({shiftMonth(filterMonth, -1)}).</p>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-600 uppercase">Per Kelompok Laporan</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kelompok</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Kas Masuk</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">HPP</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Laba Kotor</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">
                      <span className="inline-flex items-center justify-end">Biaya Operasional
                        <InfoTooltip text="Tidak termasuk pembelian stok/restock ke supplier — sudah dihitung di HPP, supaya tidak dobel." />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">
                      <span className="inline-flex items-center justify-end">Realisasi Kasbon
                        <InfoTooltip text="Baru dihitung sebagai biaya saat gajinya lunas, meski uangnya sudah keluar duluan saat kasbon dicairkan. Bukan dobel hitung." />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Laba Bersih (vs bulan lalu)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data disetujui untuk bulan ini.</td></tr>
                  ) : groups.map(g => {
                    const prev = prevGroups.find(p => p.label === g.label) || { label: g.label, ...EMPTY_TOTALS }
                    return (
                      <tr key={g.label} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{g.label}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.kasMasuk)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.hpp)}</td>
                        <td className="px-4 py-3 text-sm text-right font-semibold text-blue-700">{formatRupiah(g.labaKotor)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.biayaOperasional)}</td>
                        <td className="px-4 py-3 text-sm text-right text-amber-700">{formatRupiah(g.kasbonRealisasi)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className={`text-sm font-bold ${g.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(g.labaBersih)}</div>
                          <VarianceBadge cur={g.labaBersih} prev={prev.labaBersih} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400 mt-3">Hanya menghitung entri berstatus &quot;Disetujui&quot;. Entri yang masih menunggu verifikasi belum masuk perhitungan ini.</p>
        </>
      )}
    </div>
  )
}
