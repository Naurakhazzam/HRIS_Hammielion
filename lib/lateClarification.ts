import { createClient } from '@/lib/supabase/client'
import { todayLocalStr, localDateStr } from '@/lib/date'

// Telat LEBIH DARI 30 menit wajib dijelaskan karyawan -- HR/Owner meninjau dan bisa memberi
// kompensasi (potongan telat hari itu dihapuskan) kalau memang ada kendala. Sama pola-nya
// dengan lib/checkoutClarification.ts & lib/overtimeClaim.ts: dipakai bareng AbsenSekarang
// (pengingat ringkas) dan Portal Saya (daftar + form penjelasan).
export const LATE_CLARIFICATION_THRESHOLD_MINUTES = 30

export type LateClarificationAlertItem = {
  attendanceId: string
  date: string
  lateMinutes: number
  clarification: { status: string; reason: string; rejection_note: string | null } | null
  // true = telat >30 menit dan belum dijelaskan (atau penjelasan lama ditolak). Tidak ada batas
  // waktu keras seperti Alpha/Lembur -- karyawan tetap bisa jelaskan kapan saja, tapi jendela
  // pencarian di bawah dibatasi supaya tidak menampilkan riwayat yang sudah sangat lama.
  actionable: boolean
}

export async function fetchLateClarificationAlerts(
  supabase: ReturnType<typeof createClient>,
  employeeId: string,
  daysBack = 14
): Promise<LateClarificationAlertItem[]> {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  const { data: rows } = await supabase.from('attendances')
    .select('id, date, late_minutes')
    .eq('employee_id', employeeId).eq('status', 'present')
    .gt('late_minutes', LATE_CLARIFICATION_THRESHOLD_MINUTES)
    .gte('date', localDateStr(since)).lte('date', todayLocalStr())
    .order('date', { ascending: false })
  if (!rows || rows.length === 0) return []

  const ids = rows.map((r: any) => r.id)
  const { data: clars } = await supabase.from('late_clarifications')
    .select('attendance_id, status, reason, rejection_note, created_at')
    .in('attendance_id', ids)
    .order('created_at', { ascending: false })
  const latestByAtt = new Map<string, any>()
  ;(clars || []).forEach((c: any) => { if (!latestByAtt.has(c.attendance_id)) latestByAtt.set(c.attendance_id, c) })

  return (rows as any[]).map(r => {
    const clarification = latestByAtt.get(r.id) ?? null
    const actionable = !clarification || clarification.status === 'rejected'
    return { attendanceId: r.id, date: r.date, lateMinutes: Number(r.late_minutes), clarification, actionable }
  })
}
