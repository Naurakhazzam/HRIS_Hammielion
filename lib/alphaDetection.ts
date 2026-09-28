import { createClient } from '@/lib/supabase/client'

// Pemicu deteksi "tidak ada absen sama sekali" -> otomatis ditandai Alpha (menunggu klarifikasi
// karyawan). Sama seperti triggerDailyPhotoCleanup: bukan cron sungguhan, cuma jalan maksimal 1x
// per hari per browser, nempel di halaman Rekap Absensi yang rutin dibuka HR/Owner setiap hari.
const LAST_RUN_KEY = 'lastAlphaDetectionRun'

export async function triggerDailyAlphaDetection() {
  try {
    const last = localStorage.getItem(LAST_RUN_KEY)
    const today = new Date().toISOString().split('T')[0]
    if (last === today) return
    localStorage.setItem(LAST_RUN_KEY, today)
    const supabase = createClient()
    await supabase.rpc('detect_unexplained_absences')
  } catch {
    // Gagal diam-diam -- ini cuma housekeeping otomatis, jangan ganggu pengalaman halaman utama.
  }
}

export type AlphaAlertItem = {
  attendanceId: string
  date: string
  // Batas terakhir tanggal boleh klarifikasi (H+2 dari tanggal Alpha) -- sama persis dengan
  // aturan yang ditegakkan RPC submit_alpha_clarification di database. Diabaikan kalau
  // noDeadline true.
  deadline: string
  // true = tanggal Alpha ini masuk periode pengecualian (26 Agu - 25 Sep 2026) yang boleh
  // diklarifikasi kapan saja, tanpa batas H+2 -- sama persis dengan pengecualian di RPC
  // submit_alpha_clarification. Dikonfirmasi user karena Alpha periode ini ditandai belakangan
  // dari import data lama, bukan dari absen real-time.
  noDeadline: boolean
  // true = masih bisa/perlu diklarifikasi (belum ada klarifikasi, atau klarifikasi lama ditolak,
  // DAN belum lewat batas waktu, kecuali noDeadline). false = sudah lewat batas waktu (Alpha
  // permanen) ATAU sedang menunggu review HR (clarification.status === 'pending').
  actionable: boolean
  clarification: { status: string; requested_type: string; rejection_note: string | null } | null
}

// Periode pengecualian batas waktu klarifikasi -- lihat migrasi
// alpha_clarification_no_deadline_aug_sep_2026, HARUS selalu sama persis dengan RPC.
const NO_DEADLINE_PERIOD_START = '2026-08-26'
const NO_DEADLINE_PERIOD_END = '2026-09-25'

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

// Dipakai bareng oleh Portal Saya (tampilkan daftar lengkap) dan AbsenSekarang (cuma perlu tahu
// ada yang actionable atau tidak, buat munculkan peringatan begitu selesai absen) -- satu sumber
// aturan supaya keduanya tidak pernah beda hasil.
export async function fetchAlphaAlerts(supabase: ReturnType<typeof createClient>, employeeId: string): Promise<AlphaAlertItem[]> {
  const { data: flagged } = await supabase.from('attendances')
    .select('id, date')
    .eq('employee_id', employeeId).eq('status', 'absent').eq('auto_flagged', true)
    .order('date', { ascending: false })
  if (!flagged || flagged.length === 0) return []

  const ids = flagged.map((f: any) => f.id)
  const { data: clars } = await supabase.from('alpha_clarifications')
    .select('attendance_id, status, requested_type, rejection_note, created_at')
    .in('attendance_id', ids)
    .order('created_at', { ascending: false })
  const latestByAtt = new Map<string, any>()
  ;(clars || []).forEach((c: any) => { if (!latestByAtt.has(c.attendance_id)) latestByAtt.set(c.attendance_id, c) })

  const todayStr = new Date().toISOString().split('T')[0]
  return (flagged as any[]).map(f => {
    const deadline = addDaysStr(f.date, 2)
    const noDeadline = f.date >= NO_DEADLINE_PERIOD_START && f.date <= NO_DEADLINE_PERIOD_END
    const clarification = latestByAtt.get(f.id) ?? null
    const withinWindow = noDeadline || todayStr <= deadline
    const actionable = withinWindow && (!clarification || clarification.status === 'rejected')
    return { attendanceId: f.id, date: f.date, deadline, noDeadline, actionable, clarification }
  })
}
