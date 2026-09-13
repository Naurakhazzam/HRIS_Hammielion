'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { blockPasteOnChange, blockPasteHandlers } from '@/lib/noPaste'
import { APPLICANT_STATUS_LABELS as STATUS_LABELS } from '@/lib/recruitmentStatusLabels'
import { PSYCHOTEST_PRACTICE, PSYCHOTEST_LEVELS, PSYCHOTEST_PRAISE_THRESHOLD } from '@/lib/psychotestLevels'
import { DISC_BLOCKS, PERSONALITY_ITEMS, WORK_PREFERENCE_ITEMS, INTEGRITY_ITEMS, TestType } from '@/lib/psychometricTests'

const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"

type Question = { id: string; question_text: string }

type StatusResult = {
  found: boolean
  notice: string
  applicant_id?: string
  full_name?: string
  application_code?: string
  status?: string
  questions?: Question[]
  existing_answers?: Record<string, string>
  psychotest_done?: boolean
  psychometric_done?: Record<TestType, boolean>
}

type RoundResult = { questions: number; correct: number }
type LevelResult = RoundResult & { level: number; label: string }

function randomInRange(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function praiseFor(accuracy: number): string {
  if (accuracy >= PSYCHOTEST_PRAISE_THRESHOLD) return 'Luar biasa! Ketelitian Anda sangat baik. 👏'
  if (accuracy >= 0.6) return 'Bagus, terus pertahankan!'
  return 'Tahap ini selesai — lanjut ke tahap berikutnya.'
}

// Komponen ronde hitung cepat, dipakai ulang untuk latihan maupun 3 level
// sungguhan (beda parameter rentang angka & durasi saja).
function TimedArithmeticRound({ durationSeconds, rangeMin, rangeMax, onComplete }: {
  durationSeconds: number
  rangeMin: number
  rangeMax: number
  onComplete: (result: RoundResult) => void
}) {
  const [timeLeft, setTimeLeft] = useState(durationSeconds)
  const [problem, setProblem] = useState({ a: randomInRange(rangeMin, rangeMax), b: randomInRange(rangeMin, rangeMax) })
  const [answer, setAnswer] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const statsRef = useRef({ questions: 0, correct: 0 })
  const prevProblemRef = useRef(problem)

  const finish = useCallback(() => {
    onComplete(statsRef.current)
  }, [onComplete])

  useEffect(() => {
    const id = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(id)
          finish()
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [finish])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function nextProblem() {
    let p = { a: randomInRange(rangeMin, rangeMax), b: randomInRange(rangeMin, rangeMax) }
    // Hindari pasangan angka yang persis sama dengan soal sebelumnya, biar tidak berasa berulang.
    while (p.a === prevProblemRef.current.a && p.b === prevProblemRef.current.b) {
      p = { a: randomInRange(rangeMin, rangeMax), b: randomInRange(rangeMin, rangeMax) }
    }
    prevProblemRef.current = p
    setProblem(p)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const isCorrect = Number(answer) === problem.a + problem.b
    statsRef.current.questions += 1
    if (isCorrect) statsRef.current.correct += 1
    setAnswer('')
    nextProblem()
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-slate-500">Sisa waktu: <span className="font-semibold">{timeLeft} detik</span></p>
      <p className="text-4xl font-bold text-slate-800">{problem.a} + {problem.b} = ?</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          className={inputClass + " text-center text-lg"}
          value={answer}
          onChange={e => setAnswer(e.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium shrink-0">
          Jawab
        </button>
      </form>
    </div>
  )
}

function PsychotestSection({ applicantId, phone, onDone }: { applicantId: string; phone: string; onDone: () => void }) {
  const [phase, setPhase] = useState<'intro' | 'practice' | 'confirm' | 'level' | 'level_result' | 'submitting' | 'summary'>('intro')
  const [levelIndex, setLevelIndex] = useState(0)
  const [levelResults, setLevelResults] = useState<LevelResult[]>([])
  const [lastResult, setLastResult] = useState<RoundResult | null>(null)

  async function submitResults(results: LevelResult[]) {
    setPhase('submitting')
    try {
      await fetch('/api/lamaran/psikotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicant_id: applicantId,
          phone,
          levels: results.map(r => ({ level: r.level, questions: r.questions, correct: r.correct })),
        }),
      })
    } finally {
      setPhase('summary')
      onDone()
    }
  }

  function handleLevelComplete(result: RoundResult) {
    const cfg = PSYCHOTEST_LEVELS[levelIndex]
    const entry: LevelResult = { level: cfg.level, label: cfg.label, ...result }
    const updated = [...levelResults, entry]
    setLevelResults(updated)
    setLastResult(result)
    setPhase('level_result')
  }

  function handleContinue() {
    if (levelIndex < PSYCHOTEST_LEVELS.length - 1) {
      setLevelIndex(i => i + 1)
      setPhase('level')
    } else {
      submitResults(levelResults)
    }
  }

  if (phase === 'intro') {
    return (
      <div className="pt-3 border-t border-slate-100 space-y-3">
        <p className="text-sm font-medium text-slate-700">Selamat! Anda lolos ke tahap psikotes.</p>
        <p className="text-sm text-slate-600">
          Anda akan mengerjakan tes hitung sederhana dalam 3 level yang makin sulit (masing-masing 2 menit). Soal
          penjumlahan muncul satu per satu — jawab secepat dan setepat mungkin, lalu tekan Enter untuk lanjut ke
          soal berikutnya. Sebelum mulai, ada 1 ronde latihan {PSYCHOTEST_PRACTICE.durationSeconds} detik dulu
          (tidak dinilai) supaya Anda terbiasa dengan caranya. Tes sungguhan hanya bisa dikerjakan satu kali.
        </p>
        <button onClick={() => setPhase('practice')} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
          Mulai Latihan
        </button>
      </div>
    )
  }

  if (phase === 'practice') {
    return (
      <div className="pt-3 border-t border-slate-100 space-y-3">
        <p className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block">
          Latihan — hasil ronde ini tidak dinilai
        </p>
        <TimedArithmeticRound
          durationSeconds={PSYCHOTEST_PRACTICE.durationSeconds}
          rangeMin={PSYCHOTEST_PRACTICE.min}
          rangeMax={PSYCHOTEST_PRACTICE.max}
          onComplete={() => setPhase('confirm')}
        />
      </div>
    )
  }

  if (phase === 'confirm') {
    return (
      <div className="pt-3 border-t border-slate-100 space-y-3 text-center">
        <p className="text-sm font-medium text-slate-700">Apakah Anda sudah terbiasa dengan cara mengerjakannya?</p>
        <button onClick={() => setPhase('level')} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
          Ya, Saya Siap Mulai Tes Sesungguhnya
        </button>
      </div>
    )
  }

  if (phase === 'level') {
    const cfg = PSYCHOTEST_LEVELS[levelIndex]
    return (
      <div className="pt-3 border-t border-slate-100 space-y-3">
        <p className="text-sm font-medium text-slate-700 text-center">{cfg.label}</p>
        <TimedArithmeticRound
          durationSeconds={cfg.durationSeconds}
          rangeMin={cfg.min}
          rangeMax={cfg.max}
          onComplete={handleLevelComplete}
        />
      </div>
    )
  }

  if (phase === 'level_result' && lastResult) {
    const accuracy = lastResult.questions > 0 ? lastResult.correct / lastResult.questions : 0
    const isLast = levelIndex >= PSYCHOTEST_LEVELS.length - 1
    return (
      <div className="pt-3 border-t border-slate-100 space-y-3 text-center">
        <p className="text-sm font-medium text-slate-700">{PSYCHOTEST_LEVELS[levelIndex].label} selesai</p>
        <p className="text-sm text-slate-600">
          Anda menjawab {lastResult.questions} soal, dengan tingkat akurasi {Math.round(accuracy * 100)}%.
        </p>
        <p className="text-sm font-medium text-blue-700">{praiseFor(accuracy)}</p>
        <button onClick={handleContinue} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
          {isLast ? 'Lihat Ringkasan' : 'Lanjut ke Level Berikutnya'}
        </button>
      </div>
    )
  }

  if (phase === 'submitting') {
    return <div className="pt-3 border-t border-slate-100 text-sm text-slate-500 text-center">Menyimpan hasil...</div>
  }

  const totalQuestions = levelResults.reduce((sum, r) => sum + r.questions, 0)
  const totalCorrect = levelResults.reduce((sum, r) => sum + r.correct, 0)
  const overallAccuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0

  return (
    <div className="pt-3 border-t border-slate-100 space-y-3">
      <p className="text-sm font-medium text-slate-700 text-center">Tes Selesai — Ringkasan Hasil Anda</p>
      <div className="space-y-1">
        {levelResults.map(r => {
          const acc = r.questions > 0 ? r.correct / r.questions : 0
          return (
            <div key={r.level} className="flex justify-between text-sm text-slate-600 border-b border-slate-100 pb-1">
              <span>{r.label}</span>
              <span>{r.correct}/{r.questions} benar ({Math.round(acc * 100)}%)</span>
            </div>
          )
        })}
      </div>
      <p className="text-sm text-slate-700 text-center">
        Akurasi keseluruhan: <span className="font-semibold">{Math.round(overallAccuracy * 100)}%</span>
      </p>
      {overallAccuracy >= PSYCHOTEST_PRAISE_THRESHOLD && (
        <p className="text-sm font-medium text-green-700 text-center">
          Selamat, hasil Anda sangat baik! 🎉 Hasil sudah dikirim ke HR, terima kasih sudah mengerjakan dengan sungguh-sungguh.
        </p>
      )}
      {overallAccuracy < PSYCHOTEST_PRAISE_THRESHOLD && (
        <p className="text-sm text-slate-600 text-center">
          Terima kasih sudah menyelesaikan tes ini. Hasil sudah dikirim ke HR.
        </p>
      )}
    </div>
  )
}

// ============================================================
// Bagian 2 — DISC, Tipe Kepribadian, Preferensi Kerja, Sikap & Etika Kerja.
// Beda dari tes hitung cepat: hasil interpretasinya boleh dilihat pelamar.
// ============================================================

const PSYCHOMETRIC_MODULES: { type: TestType; title: string; description: string }[] = [
  {
    type: 'disc',
    title: 'DISC — Gaya Kerja',
    description: 'Untuk tiap kelompok pernyataan, pilih satu yang PALING menggambarkan Anda, dan satu yang PALING TIDAK menggambarkan Anda.',
  },
  {
    type: 'personality',
    title: 'Tipe Kepribadian Kerja',
    description: 'Nyatakan seberapa setuju Anda dengan tiap pernyataan berikut, dari 1 (Sangat Tidak Setuju) sampai 5 (Sangat Setuju).',
  },
  {
    type: 'work_preference',
    title: 'Preferensi Kerja',
    description: 'Nyatakan seberapa setuju Anda dengan tiap pernyataan tentang gaya kerja Anda.',
  },
  {
    type: 'integrity',
    title: 'Sikap & Etika Kerja',
    description: 'Jawab sesuai pendapat pribadi Anda yang sebenarnya — tidak ada jawaban benar atau salah.',
  },
]

function DiscForm({ onSubmit }: { onSubmit: (answers: { most: number; least: number }[]) => void }) {
  const [selections, setSelections] = useState<{ most: number | null; least: number | null }[]>(
    DISC_BLOCKS.map(() => ({ most: null, least: null }))
  )
  const allAnswered = selections.every(s => s.most !== null && s.least !== null)

  function setMost(blockIndex: number, optIndex: number) {
    setSelections(prev => prev.map((s, i) => (i === blockIndex ? { ...s, most: optIndex, least: s.least === optIndex ? null : s.least } : s)))
  }
  function setLeast(blockIndex: number, optIndex: number) {
    setSelections(prev => prev.map((s, i) => (i === blockIndex ? { ...s, least: optIndex, most: s.most === optIndex ? null : s.most } : s)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allAnswered) return
    onSubmit(selections.map(s => ({ most: s.most as number, least: s.least as number })))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {DISC_BLOCKS.map((block, bi) => (
        <div key={bi} className="border border-slate-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-slate-400">Kelompok {bi + 1} dari {DISC_BLOCKS.length}</p>
          {block.map((opt, oi) => (
            <div key={oi} className="flex items-center justify-between gap-2">
              <span className="flex-1 text-sm text-slate-700">{opt.text}</span>
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => setMost(bi, oi)}
                  className={`px-2 py-1 rounded text-xs border ${selections[bi].most === oi ? 'bg-green-600 text-white border-green-600' : 'border-slate-300 text-slate-500'}`}>
                  Paling
                </button>
                <button type="button" onClick={() => setLeast(bi, oi)}
                  className={`px-2 py-1 rounded text-xs border ${selections[bi].least === oi ? 'bg-red-600 text-white border-red-600' : 'border-slate-300 text-slate-500'}`}>
                  Paling Tidak
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
      <button type="submit" disabled={!allAnswered}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
        Kirim Jawaban
      </button>
    </form>
  )
}

function LikertForm({ items, onSubmit }: { items: { text: string }[]; onSubmit: (answers: number[]) => void }) {
  const [values, setValues] = useState<(number | null)[]>(items.map(() => null))
  const allAnswered = values.every(v => v !== null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allAnswered) return
    onSubmit(values as number[])
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {items.map((item, i) => (
        <div key={i} className="space-y-1.5">
          <p className="text-sm text-slate-700">{i + 1}. {item.text}</p>
          <div className="flex justify-between gap-1">
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} type="button" onClick={() => setValues(prev => prev.map((p, idx) => (idx === i ? v : p)))}
                className={`flex-1 py-2 rounded border text-sm ${values[i] === v ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-600'}`}>
                {v}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Sangat Tidak Setuju</span><span>Sangat Setuju</span>
          </div>
        </div>
      ))}
      <button type="submit" disabled={!allAnswered}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
        Kirim Jawaban
      </button>
    </form>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PsychometricResultDisplay({ testType, summary }: { testType: TestType; summary: any }) {
  if (testType === 'disc') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Gaya dominan Anda: {summary.dominant_traits.join(' & ')}</p>
        <p className="text-sm text-slate-600">{summary.description}</p>
      </div>
    )
  }
  if (testType === 'personality') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Tipe kecenderungan Anda: {summary.type}</p>
        <p className="text-sm text-slate-600">{summary.description}</p>
      </div>
    )
  }
  if (testType === 'work_preference') {
    return (
      <div className="space-y-1">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {summary.dimensions.map((d: any) => (
          <div key={d.key} className="flex justify-between text-sm text-slate-600 border-b border-slate-100 pb-1">
            <span>{d.label}</span><span className="font-medium">{d.level}</span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">Kecenderungan: {summary.level}</p>
      <p className="text-xs text-slate-500">{summary.note}</p>
    </div>
  )
}

function PsychometricBattery({ applicantId, phone, initialDone }: {
  applicantId: string
  phone: string
  initialDone: Record<TestType, boolean>
}) {
  const [doneMap, setDoneMap] = useState(initialDone)
  const [phase, setPhase] = useState<'intro' | 'form' | 'submitting' | 'result' | 'all_done'>(
    () => (PSYCHOMETRIC_MODULES.every(m => initialDone[m.type]) ? 'all_done' : 'intro')
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [resultSummary, setResultSummary] = useState<any>(null)
  // Modul yang hasilnya sedang ditampilkan di layar 'result' — disimpan terpisah dari
  // currentModule, karena begitu doneMap di-update, currentModule sudah loncat ke modul
  // BERIKUTNYA yang belum dikerjakan, padahal layar hasil masih perlu menampilkan modul
  // yang barusan selesai (termasuk saat itu modul terakhir, di mana currentModule jadi null).
  const [completedType, setCompletedType] = useState<TestType | null>(null)
  const [error, setError] = useState('')

  const currentIndex = PSYCHOMETRIC_MODULES.findIndex(m => !doneMap[m.type])
  const currentModule = currentIndex === -1 ? null : PSYCHOMETRIC_MODULES[currentIndex]

  async function handleModuleSubmit(answers: unknown) {
    if (!currentModule) return
    setPhase('submitting')
    setError('')
    try {
      const res = await fetch('/api/lamaran/psychometric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicant_id: applicantId, phone, test_type: currentModule.type, answers }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal menyimpan jawaban.')
        setPhase('form')
        return
      }
      setResultSummary(data.result_summary)
      setCompletedType(currentModule.type)
      setDoneMap(prev => ({ ...prev, [currentModule.type]: true }))
      setPhase('result')
    } catch {
      setError('Gagal menyimpan jawaban. Cek koneksi internet Anda.')
      setPhase('form')
    }
  }

  function handleContinue() {
    setResultSummary(null)
    const nextIndex = PSYCHOMETRIC_MODULES.findIndex(m => !doneMap[m.type])
    setPhase(nextIndex === -1 ? 'all_done' : 'intro')
  }

  if (phase === 'all_done') {
    return (
      <div className="pt-3 border-t border-slate-100 text-sm text-slate-700 text-center space-y-2">
        <p>Anda sudah menyelesaikan seluruh rangkaian tes tambahan. Terima kasih!</p>
        <p className="text-xs text-slate-400">
          Hasil di atas menunjukkan kecenderungan dari jawaban Anda sendiri — bukan diagnosis psikologi resmi.
        </p>
      </div>
    )
  }

  if (phase === 'result' && resultSummary && completedType) {
    const completedModule = PSYCHOMETRIC_MODULES.find(m => m.type === completedType)
    return (
      <div className="pt-3 border-t border-slate-100 space-y-4">
        <div className="space-y-3 text-center">
          <p className="text-sm font-medium text-slate-700">{completedModule?.title} — Selesai</p>
          <div className="text-left bg-slate-50 border border-slate-200 rounded-lg p-3">
            <PsychometricResultDisplay testType={completedType} summary={resultSummary} />
          </div>
          <button onClick={handleContinue} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
            Lanjut
          </button>
        </div>
      </div>
    )
  }

  if (!currentModule) return null

  return (
    <div className="pt-3 border-t border-slate-100 space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
      )}

      {phase === 'intro' && (
        <div className="space-y-3 text-center">
          <p className="text-sm font-medium text-slate-700">{currentModule.title}</p>
          <p className="text-sm text-slate-600">{currentModule.description}</p>
          <button onClick={() => setPhase('form')} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
            Mulai
          </button>
        </div>
      )}

      {phase === 'form' && currentModule.type === 'disc' && <DiscForm onSubmit={handleModuleSubmit} />}
      {phase === 'form' && currentModule.type === 'personality' && <LikertForm items={PERSONALITY_ITEMS} onSubmit={handleModuleSubmit} />}
      {phase === 'form' && currentModule.type === 'work_preference' && <LikertForm items={WORK_PREFERENCE_ITEMS} onSubmit={handleModuleSubmit} />}
      {phase === 'form' && currentModule.type === 'integrity' && <LikertForm items={INTEGRITY_ITEMS} onSubmit={handleModuleSubmit} />}

      {phase === 'submitting' && <p className="text-sm text-slate-500 text-center">Menyimpan hasil...</p>}
    </div>
  )
}

export default function CekStatusLamaranPage() {
  const [full_name, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<StatusResult | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [savingAnswers, setSavingAnswers] = useState(false)
  const [answersSaved, setAnswersSaved] = useState(false)
  const [psychotestFinished, setPsychotestFinished] = useState(false)
  const [error, setError] = useState('')

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setAnswersSaved(false)
    setPsychotestFinished(false)
    try {
      const res = await fetch('/api/lamaran/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, phone }),
      })
      const data: StatusResult = await res.json()
      setResult(data)
      setAnswers(data.existing_answers || {})
    } catch {
      setError('Gagal mengecek status. Cek koneksi internet Anda.')
    } finally {
      setLoading(false)
    }
  }

  function updateAnswer(questionId: string, value: string) {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  async function handleSubmitAnswers(e: React.FormEvent) {
    e.preventDefault()
    if (!result?.applicant_id) return
    setSavingAnswers(true)
    setError('')
    try {
      const res = await fetch('/api/lamaran/screening-answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicant_id: result.applicant_id,
          phone,
          answers: Object.entries(answers).map(([question_id, answer_text]) => ({ question_id, answer_text })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal menyimpan jawaban.')
        return
      }
      setAnswersSaved(true)
    } catch {
      setError('Gagal menyimpan jawaban. Cek koneksi internet Anda.')
    } finally {
      setSavingAnswers(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Cek Status Lamaran</h1>
          <p className="text-sm text-slate-500 mt-1">Hammielion Management</p>
        </div>

        <form onSubmit={handleCheck} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nama Lengkap</label>
            <input className={inputClass} required value={full_name} onChange={e => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nomor HP</label>
            <input className={inputClass} required value={phone} onChange={e => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? 'Mencari...' : 'Cek Status'}
          </button>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mt-4">{error}</div>
        )}

        {result && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mt-4 space-y-3">
            {result.found ? (
              <>
                <p className="text-sm text-slate-500">Kode Lamaran: <span className="font-mono text-blue-600">{result.application_code}</span></p>
                <p className="text-base text-slate-800">
                  Status: <span className="font-semibold">{STATUS_LABELS[result.status || ''] || result.status}</span>
                </p>
              </>
            ) : (
              <p className="text-base text-slate-800">Data lamaran tidak ditemukan.</p>
            )}
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{result.notice}</p>

            {result.found && result.status === 'screening' && result.questions && result.questions.length > 0 && (
              <form onSubmit={handleSubmitAnswers} className="pt-3 border-t border-slate-100 space-y-4">
                <p className="text-sm font-medium text-slate-700">
                  Selamat! Anda lolos ke tahap screening. Mohon jawab pertanyaan berikut:
                </p>
                {result.questions.map(q => (
                  <div key={q.id} className="space-y-1">
                    <label className="block text-sm font-medium text-slate-700">{q.question_text}</label>
                    <textarea
                      className={inputClass}
                      rows={3}
                      required
                      value={answers[q.id] || ''}
                      onChange={blockPasteOnChange(answers[q.id] || '', v => updateAnswer(q.id, v))}
                      {...blockPasteHandlers}
                    />
                  </div>
                ))}
                <p className="text-xs text-slate-400">Tulis dengan kata-kata sendiri — kolom ini tidak bisa ditempel (paste).</p>
                <button type="submit" disabled={savingAnswers}
                  className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                  {savingAnswers ? 'Menyimpan...' : answersSaved ? 'Tersimpan!' : 'Kirim Jawaban'}
                </button>
              </form>
            )}

            {result.found && result.status === 'psikotes' && result.applicant_id && (
              psychotestFinished || result.psychotest_done ? (
                <PsychometricBattery
                  applicantId={result.applicant_id}
                  phone={phone}
                  initialDone={result.psychometric_done || { disc: false, personality: false, work_preference: false, integrity: false }}
                />
              ) : (
                <PsychotestSection
                  applicantId={result.applicant_id}
                  phone={phone}
                  onDone={() => setPsychotestFinished(true)}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
