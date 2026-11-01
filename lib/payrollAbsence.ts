// SATU-SATUNYA rumus potongan tidak hadir + jatah libur 4 hari + kompensasi libur. Semua tempat
// (Slip Gaji Bulanan, rincian slip, Ringkasan Gaji, Aturan Potongan, estimasi di Portal) WAJIB
// memanggil calcAbsence() di sini -- jangan menulis ulang rumusnya di halaman. Aturan tertulisnya
// (bahasa manusia) ada di docs/ATURAN-PENGGAJIAN.md; kalau aturan berubah, ubah keduanya bersamaan.
import {
  calcEscalatingDeduction, IZIN_GROUP_MULTIPLIERS, ALPHA_GROUP_MULTIPLIERS, SUDDEN_PERMISSION_MULTIPLIERS,
  TRAINING_FLAT_MULTIPLIER, NEW_RULES_CUTOFF_DATE, type EscalatingResult,
} from './escalatingDeduction'
import type { SupabaseClient } from '@supabase/supabase-js'

export const LIBUR_QUOTA_PER_PERIOD = 4
// Pembagi gaji harian: total komponen gaji rutin ÷ 26.
export const DAILY_RATE_DIVISOR = 26
// Denda disiplin Ajukan Libur cuma ditagih dari libur yang BENAR-BENAR disetujui. 'moved' = sudah
// disetujui lalu dipindah (Ganti/Tukar Libur) -- telat ajukannya tetap terjadi, jadi tetap ditagih.
// 'pending'/'draft' belum diputuskan & 'rejected' ditolak -- tidak ditagih.
export const DISCIPLINE_FEE_STATUSES = ['approved', 'moved']

export type SalaryComponentRow = {
  base_salary?: number | string | null
  position_allowance?: number | string | null
  meal_allowance?: number | string | null
  special_allowance?: number | string | null
}

export function calcDailyRate(sc: SalaryComponentRow | null | undefined): number {
  if (!sc) return 0
  const total = Number(sc.base_salary ?? 0) + Number(sc.position_allowance ?? 0) + Number(sc.meal_allowance ?? 0) + Number(sc.special_allowance ?? 0)
  return Math.round(total / DAILY_RATE_DIVISOR)
}

/** Periode gaji 26 bulan lalu – 25 bulan ini (string YYYY-MM-DD, tanpa konversi timezone). */
export function payrollPeriodRange(month: number, year: number): { firstDay: string; lastDay: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const startM = month === 1 ? 12 : month - 1
  const startY = month === 1 ? year - 1 : year
  return { firstDay: `${startY}-${pad(startM)}-26`, lastDay: `${year}-${pad(month)}-25` }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(from + 'T12:00:00').getTime()
  const b = new Date(to + 'T12:00:00').getTime()
  return Math.round((b - a) / 86400000) + 1
}

/** Pro-rata HANYA untuk karyawan training yang join di tengah periode; permanent selalu 1. */
export function calcProRataFactor(isTraining: boolean, joinDate: string | null, firstDay: string, lastDay: string): number {
  if (!isTraining) return 1
  if (!joinDate || joinDate <= firstDay) return 1
  if (joinDate > lastDay) return 0
  return daysBetweenInclusive(joinDate, lastDay) / daysBetweenInclusive(firstDay, lastDay)
}

export type AbsenceAttendance = {
  date: string
  status: string
  admin_fee?: number | string | null
  notes?: string | null
}

export type AbsenceInput = {
  dailyRate: number
  firstDay: string
  lastDay: string
  // Tanggal setelah ini dianggap BELUM TERJADI (tidak dihitung kosong/libur). Untuk slip yang
  // dibuat setelah periode selesai, nilainya otomatis >= lastDay.
  today: string
  joinDate: string | null
  attendances: AbsenceAttendance[]
  // Jadwal libur yang berlaku (employee_roster.is_day_off = true).
  rosterDayOffDates: Iterable<string>
  isTraining: boolean
  proRataFactor: number
  flatSalary: boolean
  liburCompApplicable: boolean
  // Jumlah roster_pick_requests.discipline_fee berstatus DISCIPLINE_FEE_STATUSES.
  disciplineFeeTotal: number
  // false = estimasi berjalan di Portal: tanpa jatah 4 hari (izin langsung dipotong, hari kosong
  // langsung Alpha, tanpa kompensasi). Libur roster & cuti tetap gratis.
  applyQuota?: boolean
}

export type AbsenceBreakdown = {
  dailyRate: number
  izinGroup: EscalatingResult
  alphaGroup: EscalatingResult
  suddenPermissionGroup: EscalatingResult
  sickDays: number; sick1Free: number; sick23Half: number; sick4Full: number; sickDed: number
  adminFeeTotal: number
  liburDisciplineFeeTotal: number
  isPreNewRulesPeriod: boolean
  // Rincian pemakaian jatah libur 4 hari (urutan prioritas: roster → cuti → izin/sakit → kosong).
  liburQuota: number
  liburFromRoster: number
  liburFromLeave: number
  liburFromIzin: number
  liburFromSickDoc: number
  liburFromKosong: number
  // Hari libur roster di luar jatah -- tetap gratis (sudah disetujui HR), cuma dicatat.
  rosterBeyondQuota: number
}

export type AbsenceResult = AbsenceBreakdown & {
  absentDed: number
  absentDays: number
  liburUsedDays: number
  liburCompDays: number
  liburKompensasi: number
  // Tanggal-tanggal Alpha (eksplisit + hari kosong di luar jatah), dipakai estimasi Portal.
  alphaDates: string[]
  daysElapsed: number
}

const EMPTY_GROUP: EscalatingResult = { total: 0, blocks: [] }

/** Bagian hasil calcAbsence yang disimpan sebagai snapshot di payrolls.absent_breakdown. */
export function toAbsenceBreakdown(r: AbsenceResult): AbsenceBreakdown {
  return {
    dailyRate: r.dailyRate, izinGroup: r.izinGroup, alphaGroup: r.alphaGroup, suddenPermissionGroup: r.suddenPermissionGroup,
    sickDays: r.sickDays, sick1Free: r.sick1Free, sick23Half: r.sick23Half, sick4Full: r.sick4Full, sickDed: r.sickDed,
    adminFeeTotal: r.adminFeeTotal, liburDisciplineFeeTotal: r.liburDisciplineFeeTotal, isPreNewRulesPeriod: r.isPreNewRulesPeriod,
    liburQuota: r.liburQuota, liburFromRoster: r.liburFromRoster, liburFromLeave: r.liburFromLeave, liburFromIzin: r.liburFromIzin,
    liburFromSickDoc: r.liburFromSickDoc, liburFromKosong: r.liburFromKosong, rosterBeyondQuota: r.rosterBeyondQuota,
  }
}

export function calcAbsence(input: AbsenceInput): AbsenceResult {
  const { dailyRate, firstDay, lastDay, today, joinDate, isTraining, proRataFactor, flatSalary, liburCompApplicable } = input
  const applyQuota = input.applyQuota !== false
  // Periode yang berakhir SEBELUM NEW_RULES_CUTOFF_DATE dihitung flat 1x tanpa denda admin --
  // lihat catatan di escalatingDeduction.ts. Training selalu flat.
  const isPreNewRulesPeriod = lastDay < NEW_RULES_CUTOFF_DATE
  const tiers = (m: number[]) => (isTraining || isPreNewRulesPeriod) ? TRAINING_FLAT_MULTIPLIER : m

  const lastCounted = today < lastDay ? today : lastDay
  const inScope = (d: string) => d >= firstDay && d <= lastDay && (!joinDate || d >= joinDate)

  let daysElapsed = 0
  for (let d = firstDay; d <= lastCounted; d = addDays(d, 1)) if (inScope(d)) daysElapsed++

  if (flatSalary) {
    return {
      dailyRate, izinGroup: EMPTY_GROUP, alphaGroup: EMPTY_GROUP, suddenPermissionGroup: EMPTY_GROUP,
      sickDays: 0, sick1Free: 0, sick23Half: 0, sick4Full: 0, sickDed: 0, adminFeeTotal: 0, liburDisciplineFeeTotal: 0,
      isPreNewRulesPeriod, liburQuota: 0, liburFromRoster: 0, liburFromLeave: 0, liburFromIzin: 0, liburFromSickDoc: 0,
      liburFromKosong: 0, rosterBeyondQuota: 0, absentDed: 0, absentDays: 0, liburUsedDays: 0, liburCompDays: 0,
      liburKompensasi: 0, alphaDates: [], daysElapsed,
    }
  }

  // Record "Belum Masuk (Training)" lama bukan Alpha sungguhan -- dibuang.
  const atts = input.attendances.filter(a => inScope(a.date) && !(a.status === 'absent' && a.notes === 'Belum Masuk (Training)'))
  const attByDate = new Map(atts.map(a => [a.date, a]))

  // Hari libur roster = tanggal libur terjadwal yang sudah lewat & TIDAK dimasuki kerja. Kalau di
  // tanggal itu tercatat izin/sakit/alpha, tetap dianggap libur (tidak dipotong) -- liburnya sudah
  // disetujui. Kalau tetap masuk kerja ('present'), bukan libur: jatahnya tidak terpakai.
  const rosterDates = [...new Set(input.rosterDayOffDates)]
    .filter(d => inScope(d) && d <= lastCounted && attByDate.get(d)?.status !== 'present')
    .sort()
  const rosterSet = new Set(rosterDates)

  const datesWithStatus = (...statuses: string[]) => atts
    .filter(a => !rosterSet.has(a.date) && statuses.includes(a.status))
    .map(a => a.date)
    .sort()
  const leaveDates = datesWithStatus('leave')
  const izinRaw = datesWithStatus('permission', 'sick')
  const sickDocRaw = datesWithStatus('sick_doc')
  const explicitAlphaDates = datesWithStatus('absent')
  const suddenPermissionDates = datesWithStatus('sudden_permission')

  const emptyDates: string[] = []
  for (let d = firstDay; d <= lastCounted; d = addDays(d, 1)) {
    if (inScope(d) && !attByDate.has(d) && !rosterSet.has(d)) emptyDates.push(d)
  }

  // ── Jatah libur 4 hari/periode (di-pro-rata untuk training) ──
  // Urutan yang menghabiskan jatah: (1) libur roster, (2) cuti ('leave'), (3) izin/sakit-tanpa-
  // surat & sakit-dengan-surat digabung satu antrean dari tanggal paling awal, (4) hari kosong.
  // Alpha eksplisit & Izin Mendadak TIDAK PERNAH mengisi jatah.
  const liburQuota = applyQuota ? Math.round(LIBUR_QUOTA_PER_PERIOD * proRataFactor) : 0
  let quotaLeft = liburQuota
  const take = (n: number) => { const t = Math.min(n, quotaLeft); quotaLeft -= t; return t }

  const liburFromRoster = take(rosterDates.length)
  const liburFromLeave = take(leaveDates.length)
  const fillable = [
    ...izinRaw.map(date => ({ date, kind: 'izin' as const })),
    ...sickDocRaw.map(date => ({ date, kind: 'sick_doc' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const fillUsed = take(fillable.length)
  const liburFromIzin = fillable.slice(0, fillUsed).filter(x => x.kind === 'izin').length
  const liburFromSickDoc = fillUsed - liburFromIzin
  const izinDates = fillable.slice(fillUsed).filter(x => x.kind === 'izin').map(x => x.date)
  const sickDocDates = fillable.slice(fillUsed).filter(x => x.kind === 'sick_doc').map(x => x.date)
  const liburFromKosong = take(emptyDates.length)
  const excessEmptyDates = emptyDates.slice(liburFromKosong)

  const izinGroup = calcEscalatingDeduction(izinDates, dailyRate, tiers(IZIN_GROUP_MULTIPLIERS))
  const alphaDates = [...explicitAlphaDates, ...excessEmptyDates].sort()
  const alphaGroup = calcEscalatingDeduction(alphaDates, dailyRate, tiers(ALPHA_GROUP_MULTIPLIERS))
  const suddenPermissionGroup = calcEscalatingDeduction(suddenPermissionDates, dailyRate, tiers(SUDDEN_PERMISSION_MULTIPLIERS))

  // Sakit dengan surat (sisa di luar jatah): hari ke-1 gratis, ke-2&3 0.5x, ke-4+ 1x -- aturan
  // lama, sama untuk periode lama maupun baru.
  const sickDays = sickDocDates.length
  const sick1Free = Math.min(sickDays, 1)
  const sick23Half = Math.max(0, Math.min(sickDays - 1, 2))
  const sick4Full = Math.max(0, sickDays - 3)
  const sickDed = Math.round(sick23Half * dailyRate * 0.5 + sick4Full * dailyRate)

  // Denda Lupa Absen Masuk/Pulang (Rp15.000/Rp5.000 per kejadian) -- belum ada di periode lama.
  const adminFeeTotal = isPreNewRulesPeriod ? 0 : atts.reduce((s, a) => s + Number(a.admin_fee ?? 0), 0)
  const liburDisciplineFeeTotal = Number(input.disciplineFeeTotal ?? 0)

  const liburUsedDays = liburFromRoster + liburFromLeave + fillUsed + liburFromKosong
  const liburCompDays = applyQuota && liburCompApplicable ? quotaLeft : 0

  return {
    dailyRate, izinGroup, alphaGroup, suddenPermissionGroup,
    sickDays, sick1Free, sick23Half, sick4Full, sickDed,
    adminFeeTotal, liburDisciplineFeeTotal, isPreNewRulesPeriod,
    liburQuota, liburFromRoster, liburFromLeave, liburFromIzin, liburFromSickDoc, liburFromKosong,
    rosterBeyondQuota: rosterDates.length - liburFromRoster,
    absentDed: izinGroup.total + alphaGroup.total + suddenPermissionGroup.total + sickDed + adminFeeTotal + liburDisciplineFeeTotal,
    absentDays: izinDates.length + alphaDates.length + suddenPermissionDates.length + sickDays,
    liburUsedDays,
    liburCompDays,
    liburKompensasi: Math.round(liburCompDays * dailyRate),
    alphaDates,
    daysElapsed,
  }
}

/** Data mentah yang dibutuhkan calcAbsence, diambil dengan query yang sama di semua halaman. */
export async function fetchAbsenceSource(
  supabase: Pick<SupabaseClient, 'from'>,
  employeeId: string,
  firstDay: string,
  lastDay: string,
): Promise<{ attendances: AbsenceAttendance[]; rosterDayOffDates: string[]; disciplineFeeTotal: number }> {
  const [attRes, rosterRes, feeRes] = await Promise.all([
    supabase.from('attendances').select('date, status, admin_fee, notes').eq('employee_id', employeeId).gte('date', firstDay).lte('date', lastDay),
    supabase.from('employee_roster').select('date').eq('employee_id', employeeId).eq('is_day_off', true).gte('date', firstDay).lte('date', lastDay),
    // period_start roster SELALU sama dengan firstDay payroll (keduanya tanggal 26).
    supabase.from('roster_pick_requests').select('discipline_fee').eq('employee_id', employeeId).eq('period_start', firstDay).in('status', DISCIPLINE_FEE_STATUSES),
  ])
  return {
    attendances: (attRes.data || []) as AbsenceAttendance[],
    rosterDayOffDates: ((rosterRes.data || []) as { date: string }[]).map(r => r.date),
    disciplineFeeTotal: ((feeRes.data || []) as { discipline_fee: number | string | null }[]).reduce((s, r) => s + Number(r.discipline_fee ?? 0), 0),
  }
}

/**
 * Hitung ulang potongan tidak hadir 1 karyawan untuk 1 periode langsung dari database. Dipakai
 * untuk perkiraan & untuk slip LAMA yang belum punya snapshot payrolls.absent_breakdown -- slip
 * baru selalu dibaca dari snapshot-nya, bukan dari fungsi ini.
 */
export async function computeAbsenceForPeriod(
  supabase: Pick<SupabaseClient, 'from'>,
  employeeId: string,
  month: number,
  year: number,
  today: string,
): Promise<AbsenceResult> {
  const { firstDay, lastDay } = payrollPeriodRange(month, year)
  const [scRes, empRes, src] = await Promise.all([
    supabase.from('salary_components').select('base_salary, position_allowance, meal_allowance, special_allowance')
      .eq('employee_id', employeeId).lte('effective_date', lastDay).order('effective_date', { ascending: false }).limit(1),
    supabase.from('employees').select('join_date, employee_type, flat_salary, libur_compensation_applicable').eq('id', employeeId).single(),
    fetchAbsenceSource(supabase, employeeId, firstDay, lastDay),
  ])
  const emp = empRes.data as { join_date: string | null; employee_type: string | null; flat_salary: boolean | null; libur_compensation_applicable: boolean | null } | null
  const isTraining = emp?.employee_type === 'training'
  const joinDate = emp?.join_date ?? null
  return calcAbsence({
    dailyRate: calcDailyRate(scRes.data?.[0]), firstDay, lastDay, today, joinDate,
    attendances: src.attendances, rosterDayOffDates: src.rosterDayOffDates,
    isTraining, proRataFactor: calcProRataFactor(isTraining, joinDate, firstDay, lastDay),
    flatSalary: emp?.flat_salary === true, liburCompApplicable: emp?.libur_compensation_applicable !== false,
    disciplineFeeTotal: src.disciplineFeeTotal,
  })
}
