'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getCurrentPeriodRangeStr, rosterPeriodLabel } from '@/lib/rosterPeriod'
import { IZIN_GROUP_MULTIPLIERS, ALPHA_GROUP_MULTIPLIERS, TRAINING_FLAT_MULTIPLIER, type EscalatingResult } from '@/lib/escalatingDeduction'
import { calcAbsence, calcProRataFactor, fetchHolidayDates, ABSENCE_ATTENDANCE_COLUMNS, DISCIPLINE_FEE_STATUSES, type AbsenceAttendance, type AbsenceResult } from '@/lib/payrollAbsence'
import { todayLocalStr } from '@/lib/date'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

type SalarySummary = {
  base_salary: number; position_allowance: number; meal_allowance: number; special_allowance: number
  daily_rate: number; overtime_rate_per_hour: number; overtime_eligible: boolean
  branch_name: string | null; department_name: string | null; employee_type: string | null
}

type EmployeeRow = {
  id: string; full_name: string; employee_code: string
  branchName: string; departmentName: string
  base_salary: number; position_allowance: number; meal_allowance: number; special_allowance: number
  dailyRate: number; overtimeRate: number; overtimeEligible: boolean; isTraining: boolean
  absence: AbsenceResult
}

type EmployeeFlags = { join_date: string | null; last_working_date?: string | null; employee_type: string | null; flat_salary: boolean | null; libur_compensation_applicable: boolean | null }

// Status periode berjalan pakai rumus yang SAMA dengan slip gaji (lib/payrollAbsence.ts): jatah
// libur 4 hari, libur terjadwal, izin mendadak, sakit+surat, & denda -- supaya angka di sini
// tidak beda dengan slip yang nanti dibuat Finance.
function absenceForPeriod(
  period: { start: string; end: string }, dailyRate: number, emp: EmployeeFlags | null,
  attendances: AbsenceAttendance[], rosterDayOffDates: string[], disciplineFeeTotal: number, holidayDates: string[],
): AbsenceResult {
  const isTraining = emp?.employee_type === 'training'
  const joinDate = emp?.join_date ?? null
  const lastWorkingDate = emp?.last_working_date ?? null
  return calcAbsence({
    dailyRate, firstDay: period.start, lastDay: period.end, today: todayLocalStr(), joinDate, lastWorkingDate,
    attendances, rosterDayOffDates, holidayDates, isTraining,
    proRataFactor: calcProRataFactor(joinDate, lastWorkingDate, period.start, period.end),
    flatSalary: emp?.flat_salary === true, liburCompApplicable: emp?.libur_compensation_applicable !== false,
    disciplineFeeTotal,
  })
}

function fmtDateShort(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
}

// Kartu rincian aturan + sumber angka, dipakai untuk tampilan diri sendiri (karyawan) maupun
// modal detail per-orang (Owner/HR) — supaya rumus & angkanya selalu identik di kedua tempat.
function RateCard({ label, base, pos, meal, special, dailyRate, overtimeRate, overtimeEligible, lateRate, isTraining }: {
  label?: string; base: number; pos: number; meal: number; special: number
  dailyRate: number; overtimeRate: number; overtimeEligible: boolean; lateRate: number; isTraining?: boolean
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

      {isTraining && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 text-sm">
          <p className="font-bold text-amber-800">🔰 Status: Training — potongan Izin/Sakit-tanpa-surat &amp; Alpha FLAT, tidak eskalasi</p>
          <p className="text-amber-700 mt-1">Karyawan training dipotong <strong>{fmtRp(dailyRate)}/hari (1×)</strong> untuk Izin/Sakit-tanpa-surat maupun Alpha, kejadian ke berapa pun — tidak naik bertahap seperti karyawan permanent (yang mulai 1.5× lalu naik sampai 2× untuk Izin/Sakit-tanpa-surat maupun Alpha).</p>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-orange-700 mb-2">Izin Duka / Periksa-Keperluan / Sakit Tanpa Surat — {isTraining ? 'flat, tidak eskalasi (training)' : 'naik per hari, reset tiap periode'}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-orange-50 text-orange-800"><th className="px-3 py-1.5 text-left">Hari ke- (akumulasi)</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan</th></tr></thead>
            <tbody className="divide-y divide-orange-100">
              {(isTraining ? TRAINING_FLAT_MULTIPLIER : IZIN_GROUP_MULTIPLIERS).map((m, i) => (
                <tr key={i}><td className="px-3 py-1.5">{isTraining ? 'Semua hari' : `Hari ke-${i + 1}`}{!isTraining && i === IZIN_GROUP_MULTIPLIERS.length - 1 ? ' (mentok)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(dailyRate * m))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-red-700 mb-2">Alpha (termasuk hari kosong tanpa keterangan di luar kuota) — {isTraining ? 'flat, tidak eskalasi (training)' : 'naik per hari, reset tiap periode'}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-red-50 text-red-800"><th className="px-3 py-1.5 text-left">Hari ke- (akumulasi)</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan</th></tr></thead>
            <tbody className="divide-y divide-red-100">
              {(isTraining ? TRAINING_FLAT_MULTIPLIER : ALPHA_GROUP_MULTIPLIERS).map((m, i) => (
                <tr key={i}><td className="px-3 py-1.5">{isTraining ? 'Semua hari' : `Hari ke-${i + 1}`}{!isTraining && i === ALPHA_GROUP_MULTIPLIERS.length - 1 ? ' (mentok)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(dailyRate * m))}</td></tr>
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
          <p>Terlambat: <strong>{fmtRp(lateRate)}/menit</strong> — tarif sama untuk semua staff{label ? ' (toleransi 5 menit khusus absen QR — HR/Owner saja)' : ''}</p>
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

// Pengali tiap hari dalam 1 blok, dirangkai jadi 1 teks ringkas -- tingkatannya bisa beda-beda per
// hari karena naik per hari & berlanjut lintas kejadian (bukan cuma 1 pengali per blok).
function fmtMultiplierSeq(days: { multiplier: number }[]): string {
  return days.length === 1 ? `${days[0].multiplier}×` : days.map(d => `${d.multiplier}×`).join('→')
}

function EscalatingStatus({ title, result, colorClass }: { title: string; result: EscalatingResult; colorClass: string }) {
  if (result.blocks.length === 0) return <p className="text-sm text-slate-400">{title}: belum ada kejadian periode ini.</p>
  return (
    <div>
      <p className={`text-sm font-semibold mb-1 ${colorClass}`}>{title} — {result.blocks.length} kejadian, total {fmtRp(result.total)}</p>
      <div className="space-y-0.5 pl-3">
        {result.blocks.map((b, i) => (
          <p key={i} className="text-xs text-slate-500">
            └ Ke-{b.occurrence} ({fmtDateShort(b.dates[0])}{b.dates.length > 1 ? `–${fmtDateShort(b.dates[b.dates.length - 1])}` : ''}, {b.dates.length} hari) × {fmtMultiplierSeq(b.days)} = {fmtRp(b.subtotal)}
          </p>
        ))}
      </div>
    </div>
  )
}

function PeriodStatus({ absence }: { absence: AbsenceResult }) {
  const a = absence
  const liburParts = [
    a.liburFromRoster > 0 ? `${a.liburFromRoster} libur terjadwal` : '',
    a.liburFromLeave > 0 ? `${a.liburFromLeave} cuti` : '',
    a.liburFromIzin > 0 ? `${a.liburFromIzin} izin/sakit` : '',
    a.liburFromSickDoc > 0 ? `${a.liburFromSickDoc} sakit+surat` : '',
    a.liburFromKosong > 0 ? `${a.liburFromKosong} hari kosong` : '',
  ].filter(Boolean)
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Jatah libur terpakai: <strong>{a.liburUsedDays}/{a.liburQuota} hari</strong>{liburParts.length > 0 ? ` (${liburParts.join(' + ')})` : ''}.
        {' '}Hari izin/sakit yang masih masuk jatah ini <strong>tidak dipotong</strong>.
      </p>
      <EscalatingStatus title="Izin/Sakit Tanpa Surat" result={a.izinGroup} colorClass="text-orange-600" />
      <EscalatingStatus title="Alpha" result={a.alphaGroup} colorClass="text-red-600" />
      {a.suddenPermissionGroup.blocks.length > 0 && <EscalatingStatus title="Izin Mendadak" result={a.suddenPermissionGroup} colorClass="text-orange-700" />}
      {a.sickDays > 0 && <p className="text-sm text-blue-600">Sakit Dengan Surat (di luar jatah libur): {a.sickDays} hari → {fmtRp(a.sickDed)}</p>}
      {a.adminFeeTotal > 0 && <p className="text-sm text-slate-600">Denda Lupa Absen Masuk/Pulang: {fmtRp(a.adminFeeTotal)}</p>}
      {a.liburDisciplineFeeTotal > 0 && <p className="text-sm text-slate-600">Denda Disiplin Pengajuan Libur: {fmtRp(a.liburDisciplineFeeTotal)}</p>}
      <p className="text-sm font-semibold text-slate-800">Total potongan tidak hadir sejauh ini: {a.absentDed > 0 ? <span className="text-red-600">{fmtRp(a.absentDed)}</span> : 'Rp 0'}</p>
      <p className="text-xs text-slate-400">Perkiraan sampai hari ini — angka final ada di slip gaji setelah periode selesai.</p>
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
  const [myAbsence, setMyAbsence] = useState<AbsenceResult | null>(null)

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

    // Mode "Preview Tampilan Karyawan" harus tetap tampil sebagai karyawan (bukan tabel semua
    // orang), dan datanya diganti ke Rahmat Saleh (contoh nyata) — bukan employee_id akun admin
    // sendiri — lihat lib/previewMode.ts.
    const realAdmin = ['owner', 'hr', 'finance'].includes(userData.role)
    const previewing = realAdmin && isPreviewModeClient()
    const admin = realAdmin && !previewing
    setIsAdmin(admin)

    if (admin) await fetchAllEmployees()
    else if (previewing) await fetchPreviewStatus(PREVIEW_EMPLOYEE_ID)
    else if (userData.employee_id) await fetchMyStatus(userData.employee_id)

    setLoading(false)
  }

  // Data mentah 1 karyawan untuk status periode berjalan -- query yang sama dengan slip gaji.
  async function fetchOwnAbsenceSource(empId: string) {
    const [{ data: emp }, { data: atts }, { data: roster }, { data: fees }, holidayDates] = await Promise.all([
      supabase.from('employees').select('join_date, last_working_date, employee_type, flat_salary, libur_compensation_applicable').eq('id', empId).maybeSingle(),
      supabase.from('attendances').select(ABSENCE_ATTENDANCE_COLUMNS).eq('employee_id', empId).gte('date', period.start).lte('date', period.end),
      supabase.from('employee_roster').select('date').eq('employee_id', empId).eq('is_day_off', true).gte('date', period.start).lte('date', period.end),
      supabase.from('roster_pick_requests').select('discipline_fee').eq('employee_id', empId).eq('period_start', period.start).in('status', DISCIPLINE_FEE_STATUSES),
      fetchHolidayDates(supabase, period.start, period.end),
    ])
    return {
      holidayDates,
      emp: emp as EmployeeFlags | null,
      atts: (atts || []) as AbsenceAttendance[],
      rosterDates: (roster || []).map((r: any) => r.date as string),
      fee: (fees || []).reduce((s: number, r: any) => s + Number(r.discipline_fee ?? 0), 0),
    }
  }

  async function fetchMyStatus(empId: string) {
    const [{ data: summary }, src] = await Promise.all([
      supabase.rpc('get_my_salary_summary'),
      fetchOwnAbsenceSource(empId),
    ])
    const s = (summary as SalarySummary[] | null)?.[0] ?? null
    applyStatus(s, src)
  }

  // Dipakai admin saat Preview — get_my_salary_summary() RPC selalu mengembalikan data
  // pemanggil sendiri, jadi untuk lihat data Rahmat Saleh, admin (yang sudah punya akses baca
  // penuh lewat RLS owner/hr/finance) query tabel langsung, bukan lewat RPC.
  async function fetchPreviewStatus(empId: string) {
    const [{ data: emp }, { data: sc }, src] = await Promise.all([
      supabase.from('employees').select('overtime_applicable, employee_type, branches(name), departments(name)').eq('id', empId).single(),
      supabase.from('salary_components').select('base_salary, position_allowance, meal_allowance, special_allowance, overtime_rate_per_hour')
        .eq('employee_id', empId).lte('effective_date', period.end).order('effective_date', { ascending: false }).limit(1).maybeSingle(),
      fetchOwnAbsenceSource(empId),
    ])
    const base = Number(sc?.base_salary ?? 0), pos = Number(sc?.position_allowance ?? 0)
    const meal = Number(sc?.meal_allowance ?? 0), special = Number(sc?.special_allowance ?? 0)
    const dailyRate = Math.round((base + pos + meal + special) / 26)
    const deptName = (emp as any)?.departments?.name ?? null
    const s: SalarySummary = {
      base_salary: base, position_allowance: pos, meal_allowance: meal, special_allowance: special,
      daily_rate: dailyRate, overtime_rate_per_hour: Number(sc?.overtime_rate_per_hour ?? 0),
      overtime_eligible: (emp as any)?.overtime_applicable !== false && deptName !== 'Team Gudang',
      branch_name: (emp as any)?.branches?.name ?? null, department_name: deptName,
      employee_type: (emp as any)?.employee_type ?? null,
    }
    applyStatus(s, src)
  }

  function applyStatus(s: SalarySummary | null, src: Awaited<ReturnType<typeof fetchOwnAbsenceSource>>) {
    setMySummary(s)
    // employees_read_self cuma untuk role 'employee' -- role lain jatuh ke employee_type dari RPC.
    const emp: EmployeeFlags = src.emp ?? { join_date: null, employee_type: s?.employee_type ?? null, flat_salary: null, libur_compensation_applicable: null }
    setMyAbsence(absenceForPeriod(period, s?.daily_rate ?? 0, emp, src.atts, src.rosterDates, src.fee, src.holidayDates))
  }

  async function fetchAllEmployees() {
    const [{ data: emps }, { data: scAll }, { data: attAll }, { data: rosterAll }, { data: feeAll }, holidayDates] = await Promise.all([
      supabase.from('employees')
        .select('id, full_name, employee_code, overtime_applicable, employee_type, join_date, last_working_date, flat_salary, libur_compensation_applicable, branches(name), departments(name)')
        .eq('is_active', true).order('full_name'),
      supabase.from('salary_components')
        .select('employee_id, base_salary, position_allowance, meal_allowance, special_allowance, overtime_rate_per_hour, effective_date')
        .lte('effective_date', period.end)
        .order('effective_date', { ascending: false }),
      supabase.from('attendances').select('employee_id, ' + ABSENCE_ATTENDANCE_COLUMNS).gte('date', period.start).lte('date', period.end),
      supabase.from('employee_roster').select('employee_id, date').eq('is_day_off', true).gte('date', period.start).lte('date', period.end),
      supabase.from('roster_pick_requests').select('employee_id, discipline_fee').eq('period_start', period.start).in('status', DISCIPLINE_FEE_STATUSES),
      fetchHolidayDates(supabase, period.start, period.end),
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
    const attByEmp = new Map<string, AbsenceAttendance[]>()
    ;(attAll || []).forEach((a: any) => {
      if (!attByEmp.has(a.employee_id)) attByEmp.set(a.employee_id, [])
      attByEmp.get(a.employee_id)!.push(a)
    })
    const rosterByEmp = new Map<string, string[]>()
    ;(rosterAll || []).forEach((r: any) => {
      if (!rosterByEmp.has(r.employee_id)) rosterByEmp.set(r.employee_id, [])
      rosterByEmp.get(r.employee_id)!.push(r.date)
    })
    const feeByEmp = new Map<string, number>()
    ;(feeAll || []).forEach((r: any) => feeByEmp.set(r.employee_id, (feeByEmp.get(r.employee_id) ?? 0) + Number(r.discipline_fee ?? 0)))

    const result: EmployeeRow[] = (emps || []).map((e: any) => {
      const sc = scMap.get(e.id) ?? { base: 0, pos: 0, meal: 0, special: 0, ot: 0 }
      const dailyRate = Math.round((sc.base + sc.pos + sc.meal + sc.special) / 26)
      const deptName = e.departments?.name ?? null
      const isTraining = e.employee_type === 'training'
      return {
        id: e.id, full_name: e.full_name, employee_code: e.employee_code,
        branchName: e.branches?.name ?? '-', departmentName: deptName ?? '-',
        base_salary: sc.base, position_allowance: sc.pos, meal_allowance: sc.meal, special_allowance: sc.special,
        dailyRate, overtimeRate: sc.ot, overtimeEligible: e.overtime_applicable !== false && deptName !== 'Team Gudang',
        isTraining,
        absence: absenceForPeriod(period, dailyRate, e, attByEmp.get(e.id) || [], rosterByEmp.get(e.id) || [], feeByEmp.get(e.id) ?? 0, holidayDates),
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
                isTraining={mySummary.employee_type === 'training'}
              />
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <p className="text-sm font-semibold text-slate-800">Status Periode Ini</p>
                {myAbsence && <PeriodStatus absence={myAbsence} />}
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
                          {r.absence.izinGroup.blocks.length > 0 ? <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">{r.absence.izinGroup.blocks.length}×</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.absence.alphaGroup.blocks.length > 0 ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">{r.absence.alphaGroup.blocks.length}×</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-red-500">
                          {r.absence.absentDed > 0 ? fmtRp(r.absence.absentDed) : <span className="text-slate-300">—</span>}
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
                isTraining={detailRow.isTraining}
              />
              <div className="pt-4 mt-4 border-t border-slate-100 space-y-3">
                <p className="text-sm font-semibold text-slate-800">Status Periode Ini</p>
                <PeriodStatus absence={detailRow.absence} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
