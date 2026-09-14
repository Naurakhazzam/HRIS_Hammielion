'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toWhatsAppLink } from '@/lib/waLink'
import QRCode from 'qrcode'

type Applicant = {
  id: string
  application_code: string
  full_name: string
  gender: string
  birth_place: string | null
  birth_date: string | null
  address: string | null
  phone: string
  marital_status: string
  number_of_children: number | null
  education: string
  work_experience: string | null
  motivation: string | null
  status: string
  created_at: string
  psychotest_results: { score: number } | null
}

type ScreeningQuestion = {
  id: string
  question_text: string
  sort_order: number
  is_active: boolean
}

type ScreeningAnswerRow = {
  answer_text: string | null
  screening_questions: { question_text: string; sort_order: number } | null
}

type PsychotestResult = {
  score: number
  overall_accuracy: number
  resilience: number
  levels: {
    level: number; min: number; max: number; questions: number; correct: number
    accuracy: number; target_questions: number; throughput_ratio: number
  }[]
}

type PsychometricResultRow = {
  test_type: 'disc' | 'personality' | 'work_preference' | 'integrity'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result_summary: any
}

const PSYCHOMETRIC_LABELS: Record<string, string> = {
  disc: 'DISC — Gaya Kerja',
  personality: 'Tipe Kepribadian Kerja',
  work_preference: 'Preferensi Kerja',
  integrity: 'Sikap & Etika Kerja',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPsychometricSummary(testType: string, summary: any) {
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

const GENDER_LABELS: Record<string, string> = { male: 'Laki-laki', female: 'Perempuan' }
const MARITAL_LABELS: Record<string, string> = {
  single: 'Belum Menikah', married: 'Menikah', divorced: 'Cerai', widowed: 'Janda/Duda',
}
const STATUS_OPTIONS = [
  { value: 'baru', label: 'Baru Masuk' },
  { value: 'screening', label: 'Screening' },
  { value: 'psikotes', label: 'Psikotes' },
  { value: 'interview', label: 'Menunggu Dipanggil Interview' },
  { value: 'diterima', label: 'Diterima' },
  { value: 'ditolak', label: 'Ditolak' },
]
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.label]))
const STATUS_COLORS: Record<string, string> = {
  baru: 'bg-slate-100 text-slate-700',
  screening: 'bg-amber-100 text-amber-700',
  psikotes: 'bg-purple-100 text-purple-700',
  interview: 'bg-blue-100 text-blue-700',
  diterima: 'bg-green-100 text-green-700',
  ditolak: 'bg-red-100 text-red-700',
}

function psychotestLabel(score: number): string {
  if (score >= 80) return 'Sangat Stabil'
  if (score >= 60) return 'Stabil'
  if (score >= 40) return 'Cukup'
  return 'Kurang Stabil'
}

function getPsikotesScore(a: Applicant): number | null {
  return a.psychotest_results?.score ?? null
}

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null
  const bd = new Date(birthDate)
  if (Number.isNaN(bd.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - bd.getFullYear()
  const monthDiff = now.getMonth() - bd.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < bd.getDate())) age--
  return age
}

export default function RekrutmenPage() {
  const router = useRouter()
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [loading, setLoading] = useState(true)
  const [scoreSort, setScoreSort] = useState<'asc' | 'desc' | null>(null)
  const [activeTab, setActiveTab] = useState<'semua' | string>('semua')
  const [lamaranUrl, setLamaranUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [uploadFormUrl, setUploadFormUrl] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [urlSaved, setUrlSaved] = useState(false)

  const [questions, setQuestions] = useState<ScreeningQuestion[]>([])
  const [newQuestion, setNewQuestion] = useState('')
  const [addingQuestion, setAddingQuestion] = useState(false)

  const [detail, setDetail] = useState<Applicant | null>(null)
  const [detailAnswers, setDetailAnswers] = useState<{ question_text: string; answer_text: string }[]>([])
  const [detailPsychotest, setDetailPsychotest] = useState<PsychotestResult | null>(null)
  const [detailPsychometrics, setDetailPsychometrics] = useState<PsychometricResultRow[]>([])
  const [detailStatus, setDetailStatus] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)

  const supabase = createClient()

  const fetchApplicants = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('job_applicants')
      .select('id, application_code, full_name, gender, birth_place, birth_date, address, phone, marital_status, number_of_children, education, work_experience, motivation, status, created_at, psychotest_results(score)')
      .order('created_at', { ascending: false })
    setApplicants((data as unknown as Applicant[]) || [])
    setLoading(false)
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
    fetchApplicants()
    fetchQuestions()

    const url = `${window.location.origin}/lamaran`
    QRCode.toDataURL(url, { width: 320, margin: 1 }).then(dataUrl => {
      setLamaranUrl(url)
      setQrDataUrl(dataUrl)
    })

    supabase
      .from('recruitment_settings')
      .select('upload_form_url')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => setUploadFormUrl(data?.upload_form_url || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchApplicants, fetchQuestions])

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

  async function toggleQuestionActive(q: ScreeningQuestion) {
    await supabase.from('screening_questions').update({ is_active: !q.is_active }).eq('id', q.id)
    fetchQuestions()
  }

  async function openDetail(applicant: Applicant) {
    setDetail(applicant)
    setDetailStatus(applicant.status)
    const { data } = await supabase
      .from('screening_answers')
      .select('answer_text, screening_questions(question_text, sort_order)')
      .eq('applicant_id', applicant.id)
    const rows = ((data || []) as unknown as ScreeningAnswerRow[])
      .filter(r => r.screening_questions)
      .sort((a, b) => (a.screening_questions!.sort_order - b.screening_questions!.sort_order))
      .map(r => ({ question_text: r.screening_questions!.question_text, answer_text: r.answer_text || '' }))
    setDetailAnswers(rows)

    const { data: psychotest } = await supabase
      .from('psychotest_results')
      .select('score, overall_accuracy, resilience, levels')
      .eq('applicant_id', applicant.id)
      .maybeSingle()
    setDetailPsychotest(psychotest || null)

    const { data: psychometrics } = await supabase
      .from('psychometric_results')
      .select('test_type, result_summary')
      .eq('applicant_id', applicant.id)
    setDetailPsychometrics(psychometrics || [])
  }

  function closeDetail() {
    setDetail(null)
    setDetailAnswers([])
    setDetailPsychotest(null)
    setDetailPsychometrics([])
  }

  async function saveStatus() {
    if (!detail) return
    setSavingStatus(true)
    await supabase.from('job_applicants').update({ status: detailStatus }).eq('id', detail.id)
    setSavingStatus(false)
    setDetail({ ...detail, status: detailStatus })
    fetchApplicants()
  }

  function goToJadikanKaryawan() {
    if (!detail) return
    router.push(`/karyawan?from_applicant=${detail.id}`)
  }

  const tabs = [
    { value: 'semua', label: 'Semua', count: applicants.length },
    ...STATUS_OPTIONS.map(o => ({ value: o.value, label: o.label, count: applicants.filter(a => a.status === o.value).length })),
  ]
  const statusFiltered = activeTab === 'semua' ? applicants : applicants.filter(a => a.status === activeTab)
  const filteredApplicants = scoreSort
    ? [...statusFiltered].sort((a, b) => {
        const scoreA = getPsikotesScore(a)
        const scoreB = getPsikotesScore(b)
        if (scoreA === null && scoreB === null) return 0
        if (scoreA === null) return 1
        if (scoreB === null) return -1
        return scoreSort === 'asc' ? scoreA - scoreB : scoreB - scoreA
      })
    : statusFiltered

  function toggleScoreSort() {
    setScoreSort(prev => (prev === 'desc' ? 'asc' : prev === 'asc' ? null : 'desc'))
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Rekrutmen</h1>
      <p className="text-sm text-slate-500 mb-6">Daftar pelamar yang masuk lewat halaman lamaran publik.</p>

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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 pt-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800 mb-3">Daftar Pelamar ({filteredApplicants.length})</h2>
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {tabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 transition ${
                  activeTab === tab.value
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label} <span className="text-xs text-slate-400">({tab.count})</span>
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Kode</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Nama</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Usia</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Pendidikan</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Telepon</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Status</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">
                  <button onClick={toggleScoreSort} className="flex items-center gap-1 hover:text-slate-800">
                    Skor Psikotes
                    <span className="text-slate-400">{scoreSort === 'desc' ? '↓' : scoreSort === 'asc' ? '↑' : '↕'}</span>
                  </button>
                </th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">Memuat...</td></tr>
              )}
              {!loading && filteredApplicants.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">Belum ada pelamar di tahap ini.</td></tr>
              )}
              {filteredApplicants.map(a => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs text-blue-600">{a.application_code}</td>
                  <td className="px-4 py-2 text-slate-800">{a.full_name}</td>
                  <td className="px-4 py-2 text-slate-600">{calcAge(a.birth_date) ?? '-'}</td>
                  <td className="px-4 py-2 text-slate-600">{a.education}</td>
                  <td className="px-4 py-2">
                    <a href={toWhatsAppLink(a.phone)} target="_blank" rel="noopener noreferrer"
                      className="text-green-600 hover:underline" title="Chat via WhatsApp">
                      {a.phone}
                    </a>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-700'}`}>
                      {STATUS_LABELS[a.status] || a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {getPsikotesScore(a) !== null ? (
                      <span className="font-medium text-purple-700">{getPsikotesScore(a)}</span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openDetail(a)} className="text-blue-600 text-xs font-medium hover:underline">Detail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4 pb-2 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">{detail.full_name}</h2>
                  <p className="text-xs font-mono text-blue-600">{detail.application_code}</p>
                </div>
                <button onClick={closeDetail} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
                <p><span className="text-slate-500">Jenis Kelamin:</span> {GENDER_LABELS[detail.gender] || detail.gender}</p>
                <p><span className="text-slate-500">Usia:</span> {calcAge(detail.birth_date) ?? '-'} tahun</p>
                <p><span className="text-slate-500">Tempat Lahir:</span> {detail.birth_place || '-'}</p>
                <p><span className="text-slate-500">Tanggal Lahir:</span> {detail.birth_date || '-'}</p>
                <p className="col-span-2"><span className="text-slate-500">Alamat:</span> {detail.address || '-'}</p>
                <p>
                  <span className="text-slate-500">Telepon:</span>{' '}
                  <a href={toWhatsAppLink(detail.phone)} target="_blank" rel="noopener noreferrer"
                    className="text-green-600 hover:underline" title="Chat via WhatsApp">
                    {detail.phone}
                  </a>
                </p>
                <p><span className="text-slate-500">Pendidikan:</span> {detail.education}</p>
                <p>
                  <span className="text-slate-500">Status Perkawinan:</span> {MARITAL_LABELS[detail.marital_status] || detail.marital_status}
                  {detail.marital_status === 'married' && ` (${detail.number_of_children ?? 0} anak)`}
                </p>
              </div>

              {detail.work_experience && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-slate-700 mb-1">Pengalaman Kerja</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{detail.work_experience}</p>
                </div>
              )}

              {detail.motivation && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-slate-700 mb-1">Tentang Diri & Motivasi</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{detail.motivation}</p>
                </div>
              )}

              {detailAnswers.length > 0 && (
                <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-amber-800">Jawaban Screening</p>
                  {detailAnswers.map((a, i) => (
                    <div key={i}>
                      <p className="text-sm font-medium text-slate-700">{a.question_text}</p>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{a.answer_text || '-'}</p>
                    </div>
                  ))}
                </div>
              )}

              {detailPsychotest && (
                <div className="mb-3 bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-3">
                  <p className="text-sm font-medium text-purple-800">Hasil Psikotes (Tes Hitung Cepat 3 Level)</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-purple-700">{detailPsychotest.score}</span>
                    <span className="text-sm text-slate-600">/ 100 — {psychotestLabel(detailPsychotest.score)}</span>
                  </div>
                  <p className="text-sm text-slate-600">
                    Akurasi keseluruhan: {Math.round(detailPsychotest.overall_accuracy * 100)}% — Mempertahankan{' '}
                    {Math.round(detailPsychotest.resilience * 100)}% performa saat soal makin sulit
                  </p>
                  <div className="space-y-1">
                    {detailPsychotest.levels.map(l => (
                      <div key={l.level} className="flex items-center justify-between text-xs text-slate-600 border-b border-purple-100 pb-1">
                        <span className="shrink-0">Level {l.level} ({l.min}-{l.max})</span>
                        <span>
                          {l.correct}/{l.questions} benar ({Math.round(l.accuracy * 100)}%) — {l.questions}/{l.target_questions} soal target
                          {l.throughput_ratio >= 1 ? ' ✓' : ` (${Math.round(l.throughput_ratio * 100)}%)`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-purple-700">
                    Skor = ketepatan (60%) + kecepatan relatif target (40%) per level. Target soal masih perkiraan awal,
                    akan disesuaikan setelah cukup banyak pelamar mengerjakan tes ini. Alat bantu skrining internal, bukan tes psikologi resmi — gunakan bersama hasil interview.
                  </p>
                </div>
              )}

              {detailPsychometrics.length > 0 && (
                <div className="mb-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-3">
                  <p className="text-sm font-medium text-indigo-800">Profil Psikometri</p>
                  {detailPsychometrics.map(r => (
                    <div key={r.test_type} className="border-b border-indigo-100 pb-2 last:border-b-0 last:pb-0">
                      <p className="text-xs font-medium text-slate-500 mb-1">{PSYCHOMETRIC_LABELS[r.test_type] || r.test_type}</p>
                      {renderPsychometricSummary(r.test_type, r.result_summary)}
                    </div>
                  ))}
                  <p className="text-xs text-indigo-700">
                    DISC & Tes Sikap dibangun sendiri (bukan replika instrumen berlisensi), berdasarkan jawaban self-report pelamar — kecenderungan, bukan diagnosis resmi.
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex gap-2 items-center">
                  <label className="text-sm text-slate-600">Status:</label>
                  <select value={detailStatus} onChange={e => setDetailStatus(e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button onClick={saveStatus} disabled={savingStatus || detailStatus === detail.status}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                    {savingStatus ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
                {detail.status === 'diterima' && (
                  <button onClick={goToJadikanKaryawan}
                    className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">
                    Jadikan Karyawan →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
