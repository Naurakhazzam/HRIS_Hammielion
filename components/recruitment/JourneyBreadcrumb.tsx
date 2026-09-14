'use client'

export type JourneyStageKey = 'data_diri' | 'screening' | 'psikotes' | 'menunggu'

const STAGES: { key: JourneyStageKey; label: string }[] = [
  { key: 'data_diri', label: 'Data Diri' },
  { key: 'screening', label: 'Screening' },
  { key: 'psikotes', label: 'Psikotes' },
  { key: 'menunggu', label: 'Menunggu Kabar HR' },
]

/**
 * Jejak tahapan yang menempel di atas tiap bagian alur pelamar, supaya
 * mereka tahu sedang di mana dari total perjalanan — bukan cuma progres
 * di dalam satu tahap (itu sudah ditangani masing-masing komponen sendiri,
 * mis. "Level 2" di psikotes atau "7 dari 12 kelompok" di DISC).
 */
export default function JourneyBreadcrumb({ current, skipScreening }: {
  current: JourneyStageKey
  skipScreening?: boolean
}) {
  const currentIndex = STAGES.findIndex(s => s.key === current)
  return (
    <div className="flex items-center flex-wrap gap-1.5 mb-4 pb-3 border-b border-slate-100">
      {STAGES.map((s, i) => {
        const isSkipped = s.key === 'screening' && skipScreening
        const isCurrent = s.key === current
        const isDone = i < currentIndex
        return (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              isCurrent ? 'bg-blue-600 text-white'
                : isSkipped ? 'bg-slate-50 text-slate-300 line-through'
                : isDone ? 'bg-green-100 text-green-700'
                : 'bg-slate-100 text-slate-400'
            }`}>
              {s.label}
            </span>
            {i < STAGES.length - 1 && <span className="text-slate-300 text-xs">→</span>}
          </span>
        )
      })}
    </div>
  )
}
