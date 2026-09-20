'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getCurrentPeriodRangeStr, rosterPeriodLabel } from '@/lib/rosterPeriod'
import { calcEscalatingDeduction, IZIN_GROUP_MULTIPLIERS, ALPHA_GROUP_MULTIPLIERS, type EscalatingResult } from '@/lib/escalatingDeduction'

const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

type SalarySummary = {
  base_salary: number; position_allowance: number; meal_allowance: number; special_allowance: number
  daily_rate: number; overtime_rate_per_hour: number; overtime_eligible: boolean
  branch_name: string | null; department_name: string | null
}

type EmployeeRow = {
  id: string; full_name: string; employee_code: string
  branchName: string; departmentName: string
  base_salary: number; position_allowance: number; meal_allowance: number; special_allowance: number
  dailyRate: number; overtimeRate: number; overtimeEligible: boolean
  izin: EscalatingResult; alpha: EscalatingResult; sickDocDays: number
}

function fmtDateShort(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
}

// Kartu rincian aturan + sumber angka, dipakai untuk tampilan diri sendiri (karyawan) maupun
// modal detail per-orang (Owner/HR) — supaya rumus & angkanya selalu identik di kedua tempat.
function RateCard({ label, base, pos, meal, special, dailyRate, overtimeRate, overtimeEligible, lateRate }: {
  label?: string; base: number; pos: number; meal: number; special: number
  dailyRate: number; overtimeRate: number; overtimeEligible: boolean; lateRate: number
}) {
  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
        <p className="font-medium text-blue-800 mb-1">{label ? `Sumber gaji harian ${label}:` : 'Sumber gaji harian Anda:'}</p>
        <p className="text-blue-700">
          {fmtRp(base)} (Gaji Pokok) + {fmtRp(pos)} (Tunj. Jabatan) + {fmtRp(meal)} (Tunj. Tetap) + {fmtRp(special)} (Tunj. Khusus)
          {' '}= {fmtRp(base + pos + meal + special)} ÷ 26 hari = <strong>{fmtRp(dailyRate)}/hari</strong>
        </p>
        <p className="text-xs text-blue-500 mt-1">Angka ini yang jadi dasar SEMUA potongan izin/sakit/alpha di bawah.</p>
      </div>

      <div>
        <p className="text-sm font-semibold text-orange-700 mb-2">Izin Duka / Periksa-Keperluan / Sakit Tanpa Surat — per kejadian, reset tiap periode</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-orange-50 text-orange-800"><th className="px-3 py-1.5 text-left">Kejadian</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan</th></tr></thead>
            <tbody className="divide-y divide-orange-100">
              {IZIN_GROUP_MULTIPLIERS.map((m, i) => (
                <tr key={i}><td className="px-3 py-1.5">Ke-{i + 1}{i === IZIN_GROUP_MULTIPLIERS.length - 1 ? ' (mentok)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(dailyRate * m))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-red-700 mb-2">Alpha (termasuk hari kosong tanpa keterangan di luar kuota) — per kejadian, reset tiap periode</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-red-50 text-red-800"><th className="px-3 py-1.5 text-left">Kejadian</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan</th></tr></thead>
            <tbody className="divide-y divide-red-100">
              {ALPHA_GROUP_MULTIPLIERS.map((m, i) => (
                <tr key={i}><td className="px-3 py-1.5">Ke-{i + 1}{i === ALPHA_GROUP_MULTIPLIERS.length - 1 ? ' (mentok)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(dailyRate * m))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-blue-700 mb-2">Sakit Dengan Surat Dokter — per hari berturut (bukan per kejadian)</p>
        <div className="text-sm bg-slate-50 rounded-lg p-3 space-y-1">
          <p>Hari ke-1: <strong className="text-green-600">Gratis</strong></p>
          <p>Hari ke-2 &amp; ke-3: <strong>{fmtRp(Math.round(dailyRate * 0.5))}/hari</strong> (0.5×)</p>
          <p>Hari ke-4 dst: <strong>{fmtRp(dailyRate)}/hari</strong> (1×)</p>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">Terlambat &amp; Lembur</p>
        <div className="text-sm bg-slate-50 rounded-lg p-3 space-y-1">
          <p>Terlambat: <strong>{fmtRp(lateRate)}/menit</strong> — tarif sama untuk semua staff (toleransi 5 menit khusus absen QR)</p>
          <p>Lembur: <strong>{fmtRp(overtimeRate)}/jam</strong>
            {overtimeEligible
              ? <span className="text-green-600"> — berlaku untuk penempatan ini</span>
              : <span className="text-slate-400"> — TIDAK berlaku untuk penempatan ini (Team Gudang / dinonaktifkan khusus)</span>}
          </p>
        </div>
      </div>
    </div>
  )
}

function EscalatingStatus({ title, result, colorClass }: { title: string; result: EscalatingResult; colorClass: string }) {
  if (result.blocks.length === 0) return <p className="text-sm text-slate-400">{title}: belum ada kejadian periode ini.</p>
  return (
    <div>
      <p className={`text-sm font-semibold mb-1 ${colorClass}`}>{title} — {result.blocks.length} kejadian, total {fmtRp(result.total)}</p>
      <div className="space-y-0.5 pl-3">
        {result.blocks.map((b, i) => (
          <p key={i} className="text-xs text-slate-500">
            └ Ke-{b.occurrence} ({fmtDateShort(b.dates[0])}{b.dates.length > 1 ? `–${fmtDateShort(b.dates[b.dates.length - 1])}` : ''}, {b.dates.length} hari) × {b.multiplier}× = {fmtRp(b.subtotal)}
          </p>
        ))}
      </div>
    </div>
  )
}

export default function AturanPotonganPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [lateRate, setLateRate] = useState(0)

  // Diri sendiri (karyawan)
  const [mySummary, setMySummary] = useState<SalarySummary | null>(null)
  const [myIzin, setMyIzin] = useState<EscalatingResult>({ total: 0, blocks: [] })
  const [myAlpha, setMyAlpha] = useState<EscalatingResult>({ total: 0, blocks: [] })
  const [mySickDoc, setMySickDoc] = useState(0)

  // Semua karyawan (Owner/HR/Finance)
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [detailRow, setDetailRow] = useState<EmployeeRow | null>(null)

  const period = getCurrentPeriodRangeStr()

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
    if (!userData) return

    const { data: lateDef } = await supabase.from('salary_defaults').select('late_penalty_per_minute').limit(1).maybeSingle()
    setLateRate(Number(lateDef?.late_penalty_per_minute ?? 0))

    const admin = ['owner', 'hr', 'finance'].includes(userData.role)
    setIsAdmin(admin)

    if (admin) await fetchAllEmployees()
    else if (userData.employee_id) await fetchMyStatus(userData.employee_id)

    setLoading(false)
  }

  async function fetchMyStatus(empId: string) {
    const [{ data: summary }, { data: atts }] = await Promise.all([
      supabase.rpc('get_my_salary_summary'),
      supabase.from('attendances').select('date, status').eq('employee_id', empId).gte('date', period.start).lte('date', period.end),
    ])
    const s = (summary as SalarySummary[] | null)?.[0] ?? null
    setMySummary(s)
    const dailyRate = s?.daily_rate ?? 0
    const izinDates = (atts || []).filter(a => a.status === 'sick' || a.status === 'permission').map(a => a.date as string)
    const alphaDates = (atts || []).filter(a => a.status === 'absent').map(a => a.date as string)
    setMyIzin(calcEscalatingDeduction(izinDates, dailyRate, IZIN_GROUP_MULTIPLIERS))
    setMyAlpha(calcEscalatingDeduction(alphaDates, dailyRate, ALPHA_GROUP_MULTIPLIERS))
    setMySickDoc((atts || []).filter(a => a.status === 'sick_doc').length)
  }

  async function fetchAllEmployees() {
    const [{ data: emps }, { data: scAll }, { data: attAll }] = await Promise.all([
      supabase.from('employees')
        .select('id, full_name, employee_code, overtime_applicable, branches(name), departments(name)')
        .eq('is_active', true).order('full_name'),
      supabase.from('salary_components')
        .select('employee_id, base_salary, position_allowance, meal_allowance, special_allowance, overtime_rate_per_hour, effective_date')
        .order('effective_date', { ascending: false }),
      supabase.from('attendances').select('employee_id, date, status').gte('date', period.start).lte('date', period.end),
    ])

    const scMap = new Map<string, { base: number; pos: number; meal: number; special: number; ot: number }>()
    ;(scAll || []).forEach((sc: any) => {
      if (!scMap.has(sc.employee_id)) {
        scMap.set(sc.employee_id, {
          base: Number(sc.base_salary ?? 0), pos: Number(sc.position_allowance ?? 0),
          meal: Number(sc.meal_allowance ?? 0), special: Number(sc.special_allowance ?? 0),
          ot: Number(sc.overtime_rate_per_hour ?? 0),
        })
      }
    })
    const attByEmp = new Map<string, { date: string; status: string }[]>()
    ;(attAll || []).forEach((a: any) => {
      if (!attByEmp.has(a.employee_id)) attByEmp.set(a.employee_id, [])
      attByEmp.get(a.employee_id)!.push(a)
    })

    const result: EmployeeRow[] = (emps || []).map((e: any) => {
      const sc = scMap.get(e.id) ?? { base: 0, pos: 0, meal: 0, special: 0, ot: 0 }
      const dailyRate = Math.round((sc.base + sc.pos + sc.meal + sc.special) / 26)
      const atts = attByEmp.get(e.id) || []
      const izinDates = atts.filter(a => a.status === 'sick' || a.status === 'permission').map(a => a.date)
      const alphaDates = atts.filter(a => a.status === 'absent').map(a => a.date)
      const sickDocDays = atts.filter(a => a.status === 'sick_doc').length
      const deptName = e.departments?.name ?? null
      return {
        id: e.id, full_name: e.full_name, employee_code: e.employee_code,
        branchName: e.branches?.name ?? '-', departmentName: deptName ?? '-',
        base_salary: sc.base, position_allowance: sc.pos, meal_allowance: sc.meal, special_allowance: sc.special,
        dailyRate, overtimeRate: sc.ot, overtimeEligible: e.overtime_applicable !== false && deptName !== 'Team Gudang',
        izin: calcEscalatingDeduction(izinDates, dailyRate, IZIN_GROUP_MULTIPLIERS),
        alpha: calcEscalatingDeduction(alphaDates, dailyRate, ALPHA_GROUP_MULTIPLIERS),
        sickDocDays,
      }
    })
    setRows(result)
  }

  const filteredRows = rows.filter(r => r.full_name.toLowerCase().includes(searchTerm.toLowerCase()))

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Aturan Potongan Gaji</h1>
        <p className="text-sm text-slate-500">Rincian aturan &amp; status periode berjalan (<strong>{rosterPeriodLabel(new Date(period.start), new Date(period.end))}</strong>).</p>
      </div>

      {!isAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-6">
          {mySummary ? (
            <>
              <RateCard
                base={mySummary.base_salary} pos={mySummary.position_allowance} meal={mySummary.meal_allowance} special={mySummary.special_allowance}
                dailyRate={mySummary.daily_rate} overtimeRate={mySummary.overtime_rate_per_hour} overtimeEligible={mySummary.overtime_eligible} lateRate={lateRate}
              />
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <p className="text-sm font-semibold text-slate-800">Status Periode Ini</p>
                <EscalatingStatus title="Izin/Sakit Tanpa Surat" result={myIzin} colorClass="text-orange-600" />
                <EscalatingStatus title="Alpha" result={myAlpha} colorClass="text-red-600" />
                {mySickDoc > 0 && <p className="text-sm text-blue-600">Sakit Dengan Surat: {mySickDoc} hari periode ini.</p>}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400 italic">Komponen gaji Anda belum diatur HR — hubungi HR untuk mengisi Komponen Gaji dulu.</p>
          )}
        </div>
      )}

      {isAdmin && (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <input type="text" placeholder="Cari nama karyawan..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Gaji Harian</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Izin/Sakit</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Alpha</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Sejauh Ini</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Tidak ada data.</td></tr>
                  ) : (
                    filteredRows.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{r.full_name}</div>
                          <div className="text-xs text-slate-400">{r.employee_code} · {r.branchName}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-700">{r.dailyRate > 0 ? fmtRp(r.dailyRate) : <span className="text-red-400 text-xs italic">Belum diatur</span>}</td>
                        <td className="px-4 py-3 text-center">
                          {r.izin.blocks.length > 0 ? <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">{r.izin.blocks.length}×</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.alpha.blocks.length > 0 ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">{r.alpha.blocks.length}×</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-red-500">
                          {(r.izin.total + r.alpha.total) > 0 ? fmtRp(r.izin.total + r.alpha.total) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => setDetailRow(r)} className="text-xs text-blue-600 hover:underline font-medium">Lihat Detail</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {detailRow && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={() => setDetailRow(null)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">{detailRow.full_name}</h2>
                  <p className="text-xs text-slate-500">{detailRow.employee_code} · {detailRow.departmentName} · {detailRow.branchName}</p>
                </div>
                <button onClick={() => setDetailRow(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <RateCard
                label={detailRow.full_name}
                base={detailRow.base_salary} pos={detailRow.position_allowance} meal={detailRow.meal_allowance} special={detailRow.special_allowance}
                dailyRate={detailRow.dailyRate} overtimeRate={detailRow.overtimeRate} overtimeEligible={detailRow.overtimeEligible} lateRate={lateRate}
              />
              <div className="pt-4 mt-4 border-t border-slate-100 space-y-3">
                <p className="text-sm font-semibold text-slate-800">Status Periode Ini</p>
                <EscalatingStatus title="Izin/Sakit Tanpa Surat" result={detailRow.izin} colorClass="text-orange-600" />
                <EscalatingStatus title="Alpha" result={detailRow.alpha} colorClass="text-red-600" />
                {detailRow.sickDocDays > 0 && <p className="text-sm text-blue-600">Sakit Dengan Surat: {detailRow.sickDocDays} hari periode ini.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
