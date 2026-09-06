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
}

type Tab = 'mingguan' | 'bulanan'

function isoWeekRange(weekStr: string): { start: string; end: string } {
  // weekStr format dari <input type="week">: "2026-W27"
  const [yearStr, weekPart] = weekStr.split('-W')
  const year = Number(yearStr)
  const week = Number(weekPart)
  // ISO week: cari hari Kamis di minggu itu untuk menentukan tahun ISO dengan benar
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  const dayOfWeek = simple.getUTCDay() || 7
  const isoMonday = new Date(simple)
  isoMonday.setUTCDate(simple.getUTCDate() - dayOfWeek + 1)
  const isoSunday = new Date(isoMonday)
  isoSunday.setUTCDate(isoMonday.getUTCDate() + 6)
  return { start: isoMonday.toISOString().split('T')[0], end: isoSunday.toISOString().split('T')[0] }
}

function getCurrentIsoWeek(): string {
  const now = new Date()
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function shiftWeek(weekStr: string, delta: number): string {
  const { start } = isoWeekRange(weekStr)
  const d = new Date(start + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta * 7)
  // hitung ulang ISO week dari tanggal baru
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
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

  const [tab, setTab] = useState<Tab>('mingguan')
  const [week, setWeek] = useState(getCurrentIsoWeek())
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
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  const computeTotals = useCallback(async (startDate: string, endDate: string, periodMonth?: number, periodYear?: number): Promise<{ groups: GroupTotals[]; consolidated: GroupTotals }> => {
    const [groupsRes, cashInRes, hppRes, omsetSistemRes, cashOutRes, supplierRes, kasbonRes] = await Promise.all([
      supabase.from('fin_branch_report_groups').select('branch_id, report_group_label'),
      supabase.from('fin_cash_in').select('branch_id, amount').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').eq('entry_type', 'hpp').gte('entry_date', startDate).lte('entry_date', endDate),
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').eq('entry_type', 'omset').gte('entry_date', startDate).lte('entry_date', endDate),
      supabase.from('fin_cash_out').select('branch_id, amount, fin_cash_out_categories(affects_net_profit)').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('fin_cash_out').select('branch_id, amount').eq('status', 'approved').eq('category', 'pembayaran_supplier').gte('transaction_date', startDate).lte('transaction_date', endDate),
      // Realisasi kasbon cuma berlaku untuk tampilan bulanan (periodMonth/periodYear diisi) —
      // tidak diikutkan untuk mingguan karena periode gaji tidak selaras dengan minggu.
      periodMonth && periodYear
        ? supabase.from('payrolls').select('kasbon_deduction, employees(branch_id)').eq('status', 'paid').eq('period_month', periodMonth).eq('period_year', periodYear).gt('kasbon_deduction', 0)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (groupsRes.error) console.error('Detail error report_groups:', JSON.stringify(groupsRes.error, null, 2))
    if (cashInRes.error) console.error('Detail error cash_in:', JSON.stringify(cashInRes.error, null, 2))
    if (hppRes.error) console.error('Detail error hpp:', JSON.stringify(hppRes.error, null, 2))
    if (omsetSistemRes.error) console.error('Detail error omset_sistem:', JSON.stringify(omsetSistemRes.error, null, 2))
    if (cashOutRes.error) console.error('Detail error cash_out:', JSON.stringify(cashOutRes.error, null, 2))
    if (supplierRes.error) console.error('Detail error supplier:', JSON.stringify(supplierRes.error, null, 2))
    if (kasbonRes.error) console.error('Detail error kasbon:', JSON.stringify(kasbonRes.error, null, 2))

    const branchToGroup = new Map<string, string>()
    for (const g of (groupsRes.data as ReportGroup[]) || []) branchToGroup.set(g.branch_id, g.report_group_label)

    const totalsByGroup = new Map<string, { kasMasuk: number; hpp: number; biayaOperasional: number; kasbonRealisasi: number; omsetSistem: number; pembayaranSupplierReal: number }>()
    function ensure(label: string) {
      if (!totalsByGroup.has(label)) totalsByGroup.set(label, { kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0, omsetSistem: 0, pembayaranSupplierReal: 0 })
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

    let groupList: GroupTotals[] = Array.from(totalsByGroup.entries()).map(([label, t]) => ({
      label, kasMasuk: t.kasMasuk, hpp: t.hpp, biayaOperasional: t.biayaOperasional, kasbonRealisasi: t.kasbonRealisasi,
      omsetSistem: t.omsetSistem, pembayaranSupplierReal: t.pembayaranSupplierReal,
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
      labaKotor: acc.labaKotor + g.labaKotor, labaBersih: acc.labaBersih + g.labaBersih,
    }), { label: 'Total Konsolidasi', kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0, omsetSistem: 0, pembayaranSupplierReal: 0, labaKotor: 0, labaBersih: 0 })

    return { groups: groupList, consolidated: total }
  }, [supabase, isAdmin, myBranchId])

  const fetchData = useCallback(async () => {
    setLoading(true)
    let curStart: string, curEnd: string, prevStart: string, prevEnd: string
    let curPeriod: [number, number] | null = null
    let prevPeriod: [number, number] | null = null

    if (tab === 'mingguan') {
      const cur = isoWeekRange(week)
      const prev = isoWeekRange(shiftWeek(week, -1))
      curStart = cur.start; curEnd = cur.end; prevStart = prev.start; prevEnd = prev.end
    } else {
      const [y, m] = month.split('-').map(Number)
      curStart = localDateStr(new Date(y, m - 1, 1))
      curEnd = localDateStr(new Date(y, m, 0))
      curPeriod = [m, y]
      const prevMonth = shiftMonth(month, -1)
      const [py, pm] = prevMonth.split('-').map(Number)
      prevStart = localDateStr(new Date(py, pm - 1, 1))
      prevEnd = localDateStr(new Date(py, pm, 0))
      prevPeriod = [pm, py]
    }

    const [cur, prev, saldoAwalRes] = await Promise.all([
      computeTotals(curStart, curEnd, curPeriod?.[0], curPeriod?.[1]),
      computeTotals(prevStart, prevEnd, prevPeriod?.[0], prevPeriod?.[1]),
      // Saldo Awal (Real) cuma valid kalau ada rekening yang opening_balance_date-nya PERSIS di tanggal 1 periode ini —
      // artinya periode ini punya anchor saldo fisik yang benar-benar dihitung, bukan diperkirakan.
      supabase.from('fin_bank_accounts').select('opening_balance').eq('is_active', true).eq('opening_balance_date', curStart),
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
    setLoading(false)
  }, [tab, week, month, computeTotals, supabase])

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

  async function handleExportOmzetPerCabang() {
    setExporting(true)
    const [y, m] = month.split('-').map(Number)
    const startDate = localDateStr(new Date(y, m - 1, 1))
    const endDate = localDateStr(new Date(y, m, 0))

    const [cashInRes, hppRes] = await Promise.all([
      supabase.from('fin_cash_in').select('branch_id, amount').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').gte('entry_date', startDate).lte('entry_date', endDate),
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Laporan Resmi</h1>
        <p className="text-sm text-slate-500">Laporan P&L per kelompok laporan dengan perbandingan periode sebelumnya, berdasarkan data yang sudah disetujui.</p>
        <p className="text-xs text-slate-400 mt-1">
          Ini versi lengkap (mingguan/bulanan + ekspor CSV). Untuk sekilas lihat laba bulan ini saja, buka{' '}
          <Link href="/keuangan/dashboard" className="text-blue-600 hover:underline font-medium">Dashboard Keuangan</Link>.
        </p>
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-6">
        {(['mingguan', 'bulanan'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'mingguan' ? 'Laporan Mingguan' : 'Laporan Bulanan'}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-end gap-3">
          {tab === 'mingguan' ? (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Minggu</label>
              <input type="week" value={week} onChange={e => setWeek(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white" />
            </div>
          ) : (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Bulan</label>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white" />
            </div>
          )}
          <p className="text-xs text-slate-400 pb-2">
            {tab === 'mingguan'
              ? `${isoWeekRange(week).start} s/d ${isoWeekRange(week).end}, dibanding minggu sebelumnya`
              : `Dibanding bulan sebelumnya (${shiftMonth(month, -1)})`}
          </p>
        </div>
        {tab === 'bulanan' && isAdmin && (
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
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-blue-200">
              <h2 className="text-lg font-bold text-slate-800 mb-3">Total Konsolidasi (Seluruh Bisnis)</h2>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
                  {tab === 'mingguan' && <p className="text-[10px] text-slate-400 mt-0.5">Cuma dihitung di tampilan bulanan</p>}
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Laba Bersih</p>
                  <p className={`text-lg font-bold whitespace-nowrap ${consolidated.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(consolidated.labaBersih)}</p>
                  <VarianceBadge cur={consolidated.labaBersih} prev={prevConsolidated.labaBersih} />
                </div>
              </div>
            </div>
          )}

          {isAdmin && tab === 'bulanan' && consolidated && consolidated.omsetSistem > 0 && (() => {
            const labaKotorSistem = consolidated.omsetSistem - consolidated.hpp
            const labaBersihSistem = labaKotorSistem - consolidated.biayaOperasional - consolidated.kasbonRealisasi
            const sisaKasSeharusnya = consolidated.kasMasuk - consolidated.pembayaranSupplierReal
            const selisihKecukupanKas = sisaKasSeharusnya - consolidated.biayaOperasional
            return (
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-purple-200">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Omset &amp; HPP Sistem Kasir vs Kas Real</h2>
              <p className="text-xs text-slate-500 mb-3">Dari input di <Link href="/keuangan/hpp" className="text-blue-600 hover:underline">HPP &amp; Omset (Sistem)</Link>. Laba Kotor/Bersih (Sistem) lebih dipercaya daripada di panel atas (yang berbasis Kas Masuk), karena langsung dari sistem kasir — tidak terpengaruh piutang/uang yang belum cair.</p>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
                    <InfoTooltip text="Laba Kotor (Sistem) dikurangi Biaya Operasional (Real) & Realisasi Kasbon — angka bottom line yang paling bisa dipercaya bulan ini." />
                  </p>
                  <p className={`text-lg font-bold whitespace-nowrap ${labaBersihSistem >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(labaBersihSistem)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Uang Diterima (Real)
                    <InfoTooltip text="Kas Masuk yang benar-benar terkumpul (dari entri harian HRIS). Selisih dengan Omset Sistem itu wajar untuk cabang yang punya piutang atau alur uang antar-cabang (mis. Gudang, Toko Pusat) — bukan berarti ada kesalahan." />
                  </p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.kasMasuk)}</p>
                  <p className={`text-xs mt-0.5 whitespace-nowrap ${consolidated.omsetSistem - consolidated.kasMasuk >= 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                    Selisih: {formatRupiah(consolidated.omsetSistem - consolidated.kasMasuk)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 flex items-start min-h-[2rem]">Pembayaran Supplier (Real)
                    <InfoTooltip text="Uang yang benar-benar dibayarkan ke supplier bulan ini. Tidak dibandingkan langsung dengan HPP — bisa termasuk pelunasan utang lama, bukan cerminan HPP bulan ini." />
                  </p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.pembayaranSupplierReal)}</p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200">
                <h3 className="text-sm font-bold text-slate-700 mb-1 flex items-center">Cek Kecukupan Kas
                  <InfoTooltip text="Uang Diterima (Real) dikurangi Pembayaran Supplier (Real) = sisa kas yang seharusnya ada untuk menutup Biaya Operasional. Ini cek likuiditas bulan ini, BUKAN cek untung/rugi — bisa saja untung (Laba Bersih Sistem positif) tapi kasnya sedang defisit karena momentum bayar supplier." />
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                  <div>
                    <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Sisa Kas Seharusnya Ada</p>
                    <p className="text-base font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(sisaKasSeharusnya)}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Uang Diterima − Pembayaran Supplier</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Biaya Operasional (Real)</p>
                    <p className="text-base font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(consolidated.biayaOperasional)}</p>
                  </div>
                  <div className="md:col-span-2">
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
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-600 uppercase">Per Kelompok Laporan</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kelompok</th>
                    {showSistem && <th className="px-4 py-3 text-xs font-semibold text-purple-600 uppercase text-right">Omset (Sistem)</th>}
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Kas Masuk</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">HPP</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Laba Kotor</th>
                    {showSistem && (
                      <th className="px-4 py-3 text-xs font-semibold text-purple-600 uppercase text-right">
                        <span className="inline-flex items-center justify-end">Laba Kotor (Sistem)
                          <InfoTooltip text="Omset (Sistem) dikurangi HPP — lebih bisa dipercaya daripada Laba Kotor di sebelahnya (berbasis Kas Masuk), karena tidak terpengaruh piutang/uang yang belum cair." />
                        </span>
                      </th>
                    )}
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
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Laba Bersih (vs periode lalu)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.length === 0 ? (
                    <tr><td colSpan={showSistem ? 9 : 7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data disetujui untuk periode ini.</td></tr>
                  ) : groups.map(g => {
                    const prev = prevGroups.find(p => p.label === g.label) || { label: g.label, kasMasuk: 0, hpp: 0, biayaOperasional: 0, kasbonRealisasi: 0, omsetSistem: 0, pembayaranSupplierReal: 0, labaKotor: 0, labaBersih: 0 }
                    const labaKotorSistemGroup = g.omsetSistem - g.hpp
                    return (
                      <tr key={g.label} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800 whitespace-nowrap">{g.label}</td>
                        {showSistem && (
                          <td className="px-4 py-3 text-sm text-right text-purple-700 whitespace-nowrap">
                            {g.omsetSistem > 0 ? formatRupiah(g.omsetSistem) : <span className="text-slate-300">—</span>}
                          </td>
                        )}
                        <td className="px-4 py-3 text-sm text-right text-slate-700 whitespace-nowrap">{formatRupiah(g.kasMasuk)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700 whitespace-nowrap">{formatRupiah(g.hpp)}</td>
                        <td className="px-4 py-3 text-sm text-right font-semibold text-blue-700 whitespace-nowrap">{formatRupiah(g.labaKotor)}</td>
                        {showSistem && (
                          <td className={`px-4 py-3 text-sm text-right font-semibold whitespace-nowrap ${g.omsetSistem > 0 ? (labaKotorSistemGroup >= 0 ? 'text-green-700' : 'text-red-700') : 'text-slate-300'}`}>
                            {g.omsetSistem > 0 ? formatRupiah(labaKotorSistemGroup) : '—'}
                          </td>
                        )}
                        <td className="px-4 py-3 text-sm text-right text-slate-700 whitespace-nowrap">{formatRupiah(g.biayaOperasional)}</td>
                        <td className="px-4 py-3 text-sm text-right text-amber-700 whitespace-nowrap">{formatRupiah(g.kasbonRealisasi)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
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
            )
          })()}

          <p className="text-xs text-slate-400 mt-3">Hanya menghitung entri berstatus &quot;Disetujui&quot;. Ekspor CSV omzet per cabang (tab Bulanan) memakai data per cabang asli, bukan per kelompok laporan gabungan — sesuai kebutuhan pelaporan pajak.</p>
        </>
      )}
    </div>
  )
}
