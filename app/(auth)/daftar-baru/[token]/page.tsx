'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const GENDER_OPTIONS = [{ value: 'male', label: 'Laki-laki' }, { value: 'female', label: 'Perempuan' }]
const RELIGION_OPTIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu']
const MARITAL_OPTIONS = [
  { value: 'single', label: 'Belum Menikah' },
  { value: 'married', label: 'Menikah' },
  { value: 'divorced', label: 'Cerai' },
  { value: 'widowed', label: 'Janda/Duda' },
]
const EDUCATION_OPTIONS = ['SD', 'SMP', 'SMA/SMK', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3']

const inputClass = "w-full px-3 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50"
const labelClass = "block text-sm font-medium text-slate-700 mb-1.5"

export default function DaftarBaruPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [placement, setPlacement] = useState<{ branch_name: string; position_name: string } | null>(null)

  const [form, setForm] = useState({
    full_name: '', nik: '', phone: '', birth_date: '', birth_place: '', gender: '', address: '',
    religion: '', marital_status: '', dependants: '0', education: '',
    bank_name: '', bank_account_number: '', bank_account_name: '',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
    password: '', confirmPassword: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ email: string } | null>(null)

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) setInviteError(data.error)
        else setPlacement(data)
        setLoading(false)
      })
      .catch(() => { setInviteError('Gagal memuat undangan. Coba refresh halaman.'); setLoading(false) })
  }, [token])

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (form.password !== form.confirmPassword) { setError('Konfirmasi password tidak sama.'); return }
    if (form.password.length < 6) { setError('Password minimal 6 karakter.'); return }
    setSubmitting(true)

    const res = await fetch(`/api/invite/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Gagal mendaftar. Coba lagi.')
      setSubmitting(false)
      return
    }
    setSuccess({ email: data.email })
    setSubmitting(false)
    setTimeout(() => router.push('/login'), 4000)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Hammielion Management</h1>
          <p className="text-slate-500 text-sm mt-1">Selamat Bergabung — Lengkapi Data Anda</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          {loading ? (
            <p className="text-center text-sm text-slate-500 py-6">Memuat undangan...</p>
          ) : inviteError ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Link Tidak Bisa Dipakai</h2>
              <p className="text-sm text-slate-500">{inviteError}</p>
            </div>
          ) : success ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Akun Berhasil Dibuat!</h2>
              <p className="text-sm text-slate-500">Email login Anda: <strong className="text-slate-700">{success.email}</strong></p>
              <p className="text-xs text-slate-400 mt-2">Mengarahkan ke halaman login...</p>
            </div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 text-sm">
                <p className="text-blue-700">Penempatan Anda: <strong>{placement?.position_name}</strong> di <strong>{placement?.branch_name}</strong></p>
              </div>

              {error && (
                <div className="p-3 mb-4 rounded-lg border bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Data Pribadi</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Nama Lengkap *</label>
                      <input required value={form.full_name} onChange={e => set('full_name', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>NIK</label>
                      <input value={form.nik} onChange={e => set('nik', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>No HP *</label>
                      <input required type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Tanggal Lahir *</label>
                      <input required type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Tempat Lahir</label>
                      <input value={form.birth_place} onChange={e => set('birth_place', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Jenis Kelamin</label>
                      <select value={form.gender} onChange={e => set('gender', e.target.value)} disabled={submitting} className={inputClass + ' bg-white'}>
                        <option value="">— Pilih —</option>
                        {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Agama</label>
                      <select value={form.religion} onChange={e => set('religion', e.target.value)} disabled={submitting} className={inputClass + ' bg-white'}>
                        <option value="">— Pilih —</option>
                        {RELIGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Alamat</label>
                      <textarea value={form.address} onChange={e => set('address', e.target.value)} disabled={submitting} rows={2} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Status Pernikahan</label>
                      <select value={form.marital_status} onChange={e => set('marital_status', e.target.value)} disabled={submitting} className={inputClass + ' bg-white'}>
                        <option value="">— Pilih —</option>
                        {MARITAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Jumlah Tanggungan</label>
                      <input type="number" min="0" value={form.dependants} onChange={e => set('dependants', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Pendidikan Terakhir</label>
                      <select value={form.education} onChange={e => set('education', e.target.value)} disabled={submitting} className={inputClass + ' bg-white'}>
                        <option value="">— Pilih —</option>
                        {EDUCATION_OPTIONS.map(e2 => <option key={e2} value={e2}>{e2}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Data Bank (untuk transfer gaji)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <input placeholder="Nama Bank" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} disabled={submitting} className={inputClass} />
                    <input placeholder="No Rekening" value={form.bank_account_number} onChange={e => set('bank_account_number', e.target.value)} disabled={submitting} className={inputClass} />
                    <input placeholder="Nama Pemilik Rekening" value={form.bank_account_name} onChange={e => set('bank_account_name', e.target.value)} disabled={submitting} className={inputClass} />
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Kontak Darurat</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <input placeholder="Nama" value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} disabled={submitting} className={inputClass} />
                    <input placeholder="No HP" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} disabled={submitting} className={inputClass} />
                    <input placeholder="Hubungan (mis. Orang Tua)" value={form.emergency_contact_relation} onChange={e => set('emergency_contact_relation', e.target.value)} disabled={submitting} className={inputClass} />
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Akun Login</h3>
                  <p className="text-xs text-slate-400 mb-3">Email login akan dibuat otomatis dari Nama Lengkap Anda.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Password *</label>
                      <input required type="password" minLength={6} value={form.password} onChange={e => set('password', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Konfirmasi Password *</label>
                      <input required type="password" minLength={6} value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} disabled={submitting} className={inputClass} />
                    </div>
                  </div>
                </div>

                <button type="submit" disabled={submitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm shadow-sm transition disabled:opacity-50">
                  {submitting ? 'Menyimpan...' : 'Daftar & Buat Akun'}
                </button>
              </form>
            </>
          )}
        </div>

        {!loading && !success && (
          <p className="text-center text-sm text-slate-500 mt-6">
            Sudah punya akun? <Link href="/login" className="text-blue-600 hover:underline font-medium">Masuk di sini</Link>
          </p>
        )}
      </div>
    </div>
  )
}
