import { createClient } from '@/lib/supabase/client'
import { todayLocalStr, localDateStr } from '@/lib/date'

// Lembur TIDAK otomatis terhitung ke gaji hanya karena terdeteksi dari jam pulang -- karyawan
// wajib klaim + upload foto kertas lembur dalam 3 hari, Owner yang menyetujui (lihat migrasi
// add_overtime_claims_owner_approval). Modul ini dipakai bareng oleh Portal Saya (daftar +
// upload) dan AbsenSekarang (pengingat ringkas), sama seperti lib/alphaDetection.ts &
// lib/checkoutClarification.ts.
export type OvertimeClaimAlertItem = {
  attendanceId: string
  date: string
  hoursDetected: number
  deadline: string // date + 3 hari
  // true = tanggal lembur ini masuk periode pengecualian (26 Agu - 25 Sep 2026) yang boleh
  // diklaim kapan saja, tanpa batas 3 hari -- sama persis dengan pengecualian di RPC
  // submit_overtime_claim. Dikonfirmasi Owner: periode ini belum pernah ada proses klaim sama
  // sekali, jadi tidak adil ditagih aturan 3 hari yang baru berlaku belakangan.
  noDeadline: boolean
  claim: { status: string; rejection_note: string | null } | null
  // true = masih bisa/perlu diklaim (belum ada klaim, atau klaim lama ditolak, DAN belum lewat
  // batas 3 hari kecuali noDeadline). false + expired=true = sudah hangus (lewat batas, tidak
  // pernah disetujui).
  actionable: boolean
  expired: boolean
}

// Periode pengecualian batas waktu klaim -- lihat migrasi
// overtime_claim_no_deadline_aug_sep_2026, HARUS selalu sama persis dengan RPC.
const NO_DEADLINE_PERIOD_START = '2026-08-26'
const NO_DEADLINE_PERIOD_END = '2026-09-25'

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

export async function fetchOvertimeClaimAlerts(
  supabase: ReturnType<typeof createClient>,
  employeeId: string,
  daysBack = 7
): Promise<OvertimeClaimAlertItem[]> {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)
  // Jendela pencarian selalu mencakup periode pengecualian (26 Agu - 25 Sep 2026), berapa pun
  // daysBack-nya -- kalau tidak, lembur periode itu tidak akan pernah muncul di daftar sama
  // sekali walau sudah dibebaskan dari batas waktu di RPC.
  const sinceStr = localDateStr(since)
  const effectiveSince = sinceStr < NO_DEADLINE_PERIOD_START ? sinceStr : NO_DEADLINE_PERIOD_START
  const { data: rows } = await supabase.from('attendances')
    .select('id, date, overtime_hours')
    .eq('employee_id', employeeId).gt('overtime_hours', 0)
    .gte('date', effectiveSince).lte('date', todayLocalStr())
    .order('date', { ascending: false })
  if (!rows || rows.length === 0) return []

  const ids = rows.map((r: any) => r.id)
  const { data: claims } = await supabase.from('overtime_claims')
    .select('attendance_id, status, rejection_note, created_at')
    .in('attendance_id', ids)
    .order('created_at', { ascending: false })
  const latestByAtt = new Map<string, any>()
  ;(claims || []).forEach((c: any) => { if (!latestByAtt.has(c.attendance_id)) latestByAtt.set(c.attendance_id, c) })

  const todayStr = todayLocalStr()
  return (rows as any[]).map(r => {
    const deadline = addDaysStr(r.date, 3)
    const noDeadline = r.date >= NO_DEADLINE_PERIOD_START && r.date <= NO_DEADLINE_PERIOD_END
    const claim = latestByAtt.get(r.id) ?? null
    const withinWindow = noDeadline || todayStr <= deadline
    const approved = claim?.status === 'approved'
    const actionable = withinWindow && !approved && (!claim || claim.status === 'rejected')
    const expired = !withinWindow && !approved
    return { attendanceId: r.id, date: r.date, hoursDetected: Number(r.overtime_hours), deadline, noDeadline, claim, actionable, expired }
  })
}
