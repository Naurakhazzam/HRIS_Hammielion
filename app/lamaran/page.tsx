'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

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
}

export default function LamaranPage() {
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [applicationCode, setApplicationCode] = useState('')
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
      setApplicationCode(data.application_code)
    } catch {
      setError('Gagal mengirim lamaran. Cek koneksi internet Anda.')
    } finally {
      setSubmitting(false)
    }
  }

  if (applicationCode) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center space-y-3">
          <div className="text-4xl">✅</div>
          <h1 className="text-lg font-semibold text-slate-800">Lamaran Berhasil Dikirim</h1>
          <p className="text-sm text-slate-600">Simpan kode lamaran Anda:</p>
          <p className="text-xl font-mono font-bold text-blue-600">{applicationCode}</p>
          <p className="text-sm text-slate-600">Tim HR akan menghubungi Anda melalui nomor telepon yang didaftarkan.</p>
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
            <Field label="Jumlah Anak">
              <input type="number" min={0} className={inputClass} value={form.number_of_children}
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

          <Field label="Pengalaman Kerja">
            <textarea className={inputClass} rows={3} value={form.work_experience}
              onChange={e => update('work_experience', e.target.value)}
              placeholder="Ceritakan pengalaman kerja sebelumnya (jika ada)" />
          </Field>

          <Field label="Ceritakan tentang diri Anda & kenapa kami harus menerima Anda">
            <textarea className={inputClass} rows={4} value={form.motivation}
              onChange={e => {
                // Sebagian browser HP (chip clipboard/keyboard bawaan) menempelkan teks lewat
                // event 'input' biasa, bukan event 'paste' — jadi onPaste saja tidak cukup.
                // inputType di sini mengungkap jenis perubahan aslinya, termasuk saat itu
                // sebetulnya tempelan yang menyamar sebagai input biasa.
                const inputType = (e.nativeEvent as InputEvent).inputType
                const pasteLikeTypes = ['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank', 'insertReplacementText']
                if (inputType && pasteLikeTypes.includes(inputType)) {
                  e.currentTarget.value = form.motivation
                  return
                }
                update('motivation', e.target.value)
              }}
              onPaste={e => e.preventDefault()}
              onDrop={e => e.preventDefault()} />
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
