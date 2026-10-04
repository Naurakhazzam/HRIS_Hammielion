import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/date'

// Pemicu nonaktif otomatis untuk karyawan dengan rangkaian berturut-turut Sakit-tanpa-surat/
// Izin-tanpa-kejelasan/Alpha-belum-klarifikasi lebih dari 7 hari (lihat RPC
// auto_deactivate_long_absence di database). Sama persis pola-nya dengan triggerDailyAlphaDetection
// (lib/alphaDetection.ts) dan triggerDailyPhotoCleanup -- bukan cron sungguhan, cuma jalan maksimal
// 1x per hari per browser, nempel di halaman Rekap Absensi yang rutin dibuka HR/Owner setiap hari.
const LAST_RUN_KEY = 'lastLongAbsenceDeactivationRun'

export async function triggerDailyLongAbsenceDeactivation() {
  try {
    const last = localStorage.getItem(LAST_RUN_KEY)
    const today = localDateStr(new Date())
    if (last === today) return
    localStorage.setItem(LAST_RUN_KEY, today)
    const supabase = createClient()
    await supabase.rpc('auto_deactivate_long_absence')
  } catch {
    // Gagal diam-diam -- ini cuma housekeeping otomatis, jangan ganggu pengalaman halaman utama.
  }
}
