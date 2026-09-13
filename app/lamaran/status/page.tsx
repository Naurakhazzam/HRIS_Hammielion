'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { blockPasteOnChange, blockPasteHandlers } from '@/lib/noPaste'
import { APPLICANT_STATUS_LABELS as STATUS_LABELS } from '@/lib/recruitmentStatusLabels'

const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"

const TEST_DURATION_SECONDS = 120
const INTERVAL_SECONDS = 30

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
}

function randomDigit() {
  return Math.floor(Math.random() * 10)
}

function PsychotestSection({ applicantId, phone, onDone }: { applicantId: string; phone: string; onDone: () => void }) {
  const [phase, setPhase] = useState<'intro' | 'running' | 'submitting' | 'finished'>('intro')
  const [timeLeft, setTimeLeft] = useState(TEST_DURATION_SECONDS)
  const [problem, setProblem] = useState({ a: randomDigit(), b: randomDigit() })
  const [answer, setAnswer] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const statsRef = useRef({ total: 0, correct: 0, wrong: 0 })
  const elapsedRef = useRef(0)
  const currentIntervalRef = useRef({ questions: 0, correct: 0 })
  const intervalStatsRef = useRef<{ interval: number; questions: number; correct: number }[]>([])

  const finishTest = useCallback(async () => {
    setPhase('submitting')
    intervalStatsRef.current.push({ interval: intervalStatsRef.current.length + 1, ...currentIntervalRef.current })
    try {
      await fetch('/api/lamaran/psikotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicant_id: applicantId,
          phone,
          total_questions: statsRef.current.total,
          correct_count: statsRef.current.correct,
          wrong_count: statsRef.current.wrong,
          interval_stats: intervalStatsRef.current,
        }),
      })
    } finally {
      setPhase('finished')
      onDone()
    }
  }, [applicantId, phone, onDone])

  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => {
      elapsedRef.current += 1
      setTimeLeft(TEST_DURATION_SECONDS - elapsedRef.current)

      if (elapsedRef.current % INTERVAL_SECONDS === 0 && elapsedRef.current < TEST_DURATION_SECONDS) {
        intervalStatsRef.current.push({ interval: intervalStatsRef.current.length + 1, ...currentIntervalRef.current })
        currentIntervalRef.current = { questions: 0, correct: 0 }
      }

      if (elapsedRef.current >= TEST_DURATION_SECONDS) {
        clearInterval(id)
        finishTest()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase, finishTest])

  function startTest() {
    statsRef.current = { total: 0, correct: 0, wrong: 0 }
    elapsedRef.current = 0
    currentIntervalRef.current = { questions: 0, correct: 0 }
    intervalStatsRef.current = []
    setTimeLeft(TEST_DURATION_SECONDS)
    setProblem({ a: randomDigit(), b: randomDigit() })
    setAnswer('')
    setPhase('running')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleAnswerSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (phase !== 'running') return
    const isCorrect = Number(answer) === problem.a + problem.b
    statsRef.current.total += 1
    if (isCorrect) statsRef.current.correct += 1; else statsRef.current.wrong += 1
    currentIntervalRef.current.questions += 1
    if (isCorrect) currentIntervalRef.current.correct += 1
    setAnswer('')
    setProblem({ a: randomDigit(), b: randomDigit() })
  }

  if (phase === 'intro') {
    return (
      <div className="pt-3 border-t border-slate-100 space-y-3">
        <p className="text-sm font-medium text-slate-700">Selamat! Anda lolos ke tahap psikotes.</p>
        <p className="text-sm text-slate-600">
          Anda akan mengerjakan tes hitung sederhana selama 2 menit. Soal penjumlahan akan muncul satu per satu —
          jawab secepat dan setepat mungkin, lalu tekan Enter untuk lanjut ke soal berikutnya. Tes berjalan otomatis
          sampai waktu habis dan hanya bisa dikerjakan satu kali.
        </p>
        <button onClick={startTest} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
          Mulai Tes
        </button>
      </div>
    )
  }

  if (phase === 'running') {
    return (
      <div className="pt-3 border-t border-slate-100 space-y-4 text-center">
        <p className="text-sm text-slate-500">Sisa waktu: <span className="font-semibold">{timeLeft} detik</span></p>
        <p className="text-4xl font-bold text-slate-800">{problem.a} + {problem.b} = ?</p>
        <form onSubmit={handleAnswerSubmit} className="flex gap-2">
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

  if (phase === 'submitting') {
    return <div className="pt-3 border-t border-slate-100 text-sm text-slate-500 text-center">Menyimpan hasil...</div>
  }

  return (
    <div className="pt-3 border-t border-slate-100 text-sm text-slate-700 text-center">
      Tes selesai, hasil sudah dikirim ke HR. Terima kasih!
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
                <div className="pt-3 border-t border-slate-100 text-sm text-slate-700 text-center">
                  Anda sudah menyelesaikan tes ini, tunggu kabar dari HR.
                </div>
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
