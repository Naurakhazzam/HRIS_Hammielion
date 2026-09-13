'use client'

import { useState } from 'react'
import { blockPasteOnChange, blockPasteHandlers } from '@/lib/noPaste'

const STATUS_LABELS: Record<string, string> = {
  baru: 'Baru Masuk',
  screening: 'Sedang Diproses (Screening)',
  interview: 'Dipanggil Interview',
  diterima: 'Diterima',
  ditolak: 'Belum Berhasil Kali Ini',
}

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
}

export default function CekStatusLamaranPage() {
  const [full_name, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<StatusResult | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [savingAnswers, setSavingAnswers] = useState(false)
  const [answersSaved, setAnswersSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setAnswersSaved(false)
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
          </div>
        )}
      </div>
    </div>
  )
}
