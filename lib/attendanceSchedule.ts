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

// Sama seperti resolveSchedule(), tapi untuk absen NORMAL di cabang sendiri (bukan perbantuan)
// -- jadwal shift cabang sendiri (branch_shift_schedules) diutamakan di atas jadwal departemen
// generik kalau cabang itu sudah diatur sendiri (jam buka toko beda-beda per cabang, mis. Raja
// Petshop/Markas Petshop buka 08:00 vs default Team Toko 07:00). Jam kerja khusus pribadi tetap
// prioritas tertinggi. HARUS selalu sama persis dengan prioritas di trigger DB
// calc_attendance_times() supaya pesan langsung di HP tidak beda dari yang tersimpan di database.
export function resolveHomeSchedule(
  checkInStr: string,
  deptSchedules: WorkSchedule[],
  branchSchedules: { check_in_time: string; check_out_time: string | null; detect_until: string | null; allow_overtime: boolean }[],
  customCheckIn: string | null,
  customCheckOut: string | null
): { check_in_time: string; check_out_time: string | null; allow_overtime: boolean } | null {
  if (customCheckIn || customCheckOut) {
    return resolveSchedule(checkInStr, deptSchedules, customCheckIn, customCheckOut)
  }
  return matchSchedule(checkInStr, branchSchedules) ?? matchSchedule(checkInStr, deptSchedules)
}

export function calcLateMinutes(checkInStr: string, sched: { check_in_time: string } | null): number {
  if (!sched) return 0
  const diff = timeToMinutes(checkInStr) - timeToMinutes(sched.check_in_time)
  return Math.max(0, diff)
}

// Lembur cuma dihitung kalau sudah penuh 60 menit, dibulatkan ke bawah (jam penuh).
// HARUS selalu sama persis dengan blok lembur di trigger DB calc_attendance_times() -- absen
// pulang lewat QR/HP mengisi overtime_hours dari sini LANGSUNG lewat UPDATE attendances yang
// tidak mengubah check_in, jadi trigger DB skip (lihat guard TG_OP='UPDATE' di awal trigger) dan
// TIDAK ikut menghitung ulang/membatasi nilainya. Kalau rumus di sini beda dari trigger, lembur
// dari absen QR/HP bisa lolos tanpa batas 20:00 atau batas 3 jam/hari sama sekali.
export function calcOvertimeHours(
  checkOutStr: string | null,
  sched: { check_out_time: string | null; allow_overtime: boolean } | null
): number {
  if (!sched?.allow_overtime || !sched.check_out_time || !checkOutStr) return 0
  const schedOutMins = timeToMinutes(sched.check_out_time)
  const CAP_MINS = 20 * 60 // batas jam lembur dihitung maksimal sampai jam 20:00
  // Batas 20:00 cuma berlaku untuk jadwal yang jam pulang resminya sendiri di bawah jam 20:00 --
  // shift yang jadwal pulangnya sendiri >= 20:00 (mis. shift sore Raja Petshop/Markas Petshop,
  // jadwal 14:00-21:00) dikecualikan, supaya shift itu tetap bisa dapat lembur.
  const effectiveOutMins = schedOutMins < CAP_MINS
    ? Math.min(timeToMinutes(checkOutStr), CAP_MINS)
    : timeToMinutes(checkOutStr)
  const diffMins = effectiveOutMins - schedOutMins
  if (diffMins < 60) return 0
  // Batas maksimal 3 jam lembur/hari, berlaku semua karyawan.
  return Math.min(3, Math.floor(diffMins / 60))
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
