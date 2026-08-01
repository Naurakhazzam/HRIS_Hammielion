'use client'

import { useState, useEffect, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Branch = { id: string; name: string }

type PayrollRow = {
  id: string
  employee_id: string
  period_month: number
  period_year: number
  base_salary: number
  position_allowance: number
  meal_allowance: number
  overtime_total: number
  kpi_bonus: number
  conditional_bonus: number
  extra_bonus_total: number
  libur_compensation_days: number
  libur_compensation_amount: number
  late_deduction: number
  kasbon_deduction: number
  loyalitas_deduction: number
  inventory_loss_deduction: number
  cashier_loss_deduction: number
  gross_total: number
  net_total: number
  status: string
  employee: {
    full_name: string
    join_date: string | null
    employee_type: string
    branch_id: string
    positions: { name: string } | null
    branches: { name: string } | null
  } | null
}

type SummaryRow = {
  payrollId: string
  employeeId: string
  name: string
  position: string
  branchName: string
  branchId: string
  gajiAwal: number
  sickDays: number
  izinDays: number
  alphaDays: number
  kurangLiburDays: number
  kurangLiburAmount: number
  lebihLiburDays: number
  lebihLiburDeduction: number
  sickDeduction: number
  izinDeduction: number
  alphaDeduction: number
  totalLateMinutes: number
  lateDeduction: number
  kasbonDeduction: number
  loyalitasDeduction: number
  invLossDeduction: number
  invLossPercent: number
  invLossTotal: number
  cashierLossDeduction: number
  cashierLossPercent: number
  cashierLossTotal: number
  overtimeTotal: number
  bonusTotal: number
  grossTotal: number
  netTotal: number
  status: string
}

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)
const fmtJam = (menit: number) => menit >= 60 ? `${Math.floor(menit/60)}j ${menit%60}m` : `${menit}m`

function getPeriodLabel(month: number, year: number) {
  const endDate = new Date(year, month - 1, 25)
  const startDate = new Date(year, month - 2, 26)
  return `${startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })} – ${endDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_approval: 'Menunggu', approved: 'Disetujui', paid: 'Lunas' }
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', pending_approval: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700',
}

export default function RingkasanOwnerPage() {
  const supabase = createClient()
  const today = new Date()

  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [filterBranch, setFilterBranch] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => { fetchBranches() }, [])
  useEffect(() => { fetchSummary() }, [filterMonth, filterYear, filterBranch])

  async function fetchBranches() {
    const { data } = await supabase.from('branches').select('id,name').order('name')
    if (data) setBranches(data)
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function fetchSummary() {
    setLoading(true)

    let q = supabase
      .from('payrolls')
      .select(`
        id, employee_id, period_month, period_year,
        base_salary, position_allowance, meal_allowance,
        overtime_total, kpi_bonus, conditional_bonus, extra_bonus_total,
        libur_compensation_days, libur_compensation_amount,
        late_deduction, kasbon_deduction, loyalitas_deduction,
        inventory_loss_deduction, cashier_loss_deduction,
        gross_total, net_total, status,
        employee:employees!payrolls_employee_id_fkey(
          full_name, join_date, employee_type, branch_id,
          positions(name), branches(name)
        )
      `)
      .eq('period_month', filterMonth)
      .eq('period_year', filterYear)
      .order('created_at', { ascending: true })

    const { data: payrollData, error } = await q
    if (error || !payrollData) { setRows([]); setLoading(false); return }

    let payrolls = (payrollData as unknown as PayrollRow[])
    if (filterBranch) payrolls = payrolls.filter(p => p.employee?.branch_id === filterBranch)

    if (payrolls.length === 0) { setRows([]); setLoading(false); return }

    // Batas periode 26 bulan lalu - 25 bulan ini
    const pad = (n: number) => String(n).padStart(2, '0')
    const sm = filterMonth === 1 ? 12 : filterMonth - 1
    const sy = filterMonth === 1 ? filterYear - 1 : filterYear
    const firstDay = `${sy}-${pad(sm)}-26`
    const lastDay  = `${filterYear}-${pad(filterMonth)}-25`

    // Total kehilangan barang & minus kas per cabang (untuk hitung persentase)
    const branchIds = [...new Set(payrolls.map(p => p.employee?.branch_id).filter(Boolean))] as string[]
    const [lossInputsRes, cashierEntriesRes] = await Promise.all([
      supabase.from('loss_monthly_inputs').select('branch_id, total_loss_amount').in('branch_id', branchIds).eq('period_month', filterMonth).eq('period_year', filterYear),
      supabase.from('cashier_loss_entries').select('branch_id, amount').in('branch_id', branchIds).eq('period_month', filterMonth).eq('period_year', filterYear),
    ])
    const lossTotalByBranch: Record<string, number> = {}
    ;(lossInputsRes.data || []).forEach((l: any) => { lossTotalByBranch[l.branch_id] = Number(l.total_loss_amount) })
    const cashierTotalByBranch: Record<string, number> = {}
    ;(cashierEntriesRes.data || []).forEach((c: any) => { cashierTotalByBranch[c.branch_id] = (cashierTotalByBranch[c.branch_id] || 0) + Number(c.amount) })

    // Rincian absensi per karyawan
    const summaries = await Promise.all(payrolls.map(async (p): Promise<SummaryRow> => {
      const emp = p.employee
      const { data: atts } = await supabase
        .from('attendances')
        .select('date, status, late_minutes')
        .eq('employee_id', p.employee_id)
        .gte('date', firstDay).lte('date', lastDay)

      const joinDateVal = emp?.join_date ?? null
      const validAtts = (atts || []).filter((a: any) => !joinDateVal || a.date >= joinDateVal)
      const recordedDates = new Set(validAtts.map((a: any) => a.date))
      const sickDays = validAtts.filter((a: any) => a.status === 'sick').length
      const izinDays = validAtts.filter((a: any) => a.status === 'permission').length
      const alphaDays = validAtts.filter((a: any) => a.status === 'absent').length
      const leaveDays = validAtts.filter((a: any) => a.status === 'leave').length
      const totalLateMinutes = validAtts.reduce((s: number, a: any) => s + Number(a.late_minutes || 0), 0)

      const allDates: string[] = []
      const cur = new Date(firstDay + 'T12:00:00')
      const endD = new Date(lastDay + 'T12:00:00')
      while (cur <= endD) { allDates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`); cur.setDate(cur.getDate()+1) }
      const totalPeriodDays = allDates.length
      const emptyDays = allDates.filter(d => (!joinDateVal || d >= joinDateVal) && !recordedDates.has(d)).length

      const isTraining = emp?.employee_type === 'training'
      let proRataFactor = 1
      if (isTraining && joinDateVal) {
        if (joinDateVal > lastDay) proRataFactor = 0
        else if (joinDateVal > firstDay) {
          const joinD = new Date(joinDateVal + 'T12:00:00')
          const activeDays = Math.round((endD.getTime() - joinD.getTime()) / 86400000) + 1
          proRataFactor = activeDays / totalPeriodDays
        }
      }
      const kuotaLibur = Math.round(4 * proRataFactor)
      const totalLiburDiambil = emptyDays + leaveDays
      const lebihLiburDays = Math.max(totalLiburDiambil - kuotaLibur, 0)

      // Rincian potongan tidak hadir — dihitung langsung dari data absensi
      // asli (bukan angka gabungan di slip), supaya Sakit/Izin/Alpha/Libur
      // Lebih selalu konsisten dengan yang tertulis di Catatan.
      const gajiAwal = Number(p.base_salary) + Number(p.position_allowance) + Number(p.meal_allowance)
      const dailyRate = Math.round(gajiAwal / 26)
      const sick1Free  = Math.min(sickDays, 1)
      const sick23Half = Math.max(0, Math.min(sickDays - 1, 2))
      const sick4Full  = Math.max(0, sickDays - 3)
      const sickDeduction = Math.round(sick23Half * dailyRate * 0.5 + sick4Full * dailyRate)
      const izinDeduction = izinDays * dailyRate
      const alphaDeduction = Math.round(alphaDays * dailyRate * 1.5)
      const lebihLiburDeduction = lebihLiburDays * dailyRate

      const invLossTotal = lossTotalByBranch[emp?.branch_id || ''] || 0
      const cashierLossTotal = cashierTotalByBranch[emp?.branch_id || ''] || 0

      const overtimeTotal = Number(p.overtime_total || 0)
      const bonusTotal = Number(p.kpi_bonus||0) + Number(p.conditional_bonus||0) + Number(p.extra_bonus_total||0) + Number(p.libur_compensation_amount||0)

      return {
        payrollId: p.id, employeeId: p.employee_id,
        name: emp?.full_name ?? '—', position: emp?.positions?.name ?? '—',
        branchName: emp?.branches?.name ?? '—', branchId: emp?.branch_id ?? '',
        gajiAwal,
        sickDays, izinDays, alphaDays,
        kurangLiburDays: Number(p.libur_compensation_days || 0), kurangLiburAmount: Number(p.libur_compensation_amount || 0),
        lebihLiburDays, lebihLiburDeduction,
        sickDeduction, izinDeduction, alphaDeduction,
        totalLateMinutes, lateDeduction: Number(p.late_deduction || 0),
        kasbonDeduction: Number(p.kasbon_deduction || 0), loyalitasDeduction: Number(p.loyalitas_deduction || 0),
        invLossDeduction: Number(p.inventory_loss_deduction || 0),
        invLossPercent: invLossTotal > 0 ? Math.round((Number(p.inventory_loss_deduction||0) / invLossTotal) * 1000) / 10 : 0,
        invLossTotal,
        cashierLossDeduction: Number(p.cashier_loss_deduction || 0),
        cashierLossPercent: cashierLossTotal > 0 ? Math.round((Number(p.cashier_loss_deduction||0) / cashierLossTotal) * 1000) / 10 : 0,
        cashierLossTotal,
        overtimeTotal, bonusTotal,
        grossTotal: Number(p.gross_total), netTotal: Number(p.net_total), status: p.status,
      }
    }))

    summaries.sort((a, b) => a.branchName.localeCompare(b.branchName) || a.name.localeCompare(b.name))
    setRows(summaries)
    setLoading(false)
  }

  function buildCatatan(r: SummaryRow): string[] {
    const notes: string[] = []
    if (r.lebihLiburDays > 0) notes.push(`Libur lebih ${r.lebihLiburDays} hari (dipotong)`)
    if (r.kurangLiburDays > 0) notes.push(`Libur kurang ${r.kurangLiburDays} hari (dapat kompensasi)`)
    if (r.sickDays > 0) notes.push(`Sakit ${r.sickDays} hari`)
    if (r.izinDays > 0) notes.push(`Izin ${r.izinDays} hari`)
    if (r.alphaDays > 0) notes.push(`Alpha ${r.alphaDays} hari`)
    if (r.totalLateMinutes > 0) notes.push(`Telat ${fmtJam(r.totalLateMinutes)}`)
    return notes
  }

  function absenDeductionTotal(r: SummaryRow): number {
    return r.sickDeduction + r.izinDeduction + r.alphaDeduction + r.lebihLiburDeduction
  }

  const totalGajiAwal = rows.reduce((s, r) => s + r.gajiAwal, 0)
  const totalPotongan = rows.reduce((s, r) => s + r.lateDeduction + r.kasbonDeduction + r.loyalitasDeduction + r.invLossDeduction + r.cashierLossDeduction + absenDeductionTotal(r), 0)
  const totalGajiAkhir = rows.reduce((s, r) => s + r.netTotal, 0)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Ringkasan Gaji — Laporan Owner</h1>
          <p className="text-sm text-slate-500">Ringkasan per karyawan untuk periode {getPeriodLabel(filterMonth, filterYear)}</p>
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition print-hide">
          🖨️ Cetak / PDF
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-5 flex flex-wrap gap-4 items-end print-hide">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Bulan</label>
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Tahun</label>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {[today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cabang</label>
          <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            <option value="">Semua Cabang</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {/* Kop cetak */}
      <div className="hidden print:block text-center mb-4 pb-4 border-b-2 border-slate-800">
        <h1 className="text-xl font-bold text-slate-900 uppercase tracking-wider">HAMMIELION MANAGEMENT</h1>
        <p className="text-sm text-slate-600 mt-1">Ringkasan Gaji Karyawan — Laporan Owner</p>
        <p className="text-sm text-slate-600">Periode: {getPeriodLabel(filterMonth, filterYear)}</p>
      </div>

      {/* Versi cetak — selalu tampilkan rincian lengkap tiap karyawan, terlepas dari status expand di layar */}
      <div className="hidden print:block">
        {rows.map(r => {
          const notes = buildCatatan(r)
          const totalPot = r.lateDeduction + r.kasbonDeduction + r.loyalitasDeduction + r.invLossDeduction + r.cashierLossDeduction + absenDeductionTotal(r)
          return (
            <div key={r.payrollId} className="mb-4 pb-4 border-b border-slate-300" style={{ breakInside: 'avoid' }}>
              <div className="flex justify-between items-baseline">
                <div>
                  <span className="font-bold text-slate-900">{r.name}</span>
                  <span className="text-slate-500 text-sm ml-2">{r.position} · {r.branchName}</span>
                </div>
                <span className="font-bold text-slate-900">{fmtRp(r.netTotal)}</span>
              </div>
              {notes.length > 0 && <p className="text-xs text-amber-700 mt-1">{notes.join(' · ')}</p>}
              <div className="grid grid-cols-2 gap-x-8 mt-2 text-xs text-slate-600">
                <div>
                  <p className="font-semibold text-red-600 uppercase mb-1">Potongan</p>
                  {r.lateDeduction > 0 && <div className="flex justify-between"><span>Keterlambatan ({fmtJam(r.totalLateMinutes)})</span><span>-{fmtRp(r.lateDeduction)}</span></div>}
                  {r.sickDeduction > 0 && <div className="flex justify-between"><span>Sakit ({r.sickDays} hari)</span><span>-{fmtRp(r.sickDeduction)}</span></div>}
                  {r.izinDeduction > 0 && <div className="flex justify-between"><span>Izin ({r.izinDays} hari)</span><span>-{fmtRp(r.izinDeduction)}</span></div>}
                  {r.alphaDeduction > 0 && <div className="flex justify-between"><span>Alpha ({r.alphaDays} hari)</span><span>-{fmtRp(r.alphaDeduction)}</span></div>}
                  {r.lebihLiburDeduction > 0 && <div className="flex justify-between"><span>Libur Lebih ({r.lebihLiburDays} hari)</span><span>-{fmtRp(r.lebihLiburDeduction)}</span></div>}
                  {r.kasbonDeduction > 0 && <div className="flex justify-between"><span>Kasbon</span><span>-{fmtRp(r.kasbonDeduction)}</span></div>}
                  {r.loyalitasDeduction > 0 && <div className="flex justify-between"><span>Tabungan Loyalitas</span><span>-{fmtRp(r.loyalitasDeduction)}</span></div>}
                  {r.invLossDeduction > 0 && <div className="flex justify-between"><span>Kehilangan Barang (~{r.invLossPercent}% dr {fmtRp(r.invLossTotal)})</span><span>-{fmtRp(r.invLossDeduction)}</span></div>}
                  {r.cashierLossDeduction > 0 && <div className="flex justify-between"><span>Minus Kas Kasir (~{r.cashierLossPercent}% dr {fmtRp(r.cashierLossTotal)})</span><span>-{fmtRp(r.cashierLossDeduction)}</span></div>}
                  {totalPot === 0 && <p className="text-slate-300 italic">Tidak ada potongan.</p>}
                </div>
                <div>
                  <p className="font-semibold text-emerald-700 uppercase mb-1">Tambahan di Luar Gaji Pokok</p>
                  {r.overtimeTotal > 0 && <div className="flex justify-between"><span>Lembur</span><span>+{fmtRp(r.overtimeTotal)}</span></div>}
                  {r.kurangLiburAmount > 0 && <div className="flex justify-between"><span>Kompensasi Libur ({r.kurangLiburDays} hari)</span><span>+{fmtRp(r.kurangLiburAmount)}</span></div>}
                  {(r.bonusTotal - r.kurangLiburAmount) > 0 && <div className="flex justify-between"><span>Bonus (KPI/Kondisional/Tambahan)</span><span>+{fmtRp(r.bonusTotal - r.kurangLiburAmount)}</span></div>}
                  {r.overtimeTotal === 0 && r.bonusTotal === 0 && <p className="text-slate-300 italic">Tidak ada tambahan.</p>}
                </div>
              </div>
              <div className="flex justify-between mt-2 pt-1.5 border-t border-slate-200 text-xs text-slate-500">
                <span>Gaji Awal: {fmtRp(r.gajiAwal)}</span>
                <span>Total Bruto: {fmtRp(r.grossTotal)}</span>
                <span className="font-semibold text-slate-700">Total Potongan: -{fmtRp(totalPot)}</span>
              </div>
            </div>
          )
        })}
        {rows.length > 0 && (
          <div className="flex justify-between pt-2 font-bold text-sm text-slate-900 border-t-2 border-slate-800">
            <span>Total ({rows.length} karyawan)</span>
            <span>Awal: {fmtRp(totalGajiAwal)} · Potongan: -{fmtRp(totalPotongan)} · Akhir: {fmtRp(totalGajiAkhir)}</span>
          </div>
        )}
      </div>

      <div id="ringkasan-print-area" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:hidden">
        <div className="overflow-auto max-h-[70vh] print:max-h-none print:overflow-visible">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white sticky top-0 z-20">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap sticky top-0 left-0 z-30 bg-white shadow-[2px_0_4px_-1px_rgba(0,0,0,0.08)]">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Gaji Awal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">Catatan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Total Potongan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Gaji Akhir</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center whitespace-nowrap print-hide">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center whitespace-nowrap print-hide">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">Memuat ringkasan...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-400 text-sm">Belum ada slip gaji untuk periode ini.</td></tr>
              ) : (
                rows.map(r => {
                  const notes = buildCatatan(r)
                  const totalPot = r.lateDeduction + r.kasbonDeduction + r.loyalitasDeduction + r.invLossDeduction + r.cashierLossDeduction + absenDeductionTotal(r)
                  const isOpen = expanded.has(r.payrollId)
                  return (
                    <Fragment key={r.payrollId}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 sticky left-0 z-10 bg-white shadow-[2px_0_4px_-1px_rgba(0,0,0,0.08)]">
                          <div className="font-medium text-slate-800 whitespace-nowrap">{r.name}</div>
                          <div className="text-xs text-slate-400">{r.position} · {r.branchName}</div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-slate-700">{fmtRp(r.gajiAwal)}</td>
                        <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                          {notes.length > 0 ? notes.join(' · ') : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-red-500">
                          {totalPot > 0 ? `-${fmtRp(totalPot)}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-bold text-slate-900">{fmtRp(r.netTotal)}</td>
                        <td className="px-4 py-3 text-center print-hide">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                        </td>
                        <td className="px-4 py-3 text-center print-hide">
                          <button onClick={() => toggleExpand(r.payrollId)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            {isOpen ? 'Tutup ▲' : 'Rincian ▼'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                              <div>
                                <p className="font-semibold text-red-600 uppercase mb-2">Rincian Potongan</p>
                                <div className="space-y-1 text-slate-600">
                                  {r.lateDeduction > 0 && <div className="flex justify-between"><span>Keterlambatan ({fmtJam(r.totalLateMinutes)})</span><span className="text-red-500">-{fmtRp(r.lateDeduction)}</span></div>}
                                  {r.sickDeduction > 0 && <div className="flex justify-between"><span>Sakit ({r.sickDays} hari)</span><span className="text-red-500">-{fmtRp(r.sickDeduction)}</span></div>}
                                  {r.izinDeduction > 0 && <div className="flex justify-between"><span>Izin ({r.izinDays} hari)</span><span className="text-red-500">-{fmtRp(r.izinDeduction)}</span></div>}
                                  {r.alphaDeduction > 0 && <div className="flex justify-between"><span>Alpha ({r.alphaDays} hari)</span><span className="text-red-500">-{fmtRp(r.alphaDeduction)}</span></div>}
                                  {r.lebihLiburDeduction > 0 && <div className="flex justify-between"><span>Libur Lebih ({r.lebihLiburDays} hari)</span><span className="text-red-500">-{fmtRp(r.lebihLiburDeduction)}</span></div>}
                                  {r.kasbonDeduction > 0 && <div className="flex justify-between"><span>Kasbon</span><span className="text-red-500">-{fmtRp(r.kasbonDeduction)}</span></div>}
                                  {r.loyalitasDeduction > 0 && <div className="flex justify-between"><span>Tabungan Loyalitas</span><span className="text-red-500">-{fmtRp(r.loyalitasDeduction)}</span></div>}
                                  {r.invLossDeduction > 0 && <div className="flex justify-between"><span>Kehilangan Barang (~{r.invLossPercent}% dari {fmtRp(r.invLossTotal)})</span><span className="text-red-500">-{fmtRp(r.invLossDeduction)}</span></div>}
                                  {r.cashierLossDeduction > 0 && <div className="flex justify-between"><span>Minus Kas Kasir (~{r.cashierLossPercent}% dari {fmtRp(r.cashierLossTotal)})</span><span className="text-red-500">-{fmtRp(r.cashierLossDeduction)}</span></div>}
                                  {totalPot === 0 && <p className="text-slate-300 italic">Tidak ada potongan.</p>}
                                </div>
                              </div>
                              <div>
                                <p className="font-semibold text-emerald-600 uppercase mb-2">Tambahan di Luar Gaji Pokok</p>
                                <div className="space-y-1 text-slate-600">
                                  {r.overtimeTotal > 0 && <div className="flex justify-between"><span>Lembur</span><span className="text-emerald-600">+{fmtRp(r.overtimeTotal)}</span></div>}
                                  {r.kurangLiburAmount > 0 && <div className="flex justify-between"><span>Kompensasi Libur ({r.kurangLiburDays} hari)</span><span className="text-emerald-600">+{fmtRp(r.kurangLiburAmount)}</span></div>}
                                  {r.bonusTotal - r.kurangLiburAmount > 0 && <div className="flex justify-between"><span>Bonus (KPI/Kondisional/Tambahan)</span><span className="text-emerald-600">+{fmtRp(r.bonusTotal - r.kurangLiburAmount)}</span></div>}
                                  {r.overtimeTotal === 0 && r.bonusTotal === 0 && <p className="text-slate-300 italic">Tidak ada tambahan.</p>}
                                </div>
                                <div className="flex justify-between mt-3 pt-2 border-t border-slate-200 font-semibold text-slate-700">
                                  <span>Total Bruto</span><span>{fmtRp(r.grossTotal)}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && rows.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs text-slate-500">
            <span>{rows.length} karyawan · periode {getPeriodLabel(filterMonth, filterYear)}</span>
            <div className="flex gap-4">
              <span>Total Gaji Awal: <strong className="text-slate-700">{fmtRp(totalGajiAwal)}</strong></span>
              <span>Total Potongan: <strong className="text-red-600">-{fmtRp(totalPotongan)}</strong></span>
              <span>Total Gaji Akhir: <strong className="text-blue-600">{fmtRp(totalGajiAkhir)}</strong></span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          nav, aside { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .max-w-6xl { max-width: none !important; }
          .print-hide { display: none !important; }
        }
      `}</style>
    </div>
  )
}
