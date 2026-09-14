'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { PSYCHOTEST_PRACTICE, PSYCHOTEST_LEVELS, PSYCHOTEST_PRAISE_THRESHOLD } from '@/lib/psychotestLevels'

const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"

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

export default function PsikotesArithmetic({ applicantId, phone, onDone }: { applicantId: string; phone: string; onDone: () => void }) {
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
      <div className="space-y-3">
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
      <div className="space-y-3">
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
      <div className="space-y-3 text-center">
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
      <div className="space-y-3">
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
      <div className="space-y-3 text-center">
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
    return <p className="text-sm text-slate-500 text-center">Menyimpan hasil...</p>
  }

  const totalQuestions = levelResults.reduce((sum, r) => sum + r.questions, 0)
  const totalCorrect = levelResults.reduce((sum, r) => sum + r.correct, 0)
  const overallAccuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0

  return (
    <div className="space-y-3">
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
