// Pemicu otomatis pembersihan foto absen lama (>2 bulan) — dibatasi maksimal 1x per hari
// per browser (bukan cron sungguhan, cuma jalan kalau owner/HR sedang buka salah satu
// halaman admin absensi). Untuk pembersihan manual kapan saja, ada tombol terpisah di
// halaman Absensi > QR Absen yang langsung panggil API yang sama.
const LAST_RUN_KEY = 'lastPhotoCleanupRun'

export async function triggerDailyPhotoCleanup() {
  try {
    const last = localStorage.getItem(LAST_RUN_KEY)
    const today = new Date().toISOString().split('T')[0]
    if (last === today) return
    localStorage.setItem(LAST_RUN_KEY, today)
    await fetch('/api/attendance/cleanup-old-photos', { method: 'POST' })
  } catch {
    // Gagal diam-diam — ini cuma housekeeping otomatis, jangan ganggu pengalaman halaman utama.
  }
}
