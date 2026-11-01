// Estimasi akumulasi gaji pokok + tunjangan tetap utk PERIODE YANG SEDANG BERJALAN (live),
// dipakai di dashboard karyawan (portal). Ini TIDAK menggantikan perhitungan resmi Finance di
// Penggajian Bulanan -- murni pratinjau "saldo berjalan" yang kelihatan tumbuh harian.
//
// Potongannya memakai rumus yang SAMA dengan slip resmi (lib/payrollAbsence.ts, calcAbsence),
// dengan satu beda yang disengaja (dikonfirmasi user): jatah libur 4 hari/periode TIDAK diterapkan
// di sini (applyQuota: false) -- jatah itu baru valid dihitung kalau periode sudah selesai, jadi
// izin/sakit langsung kena potongan dan hari kosong langsung Alpha. Estimasi di sini cenderung
// sedikit lebih konservatif (pesimis) dibanding slip asli.
//
// Aturan per-hari:
// - Hadir, cuti, libur terjadwal (roster), izin/sakit/izin mendadak -> saldo +1 hari.
//   Izin/sakit/izin mendadak tetap kena potongannya masing-masing (sama seperti slip).
// - Hadir dengan Lupa Absen -> +1 hari, dikurangi denda admin (field admin_fee).
// - Alpha (tercatat, atau tidak absen & tidak ada pengajuan & bukan libur terjadwal) -> saldo TIDAK
//   bertambah, DITAMBAH kena potongan eskalasi alpha.
import { calcAbsence, type AbsenceAttendance, type AdminFeeItem } from './payrollAbsence'
import type { EscalatingResult } from './escalatingDeduction'

export type AccrualAttendanceDay = AbsenceAttendance

export type DailyAccrualResult = {
  accruedGross: number
  accruedDeduction: number
  accruedNet: number
  daysCounted: number
  daysElapsed: number
  alphaDays: number
  izinGroup: EscalatingResult
  alphaGroup: EscalatingResult
  sickDed: number
  // Denda Lupa Absen -- termasuk di accruedDeduction, ditampilkan terpisah di Portal.
  adminFeeTotal: number
  adminFeeItems: AdminFeeItem[]
}

/**
 * Hitung akumulasi gaji pokok+tunjangan dari firstDay s/d cutoffDate (INKLUSIF).
 * cutoffDate seharusnya "kemarin" (bukan hari ini) -- hari berjalan baru masuk hitungan
 * begitu sudah lewat pergantian hari, supaya tidak dihitung lebih awal dari seharusnya.
 */
export function calcDailyAccrual(
  dailyRate: number,
  firstDay: string,
  cutoffDate: string,
  joinDate: string | null,
  attendances: AccrualAttendanceDay[],
  rosterDayOffDates: Set<string>,
  opts: { lastDay?: string; isTraining?: boolean; disciplineFeeTotal?: number; lastWorkingDate?: string | null; holidayDates?: Iterable<string> } = {},
): DailyAccrualResult {
  const empty: DailyAccrualResult = {
    accruedGross: 0, accruedDeduction: 0, accruedNet: 0, daysCounted: 0, daysElapsed: 0,
    alphaDays: 0, izinGroup: { total: 0, blocks: [] }, alphaGroup: { total: 0, blocks: [] }, sickDed: 0, adminFeeTotal: 0, adminFeeItems: [],
  }
  if (cutoffDate < firstDay) return empty

  const r = calcAbsence({
    dailyRate, firstDay, lastDay: opts.lastDay ?? cutoffDate, today: cutoffDate, joinDate,
    lastWorkingDate: opts.lastWorkingDate ?? null, holidayDates: opts.holidayDates,
    attendances, rosterDayOffDates, isTraining: opts.isTraining === true, proRataFactor: 1,
    flatSalary: false, liburCompApplicable: false, disciplineFeeTotal: opts.disciplineFeeTotal ?? 0,
    applyQuota: false,
  })
  const daysCounted = r.daysElapsed - r.alphaDates.length
  const accruedGross = daysCounted * dailyRate
  return {
    accruedGross,
    accruedDeduction: r.absentDed,
    accruedNet: accruedGross - r.absentDed,
    daysCounted,
    daysElapsed: r.daysElapsed,
    alphaDays: r.alphaDates.length,
    izinGroup: r.izinGroup, alphaGroup: r.alphaGroup, sickDed: r.sickDed, adminFeeTotal: r.adminFeeTotal, adminFeeItems: r.adminFeeItems ?? [],
  }
}
