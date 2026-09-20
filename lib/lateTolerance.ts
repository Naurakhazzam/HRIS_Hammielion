// Toleransi keterlambatan khusus absen QR — antisipasi HP lemot/error saat scan. Keterlambatan
// ASLI tetap disimpan & ditampilkan apa adanya (notifikasi, Rekap Absensi, Ranking) — toleransi ini
// HANYA mengecilkan potongan gaji, bukan menyembunyikan datanya.
export const QR_LATE_TOLERANCE_MINUTES = 5

/** Menit keterlambatan yang benar-benar dipotong dari gaji, setelah toleransi absen QR. */
export function chargeableLateMinutes(lateMinutes: number, source: string | null | undefined): number {
  if (source === 'qr' && lateMinutes <= QR_LATE_TOLERANCE_MINUTES) return 0
  return lateMinutes
}

/** True kalau keterlambatan hari itu masuk toleransi (telat tapi tidak dipotong). */
export function isLateTolerated(lateMinutes: number, source: string | null | undefined): boolean {
  return lateMinutes > 0 && source === 'qr' && lateMinutes <= QR_LATE_TOLERANCE_MINUTES
}
