'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { blockPasteOnChange, blockPasteHandlers } from '@/lib/noPaste'
import RecruitmentFlow from '@/components/recruitment/RecruitmentFlow'
import { ScreeningQuestion } from '@/components/recruitment/ScreeningForm'

const GENDER_OPTIONS = [
  { value: 'male', label: 'Laki-laki' },
  { value: 'female', label: 'Perempuan' },
]
const MARITAL_OPTIONS = [
  { value: 'single', label: 'Belum Menikah' },
  { value: 'married', label: 'Menikah' },
  { value: 'divorced', label: 'Cerai' },
  { value: 'widowed', label: 'Janda/Duda' },
]
const EDUCATION_OPTIONS = ['SD', 'SMP', 'SMA/SMK', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3']
const PLACEMENT_OPTIONS = [
  { value: 'singaparna', label: 'Singaparna' },
  { value: 'tasik_kota', label: 'Tasik Kota' },
]
const PLACEMENT_REFERENCE_POINT: Record<string, string> = {
  singaparna: 'Alun-alun Singaparna',
  tasik_kota: 'UNSIL',
}

const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
const selectClass = inputClass + " bg-white"

function calcAge(birthDate: string): number | null {
  if (!birthDate) return null
  const bd = new Date(birthDate)
  if (Number.isNaN(bd.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - bd.getFullYear()
  const monthDiff = now.getMonth() - bd.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < bd.getDate())) age--
  return age
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

const emptyForm = {
  full_name: '', gender: '', birth_place: '', birth_date: '', address: '', phone: '',
  marital_status: '', number_of_children: '', education: '', work_experience: '', motivation: '',
  placement: '', distance_km: '', distance_minutes: '',
}

type SubmissionResult = {
  application_code: string
  applicant_id: string
  status: string
  questions: ScreeningQuestion[]
}

const PIPELINE_STAGES = [
  { emoji: '📝', title: 'Data Diri', desc: 'Isi formulir data diri, pengalaman kerja, dan penempatan cabang yang Anda inginkan.' },
  { emoji: '❓', title: 'Screening', desc: 'Kalau HR sedang membuka pertanyaan screening, Anda akan diminta menjawab beberapa pertanyaan singkat.' },
  { emoji: '🧮', title: 'Psikotes', desc: 'Tes hitung cepat dan beberapa tes kepribadian/gaya kerja singkat. Semua bisa dikerjakan langsung, satu per satu.' },
  { emoji: '⏳', title: 'Menunggu Dipanggil Interview', desc: 'Tim HR meninjau hasil Anda. Kalau lolos, HR akan menghubungi Anda lewat WhatsApp untuk jadwal interview.' },
  { emoji: '🧑‍💼', title: 'Training/Percobaan', desc: 'Kalau lolos interview, Anda akan menjalani masa training/percobaan terlebih dahulu.' },
  { emoji: '✅', title: 'Keputusan Akhir', desc: 'HR akan menginfokan apakah Anda diterima sebagai karyawan tetap atau belum berhasil kali ini.' },
]

function EntryChoiceScreen({ onNew }: { onNew: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Lowongan Kerja</h1>
          <p className="text-sm text-slate-500 mt-1">Hammielion Management</p>
        </div>
        <div className="grid gap-4">
          <button onClick={onNew}
            className="bg-white rounded-xl shadow-sm border-2 border-blue-200 hover:border-blue-400 p-6 text-left transition-colors">
            <div className="text-3xl mb-2">🆕</div>
            <p className="text-base font-semibold text-slate-800">Saya Baru Mau Melamar</p>
            <p className="text-sm text-slate-500 mt-1">Belum pernah mengisi formulir lamaran untuk lowongan ini.</p>
          </button>
          <Link href="/lamaran/status"
            className="bg-white rounded-xl shadow-sm border-2 border-slate-200 hover:border-slate-400 p-6 text-left transition-colors block">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-base font-semibold text-slate-800">Saya Sudah Pernah Melamar</p>
            <p className="text-sm text-slate-500 mt-1">Cek status lamaran, atau lanjutkan tahap yang belum selesai.</p>
          </Link>
        </div>
      </div>
    </div>
  )
}

function StageIntroScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Sebelum Mulai</h1>
          <p className="text-sm text-slate-500 mt-1">Hammielion Management</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Berikut tahapan proses lamaran kerja di Hammielion Management, supaya Anda tahu ada di tahap mana nanti.
            Setelah tahap Data Diri sampai Psikotes, semuanya bisa langsung dikerjakan berurutan di halaman ini juga.
          </p>
          <div className="space-y-3">
            {PIPELINE_STAGES.map((s, i) => (
              <div key={s.title} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="text-xl leading-none">{s.emoji}</span>
                  {i < PIPELINE_STAGES.length - 1 && <span className="w-px flex-1 bg-slate-200 mt-1" />}
                </div>
                <div className="pb-3">
                  <p className="text-sm font-semibold text-slate-800">{i + 1}. {s.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <button onClick={onStart}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
            Paham, Mulai Isi Formulir
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LamaranPage() {
  const [stage, setStage] = useState<'choice' | 'intro' | 'form'>('choice')
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submission, setSubmission] = useState<SubmissionResult | null>(null)
  const [uploadFormUrl, setUploadFormUrl] = useState('')

  const age = calcAge(form.birth_date)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('recruitment_settings')
      .select('upload_form_url')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => setUploadFormUrl(data?.upload_form_url || ''))
  }, [])

  function update<K extends keyof typeof emptyForm>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/lamaran', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal mengirim lamaran.')
        return
      }
      setSubmission({
        application_code: data.application_code,
        applicant_id: data.applicant_id,
        status: data.status,
        questions: data.questions || [],
      })
    } catch {
      setError('Gagal mengirim lamaran. Cek koneksi internet Anda.')
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'choice') {
    return <EntryChoiceScreen onNew={() => setStage('intro')} />
  }

  if (stage === 'intro') {
    return <StageIntroScreen onStart={() => setStage('form')} />
  }

  if (submission) {
    return (
      <div className="min-h-screen bg-slate-50 py-8 px-4">
        <div className="max-w-xl mx-auto space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-center space-y-2">
            <div className="text-3xl">✅</div>
            <h1 className="text-lg font-semibold text-slate-800">Lamaran Berhasil Dikirim</h1>
            <p className="text-sm text-slate-600">Simpan kode lamaran Anda (kalau koneksi putus, gunakan ini untuk lanjut lagi):</p>
            <p className="text-xl font-mono font-bold text-blue-600">{submission.application_code}</p>
            <p className="text-sm text-slate-600">
              Lanjutkan langsung ke tahap berikutnya di bawah ini. Kalau Anda tutup halaman ini sebelum selesai, bisa
              lanjut lagi lewat{' '}
              <Link href="/lamaran/status" className="text-blue-600 underline">Cek Status Lamaran</Link>.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <RecruitmentFlow
              applicantId={submission.applicant_id}
              phone={form.phone}
              status={submission.status}
              questions={submission.questions}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Formulir Lamaran Kerja</h1>
          <p className="text-sm text-slate-500 mt-1">Hammielion Management</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <Field label="Nama Lengkap" required>
            <input className={inputClass} required value={form.full_name}
              onChange={e => update('full_name', e.target.value)} />
          </Field>

          <Field label="Jenis Kelamin" required>
            <select className={selectClass} required value={form.gender}
              onChange={e => update('gender', e.target.value)}>
              <option value="">Pilih...</option>
              {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Tempat Lahir">
              <input className={inputClass} value={form.birth_place}
                onChange={e => update('birth_place', e.target.value)} />
            </Field>
            <Field label="Tanggal Lahir">
              <input type="date" className={inputClass} value={form.birth_date}
                onChange={e => update('birth_date', e.target.value)} />
            </Field>
          </div>
          {age !== null && <p className="text-xs text-slate-500 -mt-2">Usia: {age} tahun</p>}

          <Field label="Alamat Rumah">
            <textarea className={inputClass} rows={2} value={form.address}
              onChange={e => update('address', e.target.value)} />
          </Field>

          <Field label="Penempatan Cabang" required>
            <select className={selectClass} required value={form.placement}
              onChange={e => update('placement', e.target.value)}>
              <option value="">Pilih...</option>
              {PLACEMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          {form.placement && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-3 space-y-3">
              <p className="text-sm font-medium text-blue-800">
                Jarak Rumah ke {PLACEMENT_REFERENCE_POINT[form.placement]}
              </p>
              <p className="text-xs text-blue-700">
                Pastikan Anda mengecek jarak dan waktu tempuhnya lewat Google Maps sebelum mengisi.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Jarak" required>
                  <div className="flex">
                    <input type="text" inputMode="numeric" pattern="[0-9]*" required
                      className={inputClass + " rounded-r-none"}
                      value={form.distance_km}
                      onChange={e => update('distance_km', e.target.value.replace(/\D/g, ''))} />
                    <span className="px-3 flex items-center border border-l-0 border-slate-300 rounded-r-lg bg-slate-100 text-sm text-slate-600 shrink-0">
                      KM
                    </span>
                  </div>
                </Field>
                <Field label="Waktu Tempuh" required>
                  <div className="flex">
                    <input type="text" inputMode="numeric" pattern="[0-9]*" required
                      className={inputClass + " rounded-r-none"}
                      value={form.distance_minutes}
                      onChange={e => update('distance_minutes', e.target.value.replace(/\D/g, ''))} />
                    <span className="px-3 flex items-center border border-l-0 border-slate-300 rounded-r-lg bg-slate-100 text-sm text-slate-600 shrink-0">
                      MENIT
                    </span>
                  </div>
                </Field>
              </div>
            </div>
          )}

          <Field label="Nomor Telepon/WhatsApp" required>
            <input className={inputClass} required value={form.phone}
              onChange={e => update('phone', e.target.value)} placeholder="08xxxxxxxxxx" />
          </Field>

          <Field label="Status Perkawinan" required>
            <select className={selectClass} required value={form.marital_status}
              onChange={e => update('marital_status', e.target.value)}>
              <option value="">Pilih...</option>
              {MARITAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          {form.marital_status === 'married' && (
            <Field label="Jumlah Anak" required>
              <input type="number" min={0} required className={inputClass} value={form.number_of_children}
                onChange={e => update('number_of_children', e.target.value)} />
            </Field>
          )}

          <Field label="Pendidikan Terakhir" required>
            <select className={selectClass} required value={form.education}
              onChange={e => update('education', e.target.value)}>
              <option value="">Pilih...</option>
              {EDUCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>

          <Field label="Pengalaman Kerja" required>
            <textarea className={inputClass} rows={3} required minLength={10} value={form.work_experience}
              onChange={blockPasteOnChange(form.work_experience, v => update('work_experience', v))}
              {...blockPasteHandlers}
              placeholder='Ceritakan pengalaman kerja Anda. Kalau belum pernah bekerja, tulis "Belum ada pengalaman kerja".' />
            <p className="text-xs text-slate-400">Tulis dengan kata-kata sendiri — kolom ini tidak bisa ditempel (paste).</p>
          </Field>

          <Field label="Ceritakan tentang diri Anda & kenapa kami harus menerima Anda">
            <textarea className={inputClass} rows={4} value={form.motivation}
              onChange={blockPasteOnChange(form.motivation, v => update('motivation', v))}
              {...blockPasteHandlers} />
            <p className="text-xs text-slate-400">Tulis dengan kata-kata sendiri — kolom ini tidak bisa ditempel (paste).</p>
          </Field>

          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-3 space-y-1">
            <p className="text-sm font-medium text-blue-800">Upload CV & Foto Diri</p>
            {uploadFormUrl ? (
              <a href={uploadFormUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm text-blue-600 underline">
                Klik di sini untuk upload CV & foto
              </a>
            ) : (
              <p className="text-sm text-blue-700">Link upload menyusul, akan diinfokan oleh HR.</p>
            )}
          </div>

          <button type="submit" disabled={submitting}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {submitting ? 'Mengirim...' : 'Kirim Lamaran'}
          </button>
        </form>
      </div>
    </div>
  )
}
