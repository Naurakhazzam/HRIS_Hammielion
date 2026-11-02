// SATU-SATUNYA rumus potongan tidak hadir + jatah libur 4 hari + kompensasi libur. Semua tempat
// (Slip Gaji Bulanan, rincian slip, Ringkasan Gaji, Aturan Potongan, estimasi di Portal) WAJIB
// memanggil calcAbsence() di sini -- jangan menulis ulang rumusnya di halaman. Aturan tertulisnya
// (bahasa manusia) ada di docs/ATURAN-PENGGAJIAN.md; kalau aturan berubah, ubah keduanya bersamaan.
import { calcEscalatingDeduction, TRAINING_FLAT_MULTIPLIER, NEW_RULES_CUTOFF_DATE, type EscalatingResult } from './escalatingDeduction'
import { buildMultipliers, DEFAULT_PAYROLL_RULES, fetchPayrollRules, type PayrollRules } from './payrollRules'
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

/**
 * Pro-rata gaji = (hari kalender masa kerja di periode) ÷ (hari kalender periode). Masa kerja =
 * join_date s/d last_working_date (resign). Berlaku untuk permanent & training: karyawan baru,
 * masuk kembali, atau resign di tengah periode. Bekerja penuh satu periode = 1.
 */
export function calcProRataFactor(joinDate: string | null, lastWorkingDate: string | null, firstDay: string, lastDay: string): number {
  const start = joinDate && joinDate > firstDay ? joinDate : firstDay
  const end = lastWorkingDate && lastWorkingDate < lastDay ? lastWorkingDate : lastDay
  if (start > end) return 0
  if (start === firstDay && end === lastDay) return 1
  return daysBetweenInclusive(start, end) / daysBetweenInclusive(firstDay, lastDay)
}

export type AbsenceAttendance = {
  date: string
  status: string
  admin_fee?: number | string | null
  notes?: string | null
  // true = Alpha yang ditandai OTOMATIS oleh detect_unexplained_absences (hari tanpa absen sama
  // sekali). Diperlakukan sama dengan hari kosong: boleh mengisi jatah libur. Alpha yang ditandai
  // manual oleh HR (auto_flagged false) tetap tidak pernah mengisi jatah.
  auto_flagged?: boolean | null
}

export type AbsenceInput = {
  dailyRate: number
  firstDay: string
  lastDay: string
  // Tanggal setelah ini dianggap BELUM TERJADI (tidak dihitung kosong/libur). Untuk slip yang
  // dibuat setelah periode selesai, nilainya otomatis >= lastDay.
  today: string
  joinDate: string | null
  // Tanggal terakhir bekerja (resign). Hari setelahnya di luar masa kerja: tidak dihitung sama
  // sekali (gajinya sudah dikurangi lewat pro-rata).
  lastWorkingDate?: string | null
  attendances: AbsenceAttendance[]
  // Libur nasional/perusahaan (company_holidays): gratis, TIDAK memakai jatah libur.
  holidayDates?: Iterable<string>
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
  // Angka potongan yang berlaku di periode ini (payroll_rules). Kosong = DEFAULT_PAYROLL_RULES.
  rules?: PayrollRules
}

// Denda Lupa Absen per kejadian (attendances.admin_fee, diisi saat HR menyetujui klarifikasi).
export type AdminFeeKind = 'masuk' | 'pulang' | 'masuk_pulang' | 'lain'
export type AdminFeeItem = { date: string; amount: number; kind: AdminFeeKind }

export const ADMIN_FEE_KIND_LABEL: Record<AdminFeeKind, string> = {
  masuk: 'Lupa Absen Masuk',
  pulang: 'Lupa Absen Pulang',
  masuk_pulang: 'Lupa Absen Masuk & Pulang',
  lain: 'Denda Lupa Absen',
}

// Jenisnya dibaca dari catatan yang ditulis RPC review_*_clarification; nominal sebagai cadangan.
function adminFeeKind(notes: string | null | undefined, amount: number): AdminFeeKind {
  const masuk = notes?.includes('Lupa Absen Masuk') ?? false
  const pulang = notes?.includes('Lupa Absen Pulang') ?? false
  if (masuk && pulang) return 'masuk_pulang'
  if (masuk) return 'masuk'
  if (pulang) return 'pulang'
  if (amount === 15000) return 'masuk'
  if (amount === 5000) return 'pulang'
  return 'lain'
}

/** Rincian denda Lupa Absen dari baris absensi (admin_fee > 0), urut tanggal. */
export function adminFeeItemsFrom(atts: AbsenceAttendance[]): AdminFeeItem[] {
  return atts
    .filter(a => Number(a.admin_fee ?? 0) > 0)
    .map(a => ({ date: a.date, amount: Number(a.admin_fee), kind: adminFeeKind(a.notes, Number(a.admin_fee)) }))
    .sort((x, y) => x.date.localeCompare(y.date))
}

/**
 * absent_deduction slip = potongan tidak hadir + denda lupa absen. Di slip ditampilkan sebagai
 * dua baris terpisah supaya denda (karyawannya HADIR) tidak terbaca sebagai "Tidak Hadir".
 */
export function splitAbsentDeduction(absentDeduction: number, b: AbsenceBreakdown | null | undefined): { absence: number; adminFee: number } {
  const adminFee = Math.min(absentDeduction, Number(b?.adminFeeTotal ?? 0))
  return { absence: absentDeduction - adminFee, adminFee }
}

export type AbsenceBreakdown = {
  dailyRate: number
  izinGroup: EscalatingResult
  alphaGroup: EscalatingResult
  suddenPermissionGroup: EscalatingResult
  sickDays: number; sick1Free: number; sick23Half: number; sick4Full: number; sickDed: number
  // Pengali Sakit+surat yang dipakai (hari ke-1, ke-2&3, ke-4+). Opsional: slip sebelum migrasi 118
  // tidak menyimpannya (= 0 / 0.5 / 1).
  sickRates?: [number, number, number]
  adminFeeTotal: number
  // Rincian adminFeeTotal per tanggal. (Opsional: slip sebelum fitur ini cuma menyimpan totalnya.)
  adminFeeItems?: AdminFeeItem[]
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
  // Libur nasional/perusahaan yang tidak dimasuki kerja -- gratis, di luar jatah. (Opsional: slip
  // sebelum migrasi 112 tidak menyimpannya.)
  holidayDays?: number
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
    sickDays: r.sickDays, sick1Free: r.sick1Free, sick23Half: r.sick23Half, sick4Full: r.sick4Full, sickDed: r.sickDed, sickRates: r.sickRates,
    adminFeeTotal: r.adminFeeTotal, adminFeeItems: r.adminFeeItems, liburDisciplineFeeTotal: r.liburDisciplineFeeTotal, isPreNewRulesPeriod: r.isPreNewRulesPeriod,
    liburQuota: r.liburQuota, liburFromRoster: r.liburFromRoster, liburFromLeave: r.liburFromLeave, liburFromIzin: r.liburFromIzin,
    liburFromSickDoc: r.liburFromSickDoc, liburFromKosong: r.liburFromKosong, rosterBeyondQuota: r.rosterBeyondQuota,
    holidayDays: r.holidayDays,
  }
}

export function calcAbsence(input: AbsenceInput): AbsenceResult {
  const { dailyRate, firstDay, lastDay, today, joinDate, isTraining, proRataFactor, flatSalary, liburCompApplicable } = input
  const applyQuota = input.applyQuota !== false
  const rules = input.rules ?? DEFAULT_PAYROLL_RULES
  // Periode yang berakhir SEBELUM NEW_RULES_CUTOFF_DATE dihitung flat 1x tanpa denda admin --
  // lihat catatan di escalatingDeduction.ts. Training selalu flat (pengalinya diatur di payroll_rules).
  const isPreNewRulesPeriod = lastDay < NEW_RULES_CUTOFF_DATE
  const tiers = (start: number, step: number, max: number) => isPreNewRulesPeriod ? TRAINING_FLAT_MULTIPLIER
    : isTraining ? [rules.training_multiplier] : buildMultipliers(start, step, max)

  const lastCounted = today < lastDay ? today : lastDay
  const lastWorkingDate = input.lastWorkingDate ?? null
  const inScope = (d: string) => d >= firstDay && d <= lastDay && (!joinDate || d >= joinDate) && (!lastWorkingDate || d <= lastWorkingDate)

  let daysElapsed = 0
  for (let d = firstDay; d <= lastCounted; d = addDays(d, 1)) if (inScope(d)) daysElapsed++

  if (flatSalary) {
    return {
      dailyRate, izinGroup: EMPTY_GROUP, alphaGroup: EMPTY_GROUP, suddenPermissionGroup: EMPTY_GROUP,
      sickDays: 0, sick1Free: 0, sick23Half: 0, sick4Full: 0, sickDed: 0, sickRates: [0, 0.5, 1], adminFeeTotal: 0, adminFeeItems: [], liburDisciplineFeeTotal: 0,
      isPreNewRulesPeriod, liburQuota: 0, liburFromRoster: 0, liburFromLeave: 0, liburFromIzin: 0, liburFromSickDoc: 0,
      liburFromKosong: 0, rosterBeyondQuota: 0, holidayDays: 0, absentDed: 0, absentDays: 0, liburUsedDays: 0, liburCompDays: 0,
      liburKompensasi: 0, alphaDates: [], daysElapsed,
    }
  }

  // Record "Belum Masuk (Training)" lama bukan Alpha sungguhan -- dibuang.
  const atts = input.attendances.filter(a => inScope(a.date) && !(a.status === 'absent' && a.notes === 'Belum Masuk (Training)'))
  const attByDate = new Map(atts.map(a => [a.date, a]))

  // Hari libur roster = tanggal libur terjadwal yang sudah lewat & TIDAK dimasuki kerja. Kalau di
  // tanggal itu tercatat izin/sakit/alpha, tetap dianggap libur (tidak dipotong) -- liburnya sudah
  // disetujui. Kalau tetap masuk kerja ('present'), bukan libur: jatahnya tidak terpakai.
  // Libur nasional/perusahaan: aturannya sama dengan libur roster (masuk kerja = bukan libur;
  // tercatat izin/sakit/alpha tetap gratis), bedanya TIDAK memakai jatah 4 hari. Didahulukan dari
  // roster supaya libur roster yang jatuh di tanggal merah juga tidak memakan jatah.
  const holidayDates = [...new Set(input.holidayDates ?? [])]
    .filter(d => inScope(d) && d <= lastCounted && attByDate.get(d)?.status !== 'present')
    .sort()
  const holidaySet = new Set(holidayDates)
  const rosterDates = [...new Set(input.rosterDayOffDates)]
    .filter(d => inScope(d) && d <= lastCounted && !holidaySet.has(d) && attByDate.get(d)?.status !== 'present')
    .sort()
  const rosterSet = new Set(rosterDates)
  const isFreeDay = (d: string) => rosterSet.has(d) || holidaySet.has(d)

  const datesWithStatus = (...statuses: string[]) => atts
    .filter(a => !isFreeDay(a.date) && statuses.includes(a.status))
    .map(a => a.date)
    .sort()
  const leaveDates = datesWithStatus('leave')
  const izinRaw = datesWithStatus('permission', 'sick')
  const sickDocRaw = datesWithStatus('sick_doc')
  // Alpha otomatis (hari tanpa absen sama sekali) = hari kosong; Alpha manual HR = Alpha murni.
  const autoAlphaSet = new Set(atts.filter(a => a.status === 'absent' && a.auto_flagged === true).map(a => a.date))
  const explicitAlphaDates = datesWithStatus('absent').filter(d => !autoAlphaSet.has(d))
  const suddenPermissionDates = datesWithStatus('sudden_permission')

  const emptyDates: string[] = []
  for (let d = firstDay; d <= lastCounted; d = addDays(d, 1)) {
    if (inScope(d) && !isFreeDay(d) && (!attByDate.has(d) || autoAlphaSet.has(d))) emptyDates.push(d)
  }

  // ── Jatah libur 4 hari/periode (di-pro-rata untuk training) ──
  // Urutan yang menghabiskan jatah: (1) libur roster, (2) cuti ('leave'), (3) izin/sakit-tanpa-
  // surat & sakit-dengan-surat digabung satu antrean dari tanggal paling awal, (4) hari kosong.
  // Alpha manual HR & Izin Mendadak TIDAK PERNAH mengisi jatah. Alpha otomatis = hari kosong.
  // Libur nasional tidak masuk antrean ini sama sekali (gratis, di luar jatah).
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

  const izinGroup = calcEscalatingDeduction(izinDates, dailyRate, tiers(rules.izin_start, rules.izin_step, rules.izin_max))
  const alphaDates = [...explicitAlphaDates, ...excessEmptyDates].sort()
  const alphaGroup = calcEscalatingDeduction(alphaDates, dailyRate, tiers(rules.alpha_start, rules.alpha_step, rules.alpha_max))
  const suddenPermissionGroup = calcEscalatingDeduction(suddenPermissionDates, dailyRate, tiers(rules.sudden_start, rules.sudden_step, rules.sudden_max))

  // Sakit dengan surat (sisa di luar jatah): pengali hari ke-1 / ke-2&3 / ke-4+ (bawaan gratis /
  // 0.5x / 1x). Periode lama selalu memakai bawaan.
  const sickRates: [number, number, number] = isPreNewRulesPeriod ? [0, 0.5, 1]
    : [rules.sick_doc_day1, rules.sick_doc_day2_3, rules.sick_doc_day4_plus]
  const sickDays = sickDocDates.length
  const sick1Free = Math.min(sickDays, 1)
  const sick23Half = Math.max(0, Math.min(sickDays - 1, 2))
  const sick4Full = Math.max(0, sickDays - 3)
  const sickDed = Math.round(sick1Free * dailyRate * sickRates[0] + sick23Half * dailyRate * sickRates[1] + sick4Full * dailyRate * sickRates[2])

  // Denda Lupa Absen Masuk/Pulang (Rp15.000/Rp5.000 per kejadian) -- belum ada di periode lama.
  const adminFeeItems = isPreNewRulesPeriod ? [] : adminFeeItemsFrom(atts)
  const adminFeeTotal = adminFeeItems.reduce((s, i) => s + i.amount, 0)
  const liburDisciplineFeeTotal = Number(input.disciplineFeeTotal ?? 0)

  const liburUsedDays = liburFromRoster + liburFromLeave + fillUsed + liburFromKosong
  const liburCompDays = applyQuota && liburCompApplicable ? quotaLeft : 0

  return {
    dailyRate, izinGroup, alphaGroup, suddenPermissionGroup,
    sickDays, sick1Free, sick23Half, sick4Full, sickDed, sickRates,
    adminFeeTotal, adminFeeItems, liburDisciplineFeeTotal, isPreNewRulesPeriod,
    liburQuota, liburFromRoster, liburFromLeave, liburFromIzin, liburFromSickDoc, liburFromKosong,
    rosterBeyondQuota: rosterDates.length - liburFromRoster,
    holidayDays: holidayDates.length,
    absentDed: izinGroup.total + alphaGroup.total + suddenPermissionGroup.total + sickDed + adminFeeTotal + liburDisciplineFeeTotal,
    absentDays: izinDates.length + alphaDates.length + suddenPermissionDates.length + sickDays,
    liburUsedDays,
    liburCompDays,
    liburKompensasi: Math.round(liburCompDays * dailyRate),
    alphaDates,
    daysElapsed,
  }
}

/** Kolom attendances yang dibutuhkan calcAbsence -- pakai konstanta ini di setiap query. */
export const ABSENCE_ATTENDANCE_COLUMNS = 'date, status, admin_fee, notes, auto_flagged'

/** Tanggal libur nasional/perusahaan (company_holidays) di rentang ini. */
export async function fetchHolidayDates(supabase: Pick<SupabaseClient, 'from'>, from: string, to: string): Promise<string[]> {
  const { data } = await supabase.from('company_holidays').select('holiday_date').gte('holiday_date', from).lte('holiday_date', to)
  return ((data || []) as { holiday_date: string }[]).map(h => h.holiday_date)
}

/** Data mentah yang dibutuhkan calcAbsence, diambil dengan query yang sama di semua halaman. */
export async function fetchAbsenceSource(
  supabase: Pick<SupabaseClient, 'from'>,
  employeeId: string,
  firstDay: string,
  lastDay: string,
): Promise<{ attendances: AbsenceAttendance[]; rosterDayOffDates: string[]; holidayDates: string[]; disciplineFeeTotal: number }> {
  const [attRes, rosterRes, feeRes, holidayDates] = await Promise.all([
    supabase.from('attendances').select(ABSENCE_ATTENDANCE_COLUMNS).eq('employee_id', employeeId).gte('date', firstDay).lte('date', lastDay),
    supabase.from('employee_roster').select('date').eq('employee_id', employeeId).eq('is_day_off', true).gte('date', firstDay).lte('date', lastDay),
    // period_start roster SELALU sama dengan firstDay payroll (keduanya tanggal 26).
    supabase.from('roster_pick_requests').select('discipline_fee').eq('employee_id', employeeId).eq('period_start', firstDay).in('status', DISCIPLINE_FEE_STATUSES),
    fetchHolidayDates(supabase, firstDay, lastDay),
  ])
  return {
    holidayDates,
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
  const [scRes, empRes, src, rules] = await Promise.all([
    supabase.from('salary_components').select('base_salary, position_allowance, meal_allowance, special_allowance')
      .eq('employee_id', employeeId).lte('effective_date', lastDay).order('effective_date', { ascending: false }).limit(1),
    supabase.from('employees').select('join_date, last_working_date, employee_type, flat_salary, libur_compensation_applicable').eq('id', employeeId).single(),
    fetchAbsenceSource(supabase, employeeId, firstDay, lastDay),
    fetchPayrollRules(supabase, firstDay),
  ])
  const emp = empRes.data as { join_date: string | null; last_working_date: string | null; employee_type: string | null; flat_salary: boolean | null; libur_compensation_applicable: boolean | null } | null
  const isTraining = emp?.employee_type === 'training'
  const joinDate = emp?.join_date ?? null
  const lastWorkingDate = emp?.last_working_date ?? null
  return calcAbsence({
    dailyRate: calcDailyRate(scRes.data?.[0]), firstDay, lastDay, today, joinDate, lastWorkingDate,
    attendances: src.attendances, rosterDayOffDates: src.rosterDayOffDates, holidayDates: src.holidayDates,
    isTraining, proRataFactor: calcProRataFactor(joinDate, lastWorkingDate, firstDay, lastDay),
    flatSalary: emp?.flat_salary === true, liburCompApplicable: emp?.libur_compensation_applicable !== false,
    disciplineFeeTotal: src.disciplineFeeTotal, rules,
  })
}
