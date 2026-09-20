// Periode roster berjalan tanggal 26 s/d 25 bulan berikutnya (sama seperti siklus yang sudah
// dipakai di Rekap Absensi). Dipakai fitur Pengajuan Jadwal Libur — karyawan cuma bisa
// mengajukan untuk periode BERIKUTNYA (yang belum mulai), bukan periode yang sedang berjalan.
import { localDateStr } from './date'

export function getUpcomingRosterPeriod(refDate: Date = new Date()): { start: Date; end: Date } {
  // Periode yang MENAUNGI refDate saat ini: kalau tanggal refDate >= 26, periode itu mulai
  // bulan ini; kalau < 26, periode itu mulai bulan lalu.
  let currentStartMonth = refDate.getDate() >= 26 ? refDate.getMonth() : refDate.getMonth() - 1
  let currentStartYear = refDate.getFullYear()
  if (currentStartMonth < 0) { currentStartMonth = 11; currentStartYear -= 1 }

  // Periode BERIKUTNYA = 1 bulan setelah mulainya periode saat ini.
  let upcomingStartMonth = currentStartMonth + 1
  let upcomingStartYear = currentStartYear
  if (upcomingStartMonth > 11) { upcomingStartMonth = 0; upcomingStartYear += 1 }

  const start = new Date(upcomingStartYear, upcomingStartMonth, 26)
  let endMonth = upcomingStartMonth + 1
  let endYear = upcomingStartYear
  if (endMonth > 11) { endMonth = 0; endYear += 1 }
  const end = new Date(endYear, endMonth, 25)

  return { start, end }
}

export function rosterPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

// Semua tanggal dari start s/d end (inklusif), format "YYYY-MM-DD".
export function datesInRange(start: Date, end: Date): string[] {
  const dates: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    dates.push(localDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}
