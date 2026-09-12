'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr, todayLocalStr } from '@/lib/date'
import Link from 'next/link'
import InfoTooltip from '@/components/InfoTooltip'

const ADMIN_ROLES = ['owner', 'hr', 'finance']

type ReportGroup = { branch_id: string; report_group_label: string }
type Branch = { id: string; name: string }
type GroupTotals = {
  label: string
  kasMasuk: number
  hpp: number
  biayaOperasional: number
  kasbonRealisasi: number
  labaKotor: number
  labaBersih: number
  omsetSistem: number
  pembayaranSupplierReal: number
  belanjaSupplier: number
  totalKasKeluar: number
}

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function LaporanResmiPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)
  const isAdmin = ADMIN_ROLES.includes(role)

  const today = todayLocalStr()
  const [month, setMonth] = useState(today.slice(0, 7))

  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupTotals[]>([])
  const [prevGroups, setPrevGroups] = useState<GroupTotals[]>([])
  const [consolidated, setConsolidated] = useState<GroupTotals | null>(null)
  const [prevConsolidated, setPrevConsolidated] = useState<GroupTotals | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [exporting, setExporting] = useState(false)
  const [saldoAwalReal, setSaldoAwalReal] = useState<number | null>(null)

  // Pengeluaran per Kategori per Cabang — matriks kategori x cabang, cuma total bulan berjalan
  // (tanpa pembanding bulan lalu, beda tujuan dari tabel "Per Kelompok Laporan" di atas: ini
  // untuk perbandingan ANTAR CABANG, bukan tren waktu).
  const [cashOutCategories, setCashOutCategories] = useState<{ code: string; label: string; affects_net_profit: boolean }[]>([])
  const [categoryBreakdown, setCategoryBreakdown] = useState<{ code: string; label: string; totals: Map<string, number>; total: number }[]>([])

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
      const { data: bRes } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      if (bRes) setBranches(bRes)
      const { data: catRes } = await supabase.from('fin_cash_out_categories').select('code, label, affects_net_profit')
      if (catRes) setCashOutCategories(catRes)
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  const computeTotals = useCallback(async (startDate: string, endDate: string, periodMonth: number, periodYear: number): Promise<{ groups: GroupTotals[]; consolidated: GroupTotals }> => {
    const [groupsRes, cashInRes, hppRes, omsetSistemRes, cashOutRes, supplierRes, kasbonRes, belanjaSupplierRes] = await Promise.all([
      supabase.from('fin_branch_report_groups').select('branch_id, report_group_label'),
      supabase.from('fin_cash_in').select('branch_id, amount').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').eq('entry_type', 'hpp').gte('entry_date', startDate).lte('entry_date', endDate),
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').eq('entry_type', 'omset').gte('entry_date', startDate).lte('entry_date', endDate),
      supabase.from('fin_cash_out').select('branch_id, amount, fin_cash_out_categories(affects_net_profit)').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('fin_cash_out').select('branch_id, amount').eq('status', 'approved').eq('category', 'pembayaran_supplier').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('payrolls').select('kasbon_deduction, employees(branch_id)').eq('status', 'paid').eq('period_month', periodMonth).eq('period_year', periodYear).gt('kasbon_deduction', 0),
      // Belanja ke Supplier (Nota) — dari nota pembelian bulan ini, BEDA dari pembayaran (supplierRes
      // di atas), yang basisnya kapan uangnya benar-benar dibayar, bisa beda bulan dari nota-nya.
      supabase.from('supplier_purchases').select('branch_id, total_amount').gte('purchase_date', startDate).lte('purchase_date', endDate),
    ])
    if (groupsRes.error) console.error('Detail error report_groups:', JSON.stringify(groupsRes.error, null, 2))
    if (cashInRes.error) console.error('Detail error cash_in:', JSON.stringify(cashInRes.error, null, 2))
    if (hppRes.error) console.error('Detail error hpp:', JSON.stringify(hppRes.error, null, 2))
    if (omsetSistemRes.error) console.error('Detail error omset_sistem:', JSON.stringify(omsetSistemRes.error, null, 2))
    if (cashOutRes.error) console.error('Detail error cash_out:', JSON.stringify(cashOutRes.error, null, 2))
    if (supplierRes.error) console.error('Detail error supplier:', JSON.stringify(supplierRes.error, null, 2))
    if (kasbonRes.error) console.error('Detail error kasbon:', JSON.stringify(kasbonRes.error, null, 2))
    if (belanjaSupplierRes.error) console.error('Detail error belanja_supplier:', JSON.stringify(belanjaSupplierRes.error, null, 2))

    const branchToGroup = new Map<string, string>()
    for (const g of (groupsRes.data as ReportGroup[]) || []) branchToGroup.set(g.branch_id, g.report_group_label)

    const totalsByGroup = new Map<string, { kasMasuk: number; hpp: number; biayaOperasional: number; kasbonRealisasi: number; omsetSistem: number; pembayaranSupplierReal: number; belanjaSupplier: number; totalKasKeluar: number }>()
    function ensure(label: string) {
      if (!totalsByGroup.has(label)) totalsByGroup.set(label, { kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0, omsetSistem: 0, pembayaranSupplierReal: 0, belanjaSupplier: 0, totalKasKeluar: 0 })
      return totalsByGroup.get(label)!
    }
    for (const row of (cashInRes.data as { branch_id: string; amount: number }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (label) ensure(label).kasMasuk += Number(row.amount)
    }
    for (const row of (hppRes.data as { branch_id: string; hpp_amount: number }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (label) ensure(label).hpp += Number(row.hpp_amount)
    }
    for (const row of (omsetSistemRes.data as { branch_id: string; hpp_amount: number }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (label) ensure(label).omsetSistem += Number(row.hpp_amount)
    }
    for (const row of (cashOutRes.data as unknown as { branch_id: string; amount: number; fin_cash_out_categories: { affects_net_profit: boolean } | null }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (!label) continue
      // totalKasKeluar = SEMUA kategori (dasar hitung Kas Sesungguhnya di bawah — cuma uang yang
      // benar-benar sudah keluar yang boleh mengurangi, utang belanja yang belum dibayar TIDAK).
      ensure(label).totalKasKeluar += Number(row.amount)
      if (row.fin_cash_out_categories?.affects_net_profit !== false) ensure(label).biayaOperasional += Number(row.amount)
    }
    for (const row of (supplierRes.data as { branch_id: string; amount: number }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (label) ensure(label).pembayaranSupplierReal += Number(row.amount)
    }
    for (const row of (kasbonRes.data as unknown as { kasbon_deduction: number; employees: { branch_id: string } | null }[]) || []) {
      const branchId = row.employees?.branch_id
      const label = branchId ? branchToGroup.get(branchId) : undefined
      if (!label) continue
      ensure(label).kasbonRealisasi += Number(row.kasbon_deduction)
    }
    for (const row of (belanjaSupplierRes.data as { branch_id: string; total_amount: number }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (label) ensure(label).belanjaSupplier += Number(row.total_amount)
    }

    let groupList: GroupTotals[] = Array.from(totalsByGroup.entries()).map(([label, t]) => ({
      label, kasMasuk: t.kasMasuk, hpp: t.hpp, biayaOperasional: t.biayaOperasional, kasbonRealisasi: t.kasbonRealisasi,
      omsetSistem: t.omsetSistem, pembayaranSupplierReal: t.pembayaranSupplierReal,
      belanjaSupplier: t.belanjaSupplier, totalKasKeluar: t.totalKasKeluar,
      labaKotor: t.kasMasuk - t.hpp, labaBersih: t.kasMasuk - t.hpp - t.biayaOperasional - t.kasbonRealisasi,
    }))

    if (!isAdmin && myBranchId) {
      const myLabel = branchToGroup.get(myBranchId)
      groupList = groupList.filter(g => g.label === myLabel)
    }
    groupList.sort((a, b) => a.label.localeCompare(b.label))

    const total: GroupTotals = groupList.reduce((acc, g) => ({
      label: 'Total Konsolidasi',
      kasMasuk: acc.kasMasuk + g.kasMasuk, hpp: acc.hpp + g.hpp, biayaOperasional: acc.biayaOperasional + g.biayaOperasional,
      kasbonRealisasi: acc.kasbonRealisasi + g.kasbonRealisasi,
      omsetSistem: acc.omsetSistem + g.omsetSistem, pembayaranSupplierReal: acc.pembayaranSupplierReal + g.pembayaranSupplierReal,
      belanjaSupplier: acc.belanjaSupplier + g.belanjaSupplier, totalKasKeluar: acc.totalKasKeluar + g.totalKasKeluar,
      labaKotor: acc.labaKotor + g.labaKotor, labaBersih: acc.labaBersih + g.labaBersih,
    }), { label: 'Total Konsolidasi', kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0, omsetSistem: 0, pembayaranSupplierReal: 0, belanjaSupplier: 0, totalKasKeluar: 0, labaKotor: 0, labaBersih: 0 })

    return { groups: groupList, consolidated: total }
  }, [supabase, isAdmin, myBranchId])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const curStart = localDateStr(new Date(y, m - 1, 1))
    const curEnd = localDateStr(new Date(y, m, 0))
    const prevMonth = shiftMonth(month, -1)
    const [py, pm] = prevMonth.split('-').map(Number)
    const prevStart = localDateStr(new Date(py, pm - 1, 1))
    const prevEnd = localDateStr(new Date(py, pm, 0))

    const [cur, prev, saldoAwalRes, groupsRes, catCashOutRes] = await Promise.all([
      computeTotals(curStart, curEnd, m, y),
      computeTotals(prevStart, prevEnd, pm, py),
      // Saldo Awal (Real) cuma valid kalau ada rekening yang opening_balance_date-nya PERSIS di tanggal 1 periode ini —
      // artinya periode ini punya anchor saldo fisik yang benar-benar dihitung, bukan diperkirakan.
      supabase.from('fin_bank_accounts').select('opening_balance').eq('is_active', true).eq('opening_balance_date', curStart),
      // Buat matriks Pengeluaran per Kategori per Cabang di bawah — perlu peta cabang->kelompok
      // sendiri di sini karena computeTotals tidak mengekspos punyanya.
      supabase.from('fin_branch_report_groups').select('branch_id, report_group_label'),
      supabase.from('fin_cash_out').select('branch_id, category, amount').eq('status', 'approved').gte('transaction_date', curStart).lte('transaction_date', curEnd),
    ])
    setGroups(cur.groups)
    setConsolidated(cur.consolidated)
    setPrevGroups(prev.groups)
    setPrevConsolidated(prev.consolidated)
    setSaldoAwalReal(
      (saldoAwalRes.data && saldoAwalRes.data.length > 0)
        ? saldoAwalRes.data.reduce((s, r) => s + Number(r.opening_balance), 0)
        : null
    )

    // Pengeluaran per Kategori per Cabang — sama scope-nya dengan "Biaya Operasional" di atas
    // (kategori yang affects_net_profit=false, mis. pembelian stok ke supplier, DIKELUARKAN —
    // itu sudah dihitung di HPP, supaya total per baris tetap nyambung dengan Biaya Operasional).
    const branchToGroupForCat = new Map<string, string>()
    for (const g of (groupsRes.data as ReportGroup[]) || []) branchToGroupForCat.set(g.branch_id, g.report_group_label)
    const visibleLabels = new Set(cur.groups.map(g => g.label))
    const catInfo = new Map(cashOutCategories.map(c => [c.code, c]))
    const pivot = new Map<string, Map<string, number>>()
    for (const row of (catCashOutRes.data as { branch_id: string; category: string; amount: number }[]) || []) {
      const label = branchToGroupForCat.get(row.branch_id)
      if (!label || !visibleLabels.has(label)) continue
      const info = catInfo.get(row.category)
      if (info?.affects_net_profit === false) continue
      if (!pivot.has(row.category)) pivot.set(row.category, new Map())
      const g = pivot.get(row.category)!
      g.set(label, (g.get(label) || 0) + Number(row.amount))
    }
    const breakdownList = Array.from(pivot.entries()).map(([code, totals]) => ({
      code, label: catInfo.get(code)?.label || code, totals,
      total: Array.from(totals.values()).reduce((s, v) => s + v, 0),
    })).sort((a, b) => b.total - a.total)
    setCategoryBreakdown(breakdownList)

    setLoading(false)
  }, [month, computeTotals, supabase, cashOutCategories])

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

  // Cetak/Simpan PDF — hasil cetak selalu terang (kelas `dark` dilepas sementara, dikembalikan
  // sesudahnya), sama pola dengan Detail Laporan per Cabang. Halaman ini tidak punya bagian yang
  // collapse, jadi tidak perlu expand apapun sebelum print.
  function handlePrint() {
    const wasDark = document.documentElement.classList.contains('dark')
    if (wasDark) document.documentElement.classList.remove('dark')
    function restore() {
      if (wasDark) document.documentElement.classList.add('dark')
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    setTimeout(() => window.print(), 50)
  }

  async function handleExportOmzetPerCabang() {
    setExporting(true)
    const [y, m] = month.split('-').map(Number)
    const startDate = localDateStr(new Date(y, m - 1, 1))
    const endDate = localDateStr(new Date(y, m, 0))

    const [cashInRes, hppRes] = await Promise.all([
      supabase.from('fin_cash_in').select('branch_id, amount').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      // entry_type='hpp' wajib — tabel ini juga menyimpan baris entry_type='omset' (item #22),
      // sama seperti bug yang sempat kejadian di Dashboard Keuangan (item #39).
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').eq('entry_type', 'hpp').gte('entry_date', startDate).lte('entry_date', endDate),
    ])

    const omzetByBranch = new Map<string, number>()
    const hppByBranch = new Map<string, number>()
    for (const row of (cashInRes.data as { branch_id: string; amount: number }[]) || []) {
      omzetByBranch.set(row.branch_id, (omzetByBranch.get(row.branch_id) || 0) + Number(row.amount))
    }
    for (const row of (hppRes.data as { branch_id: string; hpp_amount: number }[]) || []) {
      hppByBranch.set(row.branch_id, (hppByBranch.get(row.branch_id) || 0) + Number(row.hpp_amount))
    }

    const rows = [['Cabang', 'Bulan', 'Omzet (Kas Masuk Disetujui)', 'HPP', 'Laba Kotor']]
    for (const b of branches) {
      const omzet = omzetByBranch.get(b.id) || 0
      const hpp = hppByBranch.get(b.id) || 0
      rows.push([b.name, month, String(omzet), String(hpp), String(omzet - hpp)])
    }
    const totalOmzet = branches.reduce((acc, b) => acc + (omzetByBranch.get(b.id) || 0), 0)
    const totalHpp = branches.reduce((acc, b) => acc + (hppByBranch.get(b.id) || 0), 0)
    rows.push(['TOTAL', month, String(totalOmzet), String(totalHpp), String(totalOmzet - totalHpp)])

    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `omzet-per-cabang-${month}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Laporan Resmi</h1>
          <p className="text-sm text-slate-500 print:hidden">Laporan P&L per kelompok laporan dengan perbandingan periode sebelumnya, berdasarkan data yang sudah disetujui.</p>
          <p className="text-xs text-slate-400 mt-1 print:hidden">
            Ini versi lengkap (per bulan + ekspor CSV). Untuk sekilas lihat laba bulan ini saja, buka{' '}
            <Link href="/keuangan/dashboard" className="text-blue-600 hover:underline font-medium">Dashboard Keuangan</Link>.
          </p>
          <p className="hidden print:block text-xs text-slate-500 mt-1">Hammielion HRIS — {new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })} — Dicetak {new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}</p>
        </div>
        {!loading && (
          <button onClick={handlePrint}
            className="print:hidden px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg shadow-sm transition whitespace-nowrap">
            🖨️ Cetak / Simpan PDF
          </button>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Bulan</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white" />
          </div>
          <p className="text-xs text-slate-400 pb-2">Dibanding bulan sebelumnya ({shiftMonth(month, -1)})</p>
        </div>
        {isAdmin && (
          <button onClick={handleExportOmzetPerCabang} disabled={exporting}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
            {exporting ? 'Menyiapkan...' : '⬇ Ekspor Omzet per Cabang (CSV)'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-500">Memuat data...</div>
      ) : (
        <>
          {isAdmin && consolidated && prevConsolidated && (
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-blue-200 print:break-inside-avoid">
              <h2 className="text-lg font-bold text-slate-800 mb-3">Total Konsolidasi (Seluruh Bisnis)</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Kas Masuk</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.kasMasuk)}</p>
                  <VarianceBadge cur={consolidated.kasMasuk} prev={prevConsolidated.kasMasuk} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">HPP</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.hpp)}</p>
                  <VarianceBadge cur={consolidated.hpp} prev={prevConsolidated.hpp} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Laba Kotor</p>
                  <p className="text-lg font-semibold text-blue-700 whitespace-nowrap">{formatRupiah(consolidated.labaKotor)}</p>
                  <VarianceBadge cur={consolidated.labaKotor} prev={prevConsolidated.labaKotor} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Biaya Operasional
                    <InfoTooltip text="Tidak termasuk pembelian stok/restock ke supplier (Gudang/Hammielion) — itu sudah dihitung di HPP, supaya tidak dihitung dobel." />
                  </p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.biayaOperasional)}</p>
                  <VarianceBadge cur={consolidated.biayaOperasional} prev={prevConsolidated.biayaOperasional} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Realisasi Kasbon
                    <InfoTooltip text="Uang kasbon sudah keluar duluan saat dicairkan ke karyawan. Di sini dihitung SEBAGAI BIAYA baru saat gajinya benar-benar lunas dan potongannya jalan — bukan dihitung dua kali, cuma waktu pengakuannya beda." />
                  </p>
                  <p className="text-lg font-semibold text-amber-700 whitespace-nowrap">{formatRupiah(consolidated.kasbonRealisasi)}</p>
                  <VarianceBadge cur={consolidated.kasbonRealisasi} prev={prevConsolidated.kasbonRealisasi} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Kas Sesungguhnya (Real)
                    <InfoTooltip text="Kas Masuk dikurangi SEMUA kas keluar yang benar-benar sudah dibayar bulan ini (termasuk pembayaran ke supplier). Utang belanja yang belum dibayar TIDAK ikut mengurangi — uangnya belum benar-benar keluar." />
                  </p>
                  <p className={`text-lg font-bold whitespace-nowrap ${(consolidated.kasMasuk - consolidated.totalKasKeluar) >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{formatRupiah(consolidated.kasMasuk - consolidated.totalKasKeluar)}</p>
                  <VarianceBadge cur={consolidated.kasMasuk - consolidated.totalKasKeluar} prev={prevConsolidated.kasMasuk - prevConsolidated.totalKasKeluar} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Laba Bersih</p>
                  <p className={`text-lg font-bold whitespace-nowrap ${consolidated.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(consolidated.labaBersih)}</p>
                  <VarianceBadge cur={consolidated.labaBersih} prev={prevConsolidated.labaBersih} />
                </div>
              </div>
            </div>
          )}

          {isAdmin && consolidated && consolidated.omsetSistem > 0 && (() => {
            const labaKotorSistem = consolidated.omsetSistem - consolidated.hpp
            const labaBersihSistem = labaKotorSistem - consolidated.biayaOperasional - consolidated.kasbonRealisasi
            const sisaKasSeharusnya = consolidated.kasMasuk - consolidated.pembayaranSupplierReal
            const selisihKecukupanKas = sisaKasSeharusnya - consolidated.biayaOperasional
            return (
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-purple-200 print:break-inside-avoid">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Omset &amp; HPP Sistem Kasir vs Kas Real</h2>
              <p className="text-xs text-slate-500 mb-4">Dari input di <Link href="/keuangan/hpp" className="text-blue-600 hover:underline">HPP &amp; Omset (Sistem)</Link>. Laba Kotor/Bersih (Sistem) lebih dipercaya daripada di panel atas (yang berbasis Kas Masuk), karena langsung dari sistem kasir — tidak terpengaruh piutang/uang yang belum cair.</p>

              <div className="px-3 py-1.5 text-[11px] font-bold text-purple-700 uppercase bg-purple-50 border border-purple-100 rounded-md mb-3">
                📊 Data Sistem (Kasir/POS)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Omset (Sistem)</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.omsetSistem)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">HPP (Sistem)</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.hpp)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Laba Kotor (Sistem)</p>
                  <p className={`text-lg font-bold whitespace-nowrap ${labaKotorSistem >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(labaKotorSistem)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Laba Bersih (Sistem)
                    <InfoTooltip text="Laba Kotor (Sistem) dikurangi Biaya Operasional (Real) & Realisasi Kasbon (dua-duanya dari bagian Kas Real di bawah, karena Sistem cuma mencatat Omset & HPP) — angka bottom line yang paling bisa dipercaya, tapi masih angka Sistem, bukan kas di tangan." />
                  </p>
                  <p className={`text-lg font-bold whitespace-nowrap ${labaBersihSistem >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(labaBersihSistem)}</p>
                </div>
              </div>

              <div className="px-3 py-1.5 text-[11px] font-bold text-blue-700 uppercase bg-blue-50 border border-blue-100 rounded-md mb-3 mt-5">
                💰 Kas Real — uang yang benar-benar sudah bergerak
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Uang Diterima (Real)
                    <InfoTooltip text="Kas Masuk yang benar-benar terkumpul (dari entri harian HRIS). Selisih dengan Omset Sistem itu wajar untuk cabang yang punya piutang atau alur uang antar-cabang (mis. Gudang, Toko Pusat) — bukan berarti ada kesalahan." />
                  </p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.kasMasuk)}</p>
                  <p className={`text-xs mt-0.5 whitespace-nowrap ${consolidated.omsetSistem - consolidated.kasMasuk >= 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                    Selisih dgn Omset (Sistem): {formatRupiah(consolidated.omsetSistem - consolidated.kasMasuk)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Pembayaran Supplier (Real)
                    <InfoTooltip text="Uang yang benar-benar dibayarkan ke supplier bulan ini. Tidak dibandingkan langsung dengan HPP — bisa termasuk pelunasan utang lama, bukan cerminan HPP bulan ini." />
                  </p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.pembayaranSupplierReal)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Sisa Kas Seharusnya Ada</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(sisaKasSeharusnya)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Uang Diterima − Pembayaran Supplier</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Biaya Operasional (Real)</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.biayaOperasional)}</p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200">
                <h3 className="text-sm font-bold text-slate-700 mb-1 flex items-center">Cek Kecukupan Kas
                  <InfoTooltip text="Uang Diterima (Real) dikurangi Pembayaran Supplier (Real) = sisa kas yang seharusnya ada untuk menutup Biaya Operasional. Ini cek likuiditas bulan ini, BUKAN cek untung/rugi — bisa saja untung (Laba Bersih Sistem positif) tapi kasnya sedang defisit karena momentum bayar supplier." />
                </h3>
                <div className="grid grid-cols-1 gap-4 mt-2">
                  <div>
                    <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Selisih (Surplus/Defisit)</p>
                    <p className={`text-base font-bold whitespace-nowrap ${selisihKecukupanKas >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(selisihKecukupanKas)}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {selisihKecukupanKas >= 0 ? 'Cukup — kas bulan ini menutup Biaya Operasional.' : 'Defisit — kekurangannya ditutup dari saldo kas yang sudah ada sebelumnya, bukan dari hasil bulan ini.'}
                    </p>
                  </div>
                </div>

                {saldoAwalReal !== null && (
                  <div className="mt-4 pt-4 border-t border-dashed border-slate-200">
                    <p className="text-xs font-medium text-slate-500 mb-2 flex items-start">Dijembatani dengan Saldo Awal Real (per {new Date(month + '-01').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })})
                      <InfoTooltip text="Rekening/kas Anda punya Saldo Awal fisik (hasil hitung nyata) tepat di tanggal 1 bulan ini — dipakai sebagai anchor untuk hitung Saldo Akhir Seharusnya. Kalau nanti Anda hitung fisik lagi di akhir bulan, bandingkan dengan angka ini untuk mengecek kelengkapan pencatatan." />
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Saldo Awal (Real)</p>
                        <p className="text-base font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(saldoAwalReal)}</p>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Saldo Akhir Seharusnya (akhir periode ini)</p>
                        <p className="text-base font-bold text-blue-700 whitespace-nowrap">{formatRupiah(saldoAwalReal + selisihKecukupanKas)}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Saldo Awal + Selisih Kecukupan Kas di atas. Cocokkan dengan hitung fisik akhir bulan untuk validasi.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )
          })()}

          {(() => {
            const showSistem = !!(consolidated && consolidated.omsetSistem > 0)
            return (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:break-inside-avoid">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-600 uppercase">Per Kelompok Laporan</h2>
              <p className="text-xs text-slate-400 mt-0.5">Cabang berdampingan sebagai kolom, supaya bisa langsung dibandingkan.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse print-compact-table">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase sticky left-0 bg-white">Kelompok</th>
                    {groups.map(g => (
                      <th key={g.label} className="px-4 py-3 text-xs font-semibold text-slate-700 uppercase text-right whitespace-nowrap">
                        <Link href={`/keuangan/laporan/detail?group=${encodeURIComponent(g.label)}&month=${month}`} className="text-blue-700 hover:underline print:no-underline print:text-slate-700">
                          {g.label} <span className="text-xs print:hidden">🔍</span>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.length === 0 ? (
                    <tr><td colSpan={groups.length + 1} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data disetujui untuk periode ini.</td></tr>
                  ) : (
                    <>
                      {showSistem && (
                        <>
                          <tr>
                            <td colSpan={groups.length + 1} className="px-4 py-1.5 text-[11px] font-bold text-purple-700 uppercase bg-purple-50 border-y border-purple-100 sticky left-0">
                              📊 Data Sistem (Kasir/POS) — dari omset &amp; HPP yang dicatat sistem kasir, BUKAN uang yang sudah pasti di tangan
                            </td>
                          </tr>
                          <tr className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3 text-sm font-medium text-purple-600 whitespace-nowrap sticky left-0 bg-white">Omset (Sistem)</td>
                            {groups.map(g => (
                              <td key={g.label} className="px-4 py-3 text-sm text-right text-purple-700 whitespace-nowrap">
                                {g.omsetSistem > 0 ? formatRupiah(g.omsetSistem) : <span className="text-slate-300">—</span>}
                              </td>
                            ))}
                          </tr>
                          <tr className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3 text-sm font-medium text-purple-600 whitespace-nowrap sticky left-0 bg-white">HPP (Sistem)</td>
                            {groups.map(g => (
                              <td key={g.label} className="px-4 py-3 text-sm text-right text-purple-700 whitespace-nowrap">{formatRupiah(g.hpp)}</td>
                            ))}
                          </tr>
                          <tr className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3 text-sm font-medium text-purple-600 whitespace-nowrap sticky left-0 bg-white">
                              <span className="inline-flex items-center">Laba Kotor (Sistem)
                                <InfoTooltip text="Omset (Sistem) dikurangi HPP (Sistem) — murni dari sistem kasir, tidak terpengaruh piutang/uang yang belum cair." />
                              </span>
                            </td>
                            {groups.map(g => {
                              const labaKotorSistemGroup = g.omsetSistem - g.hpp
                              return (
                                <td key={g.label} className={`px-4 py-3 text-sm text-right font-semibold whitespace-nowrap ${g.omsetSistem > 0 ? (labaKotorSistemGroup >= 0 ? 'text-green-700' : 'text-red-700') : 'text-slate-300'}`}>
                                  {g.omsetSistem > 0 ? formatRupiah(labaKotorSistemGroup) : '—'}
                                </td>
                              )
                            })}
                          </tr>
                          <tr className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3 text-sm font-bold text-purple-700 whitespace-nowrap sticky left-0 bg-white">
                              <span className="inline-flex items-center">Laba Bersih (Sistem)
                                <InfoTooltip text="Laba Kotor (Sistem) dikurangi Biaya Operasional & Realisasi Kasbon (dua-duanya dari kelompok Kas Real di bawah, karena Sistem cuma mencatat Omset & HPP) — angka bottom line yang paling bisa dipercaya, tapi masih angka Sistem, bukan kas di tangan." />
                              </span>
                            </td>
                            {groups.map(g => {
                              const labaKotorSistemGroup = g.omsetSistem - g.hpp
                              const labaBersihSistemGroup = labaKotorSistemGroup - g.biayaOperasional - g.kasbonRealisasi
                              return (
                                <td key={g.label} className={`px-4 py-3 text-sm text-right font-bold whitespace-nowrap ${g.omsetSistem > 0 ? (labaBersihSistemGroup >= 0 ? 'text-green-700' : 'text-red-700') : 'text-slate-300'}`}>
                                  {g.omsetSistem > 0 ? formatRupiah(labaBersihSistemGroup) : '—'}
                                </td>
                              )
                            })}
                          </tr>
                        </>
                      )}

                      <tr>
                        <td colSpan={groups.length + 1} className="px-4 py-1.5 text-[11px] font-bold text-blue-700 uppercase bg-blue-50 border-y border-blue-100 sticky left-0">
                          💰 Kas Real — uang yang benar-benar sudah bergerak (tercatat masuk/keluar)
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">Kas Masuk</td>
                        {groups.map(g => (
                          <td key={g.label} className="px-4 py-3 text-sm text-right text-slate-700 whitespace-nowrap">{formatRupiah(g.kasMasuk)}</td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">
                          <span className="inline-flex items-center">Biaya Operasional
                            <InfoTooltip text="Tidak termasuk pembelian stok/restock ke supplier — itu di bagian Nota &amp; Utang Supplier di bawah, supaya tidak dobel." />
                          </span>
                        </td>
                        {groups.map(g => (
                          <td key={g.label} className="px-4 py-3 text-sm text-right text-slate-700 whitespace-nowrap">{formatRupiah(g.biayaOperasional)}</td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">
                          <span className="inline-flex items-center">Realisasi Kasbon
                            <InfoTooltip text="Baru dihitung sebagai biaya saat gajinya lunas, meski uangnya sudah keluar duluan saat kasbon dicairkan. Bukan dobel hitung." />
                          </span>
                        </td>
                        {groups.map(g => (
                          <td key={g.label} className="px-4 py-3 text-sm text-right text-amber-700 whitespace-nowrap">{formatRupiah(g.kasbonRealisasi)}</td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">Dibayar ke Supplier</td>
                        {groups.map(g => (
                          <td key={g.label} className="px-4 py-3 text-sm text-right text-slate-700 whitespace-nowrap">{formatRupiah(g.pembayaranSupplierReal)}</td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition bg-blue-50/40">
                        <td className="px-4 py-3 text-sm font-bold text-slate-800 whitespace-nowrap sticky left-0 bg-blue-50">
                          <span className="inline-flex items-center">Kas Sesungguhnya (Real)
                            <InfoTooltip text="Kas Masuk dikurangi SEMUA kas keluar yang benar-benar sudah dibayar bulan ini (termasuk Dibayar ke Supplier). Utang yang belum dibayar (lihat bagian Nota & Utang Supplier di bawah) TIDAK ikut mengurangi — uangnya belum benar-benar keluar dari kas. Ini angka yang paling dekat dengan 'uang di tangan cabang sekarang'." />
                          </span>
                        </td>
                        {groups.map(g => {
                          const kasSesungguhnya = g.kasMasuk - g.totalKasKeluar
                          return (
                            <td key={g.label} className={`px-4 py-3 text-sm text-right font-bold whitespace-nowrap ${kasSesungguhnya >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{formatRupiah(kasSesungguhnya)}</td>
                          )
                        })}
                      </tr>

                      <tr>
                        <td colSpan={groups.length + 1} className="px-4 py-1.5 text-[11px] font-bold text-amber-700 uppercase bg-amber-50 border-y border-amber-100 sticky left-0">
                          📝 Nota &amp; Utang Supplier — sudah jadi transaksi nyata, tapi belum tentu sudah jadi kas keluar
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">
                          <span className="inline-flex items-center">Belanja ke Supplier (Nota)
                            <InfoTooltip text="Total nota pembelian ke supplier bulan ini — beda dari Dibayar ke Supplier di atas (bagian Kas Real), karena nota bisa belum lunas (utang)." />
                          </span>
                        </td>
                        {groups.map(g => (
                          <td key={g.label} className="px-4 py-3 text-sm text-right text-slate-700 whitespace-nowrap">{formatRupiah(g.belanjaSupplier)}</td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">
                          <span className="inline-flex items-center">Sisa (Utang Bulan Ini)
                            <InfoTooltip text="Belanja (Nota) dikurangi Dibayar ke Supplier, dari transaksi bulan ini saja — bukan sisa utang total/akumulasi (itu ada di Detail Laporan per Cabang). Bisa minus kalau bulan ini bayar lebih banyak dari nota baru (melunasi utang lama)." />
                          </span>
                        </td>
                        {groups.map(g => {
                          const sisaBulanIni = g.belanjaSupplier - g.pembayaranSupplierReal
                          return (
                            <td key={g.label} className={`px-4 py-3 text-sm text-right font-medium whitespace-nowrap ${sisaBulanIni > 0 ? 'text-red-700' : 'text-slate-500'}`}>{formatRupiah(sisaBulanIni)}</td>
                          )
                        })}
                      </tr>

                      <tr>
                        <td colSpan={groups.length + 1} className="px-4 py-1.5 text-[11px] font-bold text-slate-600 uppercase bg-slate-100 border-y border-slate-200 sticky left-0">
                          🔀 Laba Campuran (Kas Masuk − HPP Sistem) — selalu ada angkanya meski Sistem belum lengkap, tapi mencampur dua sumber berbeda
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">Laba Kotor</td>
                        {groups.map(g => (
                          <td key={g.label} className="px-4 py-3 text-sm text-right font-semibold text-slate-700 whitespace-nowrap">{formatRupiah(g.labaKotor)}</td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-600 whitespace-nowrap sticky left-0 bg-white">Laba Bersih (vs periode lalu)</td>
                        {groups.map(g => {
                          const prev = prevGroups.find(p => p.label === g.label) || { label: g.label, kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0, omsetSistem: 0, pembayaranSupplierReal: 0, belanjaSupplier: 0, totalKasKeluar: 0, labaKotor: 0, labaBersih: 0 }
                          return (
                            <td key={g.label} className="px-4 py-3 text-right whitespace-nowrap">
                              <div className={`text-sm font-bold ${g.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(g.labaBersih)}</div>
                              <VarianceBadge cur={g.labaBersih} prev={prev.labaBersih} />
                            </td>
                          )
                        })}
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
            )
          })()}

          {groups.length > 0 && (
            <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50">
                <h2 className="text-sm font-semibold text-slate-600 uppercase">Pengeluaran per Kategori per Cabang</h2>
                <p className="text-xs text-slate-400 mt-0.5">Total per kategori, sisi berdampingan tiap cabang — untuk lihat perbandingan langsung antar cabang, bukan tren dari waktu ke waktu. Sama scope-nya dengan Biaya Operasional (tidak termasuk pembelian stok ke supplier, sudah dihitung di HPP).</p>
              </div>
              {categoryBreakdown.length === 0 ? (
                <div className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pengeluaran untuk periode ini.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse print-compact-table">
                    <thead>
                      <tr className="bg-white border-b border-slate-200">
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase sticky left-0 bg-white">Kategori</th>
                        {groups.map(g => (
                          <th key={g.label} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">{g.label}</th>
                        ))}
                        <th className="px-4 py-3 text-xs font-semibold text-slate-700 uppercase text-right whitespace-nowrap">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {categoryBreakdown.map(row => (
                        <tr key={row.code} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 text-sm font-medium text-slate-800 whitespace-nowrap sticky left-0 bg-white">{row.label}</td>
                          {groups.map(g => {
                            const v = row.totals.get(g.label) || 0
                            return (
                              <td key={g.label} className="px-4 py-2.5 text-sm text-right whitespace-nowrap text-slate-700">
                                {v > 0 ? formatRupiah(v) : <span className="text-slate-300">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-4 py-2.5 text-sm text-right font-semibold text-red-700 whitespace-nowrap">{formatRupiah(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t-2 border-slate-200">
                        <td className="px-4 py-3 text-sm font-bold text-slate-800 sticky left-0 bg-slate-50">Total</td>
                        {groups.map(g => {
                          const colTotal = categoryBreakdown.reduce((s, row) => s + (row.totals.get(g.label) || 0), 0)
                          return <td key={g.label} className="px-4 py-3 text-sm text-right font-bold text-slate-800 whitespace-nowrap">{formatRupiah(colTotal)}</td>
                        })}
                        <td className="px-4 py-3 text-sm text-right font-bold text-red-800 whitespace-nowrap">{formatRupiah(categoryBreakdown.reduce((s, row) => s + row.total, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-slate-400 mt-3">Hanya menghitung entri berstatus &quot;Disetujui&quot;. Ekspor CSV omzet per cabang memakai data per cabang asli, bukan per kelompok laporan gabungan — sesuai kebutuhan pelaporan pajak.</p>
        </>
      )}
    </div>
  )
}
