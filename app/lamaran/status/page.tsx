'use client'

import { useState } from 'react'
import { APPLICANT_STATUS_LABELS as STATUS_LABELS } from '@/lib/recruitmentStatusLabels'
import { TestType } from '@/lib/psychometricTests'
import RecruitmentFlow from '@/components/recruitment/RecruitmentFlow'
import { ScreeningQuestion } from '@/components/recruitment/ScreeningForm'

const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"

type StatusResult = {
  found: boolean
  notice: string
  applicant_id?: string
  full_name?: string
  application_code?: string
  status?: string
  questions?: ScreeningQuestion[]
  existing_answers?: Record<string, string>
  psychotest_done?: boolean
  psikotes_levels_done?: { level: number; questions: number; correct: number }[]
  psychometric_done?: Record<TestType, boolean>
}

export default function CekStatusLamaranPage() {
  const [full_name, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<StatusResult | null>(null)
  const [error, setError] = useState('')

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/lamaran/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, phone }),
      })
      const data: StatusResult = await res.json()
      setResult(data)
    } catch {
      setError('Gagal mengecek status. Cek koneksi internet Anda.')
    } finally {
      setLoading(false)
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

            {result.found && result.applicant_id && (
              <div className="pt-3 border-t border-slate-100">
                <RecruitmentFlow
                  applicantId={result.applicant_id}
                  phone={phone}
                  status={result.status || ''}
                  questions={result.questions}
                  existingAnswers={result.existing_answers}
                  psychotestDone={result.psychotest_done}
                  psikotesLevelsDone={result.psikotes_levels_done}
                  psychometricDone={result.psychometric_done}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
