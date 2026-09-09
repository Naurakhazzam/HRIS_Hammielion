// Aturan jam kerja & keterlambatan — dipakai bareng oleh Import Absensi (mesin fingerprint,
// app/api/attendance/import/route.ts) dan Absen via HP (portal/absensi), supaya "telat berapa
// menit" dihitung sama persis di kedua jalur, tidak ada rumus dobel yang bisa diam-diam beda.

export type WorkSchedule = {
  check_in_time: string
  check_out_time: string | null
  detect_until: string | null
  allow_overtime: boolean
  applies_to_dept: string | null
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.substring(0, 5).split(':').map(Number)
  return h * 60 + m
}

// Cari jadwal shift yang cocok untuk jam checkIn tertentu — deteksi berdasarkan detect_until
// (batas waktu terakhir shift itu berlaku), yang paling awal detect_until-nya dicek duluan.
export function matchSchedule<T extends { detect_until: string | null }>(checkInStr: string, schedules: T[]): T | null {
  if (!schedules.length) return null
  const sorted = [...schedules].sort((a, b) => {
    if (!a.detect_until) return 1
    if (!b.detect_until) return -1
    return a.detect_until.localeCompare(b.detect_until)
  })
  return (
    sorted.find(s => !s.detect_until || checkInStr <= s.detect_until.substring(0, 5)) ??
    sorted[sorted.length - 1]
  )
}

// Gabungkan jadwal departemen dengan jam khusus per karyawan (custom_check_in_time/
// custom_check_out_time di tabel employees) — kalau diisi, dipakai langsung tanpa deteksi shift.
export function resolveSchedule(
  checkInStr: string,
  deptSchedules: WorkSchedule[],
  customCheckIn: string | null,
  customCheckOut: string | null
): { check_in_time: string; check_out_time: string | null; allow_overtime: boolean } | null {
  const deptSched = matchSchedule(checkInStr, deptSchedules)
  if (customCheckIn || customCheckOut) {
    return {
      check_in_time: customCheckIn ?? deptSched?.check_in_time ?? checkInStr,
      check_out_time: customCheckOut ?? deptSched?.check_out_time ?? null,
      allow_overtime: deptSched?.allow_overtime ?? true,
    }
  }
  return deptSched
}

export function calcLateMinutes(checkInStr: string, sched: { check_in_time: string } | null): number {
  if (!sched) return 0
  const diff = timeToMinutes(checkInStr) - timeToMinutes(sched.check_in_time)
  return Math.max(0, diff)
}

// Lembur cuma dihitung kalau sudah penuh 60 menit, dibulatkan ke bawah (jam penuh).
export function calcOvertimeHours(
  checkOutStr: string | null,
  sched: { check_out_time: string | null; allow_overtime: boolean } | null
): number {
  if (!sched?.allow_overtime || !sched.check_out_time || !checkOutStr) return 0
  const diffMins = timeToMinutes(checkOutStr) - timeToMinutes(sched.check_out_time)
  return diffMins >= 60 ? Math.floor(diffMins / 60) : 0
}

// Jarak antar 2 titik koordinat (meter) — rumus Haversine, dipakai buat cek radius absen HP.
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
