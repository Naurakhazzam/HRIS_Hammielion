'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

const ADMIN_ROLES = ['owner', 'hr', 'finance']

type ReportGroup = { branch_id: string; report_group_label: string }
type Branch = { id: string; name: string }
type GroupTotals = {
  label: string
  kasMasuk: number
  hpp: number
  biayaOperasional: number
  labaKotor: number
  labaBersih: number
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
  const today = new Date().toISOString().split('T')[0]
  const [month, setMonth] = useState(today.slice(0, 7))

  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupTotals[]>([])
  const [prevGroups, setPrevGroups] = useState<GroupTotals[]>([])
  const [consolidated, setConsolidated] = useState<GroupTotals | null>(null)
  const [prevConsolidated, setPrevConsolidated] = useState<GroupTotals | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [exporting, setExporting] = useState(false)

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

  const computeTotals = useCallback(async (startDate: string, endDate: string): Promise<{ groups: GroupTotals[]; consolidated: GroupTotals }> => {
    const [groupsRes, cashInRes, hppRes, cashOutRes] = await Promise.all([
      supabase.from('fin_branch_report_groups').select('branch_id, report_group_label'),
      supabase.from('fin_cash_in').select('branch_id, amount').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
      supabase.from('fin_hpp_entries').select('branch_id, hpp_amount').eq('status', 'approved').gte('entry_date', startDate).lte('entry_date', endDate),
      supabase.from('fin_cash_out').select('branch_id, amount, fin_cash_out_categories(affects_net_profit)').eq('status', 'approved').gte('transaction_date', startDate).lte('transaction_date', endDate),
    ])
    if (groupsRes.error) console.error('Detail error report_groups:', JSON.stringify(groupsRes.error, null, 2))
    if (cashInRes.error) console.error('Detail error cash_in:', JSON.stringify(cashInRes.error, null, 2))
    if (hppRes.error) console.error('Detail error hpp:', JSON.stringify(hppRes.error, null, 2))
    if (cashOutRes.error) console.error('Detail error cash_out:', JSON.stringify(cashOutRes.error, null, 2))

    const branchToGroup = new Map<string, string>()
    for (const g of (groupsRes.data as ReportGroup[]) || []) branchToGroup.set(g.branch_id, g.report_group_label)

    const totalsByGroup = new Map<string, { kasMasuk: number; hpp: number; biayaOperasional: number }>()
    function ensure(label: string) {
      if (!totalsByGroup.has(label)) totalsByGroup.set(label, { kasMasuk: 0, hpp: 0, biayaOperasional: 0 })
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
    for (const row of (cashOutRes.data as unknown as { branch_id: string; amount: number; fin_cash_out_categories: { affects_net_profit: boolean } | null }[]) || []) {
      const label = branchToGroup.get(row.branch_id)
      if (!label) continue
      if (row.fin_cash_out_categories?.affects_net_profit !== false) ensure(label).biayaOperasional += Number(row.amount)
    }

    let groupList: GroupTotals[] = Array.from(totalsByGroup.entries()).map(([label, t]) => ({
      label, kasMasuk: t.kasMasuk, hpp: t.hpp, biayaOperasional: t.biayaOperasional,
      labaKotor: t.kasMasuk - t.hpp, labaBersih: t.kasMasuk - t.hpp - t.biayaOperasional,
    }))

    if (!isAdmin && myBranchId) {
      const myLabel = branchToGroup.get(myBranchId)
      groupList = groupList.filter(g => g.label === myLabel)
    }
    groupList.sort((a, b) => a.label.localeCompare(b.label))

    const total: GroupTotals = groupList.reduce((acc, g) => ({
      label: 'Total Konsolidasi',
      kasMasuk: acc.kasMasuk + g.kasMasuk, hpp: acc.hpp + g.hpp, biayaOperasional: acc.biayaOperasional + g.biayaOperasional,
      labaKotor: acc.labaKotor + g.labaKotor, labaBersih: acc.labaBersih + g.labaBersih,
    }), { label: 'Total Konsolidasi', kasMasuk: 0, hpp: 0, biayaOperasional: 0, labaKotor: 0, labaBersih: 0 })

    return { groups: groupList, consolidated: total }
  }, [supabase, isAdmin, myBranchId])

  const fetchData = useCallback(async () => {
    setLoading(true)
    let curStart: string, curEnd: string, prevStart: string, prevEnd: string

    if (tab === 'mingguan') {
      const cur = isoWeekRange(week)
      const prev = isoWeekRange(shiftWeek(week, -1))
      curStart = cur.start; curEnd = cur.end; prevStart = prev.start; prevEnd = prev.end
    } else {
      const [y, m] = month.split('-').map(Number)
      curStart = new Date(y, m - 1, 1).toISOString().split('T')[0]
      curEnd = new Date(y, m, 0).toISOString().split('T')[0]
      const prevMonth = shiftMonth(month, -1)
      const [py, pm] = prevMonth.split('-').map(Number)
      prevStart = new Date(py, pm - 1, 1).toISOString().split('T')[0]
      prevEnd = new Date(py, pm, 0).toISOString().split('T')[0]
    }

    const [cur, prev] = await Promise.all([computeTotals(curStart, curEnd), computeTotals(prevStart, prevEnd)])
    setGroups(cur.groups)
    setConsolidated(cur.consolidated)
    setPrevGroups(prev.groups)
    setPrevConsolidated(prev.consolidated)
    setLoading(false)
  }, [tab, week, month, computeTotals])

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
    const startDate = new Date(y, m - 1, 1).toISOString().split('T')[0]
    const endDate = new Date(y, m, 0).toISOString().split('T')[0]

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
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                  <p className="text-xs text-slate-500 uppercase mb-1">Biaya Operasional</p>
                  <p className="text-lg font-semibold text-slate-800">{formatRupiah(consolidated.biayaOperasional)}</p>
                  <VarianceBadge cur={consolidated.biayaOperasional} prev={prevConsolidated.biayaOperasional} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Laba Bersih</p>
                  <p className={`text-lg font-bold ${consolidated.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(consolidated.labaBersih)}</p>
                  <VarianceBadge cur={consolidated.labaBersih} prev={prevConsolidated.labaBersih} />
                </div>
              </div>
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
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Biaya Operasional</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Laba Bersih (vs periode lalu)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data disetujui untuk periode ini.</td></tr>
                  ) : groups.map(g => {
                    const prev = prevGroups.find(p => p.label === g.label) || { label: g.label, kasMasuk: 0, hpp: 0, biayaOperasional: 0, labaKotor: 0, labaBersih: 0 }
                    return (
                      <tr key={g.label} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{g.label}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.kasMasuk)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.hpp)}</td>
                        <td className="px-4 py-3 text-sm text-right font-semibold text-blue-700">{formatRupiah(g.labaKotor)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.biayaOperasional)}</td>
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

          <p className="text-xs text-slate-400 mt-3">Hanya menghitung entri berstatus &quot;Disetujui&quot;. Ekspor CSV omzet per cabang (tab Bulanan) memakai data per cabang asli, bukan per kelompok laporan gabungan — sesuai kebutuhan pelaporan pajak.</p>
        </>
      )}
    </div>
  )
}
