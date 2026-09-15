'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import QRCode from 'qrcode'

type ScreeningQuestion = {
  id: string
  question_text: string
  sort_order: number
  is_active: boolean
}

// Format ISO -> value yang dimengerti <input type="datetime-local"> (waktu lokal browser).
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function RekrutmenPage() {
  const [applicantCount, setApplicantCount] = useState<number | null>(null)
  const [lamaranUrl, setLamaranUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [uploadFormUrl, setUploadFormUrl] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [urlSaved, setUrlSaved] = useState(false)

  // Jadwal & lokasi interview — satu pengaturan seragam untuk semua kandidat yang diundang,
  // dipakai oleh halaman undangan personal /lamaran/interview/[token].
  const [interviewDateTime, setInterviewDateTime] = useState('')
  const [interviewAddress, setInterviewAddress] = useState('')
  const [interviewMapUrl, setInterviewMapUrl] = useState('')
  const [savingInterview, setSavingInterview] = useState(false)
  const [interviewSaved, setInterviewSaved] = useState(false)

  const [demoInfo, setDemoInfo] = useState<{ application_code: string; full_name: string; phone: string } | null>(null)
  const [creatingDemo, setCreatingDemo] = useState(false)

  const [questions, setQuestions] = useState<ScreeningQuestion[]>([])
  const [newQuestion, setNewQuestion] = useState('')
  const [addingQuestion, setAddingQuestion] = useState(false)

  const supabase = createClient()

  const fetchApplicantCount = useCallback(async () => {
    const { count } = await supabase.from('job_applicants').select('id', { count: 'exact', head: true })
    setApplicantCount(count ?? 0)
  }, [supabase])

  const fetchQuestions = useCallback(async () => {
    const { data } = await supabase
      .from('screening_questions')
      .select('id, question_text, sort_order, is_active')
      .order('sort_order')
    setQuestions(data || [])
  }, [supabase])

  useEffect(() => {
    // Fetch mount-time data — setLoading(true) di dalamnya aman, bukan pola
    // cascading-render yang jadi target rule ini.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApplicantCount()
    fetchQuestions()

    const url = `${window.location.origin}/lamaran`
    QRCode.toDataURL(url, { width: 320, margin: 1 }).then(dataUrl => {
      setLamaranUrl(url)
      setQrDataUrl(dataUrl)
    })

    supabase
      .from('recruitment_settings')
      .select('upload_form_url, interview_scheduled_at, interview_address, interview_map_url')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        setUploadFormUrl(data?.upload_form_url || '')
        setInterviewDateTime(toDatetimeLocalValue(data?.interview_scheduled_at ?? null))
        setInterviewAddress(data?.interview_address || '')
        setInterviewMapUrl(data?.interview_map_url || '')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchApplicantCount, fetchQuestions])

  function copyLink() {
    navigator.clipboard.writeText(lamaranUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadQr() {
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = 'qr-lamaran-hammielion.png'
    a.click()
  }

  async function saveUploadFormUrl() {
    setSavingUrl(true)
    setUrlSaved(false)
    await supabase
      .from('recruitment_settings')
      .update({ upload_form_url: uploadFormUrl.trim(), updated_at: new Date().toISOString() })
      .eq('id', 1)
    setSavingUrl(false)
    setUrlSaved(true)
    setTimeout(() => setUrlSaved(false), 2000)
  }

  async function resetDemoApplicant() {
    setCreatingDemo(true)
    const DEMO_CODE = 'LMR-DEMO'
    const DEMO_PHONE = '089999999999'
    const full_name = 'Pelamar Demo (Pratinjau HR)'

    // Hapus data demo lama kalau ada — cascade otomatis bersihkan jawaban/hasil tesnya juga.
    await supabase.from('job_applicants').delete().eq('application_code', DEMO_CODE)

    const { count } = await supabase
      .from('screening_questions')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    const initialStatus = (count || 0) > 0 ? 'screening' : 'psikotes'

    const { error } = await supabase.from('job_applicants').insert({
      application_code: DEMO_CODE,
      full_name,
      gender: 'male',
      phone: DEMO_PHONE,
      marital_status: 'single',
      education: 'S1',
      work_experience: 'Data contoh untuk pratinjau HR — bukan pelamar sungguhan.',
      status: initialStatus,
    })

    setCreatingDemo(false)
    if (!error) {
      setDemoInfo({ application_code: DEMO_CODE, full_name, phone: DEMO_PHONE })
      fetchApplicantCount()
    }
  }

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault()
    if (!newQuestion.trim()) return
    setAddingQuestion(true)
    const nextOrder = questions.length > 0 ? Math.max(...questions.map(q => q.sort_order)) + 1 : 0
    await supabase.from('screening_questions').insert({ question_text: newQuestion.trim(), sort_order: nextOrder })
    setNewQuestion('')
    setAddingQuestion(false)
    fetchQuestions()
  }

  async function saveInterviewSettings() {
    setSavingInterview(true)
    setInterviewSaved(false)
    await supabase
      .from('recruitment_settings')
      .update({
        interview_scheduled_at: interviewDateTime ? new Date(interviewDateTime).toISOString() : null,
        interview_address: interviewAddress.trim() || null,
        interview_map_url: interviewMapUrl.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    setSavingInterview(false)
    setInterviewSaved(true)
    setTimeout(() => setInterviewSaved(false), 2000)
  }

  async function toggleQuestionActive(q: ScreeningQuestion) {
    await supabase.from('screening_questions').update({ is_active: !q.is_active }).eq('id', q.id)
    fetchQuestions()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Rekrutmen</h1>
      <p className="text-sm text-slate-500 mb-6">Pengaturan lowongan, QR code, dan pertanyaan screening.</p>

      <Link href="/rekrutmen/pelamar"
        className="block bg-blue-600 text-white rounded-xl shadow-sm p-6 mb-4 hover:bg-blue-700 transition-colors">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold">📋 Daftar Pelamar</p>
            <p className="text-sm text-blue-100 mt-1">Lihat semua pelamar, jawaban, hasil tes, dan ubah status per orang.</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">{applicantCount ?? '-'}</p>
            <p className="text-xs text-blue-100">pelamar →</p>
          </div>
        </div>
      </Link>

      <Link href="/rekrutmen/interview-konfirmasi"
        className="block bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6 hover:bg-slate-50 transition-colors">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">🗓️ Rekap Konfirmasi Interview</p>
            <p className="text-xs text-slate-500 mt-1">Siapa saja yang sudah konfirmasi kehadiran, plus kesan mereka terhadap tes & sistem rekrutmen.</p>
          </div>
          <p className="text-xs text-blue-600 whitespace-nowrap">Buka →</p>
        </div>
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-800 mb-3">Bagikan Lowongan</h2>
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR Code Lamaran" className="w-40 h-40 border border-slate-200 rounded-lg" />
          )}
          <div className="space-y-2 flex-1">
            <p className="text-sm text-slate-600">
              Cetak QR di atas atau bagikan link berikut ke calon pelamar. Halaman ini terbuka untuk umum, tanpa perlu login.
            </p>
            <div className="flex gap-2">
              <input readOnly value={lamaranUrl}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50" />
              <button onClick={copyLink}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
                {copied ? 'Tersalin!' : 'Salin Link'}
              </button>
            </div>
            {qrDataUrl && (
              <button onClick={downloadQr}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">
                Download QR (PNG)
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Pratinjau & Demo</h2>
        <p className="text-sm text-slate-500 mb-3">
          Coba langsung alur lamaran yang sesungguhnya (bukan tiruan) tanpa perlu isi form dari awal. Klik &quot;Buat/Reset
          Pelamar Demo&quot; untuk dapat nama &amp; nomor HP contoh, lalu pakai itu di halaman Cek Status Lamaran untuk
          melihat tiap tahap langsung di aplikasi.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <a href="/lamaran" target="_blank" rel="noopener noreferrer"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
            Buka Halaman Lamaran ↗
          </a>
          <a href="/lamaran/status" target="_blank" rel="noopener noreferrer"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
            Buka Cek Status Lamaran ↗
          </a>
          <button onClick={resetDemoApplicant} disabled={creatingDemo}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
            {creatingDemo ? 'Menyiapkan...' : 'Buat / Reset Pelamar Demo'}
          </button>
        </div>
        {demoInfo && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-3 text-sm space-y-1">
            <p className="text-blue-800 font-medium">Data demo siap dipakai di halaman Cek Status Lamaran:</p>
            <p className="text-blue-700">Nama: <b>{demoInfo.full_name}</b></p>
            <p className="text-blue-700">Nomor HP: <b>{demoInfo.phone}</b></p>
            <p className="text-xs text-blue-600 mt-1">Klik &quot;Buat/Reset&quot; lagi kapan saja untuk mengulang dari awal.</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Jadwal & Lokasi Interview</h2>
        <p className="text-sm text-slate-500 mb-3">
          Satu jadwal & lokasi untuk semua kandidat yang diundang — dipakai otomatis di halaman
          undangan personal tiap kandidat (link dikirim dari{' '}
          <Link href="/rekrutmen/pelamar" className="text-blue-600 hover:underline">Daftar Pelamar</Link>).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal & Jam</label>
            <input type="datetime-local" value={interviewDateTime} onChange={e => setInterviewDateTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Link Google Maps</label>
            <input value={interviewMapUrl} onChange={e => setInterviewMapUrl(e.target.value)}
              placeholder="https://maps.app.goo.gl/..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">Alamat</label>
          <input value={interviewAddress} onChange={e => setInterviewAddress(e.target.value)}
            placeholder="Contoh: Kantor Pusat Hammielion, Jl. ..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <button onClick={saveInterviewSettings} disabled={savingInterview}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
          {savingInterview ? 'Menyimpan...' : interviewSaved ? 'Tersimpan!' : 'Simpan'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Link Upload CV & Foto</h2>
        <p className="text-sm text-slate-500 mb-3">
          Tempel link Google Form (atau link upload lainnya) di sini. Pelamar akan melihatnya sebagai tombol
          klik langsung di halaman lamaran — cukup simpan, tidak perlu ubah kode atau deploy ulang.
        </p>
        <div className="flex gap-2">
          <input value={uploadFormUrl} onChange={e => setUploadFormUrl(e.target.value)}
            placeholder="https://forms.gle/..."
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          <button onClick={saveUploadFormUrl} disabled={savingUrl}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
            {savingUrl ? 'Menyimpan...' : urlSaved ? 'Tersimpan!' : 'Simpan'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Kelola Pertanyaan Screening</h2>
        <p className="text-sm text-slate-500 mb-3">
          Pertanyaan aktif akan otomatis muncul untuk dijawab pelamar yang statusnya diubah jadi &quot;Screening&quot;
          lewat halaman cek status mereka.
        </p>
        <form onSubmit={addQuestion} className="flex gap-2 mb-3">
          <input value={newQuestion} onChange={e => setNewQuestion(e.target.value)}
            placeholder="Tulis pertanyaan baru..."
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          <button type="submit" disabled={addingQuestion}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
            Tambah
          </button>
        </form>
        <div className="space-y-2">
          {questions.length === 0 && <p className="text-sm text-slate-400">Belum ada pertanyaan screening.</p>}
          {questions.map(q => (
            <div key={q.id} className="flex items-center justify-between gap-3 px-3 py-2 border border-slate-200 rounded-lg">
              <span className={`text-sm ${q.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{q.question_text}</span>
              <button onClick={() => toggleQuestionActive(q)}
                className={`text-xs px-2 py-1 rounded-lg border shrink-0 ${q.is_active ? 'border-green-300 text-green-700 bg-green-50' : 'border-slate-300 text-slate-500 bg-slate-50'}`}>
                {q.is_active ? 'Aktif' : 'Nonaktif'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
