'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toWhatsAppLink } from '@/lib/waLink'
import { isBeforeAntiPasteFix } from '@/lib/antiPasteFix'
import { PSYCHOMETRIC_LABELS, renderPsychometricSummary, psychotestLabel } from '@/lib/psychometricSummary'

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
  placement: string | null
  distance_km: number | null
  distance_minutes: number | null
  psychotest_results: { score: number } | null
  screening_answers: { created_at: string }[] | null
  interview_token: string
  interview_confirmation: string | null
  interview_confirmed_at: string | null
  test_impression: string | null
  interview_conducted_at: string | null
  interviewer_name: string | null
  interview_attendance: string | null
  interview_communication_rating: string | null
  interview_appearance_rating: string | null
  interview_motivation_rating: string | null
  interview_notes: string | null
  interview_recommendation: string | null
}

const ATTENDANCE_OPTIONS = [
  { value: 'hadir_tepat_waktu', label: 'Hadir Tepat Waktu' },
  { value: 'hadir_terlambat', label: 'Hadir Terlambat' },
  { value: 'tidak_hadir', label: 'Tidak Hadir' },
]
const RATING_OPTIONS = [
  { value: 'baik', label: 'Baik' },
  { value: 'cukup', label: 'Cukup' },
  { value: 'kurang', label: 'Kurang' },
]
const RECOMMENDATION_OPTIONS = [
  { value: 'lanjut_training', label: 'Lanjut ke Training' },
  { value: 'tidak_lolos', label: 'Tidak Lolos' },
  { value: 'pertimbangkan_lagi', label: 'Pertimbangkan Lagi' },
]
// Rekomendasi -> status pelamar otomatis, konsisten dengan auto-pindah status saat kandidat
// konfirmasi kehadiran. "Pertimbangkan Lagi" sengaja TIDAK mengubah status — biar HR yang
// putuskan lanjutannya manual kalau masih ragu.
const RECOMMENDATION_STATUS_MAP: Record<string, string> = {
  lanjut_training: 'training',
  tidak_lolos: 'ditolak',
}

function getScreeningSubmittedAt(a: Applicant): string | null {
  if (!a.screening_answers || a.screening_answers.length === 0) return null
  return a.screening_answers.reduce((earliest, r) => (r.created_at < earliest ? r.created_at : earliest), a.screening_answers[0].created_at)
}

type ScreeningAnswerRow = {
  answer_text: string | null
  created_at: string
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

const GENDER_LABELS: Record<string, string> = { male: 'Laki-laki', female: 'Perempuan' }
const PLACEMENT_LABELS: Record<string, string> = { singaparna: 'Singaparna', tasik_kota: 'Tasik Kota' }
const PLACEMENT_REFERENCE_POINT: Record<string, string> = { singaparna: 'Alun-alun Singaparna', tasik_kota: 'UNSIL' }
const MARITAL_LABELS: Record<string, string> = {
  single: 'Belum Menikah', married: 'Menikah', divorced: 'Cerai', widowed: 'Janda/Duda',
}
const STATUS_OPTIONS = [
  { value: 'baru', label: 'Baru Masuk' },
  { value: 'screening', label: 'Screening' },
  { value: 'psikotes', label: 'Psikotes' },
  { value: 'interview', label: 'Menunggu Dipanggil Interview' },
  { value: 'interview_called', label: 'Dipanggil Interview' },
  { value: 'training', label: 'Training/Percobaan' },
  { value: 'diterima', label: 'Diterima' },
  { value: 'ditolak', label: 'Ditolak' },
]
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.label]))
const STATUS_COLORS: Record<string, string> = {
  baru: 'bg-slate-100 text-slate-700',
  screening: 'bg-amber-100 text-amber-700',
  psikotes: 'bg-purple-100 text-purple-700',
  interview: 'bg-blue-100 text-blue-700',
  interview_called: 'bg-indigo-100 text-indigo-700',
  training: 'bg-cyan-100 text-cyan-700',
  diterima: 'bg-green-100 text-green-700',
  ditolak: 'bg-red-100 text-red-700',
}

// Urutan tahap normal, dipakai tombol cepat "Lanjut" — HR tetap bisa override
// manual lewat dropdown di bawahnya kalau perlu lompat/mundur tahap.
const STATUS_ORDER = ['baru', 'screening', 'psikotes', 'interview', 'interview_called', 'training', 'diterima']

function getNextStatus(current: string): string | null {
  const idx = STATUS_ORDER.indexOf(current)
  if (idx === -1 || idx === STATUS_ORDER.length - 1) return null
  return STATUS_ORDER[idx + 1]
}

function getPsikotesScore(a: Applicant): number | null {
  return a.psychotest_results?.score ?? null
}

function formatInterviewSchedule(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB'
}

// Urutan jenjang pendidikan — harus sama dengan EDUCATION_OPTIONS di app/lamaran/page.tsx,
// dipakai untuk bandingkan "minimal jenjang X" (index lebih besar = jenjang lebih tinggi).
const EDUCATION_ORDER = ['SD', 'SMP', 'SMA/SMK', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3']
function educationRank(edu: string): number {
  return EDUCATION_ORDER.indexOf(edu)
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

export default function DaftarPelamarPage() {
  const router = useRouter()
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [loading, setLoading] = useState(true)
  const [scoreSort, setScoreSort] = useState<'asc' | 'desc' | null>(null)
  const [distanceSort, setDistanceSort] = useState<'asc' | 'desc' | null>(null)
  const [activeTab, setActiveTab] = useState<'semua' | string>('semua')

  // Filter tambahan — dikombinasikan sendiri oleh HR sesuai kebutuhan tiap kali (bukan satu
  // kombinasi tetap), jadi semuanya opsional dan berlaku bareng dengan tab status di atas.
  const [filterMinAge, setFilterMinAge] = useState('')
  const [filterMaxAge, setFilterMaxAge] = useState('')
  const [filterMinEducation, setFilterMinEducation] = useState('')
  const [filterPlacement, setFilterPlacement] = useState('')
  const [filterMinScore, setFilterMinScore] = useState('')
  const hasActiveFilter = !!(filterMinAge || filterMaxAge || filterMinEducation || filterPlacement || filterMinScore)
  function resetFilters() {
    setFilterMinAge(''); setFilterMaxAge(''); setFilterMinEducation(''); setFilterPlacement(''); setFilterMinScore('')
  }

  const [detail, setDetail] = useState<Applicant | null>(null)
  const [detailAnswers, setDetailAnswers] = useState<{ question_text: string; answer_text: string }[]>([])
  const [detailScreeningSubmittedAt, setDetailScreeningSubmittedAt] = useState<string | null>(null)
  const [detailPsychotest, setDetailPsychotest] = useState<PsychotestResult | null>(null)
  const [detailPsychometrics, setDetailPsychometrics] = useState<PsychometricResultRow[]>([])
  const [detailStatus, setDetailStatus] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)

  // Form Hasil Interview — diisi HR/Owner SETELAH wawancara aktual berlangsung.
  const [interviewResultForm, setInterviewResultForm] = useState({
    interviewer_name: '', attendance: '', communication: '', appearance: '', motivation: '',
    notes: '', recommendation: '',
  })
  const [savingInterviewResult, setSavingInterviewResult] = useState(false)
  const [interviewResultSaved, setInterviewResultSaved] = useState(false)

  // Jadwal & lokasi interview seragam untuk semua kandidat — diatur sekali di halaman
  // Pengaturan Rekrutmen (recruitment_settings), bukan per-kandidat lagi.
  const [interviewSettings, setInterviewSettings] = useState<{
    interview_scheduled_at: string | null; interview_address: string | null; interview_map_url: string | null
  } | null>(null)

  const supabase = createClient()

  const fetchApplicants = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('job_applicants')
      .select('id, application_code, full_name, gender, birth_place, birth_date, address, phone, marital_status, number_of_children, education, work_experience, motivation, status, created_at, placement, distance_km, distance_minutes, psychotest_results(score), screening_answers(created_at), interview_token, interview_confirmation, interview_confirmed_at, test_impression, interview_conducted_at, interviewer_name, interview_attendance, interview_communication_rating, interview_appearance_rating, interview_motivation_rating, interview_notes, interview_recommendation')
      .order('created_at', { ascending: false })
    setApplicants((data as unknown as Applicant[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    supabase.from('recruitment_settings')
      .select('interview_scheduled_at, interview_address, interview_map_url')
      .eq('id', 1).maybeSingle()
      .then(({ data }) => setInterviewSettings(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Fetch mount-time data — setLoading(true) di dalamnya aman, bukan pola
    // cascading-render yang jadi target rule ini.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApplicants()
  }, [fetchApplicants])

  async function openDetail(applicant: Applicant) {
    setDetail(applicant)
    setDetailStatus(applicant.status)
    setInterviewResultForm({
      interviewer_name: applicant.interviewer_name || '',
      attendance: applicant.interview_attendance || '',
      communication: applicant.interview_communication_rating || '',
      appearance: applicant.interview_appearance_rating || '',
      motivation: applicant.interview_motivation_rating || '',
      notes: applicant.interview_notes || '',
      recommendation: applicant.interview_recommendation || '',
    })
    setInterviewResultSaved(false)
    const { data } = await supabase
      .from('screening_answers')
      .select('answer_text, created_at, screening_questions(question_text, sort_order)')
      .eq('applicant_id', applicant.id)
    const rawRows = (data || []) as unknown as ScreeningAnswerRow[]
    const rows = rawRows
      .filter(r => r.screening_questions)
      .sort((a, b) => (a.screening_questions!.sort_order - b.screening_questions!.sort_order))
      .map(r => ({ question_text: r.screening_questions!.question_text, answer_text: r.answer_text || '' }))
    setDetailAnswers(rows)
    // Semua jawaban screening disimpan sekali jalan (satu upsert), jadi
    // created_at baris manapun cukup mewakili waktu submit keseluruhan.
    setDetailScreeningSubmittedAt(rawRows.length > 0 ? rawRows[0].created_at : null)

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
    setDetailScreeningSubmittedAt(null)
    setDetailPsychotest(null)
    setDetailPsychometrics([])
  }

  function interviewInviteLink(applicant: Applicant) {
    return `${window.location.origin}/lamaran/interview/${applicant.interview_token}`
  }

  async function saveInterviewResult() {
    if (!detail) return
    setSavingInterviewResult(true)
    setInterviewResultSaved(false)

    const payload: Record<string, string | null> = {
      interview_conducted_at: new Date().toISOString(),
      interviewer_name: interviewResultForm.interviewer_name.trim() || null,
      interview_attendance: interviewResultForm.attendance || null,
      interview_communication_rating: interviewResultForm.communication || null,
      interview_appearance_rating: interviewResultForm.appearance || null,
      interview_motivation_rating: interviewResultForm.motivation || null,
      interview_notes: interviewResultForm.notes.trim() || null,
      interview_recommendation: interviewResultForm.recommendation || null,
    }
    // Rekomendasi otomatis majukan status pelamar — konsisten dengan auto-pindah status saat
    // kandidat konfirmasi kehadiran. "Pertimbangkan Lagi" sengaja tidak mengubah status.
    const mappedStatus = RECOMMENDATION_STATUS_MAP[interviewResultForm.recommendation]
    if (mappedStatus) payload.status = mappedStatus

    const { error } = await supabase.from('job_applicants').update(payload).eq('id', detail.id)
    setSavingInterviewResult(false)
    if (!error) {
      setDetail({ ...detail, ...payload } as Applicant)
      if (mappedStatus) setDetailStatus(mappedStatus)
      setInterviewResultSaved(true)
      fetchApplicants()
    }
  }

  function openInterviewWhatsApp(applicant: Applicant) {
    const link = interviewInviteLink(applicant)
    const text = `Halo ${applicant.full_name}, Anda diundang wawancara kerja di Hammielion Management. Cek detail jadwal, hal yang perlu disiapkan, dan konfirmasi kehadiran lewat link ini ya:\n${link}`
    window.open(`${toWhatsAppLink(applicant.phone)}?text=${encodeURIComponent(text)}`, '_blank')
  }

  async function saveStatus() {
    if (!detail) return
    setSavingStatus(true)
    await supabase.from('job_applicants').update({ status: detailStatus }).eq('id', detail.id)
    setSavingStatus(false)
    setDetail({ ...detail, status: detailStatus })
    fetchApplicants()
  }

  async function quickSetStatus(newStatus: string) {
    if (!detail) return
    setSavingStatus(true)
    await supabase.from('job_applicants').update({ status: newStatus }).eq('id', detail.id)
    setSavingStatus(false)
    // Tutup modal detail begitu status berubah — sebelumnya modal tetap terbuka
    // dengan tombol "Lanjut" yang label-nya langsung berganti ke tahap
    // berikutnya di posisi yang sama, jadi kalau HR klik lagi karena mengira
    // klik pertama tidak kena, pelamar bisa kelewat maju beberapa tahap
    // sekaligus tanpa sadar. Tutup dulu, HR buka lagi kalau memang mau lanjut.
    closeDetail()
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

  const criteriaFiltered = statusFiltered.filter(a => {
    const age = calcAge(a.birth_date)
    if (filterMinAge && (age === null || age < Number(filterMinAge))) return false
    if (filterMaxAge && (age === null || age > Number(filterMaxAge))) return false
    if (filterMinEducation && educationRank(a.education) < educationRank(filterMinEducation)) return false
    if (filterPlacement && a.placement !== filterPlacement) return false
    if (filterMinScore) {
      const score = getPsikotesScore(a)
      if (score === null || score < Number(filterMinScore)) return false
    }
    return true
  })

  // Cuma satu kolom yang aktif sort dalam satu waktu — pola sama seperti tabel sort lain di
  // app ini, supaya urutan hasil jelas (bukan gabungan beberapa sort sekaligus yang ambigu).
  const filteredApplicants = distanceSort
    ? [...criteriaFiltered].sort((a, b) => {
        if (a.distance_km === null && b.distance_km === null) return 0
        if (a.distance_km === null) return 1
        if (b.distance_km === null) return -1
        return distanceSort === 'asc' ? a.distance_km - b.distance_km : b.distance_km - a.distance_km
      })
    : scoreSort
    ? [...criteriaFiltered].sort((a, b) => {
        const scoreA = getPsikotesScore(a)
        const scoreB = getPsikotesScore(b)
        if (scoreA === null && scoreB === null) return 0
        if (scoreA === null) return 1
        if (scoreB === null) return -1
        return scoreSort === 'asc' ? scoreA - scoreB : scoreB - scoreA
      })
    : criteriaFiltered

  function toggleScoreSort() {
    setDistanceSort(null)
    setScoreSort(prev => (prev === 'desc' ? 'asc' : prev === 'asc' ? null : 'desc'))
  }

  function toggleDistanceSort() {
    setScoreSort(null)
    // Default ke 'asc' dulu (terdekat di atas) — itu yang paling sering dicari, beda dari skor
    // psikotes yang defaultnya 'desc' (tertinggi di atas).
    setDistanceSort(prev => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'))
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-sm">
        <Link href="/rekrutmen" className="text-blue-600 hover:underline">Rekrutmen</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-500">Daftar Pelamar</span>
      </div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-2">
        <h1 className="text-2xl font-bold text-slate-800">Daftar Pelamar</h1>
        <Link href="/rekrutmen/interview-konfirmasi"
          className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
          🗓️ Rekap Konfirmasi Interview →
        </Link>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Semua pelamar yang masuk lewat halaman lamaran publik. Untuk QR code, link upload, dan pertanyaan
        screening, buka halaman{' '}
        <Link href="/rekrutmen" className="text-blue-600 hover:underline">Pengaturan Rekrutmen</Link>.
      </p>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 pt-4 border-b border-slate-200">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="text-base font-semibold text-slate-800">Daftar Pelamar ({filteredApplicants.length})</h2>
            <p className="text-xs text-slate-400 flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> Sebelum perbaikan anti-paste
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" /> Sesudah
              </span>
            </p>
          </div>
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

        {/* Panel filter — semua opsional, dikombinasikan bebas sesuai kebutuhan pencarian saat itu */}
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Usia</label>
            <div className="flex items-center gap-1">
              <input type="number" min={0} placeholder="Min" value={filterMinAge} onChange={e => setFilterMinAge(e.target.value)}
                className="w-16 px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
              <span className="text-slate-400 text-xs">–</span>
              <input type="number" min={0} placeholder="Max" value={filterMaxAge} onChange={e => setFilterMaxAge(e.target.value)}
                className="w-16 px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Pendidikan Minimal</label>
            <select value={filterMinEducation} onChange={e => setFilterMinEducation(e.target.value)}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">Semua</option>
              {EDUCATION_ORDER.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Penempatan</label>
            <select value={filterPlacement} onChange={e => setFilterPlacement(e.target.value)}
              className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">Semua</option>
              {Object.entries(PLACEMENT_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Skor Psikotes Minimal</label>
            <input type="number" min={0} max={100} placeholder="mis. 70" value={filterMinScore} onChange={e => setFilterMinScore(e.target.value)}
              className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          {hasActiveFilter && (
            <button onClick={resetFilters} className="text-xs text-red-600 hover:underline mb-1.5">
              ✕ Reset filter
            </button>
          )}
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
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Penempatan</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">
                  <button onClick={toggleDistanceSort} className="flex items-center gap-1 hover:text-slate-800" title="Jarak dari rumah ke titik acuan penempatan">
                    Jarak
                    <span className="text-slate-400">{distanceSort === 'asc' ? '↑' : distanceSort === 'desc' ? '↓' : '↕'}</span>
                  </button>
                </th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Status</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600" title="Menandai apakah jawaban screening diisi sebelum atau sesudah perbaikan celah bypass anti-paste">
                  Anti-Paste
                </th>
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
                <tr><td colSpan={11} className="px-4 py-6 text-center text-slate-400">Memuat...</td></tr>
              )}
              {!loading && filteredApplicants.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-6 text-center text-slate-400">Belum ada pelamar di tahap ini.</td></tr>
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
                  <td className="px-4 py-2 text-slate-600">{a.placement ? PLACEMENT_LABELS[a.placement] || a.placement : '-'}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {a.distance_km !== null ? `${a.distance_km} KM` : '-'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-700'}`}>
                      {STATUS_LABELS[a.status] || a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {(() => {
                      const submittedAt = getScreeningSubmittedAt(a)
                      if (!submittedAt) return <span className="text-slate-300">-</span>
                      return (
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${isBeforeAntiPasteFix(submittedAt) ? 'bg-red-500' : 'bg-green-500'}`}
                          title={isBeforeAntiPasteFix(submittedAt) ? 'Diisi sebelum perbaikan anti-paste' : 'Diisi sesudah perbaikan anti-paste'}
                        />
                      )
                    })()}
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
                <p className="col-span-2">
                  <span className="text-slate-500">Penempatan:</span>{' '}
                  {detail.placement ? PLACEMENT_LABELS[detail.placement] || detail.placement : '-'}
                  {detail.placement && detail.distance_km !== null && detail.distance_minutes !== null && (
                    <span className="text-slate-500">
                      {' '}— {detail.distance_km} KM / {detail.distance_minutes} menit dari rumah ke {PLACEMENT_REFERENCE_POINT[detail.placement]}
                    </span>
                  )}
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
                <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <p className="text-sm font-medium text-amber-800">Jawaban Screening</p>
                    {detailScreeningSubmittedAt && (
                      isBeforeAntiPasteFix(detailScreeningSubmittedAt) ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                          ⚠️ Sebelum perbaikan anti-paste
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                          ✅ Sesudah perbaikan anti-paste
                        </span>
                      )
                    )}
                  </div>
                  {detailScreeningSubmittedAt && isBeforeAntiPasteFix(detailScreeningSubmittedAt) && (
                    <p className="text-xs text-red-700 mb-2">
                      Diisi sebelum celah bypass anti-paste ditutup — jawaban ini mungkin masih mengandung teks
                      tempelan yang tidak sempat terdeteksi. Jadikan pertimbangan tambahan, jangan patokan mutlak.
                    </p>
                  )}
                  <div className="space-y-4 mt-2">
                    {detailAnswers.map((a, i) => (
                      <div key={i} className={i > 0 ? 'pt-4 border-t border-amber-200' : ''}>
                        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                          Pertanyaan {i + 1}
                        </p>
                        <p className="text-sm font-medium text-slate-800 mb-2">{a.question_text}</p>
                        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Jawaban</p>
                          <p className="text-sm text-slate-600 whitespace-pre-wrap">{a.answer_text || '-'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
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

              <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-blue-800">Undangan Interview</p>
                {!interviewSettings?.interview_scheduled_at ? (
                  <p className="text-xs text-amber-700">
                    Jadwal interview belum diatur. Atur di{' '}
                    <Link href="/rekrutmen" className="underline font-medium">Pengaturan Rekrutmen</Link> dulu (berlaku sama untuk semua kandidat).
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">
                      Jadwal (untuk semua kandidat): <span className="font-medium text-slate-700">{formatInterviewSchedule(interviewSettings.interview_scheduled_at)}</span>
                      <br />Link undangan kandidat ini: <span className="font-mono text-blue-600 break-all">{interviewInviteLink(detail)}</span>
                    </p>
                    <button onClick={() => openInterviewWhatsApp(detail)}
                      className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">
                      📤 Kirim Link via WhatsApp
                    </button>
                  </>
                )}
                {detail.interview_confirmation && (
                  <p className="text-xs bg-white border border-blue-100 rounded-lg px-2 py-1.5 text-slate-600">
                    ✅ Kandidat konfirmasi: &ldquo;{detail.interview_confirmation}&rdquo;
                    {detail.interview_confirmed_at && <span className="text-slate-400"> — {formatInterviewSchedule(detail.interview_confirmed_at)}</span>}
                  </p>
                )}
                {detail.test_impression && (
                  <p className="text-xs bg-white border border-blue-100 rounded-lg px-2 py-1.5 text-slate-600">
                    💬 Kesan kandidat soal tes: &ldquo;{detail.test_impression}&rdquo;
                  </p>
                )}
              </div>

              {/* Hasil Interview — diisi HR/Owner SETELAH wawancara aktual berlangsung,
                  beda dari konfirmasi kandidat di atas (yang diisi SEBELUM interview). */}
              <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-3">
                <p className="text-sm font-medium text-emerald-800">Hasil Interview</p>
                {detail.interview_conducted_at && (
                  <p className="text-xs text-emerald-700">
                    Terakhir dicatat: {formatInterviewSchedule(detail.interview_conducted_at)}
                    {detail.interviewer_name && ` oleh ${detail.interviewer_name}`}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Nama Pewawancara</label>
                    <input value={interviewResultForm.interviewer_name}
                      onChange={e => setInterviewResultForm({ ...interviewResultForm, interviewer_name: e.target.value })}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Kehadiran</label>
                    <select value={interviewResultForm.attendance}
                      onChange={e => setInterviewResultForm({ ...interviewResultForm, attendance: e.target.value })}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">-- Pilih --</option>
                      {ATTENDANCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Komunikasi (lancar & lugas)</label>
                    <select value={interviewResultForm.communication}
                      onChange={e => setInterviewResultForm({ ...interviewResultForm, communication: e.target.value })}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">-- Pilih --</option>
                      {RATING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Penampilan & Kesiapan</label>
                    <select value={interviewResultForm.appearance}
                      onChange={e => setInterviewResultForm({ ...interviewResultForm, appearance: e.target.value })}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">-- Pilih --</option>
                      {RATING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Motivasi & Kecocokan</label>
                    <select value={interviewResultForm.motivation}
                      onChange={e => setInterviewResultForm({ ...interviewResultForm, motivation: e.target.value })}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">-- Pilih --</option>
                      {RATING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Rekomendasi</label>
                    <select value={interviewResultForm.recommendation}
                      onChange={e => setInterviewResultForm({ ...interviewResultForm, recommendation: e.target.value })}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">-- Pilih --</option>
                      {RECOMMENDATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Catatan / Kesan Bebas</label>
                  <textarea value={interviewResultForm.notes} rows={2}
                    onChange={e => setInterviewResultForm({ ...interviewResultForm, notes: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white resize-none" />
                </div>
                {interviewResultForm.recommendation && RECOMMENDATION_STATUS_MAP[interviewResultForm.recommendation] && (
                  <p className="text-xs text-emerald-700">
                    ℹ️ Simpan akan otomatis pindahkan status pelamar ke &ldquo;{STATUS_LABELS[RECOMMENDATION_STATUS_MAP[interviewResultForm.recommendation]]}&rdquo;.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={saveInterviewResult} disabled={savingInterviewResult}
                    className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                    {savingInterviewResult ? 'Menyimpan...' : 'Simpan Hasil Interview'}
                  </button>
                  {interviewResultSaved && <span className="text-xs text-emerald-700">Tersimpan.</span>}
                </div>
              </div>

              {(getNextStatus(detail.status) || detail.status !== 'ditolak') && (
                <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-2">
                  {getNextStatus(detail.status) && (
                    <button onClick={() => quickSetStatus(getNextStatus(detail.status)!)} disabled={savingStatus}
                      className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                      ✅ Lanjut ke {STATUS_LABELS[getNextStatus(detail.status)!]}
                    </button>
                  )}
                  {detail.status !== 'ditolak' && (
                    <button onClick={() => quickSetStatus('ditolak')} disabled={savingStatus}
                      className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                      ❌ Tolak Pelamar
                    </button>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex gap-2 items-center">
                  <label className="text-xs text-slate-400">Ubah manual:</label>
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
