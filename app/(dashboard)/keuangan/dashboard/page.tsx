'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

const ADMIN_ROLES = ['owner', 'hr', 'finance']

type ReportGroup = { branch_id: string; report_group_label: string }
type GroupTotals = {
  label: string
  kasMasuk: number
  hpp: number
  biayaOperasional: number
  labaKotor: number
  labaBersih: number
}

export default function DashboardKeuanganPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  const today = new Date().toISOString().split('T')[0]
  const [filterMonth, setFilterMonth] = useState(today.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupTotals[]>([])
  const [consolidated, setConsolidated] = useState<GroupTotals | null>(null)
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

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0]
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

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

    let groupList: GroupTotals[] = Array.from(totalsByGroup.entries()).map(([label, t]) => ({
      label,
      kasMasuk: t.kasMasuk,
      hpp: t.hpp,
      biayaOperasional: t.biayaOperasional,
      labaKotor: t.kasMasuk - t.hpp,
      labaBersih: t.kasMasuk - t.hpp - t.biayaOperasional,
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
      labaKotor: acc.labaKotor + g.labaKotor,
      labaBersih: acc.labaBersih + g.labaBersih,
    }), { label: 'Total Konsolidasi', kasMasuk: 0, hpp: 0, biayaOperasional: 0, labaKotor: 0, labaBersih: 0 })

    setGroups(groupList)
    setConsolidated(totalKonsolidasi)
    setAsOf(new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))
    setLoading(false)
  }, [supabase, filterMonth, isAdmin, myBranchId])

  useEffect(() => { if (!roleLoading) fetchData() }, [roleLoading, fetchData])

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Dashboard Keuangan</h1>
          <p className="text-sm text-slate-500">Laba Kotor & Laba Bersih live berdasarkan data yang sudah disetujui. Laba Kotor = Kas Masuk − HPP. Laba Bersih = Laba Kotor − Biaya Operasional (restock dikecualikan).</p>
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
          {isAdmin && consolidated && (
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-blue-200">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-bold text-slate-800">Total Konsolidasi (Seluruh Bisnis)</h2>
                <span className="text-xs text-slate-400">per {asOf}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Kas Masuk</p>
                  <p className="text-lg font-semibold text-slate-800">{formatRupiah(consolidated.kasMasuk)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">HPP</p>
                  <p className="text-lg font-semibold text-slate-800">{formatRupiah(consolidated.hpp)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Laba Kotor</p>
                  <p className="text-lg font-semibold text-blue-700">{formatRupiah(consolidated.labaKotor)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Biaya Operasional</p>
                  <p className="text-lg font-semibold text-slate-800">{formatRupiah(consolidated.biayaOperasional)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1">Laba Bersih</p>
                  <p className={`text-lg font-bold ${consolidated.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(consolidated.labaBersih)}</p>
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
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Laba Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data disetujui untuk bulan ini.</td></tr>
                  ) : groups.map(g => (
                    <tr key={g.label} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{g.label}</td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.kasMasuk)}</td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.hpp)}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-blue-700">{formatRupiah(g.labaKotor)}</td>
                      <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(g.biayaOperasional)}</td>
                      <td className={`px-4 py-3 text-sm text-right font-bold ${g.labaBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(g.labaBersih)}</td>
                    </tr>
                  ))}
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
