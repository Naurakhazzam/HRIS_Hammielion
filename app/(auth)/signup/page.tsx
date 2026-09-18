'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { emailFromName } from '@/lib/emailFromName'

export default function SignupPage() {
  const [formMode, setFormMode] = useState<'full' | 'quick'>('full')

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Hammielion Management</h1>
          <p className="text-slate-500 text-sm mt-1">Daftar Akun Karyawan</p>
        </div>

        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-4">
          <button type="button" onClick={() => setFormMode('full')}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition ${formMode === 'full' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
            Verifikasi Lengkap
          </button>
          <button type="button" onClick={() => setFormMode('quick')}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition ${formMode === 'quick' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
            Kode Karyawan Saja
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          {formMode === 'full' ? <FullVerifyForm /> : <QuickForm />}
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          Sudah punya akun? <Link href="/login" className="text-blue-600 hover:underline font-medium">Masuk di sini</Link>
        </p>
      </div>
    </div>
  )
}

function FullVerifyForm() {
  const router = useRouter()
  const [employeeCode, setEmployeeCode] = useState('')
  const [verifyMethod, setVerifyMethod] = useState<'phone' | 'birth_date'>('phone')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) { setError('Konfirmasi password tidak sama.'); return }
    setLoading(true)

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_code: employeeCode,
        phone: verifyMethod === 'phone' ? phone : undefined,
        birth_date: verifyMethod === 'birth_date' ? birthDate : undefined,
        email,
        password,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Gagal mendaftar. Coba lagi.')
      setLoading(false)
      return
    }
    setSuccess(true)
    setLoading(false)
    setTimeout(() => router.push('/login'), 2500)
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Akun berhasil dibuat</h2>
        <p className="text-sm text-slate-500">Mengarahkan ke halaman login...</p>
      </div>
    )
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-slate-700 mb-1">Daftar Akun Baru</h2>
      <p className="text-xs text-slate-500 mb-6">Khusus karyawan yang sudah terdaftar di data HR. Belum punya Kode Karyawan? Hubungi HR dulu.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="employee_code" className="block text-sm font-medium text-slate-700 mb-1.5">Kode Karyawan</label>
          <input id="employee_code" type="text" required value={employeeCode} onChange={e => setEmployeeCode(e.target.value.toUpperCase())}
            placeholder="Contoh: EMP-012" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Verifikasi Identitas</label>
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-2">
            <button type="button" onClick={() => setVerifyMethod('phone')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${verifyMethod === 'phone' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
              Nomor HP
            </button>
            <button type="button" onClick={() => setVerifyMethod('birth_date')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${verifyMethod === 'birth_date' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
              Tanggal Lahir
            </button>
          </div>
          {verifyMethod === 'phone' ? (
            <input type="tel" required value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="Nomor HP yang tercatat di data HR" disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
          ) : (
            <input type="date" required value={birthDate} onChange={e => setBirthDate(e.target.value)}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
          )}
          <p className="text-[11px] text-slate-400 mt-1">Buat memastikan Anda memang karyawan ini — harus sesuai dengan data yang tercatat di HR.</p>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
          <input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="email@anda.com" autoComplete="email" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
          <input id="password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Minimal 6 karakter" autoComplete="new-password" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
        </div>

        <div>
          <label htmlFor="confirm_password" className="block text-sm font-medium text-slate-700 mb-1.5">Konfirmasi Password</label>
          <input id="confirm_password" type="password" required minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Ulangi password" autoComplete="new-password" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
        </div>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm py-2.5 rounded-lg transition disabled:opacity-60 flex items-center justify-center gap-2">
          {loading ? 'Mendaftarkan...' : 'Daftar'}
        </button>
      </form>
    </>
  )
}

// Jalur cepat: cuma modal Kode Karyawan (dianggap sudah cukup rahasia — keputusan Owner),
// verifikasi identitas pakai Nama Lengkap + Tanggal Lahir (dicocokkan ke data HR), Kode
// Karyawan OPSIONAL (cuma dipakai untuk membedakan kalau kebetulan ada 2 karyawan dengan nama
// & tanggal lahir sama persis). Email login dibentuk dari Nama Lengkap yang sama + domain
// @hammielion.com (bukan email pribadi bebas seperti tab satunya).
function QuickForm() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkedInfo, setCheckedInfo] = useState<{ employee_code: string; position_name: string | null } | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null) // simpan email yang jadi, untuk ditampilkan
  const [loading, setLoading] = useState(false)

  const previewEmail = emailFromName(fullName)

  async function checkIdentity() {
    setCheckedInfo(null)
    setCheckError(null)
    if (!fullName.trim() || !birthDate) return
    setChecking(true)
    const params = new URLSearchParams({ name: fullName.trim(), birth_date: birthDate })
    if (employeeCode.trim()) params.set('employee_code', employeeCode.trim())
    const res = await fetch(`/api/signup/quick?${params.toString()}`)
    const data = await res.json()
    if (!res.ok) setCheckError(data.error || 'Data tidak valid.')
    else setCheckedInfo({ employee_code: data.employee_code, position_name: data.position_name })
    setChecking(false)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) { setError('Konfirmasi password tidak sama.'); return }
    setLoading(true)

    const res = await fetch('/api/signup/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, birth_date: birthDate, employee_code: employeeCode || undefined, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Gagal mendaftar. Coba lagi.')
      setLoading(false)
      return
    }
    setSuccess(data.email)
    setLoading(false)
    setTimeout(() => router.push('/login'), 4000)
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Akun berhasil dibuat</h2>
        <p className="text-sm text-slate-600">Email login Anda:</p>
        <p className="text-sm font-semibold text-blue-700 mb-2">{success}</p>
        <p className="text-xs text-slate-400">Catat email ini — dipakai untuk login. Mengarahkan ke halaman login...</p>
      </div>
    )
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-slate-700 mb-1">Daftar Cepat</h2>
      <p className="text-xs text-slate-500 mb-6">Khusus karyawan yang sudah terdaftar di data HR. Verifikasi pakai Nama Lengkap &amp; Tanggal Lahir sesuai data HR.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="qc_full_name" className="block text-sm font-medium text-slate-700 mb-1.5">Nama Lengkap (sesuai data HR)</label>
          <input id="qc_full_name" type="text" required value={fullName}
            onChange={e => { setFullName(e.target.value); setCheckedInfo(null); setCheckError(null) }}
            onBlur={checkIdentity}
            placeholder="Nama Lengkap Anda" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50" />
          <p className="text-[11px] text-slate-400 mt-1">
            Email login Anda nanti: <span className="font-medium text-slate-600">{previewEmail || '—'}</span>
          </p>
        </div>

        <div>
          <label htmlFor="qc_birth_date" className="block text-sm font-medium text-slate-700 mb-1.5">Tanggal Lahir (sesuai data HR)</label>
          <input id="qc_birth_date" type="date" required value={birthDate}
            onChange={e => { setBirthDate(e.target.value); setCheckedInfo(null); setCheckError(null) }}
            onBlur={checkIdentity}
            disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
        </div>

        <div>
          <label htmlFor="qc_employee_code" className="block text-sm font-medium text-slate-700 mb-1.5">Kode Karyawan <span className="text-slate-400 font-normal">(opsional — isi kalau diminta HR)</span></label>
          <input id="qc_employee_code" type="text" value={employeeCode}
            onChange={e => { setEmployeeCode(e.target.value.toUpperCase()); setCheckedInfo(null); setCheckError(null) }}
            onBlur={checkIdentity}
            placeholder="Contoh: EMP-012" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50" />
          {checking && <p className="text-xs text-slate-400 mt-1">Mengecek...</p>}
          {checkedInfo && (
            <p className="text-xs text-green-600 mt-1">
              ✓ Data ditemukan — Kode: <strong>{checkedInfo.employee_code}</strong>{checkedInfo.position_name ? <>, Jabatan: <strong>{checkedInfo.position_name}</strong></> : null}
            </p>
          )}
          {checkError && <p className="text-xs text-red-600 mt-1">{checkError}</p>}
        </div>

        <div>
          <label htmlFor="qc_password" className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
          <input id="qc_password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Minimal 6 karakter" autoComplete="new-password" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
        </div>

        <div>
          <label htmlFor="qc_confirm_password" className="block text-sm font-medium text-slate-700 mb-1.5">Konfirmasi Password</label>
          <input id="qc_confirm_password" type="password" required minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Ulangi password" autoComplete="new-password" disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
        </div>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm py-2.5 rounded-lg transition disabled:opacity-60 flex items-center justify-center gap-2">
          {loading ? 'Mendaftarkan...' : 'Daftar'}
        </button>
      </form>
    </>
  )
}
