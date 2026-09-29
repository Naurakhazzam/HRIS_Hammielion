export type PhotoMode = 'none' | 'single' | 'before_after'

export const PHOTO_MODE_LABEL: Record<PhotoMode, string> = {
  none: 'Tanpa foto',
  single: '1 foto bebas',
  before_after: 'Sebelum & Sesudah',
}

export type Cadence = 'once' | 'daily' | 'weekly' | 'monthly'

export const CADENCE_LABEL: Record<Cadence, string> = {
  once: '1️⃣ Sekali Jalan',
  daily: '🔁 Harian',
  weekly: '🔁 Mingguan',
  monthly: '🔁 Bulanan',
}

export const CADENCE_HINT: Record<Cadence, string> = {
  once: 'Ada tenggat, satu laporan saja. Tidak memengaruhi KPI.',
  daily: 'Berulang tiap hari kerja, dihitung per hari. Terhubung ke KPI.',
  weekly: 'Berulang tiap minggu (Senin-Minggu), dihitung per minggu. Terhubung ke KPI.',
  monthly: 'Berulang tiap periode gajian (26-25), dihitung per periode. Terhubung ke KPI.',
}

export type AssignmentMode = 'individual' | 'team'

export type DailyTaskTemplate = {
  id: string
  title: string
  description: string | null
  photo_mode: PhotoMode
  is_active: boolean
}

export type LogRow = {
  id: string
  employee_id: string
  log_date: string
  before_content: string
  before_photo_paths: string[]
  before_submitted_at: string
  after_content: string | null
  after_photo_paths: string[]
  after_submitted_at: string | null
  phase: 'before_only' | 'done'
  is_invalid: boolean
  invalid_reason: string | null
}

export type PicRow = { branch_id: string; employee_id: string }
