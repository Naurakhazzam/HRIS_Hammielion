'use client'

import { useState } from 'react'
import { blockPasteOnChange, blockPasteHandlers } from '@/lib/noPaste'

const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"

export type ScreeningQuestion = { id: string; question_text: string }

export default function ScreeningForm({ applicantId, phone, questions, existingAnswers, onDone }: {
  applicantId: string
  phone: string
  questions: ScreeningQuestion[]
  existingAnswers?: Record<string, string>
  onDone: () => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(existingAnswers || {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateAnswer(questionId: string, value: string) {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/lamaran/screening-answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicant_id: applicantId,
          phone,
          answers: Object.entries(answers).map(([question_id, answer_text]) => ({ question_id, answer_text })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal menyimpan jawaban.')
        return
      }
      onDone()
    } catch {
      setError('Gagal menyimpan jawaban. Cek koneksi internet Anda.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm font-medium text-slate-700">
        Selamat! Anda lolos ke tahap screening. Mohon jawab pertanyaan berikut:
      </p>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
      )}
      {questions.map(q => (
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
      <button type="submit" disabled={saving}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
        {saving ? 'Menyimpan...' : 'Kirim Jawaban'}
      </button>
    </form>
  )
}
