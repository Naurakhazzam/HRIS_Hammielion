export type PhotoMode = 'none' | 'single' | 'before_after'

export const PHOTO_MODE_LABEL: Record<PhotoMode, string> = {
  none: 'Tanpa foto',
  single: '1 foto bebas',
  before_after: 'Sebelum & Sesudah',
}

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
