'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import QRCode from 'qrcode'

type Applicant = {
  id: string
  application_code: string
  full_name: string
  gender: string
  birth_date: string | null
  education: string
  phone: string
  created_at: string
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
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [loading, setLoading] = useState(true)
  const [lamaranUrl, setLamaranUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [uploadFormUrl, setUploadFormUrl] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [urlSaved, setUrlSaved] = useState(false)

  const supabase = createClient()

  const fetchApplicants = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('job_applicants')
      .select('id, application_code, full_name, gender, birth_date, education, phone, created_at')
      .order('created_at', { ascending: false })
    setApplicants(data || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // Fetch mount-time data — setLoading(true) di dalamnya aman, bukan pola
    // cascading-render yang jadi target rule ini.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApplicants()

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
  }, [fetchApplicants])

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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">Daftar Pelamar ({applicants.length})</h2>
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
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Tanggal Daftar</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Memuat...</td></tr>
              )}
              {!loading && applicants.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Belum ada pelamar masuk.</td></tr>
              )}
              {applicants.map(a => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs text-blue-600">{a.application_code}</td>
                  <td className="px-4 py-2 text-slate-800">{a.full_name}</td>
                  <td className="px-4 py-2 text-slate-600">{calcAge(a.birth_date) ?? '-'}</td>
                  <td className="px-4 py-2 text-slate-600">{a.education}</td>
                  <td className="px-4 py-2 text-slate-600">{a.phone}</td>
                  <td className="px-4 py-2 text-slate-600">{new Date(a.created_at).toLocaleDateString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
