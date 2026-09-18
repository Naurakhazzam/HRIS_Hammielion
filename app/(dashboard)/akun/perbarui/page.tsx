'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { emailFromName } from '@/lib/emailFromName'

export default function PerbaruiAkunPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [currentEmail, setCurrentEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    setCurrentEmail(user.email ?? '')
    const { data: userData } = await supabase.from('users')
      .select('employees(full_name)')
      .eq('id', user.id).single()
    setName((userData as any)?.employees?.full_name ?? '')
    setLoading(false)
  }

  const previewEmail = emailFromName(name)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) { setError('Konfirmasi password tidak sama.'); return }
    setSubmitting(true)

    const res = await fetch('/api/akun/perbarui', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Gagal memperbarui akun. Coba lagi.')
      setSubmitting(false)
      return
    }
    setSuccess(data.email)
    setSubmitting(false)
    setTimeout(async () => {
      await supabase.auth.signOut()
      router.push('/login')
    }, 5000)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Perbarui Akun Saya</h1>
        <p className="text-sm text-slate-500">Pindah ke email standar perusahaan (@hammielion.com) dan atur ulang password Anda sendiri.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        {success ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Akun berhasil diperbarui</h2>
            <p className="text-sm text-slate-600">Email login baru Anda:</p>
            <p className="text-sm font-semibold text-blue-700 mb-2">{success}</p>
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
              ⚠️ Catat email &amp; password baru ini baik-baik. Karena bukan email pribadi sungguhan, fitur "Lupa Password" tidak bisa dipakai untuk akun ini — kalau lupa, harus minta HR/Owner reset manual.
            </p>
            <p className="text-xs text-slate-400 mt-3">Anda akan otomatis logout, silakan login lagi pakai email &amp; password baru...</p>
          </div>
        ) : (
          <>
            <div className="mb-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Email Anda saat ini: <span className="font-medium text-slate-700">{currentEmail}</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1.5">Nama Lengkap (untuk email login)</label>
                <input id="name" type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Nama Lengkap Anda" disabled={submitting}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
                <p className="text-[11px] text-slate-400 mt-1">
                  Email baru Anda: <span className="font-medium text-slate-600">{previewEmail || '—'}</span>
                </p>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">Password Baru</label>
                <input id="password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter" autoComplete="new-password" disabled={submitting}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
              </div>

              <div>
                <label htmlFor="confirm_password" className="block text-sm font-medium text-slate-700 mb-1.5">Konfirmasi Password Baru</label>
                <input id="confirm_password" type="password" required minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi password baru" autoComplete="new-password" disabled={submitting}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
              )}

              <button type="submit" disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm py-2.5 rounded-lg transition disabled:opacity-60">
                {submitting ? 'Menyimpan...' : 'Perbarui Akun'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
