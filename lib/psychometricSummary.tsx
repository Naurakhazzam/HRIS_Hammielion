// Dipakai bareng oleh halaman admin (Detail Pelamar) dan halaman kandidat (Undangan Interview)
// supaya render skor psikotes & psikometri konsisten di kedua tempat, tidak ada dua salinan
// logic yang bisa saling tidak sinkron.

export const PSYCHOMETRIC_LABELS: Record<string, string> = {
  disc: 'DISC — Gaya Kerja',
  personality: 'Tipe Kepribadian Kerja',
  work_preference: 'Preferensi Kerja',
  integrity: 'Sikap & Etika Kerja',
}

export function psychotestLabel(score: number): string {
  if (score >= 80) return 'Sangat Stabil'
  if (score >= 60) return 'Stabil'
  if (score >= 40) return 'Cukup'
  return 'Kurang Stabil'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderPsychometricSummary(testType: string, summary: any) {
  if (testType === 'disc') {
    return (
      <p className="text-sm text-slate-600">
        Gaya dominan: <span className="font-medium">{summary.dominant_traits.join(' & ')}</span> — {summary.description}
      </p>
    )
  }
  if (testType === 'personality') {
    return (
      <p className="text-sm text-slate-600">
        Tipe: <span className="font-medium">{summary.type}</span> — {summary.description}
      </p>
    )
  }
  if (testType === 'work_preference') {
    return (
      <div className="space-y-1">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {summary.dimensions.map((d: any) => (
          <div key={d.key} className="flex justify-between text-sm text-slate-600">
            <span>{d.label}</span><span className="font-medium">{d.level}</span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <p className="text-sm text-slate-600">
      Kecenderungan: <span className="font-medium">{summary.level}</span> ({summary.percentage}%)
    </p>
  )
}
