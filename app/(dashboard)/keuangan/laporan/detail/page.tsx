'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr, todayLocalStr } from '@/lib/date'
import Link from 'next/link'
import { remainingFor, type SupplierPaymentRow } from '@/lib/supplierPurchases'

const ADMIN_ROLES = ['owner', 'hr', 'finance']

type CashInRow = {
  id: string
  transaction_date: string
  amount: number
  expense_amount: number
  cash_adjustment: number
  payment_method: string
  description: string | null
  status: string
  branch_id: string
  branches?: { name: string } | null
}
type CashOutRow = {
  id: string
  transaction_date: string
  amount: number
  category: string
  description: string | null
  status: string
  branch_id: string
  branches?: { name: string } | null
}
type CashOutCategory = { code: string; label: string; affects_net_profit: boolean }
type HppRow = { branch_id: string; hpp_amount: number; entry_type: 'hpp' | 'omset' }
type CashierLossRow = {
  id: string
  branch_id: string
  entry_date: string
  amount: number
  notes: string | null
  branches?: { name: string } | null
  employees?: { full_name: string } | null
}
type SupplierPurchaseRow = { id: string; branch_id: string; total_amount: number; suppliers?: { name: string } | null }
type AssetBaselineRow = { branch_id: string; inventory_value: number; baseline_date: string }

// Kategori Kas Keluar yang berasal dari penggajian — dikelompokkan jadi satu bagian tersendiri
// ("Rincian Penggajian"), bukan tercampur di daftar kategori umum.
const PAYROLL_CATEGORIES = ['payroll', 'gaji_', 'driver_wage', 'helper_wage', 'borongan_wage', 'gaji_freelance']

export default function LaporanDetailPage() {
  const supabase = createClient()

  const [role, setRole] = useState('')
  const [roleLoading, setRoleLoading] = useState(true)
  const isAdmin = ADMIN_ROLES.includes(role)

  const today = todayLocalStr()
  const [groupLabels, setGroupLabels] = useState<string[]>([])
  const [branchToGroup, setBranchToGroup] = useState<Map<string, string>>(new Map())
  const [selectedGroup, setSelectedGroup] = useState('')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [categories, setCategories] = useState<CashOutCategory[]>([])

  const [loading, setLoading] = useState(true)
  const [cashInRows, setCashInRows] = useState<CashInRow[]>([])
  const [cashOutRows, setCashOutRows] = useState<CashOutRow[]>([])
  const [hppRows, setHppRows] = useState<HppRow[]>([])
  const [cashierLossRows, setCashierLossRows] = useState<CashierLossRow[]>([])
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [showPemasukan, setShowPemasukan] = useState(false)
  const [showPenggajian, setShowPenggajian] = useState(false)
  const [showKehilangan, setShowKehilangan] = useState(false)

  // Kondisi saat ini (bukan berdasarkan periode/bulan yang dipilih) — Sisa Utang Supplier itu saldo
  // berjalan real-time, dan Aset Barang cuma ada 1 snapshot (baseline), bukan data bulanan.
  const [sisaUtangSupplier, setSisaUtangSupplier] = useState(0)
  const [totalAsetBarang, setTotalAsetBarang] = useState(0)
  const [asetBaselineDate, setAsetBaselineDate] = useState<string | null>(null)
  const [loadingKondisi, setLoadingKondisi] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (userRow) setRole(userRow.role)
      }

      const { data: groupsRes } = await supabase.from('fin_branch_report_groups').select('branch_id, report_group_label')
      const map = new Map<string, string>()
      const labelSet = new Set<string>()
      for (const g of groupsRes || []) {
        map.set(g.branch_id, g.report_group_label)
        labelSet.add(g.report_group_label)
      }
      setBranchToGroup(map)
      const labels = Array.from(labelSet).sort()
      setGroupLabels(labels)

      const { data: catRes } = await supabase.from('fin_cash_out_categories').select('code, label, affects_net_profit')
      if (catRes) setCategories(catRes)

      // Prefill dari query string kalau ada (link deep dari Laporan Resmi), tanpa pakai hook useSearchParams
      const params = new URLSearchParams(window.location.search)
      const qGroup = params.get('group')
      const qMonth = params.get('month')
      setSelectedGroup(qGroup && labels.includes(qGroup) ? qGroup : labels[0] || '')
      if (qMonth) setMonth(qMonth)

      setRoleLoading(false)
    }
    init()
  }, [supabase])

  const fetchData = useCallback(async () => {
    if (!selectedGroup) { setLoading(false); return }
    setLoading(true)
    const branchIds = Array.from(branchToGroup.entries()).filter(([, label]) => label === selectedGroup).map(([id]) => id)
    if (branchIds.length === 0) { setCashInRows([]); setCashOutRows([]); setHppRows([]); setCashierLossRows([]); setLoading(false); return }

    const [year, m] = month.split('-').map(Number)
    const startDate = localDateStr(new Date(year, m - 1, 1))
    const endDate = localDateStr(new Date(year, m, 0))

    const [cashInRes, cashOutRes, hppRes, cashierLossRes] = await Promise.all([
      supabase.from('fin_cash_in')
        .select('id, transaction_date, amount, expense_amount, cash_adjustment, payment_method, description, status, branch_id, branches(name)')
        .in('branch_id', branchIds).gte('transaction_date', startDate).lte('transaction_date', endDate)
        .order('transaction_date', { ascending: true }),
      supabase.from('fin_cash_out')
        .select('id, transaction_date, amount, category, description, status, branch_id, branches(name)')
        .in('branch_id', branchIds).gte('transaction_date', startDate).lte('transaction_date', endDate)
        .order('transaction_date', { ascending: true }),
      supabase.from('fin_hpp_entries')
        .select('branch_id, hpp_amount, entry_type').eq('status', 'approved')
        .in('branch_id', branchIds).gte('entry_date', startDate).lte('entry_date', endDate),
      supabase.from('cashier_loss_entries')
        .select('id, branch_id, entry_date, amount, notes, branches(name), employees!cashier_loss_entries_employee_id_fkey(full_name)')
        .in('branch_id', branchIds).gte('entry_date', startDate).lte('entry_date', endDate)
        .order('entry_date', { ascending: true }),
    ])

    if (cashInRes.error) console.error('Detail error cash_in:', JSON.stringify(cashInRes.error, null, 2))
    if (cashOutRes.error) console.error('Detail error cash_out:', JSON.stringify(cashOutRes.error, null, 2))
    if (hppRes.error) console.error('Detail error hpp:', JSON.stringify(hppRes.error, null, 2))
    if (cashierLossRes.error) console.error('Detail error cashier_loss:', JSON.stringify(cashierLossRes.error, null, 2))

    setCashInRows((cashInRes.data as unknown as CashInRow[]) || [])
    setCashOutRows((cashOutRes.data as unknown as CashOutRow[]) || [])
    setHppRows((hppRes.data as HppRow[]) || [])
    setCashierLossRows((cashierLossRes.data as unknown as CashierLossRow[]) || [])
    setExpandedCategories(new Set())
    setLoading(false)
  }, [supabase, selectedGroup, month, branchToGroup])

  useEffect(() => { if (!roleLoading && isAdmin) fetchData() }, [roleLoading, isAdmin, fetchData])

  // Sisa Utang Supplier & Aset Barang — kondisi SAAT INI (bukan per bulan yang difilter di atas),
  // jadi diambil terpisah, cuma bergantung pada cabang yang dipilih.
  const fetchKondisi = useCallback(async () => {
    if (!selectedGroup) { setLoadingKondisi(false); return }
    setLoadingKondisi(true)
    const branchIds = Array.from(branchToGroup.entries()).filter(([, label]) => label === selectedGroup).map(([id]) => id)
    if (branchIds.length === 0) {
      setSisaUtangSupplier(0); setTotalAsetBarang(0); setAsetBaselineDate(null); setLoadingKondisi(false)
      return
    }

    const [purchasesRes, baselineRes] = await Promise.all([
      supabase.from('supplier_purchases').select('id, branch_id, total_amount').in('branch_id', branchIds),
      supabase.from('fin_branch_capital_baseline').select('branch_id, inventory_value, baseline_date').eq('status', 'approved').in('branch_id', branchIds),
    ])
    if (purchasesRes.error) console.error('Detail error supplier_purchases:', JSON.stringify(purchasesRes.error, null, 2))
    if (baselineRes.error) console.error('Detail error baseline:', JSON.stringify(baselineRes.error, null, 2))

    const purchases = (purchasesRes.data as SupplierPurchaseRow[]) || []
    let payments: SupplierPaymentRow[] = []
    if (purchases.length > 0) {
      const { data: paymentsData, error: paymentsErr } = await supabase
        .from('fin_cash_out').select('source_id, amount, status')
        .eq('source_table', 'supplier_purchases').in('source_id', purchases.map(p => p.id))
      if (paymentsErr) console.error('Detail error supplier payments:', JSON.stringify(paymentsErr, null, 2))
      payments = (paymentsData as SupplierPaymentRow[]) || []
    }
    const sisaUtang = purchases.reduce((s, p) => s + remainingFor(p.total_amount, p.id, payments), 0)
    setSisaUtangSupplier(sisaUtang)

    const baselines = (baselineRes.data as AssetBaselineRow[]) || []
    setTotalAsetBarang(baselines.reduce((s, b) => s + Number(b.inventory_value), 0))
    setAsetBaselineDate(baselines.length > 0 ? baselines.map(b => b.baseline_date).sort().reverse()[0] : null)
    setLoadingKondisi(false)
  }, [supabase, selectedGroup, branchToGroup])

  useEffect(() => { if (!roleLoading && isAdmin) fetchKondisi() }, [roleLoading, isAdmin, fetchKondisi])

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', revisi: 'bg-blue-100 text-blue-800' }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', revisi: 'Revisi' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  // Entri yang bukan "Disetujui" tetap ditampilkan (transparan, data apa adanya) tapi TIDAK ikut ke
  // total manapun di halaman ini — beri keterangan langsung menempel di barisnya supaya tidak disangka salah hitung.
  function statusCell(status: string) {
    return (
      <div className="text-center">
        {statusBadge(status)}
        {status !== 'approved' && (
          <div className="text-[10px] text-amber-600 mt-0.5 whitespace-nowrap">tidak dihitung ke total</div>
        )}
      </div>
    )
  }

  function toggleCategory(code: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

  // Ringkasan
  const cashInApproved = cashInRows.filter(r => r.status === 'approved')
  const totalOmzetDilaporkan = cashInApproved.reduce((s, r) => s + Number(r.amount), 0)
  const totalUangDiterima = cashInApproved.reduce((s, r) => s + Number(r.amount) - Number(r.expense_amount || 0) + Number(r.cash_adjustment || 0), 0)
  const cashOutApproved = cashOutRows.filter(r => r.status === 'approved')
  const totalKasKeluar = cashOutApproved.reduce((s, r) => s + Number(r.amount), 0)
  const catMap = new Map(categories.map(c => [c.code, c]))
  const biayaOperasional = cashOutApproved.filter(r => catMap.get(r.category)?.affects_net_profit !== false).reduce((s, r) => s + Number(r.amount), 0)
  const omsetSistem = hppRows.filter(r => r.entry_type === 'omset').reduce((s, r) => s + Number(r.hpp_amount), 0)
  const hppSistem = hppRows.filter(r => r.entry_type === 'hpp').reduce((s, r) => s + Number(r.hpp_amount), 0)
  const hasSistemData = omsetSistem > 0 || hppSistem > 0
  const labaKotorSistem = omsetSistem - hppSistem
  const labaBersihSistem = labaKotorSistem - biayaOperasional
  // Uang Masuk (Real) dikurangi Total Kas Keluar (SEMUA kategori) — Biaya Operasional TIDAK dikurangkan lagi
  // di sini karena sudah termasuk di dalam Total Kas Keluar (kalau dikurangi dua kali, hasilnya jadi salah).
  const perkiraanKasSeharusnya = totalUangDiterima - totalKasKeluar

  // Kelompok kategori pengeluaran (di luar penggajian — penggajian punya bagian tersendiri di bawah)
  const byCategory = new Map<string, { label: string; rows: CashOutRow[]; total: number; affectsNetProfit: boolean }>()
  const payrollRows: CashOutRow[] = []
  for (const r of cashOutRows) {
    if (PAYROLL_CATEGORIES.includes(r.category)) { payrollRows.push(r); continue }
    const cat = catMap.get(r.category)
    const label = cat?.label || r.category
    if (!byCategory.has(r.category)) byCategory.set(r.category, { label, rows: [], total: 0, affectsNetProfit: cat?.affects_net_profit !== false })
    const entry = byCategory.get(r.category)!
    entry.rows.push(r)
    if (r.status === 'approved') entry.total += Number(r.amount)
  }
  const categoryList = Array.from(byCategory.entries()).sort((a, b) => b[1].total - a[1].total)
  const totalPenggajian = payrollRows.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.amount), 0)
  const totalKehilangan = cashierLossRows.reduce((s, r) => s + Number(r.amount), 0)

  const monthLabel = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Anda tidak memiliki akses ke halaman Detail Laporan per Cabang.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/keuangan/laporan" className="text-sm text-blue-600 hover:underline">&larr; Kembali ke Laporan Resmi</Link>
        <h1 className="text-2xl font-bold text-slate-800 mt-2 mb-1">Detail Laporan per Cabang</h1>
        <p className="text-sm text-slate-500">Rincian lengkap pemasukan &amp; pengeluaran per kelompok laporan, diurutkan dari tanggal 1 — klik kategori pengeluaran untuk lihat daftar transaksinya.</p>
      </div>

      <div className="mb-6 bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-end justify-between">
        <div>
          <label className="block text-xs text-slate-500 mb-2">Pilih Cabang</label>
          {groupLabels.length === 0 ? (
            <p className="text-sm text-slate-400">-- Belum ada kelompok --</p>
          ) : (
            <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg w-fit">
              {groupLabels.map(l => (
                <button key={l} onClick={() => setSelectedGroup(l)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${selectedGroup === l ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Bulan</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white" />
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-500">Memuat data...</div>
      ) : !selectedGroup ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-500 text-sm">Pilih kelompok/cabang dulu.</div>
      ) : (
        <>
          <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-blue-200">
            <h2 className="text-lg font-bold text-slate-800 mb-3">{selectedGroup} — {monthLabel}</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Omzet Dilaporkan (Kas Masuk)</p>
                <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(totalOmzetDilaporkan)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Uang Diterima (Real)</p>
                <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(totalUangDiterima)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Total Kas Keluar (Semua Kategori)</p>
                <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(totalKasKeluar)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Biaya Operasional</p>
                <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(biayaOperasional)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Perkiraan Uang Kas yang Harus Ada</p>
                <p className={`text-lg font-bold whitespace-nowrap ${perkiraanKasSeharusnya >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(perkiraanKasSeharusnya)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Uang Diterima − Total Kas Keluar (Biaya Operasional sudah termasuk di dalamnya, tidak dikurangi dua kali)</p>
              </div>
            </div>

            {hasSistemData && (
              <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-purple-600 uppercase mb-1 min-h-[2rem]">Omset (Sistem)</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(omsetSistem)}</p>
                </div>
                <div>
                  <p className="text-xs text-purple-600 uppercase mb-1 min-h-[2rem]">HPP (Sistem)</p>
                  <p className="text-lg font-semibold text-slate-800 whitespace-nowrap">{formatRupiah(hppSistem)}</p>
                </div>
                <div>
                  <p className="text-xs text-purple-600 uppercase mb-1 min-h-[2rem]">Laba Kotor (Sistem)</p>
                  <p className={`text-lg font-bold whitespace-nowrap ${labaKotorSistem >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(labaKotorSistem)}</p>
                </div>
                <div>
                  <p className="text-xs text-purple-600 uppercase mb-1 min-h-[2rem]">Laba Bersih (Sistem)</p>
                  <p className={`text-lg font-bold whitespace-nowrap ${labaBersihSistem >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatRupiah(labaBersihSistem)}</p>
                </div>
              </div>
            )}
          </div>

          <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border-2 border-amber-200">
            <h2 className="text-lg font-bold text-slate-800 mb-1">Kondisi Cabang Saat Ini</h2>
            <p className="text-xs text-slate-500 mb-3">Berbeda dari angka di atas — ini bukan angka per bulan, tapi kondisi terkini (neraca), supaya kelihatan jelas posisi cabang ini: apa yang masih dipunya (aset barang) dan apa yang masih ditanggung (utang supplier).</p>
            {loadingKondisi ? (
              <div className="text-sm text-slate-400 py-2">Memuat...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Sisa Utang ke Supplier (Saat Ini)</p>
                  <p className={`text-lg font-bold whitespace-nowrap ${sisaUtangSupplier > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatRupiah(sisaUtangSupplier)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Total pembelian dikurangi yang sudah dibayar &amp; disetujui, akumulasi sejak awal — lihat rinciannya di Pembelian &amp; Utang Supplier.</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase mb-1 min-h-[2rem]">Total Aset Barang</p>
                  <p className="text-lg font-bold text-slate-800 whitespace-nowrap">{formatRupiah(totalAsetBarang)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {asetBaselineDate
                      ? `Snapshot per ${new Date(asetBaselineDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })} (Modal Cabang) — bukan angka bulan ${monthLabel}.`
                      : 'Belum ada data Modal Cabang untuk kelompok ini.'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-600 uppercase">Rincian Pengeluaran per Kategori</h2>
              <p className="text-xs text-slate-400 mt-0.5">Klik baris kategori untuk buka daftar transaksinya (tanggal, nominal, keterangan). Total di sini cuma menghitung entri berstatus &quot;Disetujui&quot;.</p>
            </div>
            {categoryList.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pengeluaran untuk periode ini.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {categoryList.map(([code, info]) => (
                  <div key={code}>
                    <button onClick={() => toggleCategory(code)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition text-left">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <span className={`text-xs transition-transform ${expandedCategories.has(code) ? 'rotate-90' : ''}`}>▶</span>
                        {info.label}
                        {!info.affectsNetProfit && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">di luar P&amp;L</span>}
                        <span className="text-xs text-slate-400">({info.rows.length} entri)</span>
                      </span>
                      <span className="text-sm font-semibold text-red-700 whitespace-nowrap">{formatRupiah(info.total)}</span>
                    </button>
                    {expandedCategories.has(code) && (
                      <div className="bg-slate-50 border-t border-slate-100">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-xs text-slate-500 uppercase">
                              <th className="px-4 pl-10 py-2">Tanggal</th>
                              <th className="px-4 py-2">Cabang</th>
                              <th className="px-4 py-2 text-right">Nominal</th>
                              <th className="px-4 py-2">Keterangan</th>
                              <th className="px-4 py-2 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {info.rows.map(r => (
                              <tr key={r.id} className="text-sm">
                                <td className="px-4 pl-10 py-2 text-slate-600 whitespace-nowrap">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                                <td className="px-4 py-2 text-slate-600">{r.branches?.name || '—'}</td>
                                <td className="px-4 py-2 text-right font-medium text-slate-800 whitespace-nowrap">{formatRupiah(r.amount)}</td>
                                <td className="px-4 py-2 text-slate-500">{r.description || '—'}</td>
                                <td className="px-4 py-2">{statusCell(r.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
            <button onClick={() => setShowPenggajian(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition text-left border-b border-slate-200 bg-slate-50">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-600 uppercase">
                <span className={`text-xs transition-transform ${showPenggajian ? 'rotate-90' : ''}`}>▶</span>
                Rincian Penggajian
                <span className="text-xs text-slate-400 normal-case">({payrollRows.length} entri)</span>
              </span>
              <span className="text-sm font-semibold text-red-700 whitespace-nowrap">{formatRupiah(totalPenggajian)}</span>
            </button>
            {showPenggajian && (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase sticky top-0 bg-white">
                      <th className="px-4 py-2">Tanggal</th>
                      <th className="px-4 py-2">Cabang</th>
                      <th className="px-4 py-2">Kategori</th>
                      <th className="px-4 py-2 text-right">Nominal</th>
                      <th className="px-4 py-2">Keterangan</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payrollRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada penggajian untuk periode ini. Ingat: gajian periode bulan lalu biasanya baru tercatat di bulan ini (jeda pembayaran ~1 bulan).</td></tr>
                    ) : payrollRows.map(r => (
                      <tr key={r.id} className="text-sm hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                        <td className="px-4 py-2 text-slate-600">{r.branches?.name || '—'}</td>
                        <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{catMap.get(r.category)?.label || r.category}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-800 whitespace-nowrap">{formatRupiah(r.amount)}</td>
                        <td className="px-4 py-2 text-slate-500">{r.description || '—'}</td>
                        <td className="px-4 py-2">{statusCell(r.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
            <button onClick={() => setShowKehilangan(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition text-left border-b border-slate-200 bg-slate-50">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-600 uppercase">
                <span className={`text-xs transition-transform ${showKehilangan ? 'rotate-90' : ''}`}>▶</span>
                Rincian Kehilangan Barang/Kasir
                <span className="text-xs text-slate-400 normal-case">({cashierLossRows.length} entri)</span>
              </span>
              <span className="text-sm font-semibold text-red-700 whitespace-nowrap">{formatRupiah(totalKehilangan)}</span>
            </button>
            {showKehilangan && (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase sticky top-0 bg-white">
                      <th className="px-4 py-2">Tanggal</th>
                      <th className="px-4 py-2">Cabang</th>
                      <th className="px-4 py-2">Karyawan</th>
                      <th className="px-4 py-2 text-right">Nominal</th>
                      <th className="px-4 py-2">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cashierLossRows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada kehilangan barang/kasir untuk periode ini.</td></tr>
                    ) : cashierLossRows.map(r => (
                      <tr key={r.id} className="text-sm hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{new Date(r.entry_date).toLocaleDateString('id-ID')}</td>
                        <td className="px-4 py-2 text-slate-600">{r.branches?.name || '—'}</td>
                        <td className="px-4 py-2 text-slate-600">{r.employees?.full_name || '—'}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-800 whitespace-nowrap">{formatRupiah(r.amount)}</td>
                        <td className="px-4 py-2 text-slate-500">{r.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button onClick={() => setShowPemasukan(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition text-left border-b border-slate-200 bg-slate-50">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-600 uppercase">
                <span className={`text-xs transition-transform ${showPemasukan ? 'rotate-90' : ''}`}>▶</span>
                Rincian Pemasukan (Kas Masuk)
                <span className="text-xs text-slate-400 normal-case">({cashInRows.length} entri)</span>
              </span>
              <span className="text-sm font-semibold text-green-700 whitespace-nowrap">{formatRupiah(totalUangDiterima)}</span>
            </button>
            {showPemasukan && (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase sticky top-0 bg-white">
                      <th className="px-4 py-2">Tanggal</th>
                      <th className="px-4 py-2">Cabang</th>
                      <th className="px-4 py-2 text-right">Omzet</th>
                      <th className="px-4 py-2 text-right">Uang Diterima</th>
                      <th className="px-4 py-2">Keterangan</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cashInRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pemasukan untuk periode ini.</td></tr>
                    ) : cashInRows.map(r => (
                      <tr key={r.id} className="text-sm hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                        <td className="px-4 py-2 text-slate-600">{r.branches?.name || '—'}</td>
                        <td className="px-4 py-2 text-right text-slate-700 whitespace-nowrap">{formatRupiah(r.amount)}</td>
                        <td className="px-4 py-2 text-right font-medium text-green-700 whitespace-nowrap">{formatRupiah(Number(r.amount) - Number(r.expense_amount || 0) + Number(r.cash_adjustment || 0))}</td>
                        <td className="px-4 py-2 text-slate-500">{r.description || '—'}</td>
                        <td className="px-4 py-2">{statusCell(r.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-400 mt-3">Semua total di halaman ini hanya menghitung entri berstatus &quot;Disetujui&quot; — entri Menunggu/Ditolak tetap ditampilkan di daftar supaya kelihatan.</p>
        </>
      )}
    </div>
  )
}
