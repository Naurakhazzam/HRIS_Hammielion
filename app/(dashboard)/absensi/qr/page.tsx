'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import QRCode from 'qrcode'
import { triggerDailyPhotoCleanup } from '@/lib/photoCleanup'

type BranchQr = { id: string; name: string; token: string | null; dataUrl: string | null }

export default function AbsenQrAdminPage() {
  const supabase = createClient()
  const [branches, setBranches] = useState<BranchQr[]>([])
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [cleanupCount, setCleanupCount] = useState<number | null>(null)
  const [cleaning, setCleaning] = useState(false)

  useEffect(() => { fetchBranches(); fetchCleanupCount(); triggerDailyPhotoCleanup() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function fetchBranches() {
    setLoading(true)
    const { data } = await supabase.from('branches')
      .select('id, name, branch_qr_tokens(token)')
      .order('name')

    const rows = (data || []).map((b: any) => ({
      id: b.id, name: b.name, token: b.branch_qr_tokens?.token ?? null, dataUrl: null as string | null,
    }))

    const withQr = await Promise.all(rows.map(async r => {
      if (!r.token) return r
      const url = `${window.location.origin}/absen-qr/${r.token}`
      // width lebih besar dari yang ditampilkan di layar — supaya waktu di-scale besar untuk
      // cetak (2 per halaman), hasilnya tetap tajam, tidak pecah/blur.
      const dataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1 })
      return { ...r, dataUrl }
    }))
    setBranches(withQr)
    setLoading(false)
  }

  async function fetchCleanupCount() {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 60)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    const { count } = await supabase.from('attendances')
      .select('id', { count: 'exact', head: true })
      .lt('date', cutoffStr)
      .or('check_in_photo_url.not.is.null,check_out_photo_url.not.is.null')
    setCleanupCount(count ?? 0)
  }

  async function regenerateToken(branchId: string) {
    if (!confirm('Buat ulang QR untuk cabang ini? QR lama tidak akan berfungsi lagi — pastikan cetak yang baru.')) return
    setRegenerating(branchId)
    const { error } = await supabase.from('branch_qr_tokens')
      .update({ token: crypto.randomUUID(), updated_at: new Date().toISOString() })
      .eq('branch_id', branchId)
    if (error) showMsg('error', 'Gagal membuat ulang QR: ' + error.message)
    else { showMsg('success', 'QR baru berhasil dibuat. Cetak & pasang yang baru di cabang.'); await fetchBranches() }
    setRegenerating(null)
  }

  async function runCleanupNow() {
    setCleaning(true)
    try {
      const res = await fetch('/api/attendance/cleanup-old-photos', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal membersihkan foto.')
      showMsg('success', `${data.deletedFiles} file foto dihapus dari ${data.clearedRows} baris absensi.`)
      fetchCleanupCount()
    } catch (e: any) {
      showMsg('error', e.message)
    }
    setCleaning(false)
  }

  return (
    <div>
      {/* Cetak: paksa 2 QR per halaman (bukan ikut grid layar yang bisa 2-3 kolom tergantung
          lebar), dan halaman baru otomatis dimulai tiap 2 kartu — supaya QR-nya bisa dicetak
          besar dan jelas, tidak berdesakan kecil-kecil. */}
      <style>{`
        @media print {
          .qr-print-grid { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 3rem !important; }
          .qr-print-card { break-inside: avoid; }
          .qr-print-card:nth-child(2n) { break-after: page; }
        }
      `}</style>

      <div className="mb-6 print:hidden">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">QR Absen</h1>
        <p className="text-sm text-slate-500">Cetak & tempel QR ini di masing-masing cabang. Karyawan tinggal scan pakai kamera HP untuk absen masuk/pulang — tanpa perlu deteksi lokasi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border print:hidden ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="mb-8 bg-white rounded-xl shadow-sm border border-slate-200 p-5 print:hidden">
        <h2 className="text-sm font-bold text-slate-700 mb-1">Kebersihan Storage Foto Absen</h2>
        <p className="text-xs text-slate-500 mb-3">Foto absen (check-in/check-out) yang lebih tua dari 2 bulan dihapus otomatis (data jam masuk/pulang/telat/lembur TIDAK ikut terhapus, cuma file fotonya). Ini pembersihan manual kalau mau langsung dijalankan sekarang.</p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">{cleanupCount === null ? 'Menghitung...' : `${cleanupCount} baris absen punya foto >2 bulan`}</span>
          <button onClick={runCleanupNow} disabled={cleaning || !cleanupCount}
            className="px-3 py-1.5 text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-200 transition disabled:opacity-50">
            {cleaning ? 'Membersihkan...' : 'Bersihkan Sekarang'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Memuat...</div>
      ) : (
        <div className="qr-print-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {branches.map(b => (
            <div key={b.id} className="qr-print-card bg-white rounded-xl shadow-sm border border-slate-200 p-5 text-center print:shadow-none print:border-2 print:p-10">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 print:text-lg">QR Absen — Cabang</p>
              <p className="text-xl font-extrabold text-slate-800 mb-3 print:text-5xl print:mb-6">{b.name}</p>
              {b.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.dataUrl} alt={`QR Absen ${b.name}`} className="mx-auto w-48 h-48 print:w-full print:h-auto print:max-w-none" />
              ) : (
                <p className="text-xs text-slate-400 py-12">QR belum tersedia.</p>
              )}
              <button onClick={() => regenerateToken(b.id)} disabled={regenerating === b.id}
                className="mt-3 text-xs text-slate-500 hover:text-red-600 underline print:hidden disabled:opacity-50">
                {regenerating === b.id ? 'Memproses...' : 'Buat Ulang QR (kalau bocor/hilang)'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 print:hidden">
        <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
          🖨️ Cetak Semua QR
        </button>
      </div>
    </div>
  )
}
