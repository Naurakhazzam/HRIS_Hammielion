// Estimasi akumulasi gaji pokok + tunjangan tetap utk PERIODE YANG SEDANG BERJALAN (live),
// dipakai di dashboard karyawan (portal). Ini TIDAK menggantikan perhitungan resmi Finance di
// Penggajian Bulanan (penggajian/bulanan/page.tsx) -- sengaja dibikin sederhana, terpisah,
// murni utk pratinjau "saldo berjalan" yang kelihatan tumbuh harian. Beda utama dari slip resmi:
// kuota libur 4 hari/periode TIDAK ditiru di sini (itu baru valid dihitung kalau periode sudah
// penuh/selesai), jadi hari izin/sakit/kosong di awal periode langsung kena potongan tanpa jatah
// gratis -- estimasi di sini cenderung sedikit lebih konservatif (pesimis) dibanding slip asli.
//
// Aturan per-hari (dikonfirmasi user):
// - Hadir (masuk+pulang)         -> saldo +1 hari, tanpa potongan.
// - Hadir (masuk saja/lupa pulang) -> saldo +1 hari, dikurangi denda admin (field admin_fee).
// - Ada pengajuan sakit/izin/cuti, ATAU memang jadwal libur roster -> saldo +1 hari;
//   kalau izin/sakit (bukan libur roster) kena potongan eskalasi/tiered yang sama seperti slip asli.
// - Tidak absen & tidak ada pengajuan & bukan jadwal libur -> Alpha: saldo TIDAK bertambah,
//   DITAMBAH kena potongan eskalasi alpha (dipotong dari total, bukan cuma "tidak dapat").
import { calcEscalatingDeduction, IZIN_GROUP_MULTIPLIERS, ALPHA_GROUP_MULTIPLIERS, type EscalatingResult } from './escalatingDeduction'

export type AccrualAttendanceDay = {
  date: string
  status: 'present' | 'absent' | 'leave' | 'sick' | 'permission' | 'sick_doc'
  admin_fee?: number | null
}

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
  adminFeeTotal: number
}

function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
): DailyAccrualResult {
  const empty: DailyAccrualResult = {
    accruedGross: 0, accruedDeduction: 0, accruedNet: 0, daysCounted: 0, daysElapsed: 0,
    alphaDays: 0, izinGroup: { total: 0, blocks: [] }, alphaGroup: { total: 0, blocks: [] }, sickDed: 0, adminFeeTotal: 0,
  }
  if (cutoffDate < firstDay) return empty

  const attByDate = new Map(attendances.map(a => [a.date, a]))
  const pad = (n: number) => String(n).padStart(2, '0')
  const dates: string[] = []
  const cur = new Date(firstDay + 'T00:00:00')
  const end = new Date(cutoffDate + 'T00:00:00')
  while (cur <= end) {
    dates.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }

  let accruedGross = 0
  let adminFeeTotal = 0
  let daysElapsed = 0
  const izinDates: string[] = []
  const sickDocDates: string[] = []
  const alphaDates: string[] = []
  let daysCounted = 0

  for (const d of dates) {
    if (joinDate && d < joinDate) continue
    daysElapsed++
    const att = attByDate.get(d)
    if (att) {
      if (att.status === 'present') {
        accruedGross += dailyRate
        daysCounted++
        adminFeeTotal += Number(att.admin_fee ?? 0)
      } else if (att.status === 'leave') {
        accruedGross += dailyRate
        daysCounted++
      } else if (att.status === 'sick' || att.status === 'permission') {
        accruedGross += dailyRate
        daysCounted++
        izinDates.push(d)
      } else if (att.status === 'sick_doc') {
        accruedGross += dailyRate
        daysCounted++
        sickDocDates.push(d)
      } else if (att.status === 'absent') {
        alphaDates.push(d)
      }
    } else if (rosterDayOffDates.has(d)) {
      accruedGross += dailyRate
      daysCounted++
    } else {
      alphaDates.push(d)
    }
  }

  const izinGroup = calcEscalatingDeduction(izinDates, dailyRate, IZIN_GROUP_MULTIPLIERS)
  const alphaGroup = calcEscalatingDeduction(alphaDates, dailyRate, ALPHA_GROUP_MULTIPLIERS)
  const sickCount = sickDocDates.length
  const sick23Half = Math.max(0, Math.min(sickCount - 1, 2))
  const sick4Full = Math.max(0, sickCount - 3)
  const sickDed = Math.round(sick23Half * dailyRate * 0.5 + sick4Full * dailyRate)

  const accruedDeduction = izinGroup.total + alphaGroup.total + sickDed + adminFeeTotal
  return {
    accruedGross,
    accruedDeduction,
    accruedNet: accruedGross - accruedDeduction,
    daysCounted,
    daysElapsed,
    alphaDays: alphaDates.length,
    izinGroup, alphaGroup, sickDed, adminFeeTotal,
  }
}
