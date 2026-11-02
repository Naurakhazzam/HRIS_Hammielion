// Hitung ulang slip gaji yang MASIH DRAFT setelah angka di Potongan & Lembur (payroll_rules)
// diubah -- supaya slip yang sudah dibuat langsung ikut aturan baru tanpa dibuat ulang manual.
// Yang dihitung ulang: potongan tidak hadir (+ kompensasi libur), potongan telat, dan lembur.
// Komponen lain (gaji pokok, tunjangan, bonus, kasbon, kehilangan) tidak disentuh. Slip yang
// sudah disetujui/dibayar TIDAK PERNAH diubah.
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAbsenceForPeriod, toAbsenceBreakdown, payrollPeriodRange } from './payrollAbsence'
import { chargeableLateMinutes } from './lateTolerance'
import { fetchPayrollRules, periodStartOf } from './payrollRules'
import { todayLocalStr } from './date'

// Sama dengan pembulatan di Gaji Staff: < 60 menit = 0, lalu dibulatkan ke bawah per jam.
const roundOvertimeHours = (raw: number) => (raw * 60 < 60 ? 0 : Math.floor(raw))

export type RecalcResult = { updated: number; failed: number }
type SlipRow = { id: string; employee_id: string; period_month: number; period_year: number }
type AttRow = { date: string; late_minutes: number | null; source: string | null; overtime_hours: number | string | null; overtime_hours_adjusted: number | string | null; overtime_validated: boolean | null }

/**
 * Hitung ulang semua slip draft yang periodenya mulai >= fromPeriodStart dan (kalau ada)
 * < untilPeriodStart (mulai aturan berikutnya).
 */
export async function recalcDraftPayrolls(
  supabase: SupabaseClient, fromPeriodStart: string, untilPeriodStart: string | null,
): Promise<RecalcResult> {
  const { data: slips } = await supabase.from('payrolls').select('id, employee_id, period_month, period_year').eq('status', 'draft')
  const targets = ((slips || []) as SlipRow[]).filter(s => {
    const start = periodStartOf(s.period_month, s.period_year)
    return start >= fromPeriodStart && (!untilPeriodStart || start < untilPeriodStart)
  })
  let updated = 0, failed = 0
  for (const s of targets) {
    try {
      const { firstDay, lastDay } = payrollPeriodRange(s.period_month, s.period_year)
      const [absence, rules, empRes, attRes] = await Promise.all([
        computeAbsenceForPeriod(supabase, s.employee_id, s.period_month, s.period_year, todayLocalStr()),
        fetchPayrollRules(supabase, firstDay),
        supabase.from('employees').select('join_date, last_working_date, overtime_applicable, late_penalty_applicable, flat_salary').eq('id', s.employee_id).single(),
        supabase.from('attendances').select('date, late_minutes, source, overtime_hours, overtime_hours_adjusted, overtime_validated')
          .eq('employee_id', s.employee_id).gte('date', firstDay).lte('date', lastDay),
      ])
      const emp = empRes.data as { join_date: string | null; last_working_date: string | null; overtime_applicable: boolean | null; late_penalty_applicable: boolean | null; flat_salary: boolean | null } | null
      const flat = emp?.flat_salary === true
      const inEmployment = (d: string) => (!emp?.join_date || d >= emp.join_date) && (!emp?.last_working_date || d <= emp.last_working_date)
      const atts = ((attRes.data || []) as AttRow[]).filter(a => inEmployment(a.date))
      const lateMins = (flat || emp?.late_penalty_applicable === false) ? 0
        : atts.reduce((sum, a) => sum + chargeableLateMinutes(Number(a.late_minutes ?? 0), a.source), 0)
      // Lembur: hanya hari yang sudah di-ACC (overtime_validated), pakai jam yang disetujui.
      const otHours = (flat || emp?.overtime_applicable === false) ? 0
        : atts.filter(a => a.overtime_validated).reduce((sum, a) => sum + (a.overtime_hours_adjusted != null ? Number(a.overtime_hours_adjusted) : roundOvertimeHours(Number(a.overtime_hours ?? 0))), 0)

      const { error } = await supabase.from('payrolls').update({
        absent_deduction: absence.absentDed, absent_days: absence.absentDays,
        libur_compensation_days: absence.liburCompDays, libur_compensation_amount: absence.liburKompensasi,
        absent_breakdown: toAbsenceBreakdown(absence),
        late_deduction: lateMins * rules.late_penalty_per_minute,
        overtime_total: otHours * rules.overtime_rate_per_hour,
      }).eq('id', s.id).eq('status', 'draft')
      if (error) { failed++; continue }
      const { error: e2 } = await supabase.rpc('recalc_payroll_totals', { p_payroll_id: s.id })
      if (e2) failed++; else updated++
    } catch {
      failed++
    }
  }
  return { updated, failed }
}
