import { createClient } from '@/lib/supabase/client'
import { todayLocalStr, localDateStr } from '@/lib/date'

// "Lupa Absen Pulang" -- sudah absen masuk (status present), tapi check_out tidak pernah
// terisi. Beda dari Alpha (lib/alphaDetection.ts) yang mensyaratkan status='absent' sama
// sekali; di sini absennya ADA, cuma belum lengkap. Tidak ada batas waktu 2 hari seperti Alpha
// (cuma dibatasi kuota 4x/periode, dicek di RPC submit_checkout_clarification), tapi jendela
// pencarian dibatasi 14 hari terakhir supaya konsisten dengan panel HR di Rekap Absensi.
export type IncompleteCheckoutItem = {
  attendanceId: string
  date: string
  checkIn: string
  clarification: { status: string; reason: string; rejection_note: string | null } | null
  actionable: boolean
}

export async function fetchIncompleteCheckouts(
  supabase: ReturnType<typeof createClient>,
  employeeId: string,
  daysBack = 14
): Promise<IncompleteCheckoutItem[]> {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  const { data: rows } = await supabase.from('attendances')
    .select('id, date, check_in')
    .eq('employee_id', employeeId).eq('status', 'present')
    .not('check_in', 'is', null).is('check_out', null)
    .lt('date', todayLocalStr()).gte('date', localDateStr(since))
    .order('date', { ascending: false })
  if (!rows || rows.length === 0) return []

  const ids = rows.map((r: any) => r.id)
  const { data: clars } = await supabase.from('checkout_clarifications')
    .select('attendance_id, status, reason, rejection_note, created_at')
    .in('attendance_id', ids)
    .order('created_at', { ascending: false })
  const latestByAtt = new Map<string, any>()
  ;(clars || []).forEach((c: any) => { if (!latestByAtt.has(c.attendance_id)) latestByAtt.set(c.attendance_id, c) })

  return (rows as any[]).map(r => {
    const clarification = latestByAtt.get(r.id) ?? null
    const actionable = !clarification || clarification.status === 'rejected'
    return { attendanceId: r.id, date: r.date, checkIn: r.check_in, clarification, actionable }
  })
}
