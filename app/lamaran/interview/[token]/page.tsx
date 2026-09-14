'use client'

import { use, useState, useEffect } from 'react'
import { PSYCHOMETRIC_LABELS, renderPsychometricSummary, psychotestLabel } from '@/lib/psychometricSummary'

type PsychotestResult = { score: number; overall_accuracy: number; resilience: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PsychometricRow = { test_type: string; result_summary: any }

type InviteData = {
  found: boolean
  scheduled?: boolean
  full_name?: string
  application_code?: string
  interview_scheduled_at?: string
  interview_confirmation?: string | null
  interview_confirmed_at?: string | null
  psychotest?: PsychotestResult | null
  psychometrics?: PsychometricRow[]
}

function formatSchedule(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB'
}

export default function InterviewInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<InviteData | null>(null)
  const [confirmationText, setConfirmationText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchInvite() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchInvite() {
    setLoading(true)
    try {
      const res = await fetch(`/api/lamaran/interview/${token}`)
      const json: InviteData = await res.json()
      setData(json)
      if (json.interview_confirmation) setConfirmationText(json.interview_confirmation)
    } catch {
      setError('Gagal memuat undangan. Cek koneksi internet Anda.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (!confirmationText.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/lamaran/interview/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation_text: confirmationText }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Gagal mengirim konfirmasi.'); setSubmitting(false); return }
      setSubmitted(true)
    } catch {
      setError('Gagal mengirim konfirmasi. Cek koneksi internet Anda.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Memuat undangan...</div>
  }

  if (!data?.found) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-md text-center">
          <p className="text-slate-700 font-medium">Undangan tidak ditemukan.</p>
          <p className="text-sm text-slate-500 mt-1">Link ini mungkin salah atau sudah tidak berlaku. Hubungi HR Hammielion Management untuk memastikan.</p>
        </div>
      </div>
    )
  }

  if (!data.scheduled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-md text-center">
          <p className="text-slate-700 font-medium">Halo {data.full_name},</p>
          <p className="text-sm text-slate-500 mt-1">Jadwal wawancara Anda belum ditentukan. Silakan tunggu info lebih lanjut dari HR.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-slate-800">Undangan Wawancara Kerja</h1>
          <p className="text-sm text-slate-500 mt-1">Hammielion Management</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-slate-700">Halo <span className="font-semibold">{data.full_name}</span>,</p>
          <p className="text-sm text-slate-600 mt-2">
            Selamat! Anda diundang untuk wawancara kerja di Hammielion Management, pada:
          </p>
          <p className="text-lg font-bold text-blue-700 mt-2">{formatSchedule(data.interview_scheduled_at!)} sampai selesai</p>

          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <span className="text-lg">👔</span>
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Pakaian:</span> Casual rapi dengan penampilan terbaik Anda —
                bukan kemeja hitam-putih formal. Anggap saja seperti mau bertemu orang spesial, pakai baju terbaik yang Anda punya.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="text-lg">📄</span>
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Bawa:</span> CV fisik (cetak/hard copy) saja, tidak perlu berkas lain.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="text-lg">💰</span>
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Info Training:</span> Selama masa training, gaji Rp800.000/bulan.
                Bonus Rp400.000 diberikan di bulan terakhir, setelah menyelesaikan training 3 bulan.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="text-lg">🗣️</span>
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Tips:</span> Saat wawancara, jawab dengan lancar, lugas, dan percaya diri ya.
              </p>
            </div>
          </div>
        </div>

        {(data.psychotest || (data.psychometrics && data.psychometrics.length > 0)) && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-3">Hasil Tes & Penilaian Anda</p>
            {data.psychotest && (
              <div className="mb-3 pb-3 border-b border-slate-100">
                <p className="text-xs text-slate-500 mb-1">Tes Hitung Cepat</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-purple-700">{data.psychotest.score}</span>
                  <span className="text-sm text-slate-500">/ 100 — {psychotestLabel(data.psychotest.score)}</span>
                </div>
              </div>
            )}
            {(data.psychometrics || []).map(r => (
              <div key={r.test_type} className="mb-2 last:mb-0">
                <p className="text-xs font-medium text-slate-500 mb-1">{PSYCHOMETRIC_LABELS[r.test_type] || r.test_type}</p>
                {renderPsychometricSummary(r.test_type, r.result_summary)}
              </div>
            ))}
            <p className="text-xs text-slate-400 mt-3">Hasil ini adalah alat bantu internal kami untuk mengenal Anda lebih baik — bukan penilaian akhir. Tetap tampil percaya diri saat wawancara ya!</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-2">Konfirmasi Kehadiran</p>
          {submitted || data.interview_confirmation ? (
            <div>
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                Terima kasih, konfirmasi Anda sudah kami terima: &ldquo;{submitted ? confirmationText : data.interview_confirmation}&rdquo;
              </p>
              <button onClick={() => setSubmitted(false)} className="text-xs text-blue-600 hover:underline mt-2">Ubah konfirmasi</button>
            </div>
          ) : (
            <form onSubmit={handleConfirm} className="space-y-3">
              <p className="text-xs text-slate-500">Ketik konfirmasi kehadiran Anda, contoh: &quot;Akan hadir sekitar jam 10.15&quot;</p>
              <input value={confirmationText} onChange={e => setConfirmationText(e.target.value)} required
                placeholder="Akan hadir sekitar jam..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="submit" disabled={submitting}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                {submitting ? 'Mengirim...' : 'Kirim Konfirmasi'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
