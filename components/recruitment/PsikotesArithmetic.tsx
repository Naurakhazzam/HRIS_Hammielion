'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { PSYCHOTEST_PRACTICE, PSYCHOTEST_LEVELS, PSYCHOTEST_PRAISE_THRESHOLD } from '@/lib/psychotestLevels'

const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"

type RoundResult = { questions: number; correct: number }
type LevelResult = RoundResult & { level: number; label: string }
type LevelProgress = { level: number; questions: number; correct: number }

function randomInRange(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function praiseFor(accuracy: number): string {
  if (accuracy >= PSYCHOTEST_PRAISE_THRESHOLD) return 'Luar biasa! Ketelitian Anda sangat baik. 👏'
  if (accuracy >= 0.6) return 'Bagus, terus pertahankan!'
  return 'Tahap ini selesai — lanjut ke tahap berikutnya.'
}

function labelForLevel(level: number): string {
  return PSYCHOTEST_LEVELS.find(l => l.level === level)?.label || `Level ${level}`
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
    // Kotak kosong bukan jawaban — jangan dihitung sebagai soal terjawab
    // (Number('') === 0 di JS, jadi tanpa guard ini malah bisa "benar" kalau
    // hasilnya kebetulan 0, dan tetap menambah jumlah soal walau belum dijawab).
    if (answer.trim() === '') return
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

export default function PsikotesArithmetic({ applicantId, phone, initialLevelsDone, onDone }: {
  applicantId: string
  phone: string
  initialLevelsDone?: LevelProgress[]
  onDone: () => void
}) {
  const alreadyDone = initialLevelsDone || []
  const [levelResults, setLevelResults] = useState<LevelResult[]>(
    alreadyDone.map(p => ({ level: p.level, label: labelForLevel(p.level), questions: p.questions, correct: p.correct }))
  )
  // levelIndex menunjuk ke level yang BELUM dikerjakan — kalau resume dengan
  // sebagian level sudah tersimpan di server, langsung lanjut dari situ.
  const [levelIndex, setLevelIndex] = useState(alreadyDone.length)
  const [phase, setPhase] = useState<'intro' | 'practice' | 'confirm' | 'level' | 'submitting_level' | 'level_result' | 'summary'>(
    alreadyDone.length > 0 ? 'level' : 'intro'
  )
  const [lastResult, setLastResult] = useState<RoundResult | null>(null)
  const [error, setError] = useState('')

  async function handleLevelComplete(result: RoundResult) {
    const cfg = PSYCHOTEST_LEVELS[levelIndex]
    setLastResult(result)
    setPhase('submitting_level')
    setError('')
    try {
      const res = await fetch('/api/lamaran/psikotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicant_id: applicantId, phone, level: cfg.level, questions: result.questions, correct: result.correct }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal menyimpan hasil level ini.')
        setPhase('level_result')
        return
      }
      setLevelResults(prev => [...prev, { level: cfg.level, label: cfg.label, ...result }])
      if (data.allLevelsDone) {
        setPhase('summary')
        onDone()
      } else {
        setPhase('level_result')
      }
    } catch {
      setError('Gagal menyimpan hasil level ini. Cek koneksi internet Anda.')
      setPhase('level_result')
    }
  }

  function handleContinue() {
    setLevelIndex(i => i + 1)
    setPhase('level')
  }

  if (phase === 'intro') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-700">Selamat! Anda lolos ke tahap psikotes.</p>
        <p className="text-sm text-slate-600">
          Anda akan mengerjakan tes hitung sederhana dalam 3 level yang makin sulit (masing-masing 2 menit). Soal
          penjumlahan muncul satu per satu — jawab secepat dan setepat mungkin, lalu tekan Enter untuk lanjut ke
          soal berikutnya. Sebelum mulai, ada 1 ronde latihan {PSYCHOTEST_PRACTICE.durationSeconds} detik dulu
          (tidak dinilai) supaya Anda terbiasa dengan caranya. Hasil tiap level langsung tersimpan begitu selesai,
          jadi kalau koneksi terputus Anda bisa lanjut dari level berikutnya tanpa mengulang dari awal.
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
    if (!cfg) return null
    return (
      <div className="space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
        )}
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

  if (phase === 'submitting_level') {
    return <p className="text-sm text-slate-500 text-center">Menyimpan hasil level ini...</p>
  }

  if (phase === 'level_result' && lastResult) {
    const accuracy = lastResult.questions > 0 ? lastResult.correct / lastResult.questions : 0
    const isLast = levelIndex >= PSYCHOTEST_LEVELS.length - 1
    return (
      <div className="space-y-3 text-center">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 text-left">{error}</div>
        )}
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
