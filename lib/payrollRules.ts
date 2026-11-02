// SATU PINTU angka potongan & lembur staff: tabel payroll_rules (migrasi 118), diatur Owner/HR di
// menu Penggajian → Setup Gaji & Tarif → Potongan & Lembur. Satu baris = satu set aturan yang
// berlaku MULAI periode effective_from (selalu tanggal 26) sampai ada set aturan berikutnya.
// Semua tempat yang menghitung/menampilkan potongan, telat, atau lembur WAJIB memakai
// fetchPayrollRules() di sini -- jangan baca salary_defaults / salary_components.overtime_rate lagi.
import type { SupabaseClient } from '@supabase/supabase-js'

export type PayrollRules = {
  effective_from: string
  overtime_rate_per_hour: number
  late_penalty_per_minute: number
  // Izin (Duka/Periksa/Keperluan) + Sakit tanpa surat dokter -- 1 hitungan hari.
  izin_start: number; izin_step: number; izin_max: number
  // Izin Mendadak (tanpa H-2) -- hitungan hari sendiri.
  sudden_start: number; sudden_step: number; sudden_max: number
  // Alpha (manual HR + hari kosong di luar jatah) -- hitungan hari sendiri.
  alpha_start: number; alpha_step: number; alpha_max: number
  // Sakit dengan surat dokter (di luar jatah libur), per hari dalam periode.
  sick_doc_day1: number; sick_doc_day2_3: number; sick_doc_day4_plus: number
  // Karyawan training: flat, tidak naik bertahap (Izin, Izin Mendadak, Alpha).
  training_multiplier: number
}

// Dipakai kalau tabel payroll_rules belum ada / belum ada baris yang berlaku untuk periode itu.
// Sama dengan aturan yang berlaku mulai periode Oktober 2026.
export const DEFAULT_PAYROLL_RULES: PayrollRules = {
  effective_from: '2026-09-26',
  overtime_rate_per_hour: 10000,
  late_penalty_per_minute: 1000,
  izin_start: 1.5, izin_step: 0.2, izin_max: 2,
  sudden_start: 1.5, sudden_step: 0.2, sudden_max: 2,
  alpha_start: 1.5, alpha_step: 0.2, alpha_max: 2,
  sick_doc_day1: 0, sick_doc_day2_3: 0.5, sick_doc_day4_plus: 1,
  training_multiplier: 1,
}

export const PAYROLL_RULE_NUMBER_KEYS = [
  'overtime_rate_per_hour', 'late_penalty_per_minute',
  'izin_start', 'izin_step', 'izin_max',
  'sudden_start', 'sudden_step', 'sudden_max',
  'alpha_start', 'alpha_step', 'alpha_max',
  'sick_doc_day1', 'sick_doc_day2_3', 'sick_doc_day4_plus',
  'training_multiplier',
] as const satisfies readonly (keyof PayrollRules)[]

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Tabel pengali per hari: mulai `start`, naik `step` tiap hari, mentok di `max`.
 * Mis. 1.5 / 0.2 / 2 → [1.5, 1.7, 1.9, 2]. Elemen terakhir = nilai mentok.
 */
export function buildMultipliers(start: number, step: number, max: number): number[] {
  if (!(step > 0) || start >= max) return [round2(start)]
  const out: number[] = []
  for (let v = start; v < max - 1e-9 && out.length < 50; v += step) out.push(round2(v))
  out.push(round2(max))
  return out
}

export function normalizeRules(row: Partial<Record<keyof PayrollRules, unknown>> | null | undefined): PayrollRules {
  const r: PayrollRules = { ...DEFAULT_PAYROLL_RULES }
  if (!row) return r
  if (typeof row.effective_from === 'string') r.effective_from = row.effective_from
  for (const k of PAYROLL_RULE_NUMBER_KEYS) {
    const v = row[k]
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) r[k] = Number(v)
  }
  return r
}

/** Set aturan yang berlaku untuk periode yang DIMULAI periodStart (tanggal 26). */
export async function fetchPayrollRules(supabase: Pick<SupabaseClient, 'from'>, periodStart: string): Promise<PayrollRules> {
  const { data, error } = await supabase.from('payroll_rules').select('*')
    .lte('effective_from', periodStart).order('effective_from', { ascending: false }).limit(1).maybeSingle()
  if (!error && data) return normalizeRules(data)
  // Cadangan sebelum migrasi 118 diterapkan: tarif lama di salary_defaults.
  const { data: def } = await supabase.from('salary_defaults').select('late_penalty_per_minute, overtime_rate_per_hour').limit(1).maybeSingle()
  return normalizeRules({ ...DEFAULT_PAYROLL_RULES, ...(def ?? {}), effective_from: periodStart })
}

/** Tanggal mulai periode (26) dari bulan-tahun slip (periode 26 bulan lalu – 25 bulan ini). */
export function periodStartOf(month: number, year: number): string {
  const m = month === 1 ? 12 : month - 1
  const y = month === 1 ? year - 1 : year
  return `${y}-${String(m).padStart(2, '0')}-26`
}

export const fmtMultiplier = (m: number) => `${String(round2(m)).replace('.', ',')}×`
