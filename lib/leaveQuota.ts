// Aturan Cuti Tahunan: sama rata untuk semua karyawan, dihitung dari tahun masa kerja
// (ulang tahun `join_date`), BUKAN tahun kalender Januari-Desember.
export const ANNUAL_LEAVE_QUOTA_DAYS = 12
export const MIN_TENURE_DAYS_FOR_ANNUAL_LEAVE = 365

const MS_PER_DAY = 1000 * 60 * 60 * 24

export function tenureDays(joinDate: string | Date, today: Date = new Date()): number {
  const join = new Date(joinDate)
  return Math.floor((today.getTime() - join.getTime()) / MS_PER_DAY)
}

export function isEligibleForAnnualLeave(joinDate: string | Date, today: Date = new Date()): boolean {
  return tenureDays(joinDate, today) >= MIN_TENURE_DAYS_FOR_ANNUAL_LEAVE
}

// Periode cuti berjalan: dari tanggal ulang tahun masa kerja terakhir sampai sehari sebelum
// ulang tahun berikutnya. Contoh: join_date 10 Maret 2021, hari ini 14 Sep 2026
// -> periode berjalan = 10 Maret 2026 s/d 9 Maret 2027.
export function getCurrentLeaveYear(joinDate: string | Date, today: Date = new Date()) {
  const join = new Date(joinDate)
  const anniversary = new Date(today.getFullYear(), join.getMonth(), join.getDate())
  if (anniversary.getTime() > today.getTime()) {
    anniversary.setFullYear(anniversary.getFullYear() - 1)
  }
  const start = anniversary
  const end = new Date(start)
  end.setFullYear(end.getFullYear() + 1)
  end.setDate(end.getDate() - 1)
  return { start, end }
}

export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}
