'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)
// Format ringkas untuk print: tanpa "Rp", gunakan titik sebagai pemisah ribuan
const fmtPrint = (v: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v)

// Komponen Amount: tampilkan format penuh di layar, format ringkas di print
function Amt({ v, className }: { v: number; className?: string }) {
  if (v === 0) return <span className="text-slate-300">—</span>
  return (
    <span className={className}>
      <span className="screen-only">{fmtRp(v)}</span>
      <span className="print-only">{fmtPrint(v)}</span>
    </span>
  )
}
function AmtNeg({ v, className }: { v: number; className?: string }) {
  if (v === 0) return <span className="text-slate-300">—</span>
  return (
    <span className={className}>
      <span className="screen-only">-{fmtRp(v)}</span>
      <span className="print-only">-{fmtPrint(v)}</span>
    </span>
  )
}

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
  late_deduction: number
  kasbon_deduction: number
  absent_deduction: number
  absent_days: number
  inventory_loss_deduction: number
  cashier_loss_deduction: number
  loyalitas_deduction: number
  gross_total: number
  net_total: number
  status: string
  employee: {
    full_name: string
    employee_code: string
    branch_id: string
    branches: { name: string } | null
    positions: { name: string } | null
  } | null
}

type BonusAssessment = {
  criteria_id: string
  is_achieved: boolean
  notes: string | null
  criteria: { criteria_name: string; nominal_amount: number } | null
}

type AttendanceSummary = {
  employee_id: string
  hadir: number
  tidak_hadir: number
  libur: number
}

type LossData = {
  branch_id: string
  branch_name: string
  total_loss: number
  company_pct: number
  company_cover: number
  employee_cover: number
}

export default function LaporanPage() {
  const supabase = createClient()
  const today = new Date()
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [groupBy, setGroupBy] = useState<'branch' | 'all'>('branch')
  const [loading, setLoading] = useState(false)

  const [payrolls, setPayrolls] = useState<PayrollRow[]>([])
  const [bonusMap, setBonusMap] = useState<Record<string, BonusAssessment[]>>({})
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceSummary>>({})
  const [lossData, setLossData] = useState<LossData[]>([])
  const [branches, setBranches] = useState<{id:string;name:string}[]>([])

  const yearOptions = [today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1]

  // Hitung periode (26 bulan lalu - 25 bulan ini)
  function getPeriodDates(month: number, year: number) {
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const firstDay = `${prevYear}-${String(prevMonth).padStart(2,'0')}-26`
    const lastDay = `${year}-${String(month).padStart(2,'0')}-25`
    return { firstDay, lastDay }
  }

  async function fetchReport() {
    setLoading(true)
    const { firstDay, lastDay } = getPeriodDates(filterMonth, filterYear)

    // 1. Payrolls
    const { data: payrollData } = await supabase
      .from('payrolls')
      .select(`
        id, employee_id, period_month, period_year,
        base_salary, position_allowance, meal_allowance,
        overtime_total, kpi_bonus, conditional_bonus,
        late_deduction, kasbon_deduction, absent_deduction, absent_days,
        inventory_loss_deduction, cashier_loss_deduction, loyalitas_deduction,
        gross_total, net_total, status,
        employee:employees!payrolls_employee_id_fkey(
          full_name, employee_code, branch_id,
          branches(name), positions(name)
        )
      `)
      .eq('period_month', filterMonth)
      .eq('period_year', filterYear)
      .order('employee_id')

    const rows = (payrollData || []) as unknown as PayrollRow[]
    setPayrolls(rows)

    if (rows.length === 0) { setLoading(false); return }

    const payrollIds = rows.map(p => p.id)
    const empIds = rows.map(p => p.employee_id)

    // 2. Bonus assessments
    const { data: bonusData } = await supabase
      .from('payroll_bonus_assessments')
      .select('payroll_id, criteria_id, is_achieved, notes, criteria:employee_bonus_criteria!payroll_bonus_assessments_criteria_id_fkey(criteria_name, nominal_amount)')
      .in('payroll_id', payrollIds)
      .eq('is_achieved', true)

    const bMap: Record<string, BonusAssessment[]> = {}
    ;(bonusData || []).forEach((b: any) => {
      if (!bMap[b.payroll_id]) bMap[b.payroll_id] = []
      bMap[b.payroll_id].push(b)
    })
    setBonusMap(bMap)

    // 3. Absensi summary
    const { data: attData } = await supabase
      .from('attendances')
      .select('employee_id, status, date')
      .in('employee_id', empIds)
      .gte('date', firstDay)
      .lte('date', lastDay)

    const aMap: Record<string, AttendanceSummary> = {}
    empIds.forEach(id => { aMap[id] = { employee_id: id, hadir: 0, tidak_hadir: 0, libur: 0 } })
    ;(attData || []).forEach((a: any) => {
      if (!aMap[a.employee_id]) return
      if (a.status === 'present') aMap[a.employee_id].hadir++
      else if (a.status === 'absent') aMap[a.employee_id].tidak_hadir++
      else if (['leave','sick','permission'].includes(a.status)) aMap[a.employee_id].libur++
    })
    setAttendanceMap(aMap)

    // 4. Kehilangan per cabang
    const { data: lossInputs } = await supabase
      .from('loss_monthly_inputs')
      .select('branch_id, total_loss_amount, branches(name)')
      .eq('period_month', filterMonth)
      .eq('period_year', filterYear)

    const { data: lossConfigs } = await supabase
      .from('branch_loss_configs')
      .select('branch_id, company_coverage_percent, created_at')
      .order('created_at', { ascending: false })

    // Ambil config terbaru per cabang
    const configMap: Record<string, number> = {}
    ;(lossConfigs || []).forEach((c: any) => {
      if (configMap[c.branch_id] === undefined) configMap[c.branch_id] = Number(c.company_coverage_percent)
    })

    const lossRows: LossData[] = (lossInputs || []).map((l: any) => {
      const total = Number(l.total_loss_amount)
      const pct = configMap[l.branch_id] ?? 0
      const companyCover = Math.round(total * pct / 100)
      return {
        branch_id: l.branch_id,
        branch_name: (l.branches as any)?.name ?? '—',
        total_loss: total,
        company_pct: pct,
        company_cover: companyCover,
        employee_cover: total - companyCover,
      }
    })
    setLossData(lossRows)

    // 5. Branches
    const { data: branchData } = await supabase.from('branches').select('id,name').eq('is_active',true).order('name')
    setBranches(branchData || [])

    setLoading(false)
  }

  // Grouping
  const branchGroups = (() => {
    if (groupBy === 'all') return [{ id: 'all', name: 'Semua Cabang', rows: payrolls }]
    const map: Record<string, { id: string; name: string; rows: PayrollRow[] }> = {}
    payrolls.forEach(p => {
      const bid = p.employee?.branch_id ?? 'unknown'
      const bname = (p.employee?.branches as any)?.name ?? '—'
      if (!map[bid]) map[bid] = { id: bid, name: bname, rows: [] }
      map[bid].rows.push(p)
    })
    return Object.values(map).sort((a,b) => a.name.localeCompare(b.name))
  })()

  // Ringkasan per cabang
  const branchSummary = branchGroups.map(g => ({
    name: g.name,
    count: g.rows.length,
    totalBruto: g.rows.reduce((s,p) => s + Number(p.gross_total), 0),
    totalPotongan: g.rows.reduce((s,p) => s + Number(p.late_deduction) + Number(p.kasbon_deduction) + Number(p.absent_deduction) + Number(p.inventory_loss_deduction) + Number(p.cashier_loss_deduction) + Number(p.loyalitas_deduction ?? 0), 0),
    totalBersih: g.rows.reduce((s,p) => s + Number(p.net_total), 0),
  }))

  const grandTotals = {
    count: payrolls.length,
    bruto: payrolls.reduce((s,p) => s + Number(p.gross_total), 0),
    potongan: payrolls.reduce((s,p) => s + Number(p.late_deduction) + Number(p.kasbon_deduction) + Number(p.absent_deduction) + Number(p.inventory_loss_deduction) + Number(p.cashier_loss_deduction) + Number(p.loyalitas_deduction ?? 0), 0),
    bersih: payrolls.reduce((s,p) => s + Number(p.net_total), 0),
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print-hide">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">📄 Laporan Penggajian</h1>
          <p className="text-sm text-slate-500">Ringkasan bulanan untuk owner</p>
        </div>
        <button onClick={() => window.print()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition flex items-center gap-2">
          🖨️ Cetak / Simpan PDF
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6 print-hide">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Bulan</label>
            <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
              {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tahun</label>
            <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tampilan</label>
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              {(['branch','all'] as const).map(v => (
                <button key={v} onClick={() => setGroupBy(v)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition ${groupBy===v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {v === 'branch' ? '🏢 Per Cabang' : '📋 Semua'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={fetchReport} disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
            {loading ? 'Memuat...' : '🔍 Tampilkan Laporan'}
          </button>
        </div>
      </div>

      {payrolls.length === 0 && !loading && (
        <div className="text-center py-16 text-slate-400 text-sm">Pilih bulan & tahun lalu klik Tampilkan Laporan</div>
      )}

      {payrolls.length > 0 && (
        <div className="space-y-8" id="laporan-content">

          {/* ── Print header ── */}
          <div className="hidden print:block mb-5">
            <div className="flex justify-between items-start">
              <div>
                <div className="print-title">LAPORAN PENGGAJIAN BULANAN</div>
                <div className="print-subtitle">
                  Periode: {MONTHS[filterMonth-1]} {filterYear} &nbsp;·&nbsp;
                  Dicetak: {new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})} &nbsp;·&nbsp;
                  Hammielion HRIS
                </div>
              </div>
              <div className="text-right print-subtitle">
                <div className="font-bold text-slate-700">{grandTotals.count} Karyawan</div>
                <div>Total Bersih: <strong>{fmtRp(grandTotals.bersih)}</strong></div>
              </div>
            </div>
            <hr style={{borderTop:'2px solid #1e293b', marginTop:'8px'}} />
          </div>

          {/* ── Ringkasan per cabang ── */}
          <section>
            <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-1 h-5 bg-blue-500 rounded-full inline-block"></span>
              Ringkasan Per Cabang — {MONTHS[filterMonth-1]} {filterYear}
            </h2>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-sm summary-table">
                <thead className="bg-slate-800 text-white">
                  <tr>
                    {['Cabang','Karyawan','Total Bruto','Total Potongan','Total Gaji Bersih'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {branchSummary.map((b,i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-800">{b.name}</td>
                      <td className="px-4 py-3 text-slate-600 text-center">{b.count}</td>
                      <td className="px-4 py-3 text-slate-700"><Amt v={b.totalBruto} /></td>
                      <td className="px-4 py-3 text-red-600 font-medium"><AmtNeg v={b.totalPotongan} /></td>
                      <td className="px-4 py-3 font-bold text-green-700"><Amt v={b.totalBersih} className="text-green-700" /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="dark">
                  <tr>
                    <td className="px-4 py-3 text-white font-bold text-sm">TOTAL</td>
                    <td className="px-4 py-3 text-white text-center font-bold">{grandTotals.count}</td>
                    <td className="px-4 py-3 text-white font-bold"><Amt v={grandTotals.bruto} /></td>
                    <td className="px-4 py-3 text-white font-bold"><AmtNeg v={grandTotals.potongan} /></td>
                    <td className="px-4 py-3 font-bold text-green-300"><Amt v={grandTotals.bersih} /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── Detail per karyawan ── */}
          {branchGroups.map((group, gi) => (
            <section key={group.id} className={`allow-break ${gi > 0 ? 'page-break' : ''}`}>
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-emerald-500 rounded-full inline-block"></span>
                Detail Karyawan {groupBy === 'branch' ? `— ${group.name}` : '— Semua Cabang'}
              </h2>

              {/* Tabel 1: Absensi + Pendapatan */}
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1.5 tracking-wide">Absensi & Pendapatan</p>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto mb-4">
                <table className="w-full text-xs detail-table">
                  <thead className="bg-slate-800 text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Karyawan</th>
                      {groupBy === 'all' && <th className="px-3 py-2.5 text-left">Cabang</th>}
                      <th className="px-3 py-2.5 text-center">Hadir</th>
                      <th className="px-3 py-2.5 text-center">Absen</th>
                      <th className="px-3 py-2.5 text-center">Libur</th>
                      <th className="px-3 py-2.5 text-right">Gaji Pokok</th>
                      <th className="px-3 py-2.5 text-right">Tunjangan</th>
                      <th className="px-3 py-2.5 text-right">Lembur</th>
                      <th className="px-3 py-2.5 text-right">KPI</th>
                      <th className="px-3 py-2.5 text-right">Bonus Kond.</th>
                      <th className="px-3 py-2.5 text-right" style={{background:'#166534',color:'white'}}>Total Bruto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.rows.map((p,ri) => {
                      const att = attendanceMap[p.employee_id] || { hadir: 0, tidak_hadir: 0, libur: 0 }
                      const bonuses = bonusMap[p.id] || []
                      const tunjangan = Number(p.position_allowance) + Number(p.meal_allowance)
                      return (
                        <tr key={p.id} className={ri % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}>
                          <td className="px-3 py-2.5 col-nama">
                            <div className="font-semibold text-slate-800">{p.employee?.full_name}</div>
                            <div className="text-slate-400 text-[9px]">{p.employee?.employee_code} · {(p.employee?.positions as any)?.name}</div>
                          </td>
                          {groupBy === 'all' && <td className="px-3 py-2 text-slate-600 col-cabang">{(p.employee?.branches as any)?.name ?? '—'}</td>}
                          <td className="px-3 py-2.5 text-center font-bold text-green-700">{att.hadir}</td>
                          <td className="px-3 py-2.5 text-center font-bold text-red-600">{att.tidak_hadir || p.absent_days || 0}</td>
                          <td className="px-3 py-2.5 text-center text-slate-500">{att.libur}</td>
                          <td className="px-3 py-2.5 text-right text-slate-700"><Amt v={Number(p.base_salary)} /></td>
                          <td className="px-3 py-2.5 text-right text-slate-700"><Amt v={tunjangan} /></td>
                          <td className="px-3 py-2.5 text-right text-slate-600"><Amt v={Number(p.overtime_total)} /></td>
                          <td className="px-3 py-2.5 text-right text-slate-600"><Amt v={Number(p.kpi_bonus)} /></td>
                          <td className="px-3 py-2.5 text-right text-slate-600">
                            {Number(p.conditional_bonus) > 0 ? (
                              <div>
                                <Amt v={Number(p.conditional_bonus)} />
                                {bonuses.map((b,i) => (
                                  <div key={i} className="text-[9px] text-green-600">✓ {b.criteria?.criteria_name}{b.notes ? ` — ${b.notes}` : ''}</div>
                                ))}
                              </div>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-green-700"><Amt v={Number(p.gross_total)} className="text-green-700" /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={groupBy === 'all' ? 2 : 1} className="px-3 py-2 font-bold text-xs uppercase text-slate-700">Subtotal</td>
                      <td className="px-3 py-2 text-center font-bold text-green-700">{group.rows.reduce((s,p)=>s+(attendanceMap[p.employee_id]?.hadir||0),0)}</td>
                      <td colSpan={6} className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right font-bold text-green-700"><Amt v={group.rows.reduce((s,p)=>s+Number(p.gross_total),0)} className="text-green-700" /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Tabel 2: Potongan + Gaji Bersih */}
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1.5 tracking-wide">Potongan & Gaji Bersih</p>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs detail-table">
                  <thead className="bg-slate-700 text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Karyawan</th>
                      {groupBy === 'all' && <th className="px-3 py-2.5 text-left">Cabang</th>}
                      <th className="px-3 py-2.5 text-right" style={{color:'#fca5a5'}}>- Terlambat</th>
                      <th className="px-3 py-2.5 text-right" style={{color:'#fca5a5'}}>- Tdk Hadir</th>
                      <th className="px-3 py-2.5 text-right" style={{color:'#fca5a5'}}>- Kasbon</th>
                      <th className="px-3 py-2.5 text-right" style={{color:'#fca5a5'}}>- Kehilangan</th>
                      <th className="px-3 py-2.5 text-right" style={{color:'#fca5a5'}}>- Kasir</th>
                      <th className="px-3 py-2.5 text-right" style={{color:'#fca5a5'}}>- Loyalitas</th>
                      <th className="px-3 py-2.5 text-right" style={{background:'#1e40af',color:'white'}}>Gaji Bersih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.rows.map((p,ri) => (
                      <tr key={p.id} className={ri % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}>
                        <td className="px-3 py-2.5 col-nama">
                          <div className="font-semibold text-slate-800">{p.employee?.full_name}</div>
                          <div className="text-slate-400 text-[9px]">{p.employee?.employee_code}</div>
                        </td>
                        {groupBy === 'all' && <td className="px-3 py-2 text-slate-600 col-cabang">{(p.employee?.branches as any)?.name ?? '—'}</td>}
                        <td className="px-3 py-2.5 text-right text-red-600"><AmtNeg v={Number(p.late_deduction)} /></td>
                        <td className="px-3 py-2.5 text-right text-red-600"><AmtNeg v={Number(p.absent_deduction)} /></td>
                        <td className="px-3 py-2.5 text-right text-red-600"><AmtNeg v={Number(p.kasbon_deduction)} /></td>
                        <td className="px-3 py-2.5 text-right text-red-600"><AmtNeg v={Number(p.inventory_loss_deduction)} /></td>
                        <td className="px-3 py-2.5 text-right text-red-600"><AmtNeg v={Number(p.cashier_loss_deduction)} /></td>
                        <td className="px-3 py-2.5 text-right text-red-600"><AmtNeg v={Number(p.loyalitas_deduction)} /></td>
                        <td className="px-3 py-2.5 text-right font-bold text-blue-700"><Amt v={Number(p.net_total)} className="text-blue-700" /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={groupBy === 'all' ? 7 : 6} className="px-3 py-2 font-bold text-xs uppercase text-slate-700">Subtotal Gaji Bersih {group.name}</td>
                      <td className="px-3 py-2 text-right font-bold text-blue-700"><Amt v={group.rows.reduce((s,p)=>s+Number(p.net_total),0)} className="text-blue-700" /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}

          {/* ── Kehilangan per cabang ── */}
          {lossData.length > 0 && (
            <section>
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-red-500 rounded-full inline-block"></span>
                Kehilangan Barang Per Cabang — {MONTHS[filterMonth-1]} {filterYear}
              </h2>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Cabang','Total Kehilangan','% Kantor','Ditanggung Kantor','Ditanggung Karyawan'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lossData.map((l,i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-slate-800">{l.branch_name}</td>
                        <td className="px-4 py-3 font-semibold text-red-600"><Amt v={l.total_loss} /></td>
                        <td className="px-4 py-3 text-slate-600">{l.company_pct}%</td>
                        <td className="px-4 py-3 text-blue-600"><Amt v={l.company_cover} /></td>
                        <td className="px-4 py-3 text-red-600 font-medium"><Amt v={l.employee_cover} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 border-t border-slate-300">
                    <tr>
                      <td className="px-4 py-2.5 font-bold text-slate-700 text-xs uppercase">Total</td>
                      <td className="px-4 py-2.5 font-bold text-red-600"><Amt v={lossData.reduce((s,l)=>s+l.total_loss,0)} /></td>
                      <td></td>
                      <td className="px-4 py-2.5 font-bold text-blue-600"><Amt v={lossData.reduce((s,l)=>s+l.company_cover,0)} /></td>
                      <td className="px-4 py-2.5 font-bold text-red-600"><Amt v={lossData.reduce((s,l)=>s+l.employee_cover,0)} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {/* ── Footer laporan ── */}
          <div className="text-center text-xs text-slate-400 py-4 border-t border-slate-200 print:block">
            Laporan dibuat otomatis oleh Hammielion HRIS · {MONTHS[filterMonth-1]} {filterYear}
          </div>

        </div>
      )}

      {/* Print styles */}
      <style>{`
        /* ── Screen: sembunyikan print-only ── */
        .print-only { display: none; }
        .screen-only { display: inline; }

        @media print {
          /* ── Reset & page ── */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
          @page { size: A4 landscape; margin: 8mm 10mm; }

          body { font-size: 9px; font-family: Arial, sans-serif; color: #1e293b; background: white !important; margin: 0; }

          /* ── Visibilitas ── */
          .print-hide { display: none !important; }
          .print-only { display: inline !important; }
          .screen-only { display: none !important; }

          /* ── Dekorasi layar ── */
          .rounded-xl, .rounded-lg, .shadow-sm { border-radius: 0 !important; box-shadow: none !important; }
          .overflow-x-auto { overflow: visible !important; }
          .border { border: none !important; }

          /* ── Section & page-break ── */
          section { margin-bottom: 12px; }
          section.allow-break { page-break-inside: auto; }
          .page-break { page-break-before: always; }

          /* ── Typography ── */
          h2 { font-size: 10px !important; font-weight: 700; color: #0f172a; border-bottom: 1.5px solid #334155; padding-bottom: 3px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; }
          h2 span.w-1 { display: none; }
          .print-title { font-size: 14px; font-weight: 800; color: #0f172a; }
          .print-subtitle { font-size: 9px; color: #475569; margin-top: 2px; }
          p.text-xs { font-size: 8px !important; margin-bottom: 4px !important; }

          /* ── Tables umum ── */
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th {
            background: #1e293b !important; color: white !important;
            padding: 4px 4px; text-align: left; font-size: 7px; font-weight: 700;
            white-space: normal; word-break: break-word; line-height: 1.2;
          }
          th[class*="text-right"], th.text-right { text-align: right; }
          th[class*="text-center"], th.text-center { text-align: center; }
          td { padding: 2px 4px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; font-size: 8px; }
          tr:nth-child(even) td { background: #f8fafc !important; }
          tfoot td { background: #f1f5f9 !important; font-weight: 700; border-top: 1.5px solid #334155; font-size: 8px; }
          tfoot.dark td { background: #1e293b !important; color: white !important; }

          /* ── Warna ── */
          .text-green-700, [class*="text-green-700"] { color: #15803d !important; }
          .text-red-600,  [class*="text-red-600"]  { color: #dc2626 !important; }
          .text-blue-700, [class*="text-blue-700"] { color: #1d4ed8 !important; }
          .text-blue-600, [class*="text-blue-600"] { color: #2563eb !important; }
          .text-slate-400 { color: #94a3b8 !important; }
          .text-slate-300 { color: #cbd5e1 !important; }

          /* ── Ringkasan cabang ── */
          .summary-table { table-layout: auto; }
          .summary-table th { font-size: 8px; padding: 5px 6px; }
          .summary-table td { font-size: 9px; padding: 4px 6px; }

          /* ── Detail karyawan — kolom lebar fixed ── */
          .detail-table { table-layout: fixed; }
          .detail-table th { font-size: 6.5px; padding: 3px 3px; }
          .detail-table td { font-size: 7.5px; padding: 2px 3px; line-height: 1.3; }

          /* Kolom nama karyawan: lebih lebar */
          .detail-table .col-nama { width: 110px; }
          .detail-table .col-cabang { width: 70px; }

          /* Kolom angka: narrow */
          .detail-table th:not(.col-nama):not(.col-cabang),
          .detail-table td:not(.col-nama):not(.col-cabang) {
            width: auto;
            white-space: nowrap;
            text-align: right;
          }

          /* Nama karyawan: wrap normal */
          .detail-table .col-nama div { overflow: hidden; white-space: normal; word-break: break-word; }

          /* ── Footer ── */
          .print\\:block { display: block !important; }
        }
      `}</style>
    </div>
  )
}
