'use client'

import { useState, useRef, useEffect } from 'react'

// Kamera khusus alur Pengiriman Logistik — pakai kamera BELAKANG (bukan selfie seperti Absen),
// karena ini motret barang/toko/kejadian, bukan wajah. Foto wajib langsung dari kamera saat itu
// juga (getUserMedia + canvas), sama seperti Absen Selfie — tidak boleh dari galeri.
// Komponen ini sengaja dibuat baru & terpisah dari components/AbsenSekarang.tsx (bukan hasil
// ekstrak/refactor dari situ) supaya tidak berisiko mengganggu fitur absen yang sudah jalan benar.

type Props = {
  label: string
  employeeName: string
  onCaptured: (blob: Blob) => void
  onCancel?: () => void
  // Jalur cadangan "Kamera Bawaan HP" (<input capture>) di sebagian HP (mis. MIUI) masih bisa
  // membuka galeri. Kalau diisi, file yang dibuat lebih lama dari ini ditolak -- foto galeri
  // hampir selalu jauh lebih tua dari foto yang barusan diambil.
  maxFileAgeMs?: number
}

export default function LogisticsCameraCapture({ label, employeeName, onCaptured, onCancel, maxFileAgeMs }: Props) {
  const [step, setStep] = useState<'idle' | 'camera' | 'preview'>('idle')
  const [cameraReady, setCameraReady] = useState(false)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Sebagian HP (terutama yang murah/lawas) sesekali gagal MENAMPILKAN pratinjau foto sesaat
  // setelah difoto (glitch render WebView/memori) -- terbukti dari laporan lapangan, file
  // foto aslinya sebenarnya baik-baik saja begitu dicek, cuma tampilannya yang sempat gagal.
  // Jadi dicoba muat ulang otomatis dulu beberapa kali (biasanya langsung berhasil) sebelum
  // benar-benar dianggap rusak dan mengunci tombol "Gunakan Foto Ini".
  const [previewRetry, setPreviewRetry] = useState(0)
  const [previewFailed, setPreviewFailed] = useState(false)
  const MAX_PREVIEW_RETRY = 3

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => stopCamera(), [])
  useEffect(() => {
    if (step !== 'camera' || !streamRef.current || !videoRef.current) return
    videoRef.current.srcObject = streamRef.current
    videoRef.current.play().catch(() => { /* autoPlay jadi fallback */ })
  }, [step])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  async function openCamera() {
    setError(null)
    setCameraReady(false)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Browser ini tidak mendukung akses kamera (kemungkinan dibuka dari dalam aplikasi lain). Coba buka lewat Chrome/Safari langsung.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      setStep('camera')
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      setError(`Tidak bisa mengakses kamera (${detail}).`)
    }
  }

  function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const now = new Date()
    const line1 = employeeName
    const line2 = `${now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} ${now.toLocaleTimeString('id-ID')}`
    const line3 = label
    const barHeight = Math.max(64, height * 0.14)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, height - barHeight, width, barHeight)
    ctx.fillStyle = '#fff'
    const fontSize = Math.max(14, Math.round(width / 28))
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillText(line1, 12, height - barHeight + fontSize + 4)
    ctx.font = `${fontSize * 0.8}px sans-serif`
    ctx.fillText(line2, 12, height - barHeight + fontSize * 2 + 6)
    ctx.fillText(line3, 12, height - barHeight + fontSize * 3 + 8)
  }

  function takePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (!video.videoWidth || !video.videoHeight) { setError('Kamera belum siap sepenuhnya, tunggu 1-2 detik lalu coba lagi.'); return }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch {
      setError('Gagal mengambil gambar dari kamera. Coba lagi.')
      return
    }
    drawWatermark(ctx, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!blob) return
      setCapturedBlob(blob)
      setCapturedUrl(URL.createObjectURL(blob))
      setPreviewRetry(0)
      setPreviewFailed(false)
      stopCamera()
      setStep('preview')
    }, 'image/jpeg', 0.85)
  }

  function openNativeCameraFallback() {
    fileInputRef.current?.click()
  }

  function handleFileCaptured(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (maxFileAgeMs && file.lastModified > 0 && Date.now() - file.lastModified > maxFileAgeMs) {
      setError('Foto harus diambil langsung dari kamera saat ini, bukan dari galeri. Coba ambil foto lagi.')
      return
    }
    stopCamera()
    const objUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) { URL.revokeObjectURL(objUrl); return }
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(objUrl); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      drawWatermark(ctx, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        URL.revokeObjectURL(objUrl)
        if (!blob) return
        setCapturedBlob(blob)
        setCapturedUrl(URL.createObjectURL(blob))
        setPreviewRetry(0)
        setPreviewFailed(false)
        setStep('preview')
      }, 'image/jpeg', 0.85)
    }
    img.onerror = () => { URL.revokeObjectURL(objUrl); setError('Gagal memuat foto dari kamera.') }
    img.src = objUrl
  }

  function retake() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedBlob(null)
    setCapturedUrl(null)
    setPreviewRetry(0)
    setPreviewFailed(false)
    openCamera()
  }

  // Coba render ulang pratinjaunya dulu (biasanya cukup 1x) sebelum benar-benar dianggap
  // rusak -- file blob-nya sendiri tidak berubah, cuma elemen <img>-nya dipaksa mencoba lagi
  // lewat key yang berganti.
  function handlePreviewError() {
    setPreviewRetry(n => {
      if (n + 1 >= MAX_PREVIEW_RETRY) { setPreviewFailed(true); return n }
      return n + 1
    })
  }

  function confirmPhoto() {
    if (!capturedBlob) return
    onCaptured(capturedBlob)
  }

  function cancel() {
    stopCamera()
    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedBlob(null)
    setCapturedUrl(null)
    setStep('idle')
    onCancel?.()
  }

  return (
    <div className="space-y-2">
      {error && step === 'idle' && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {step === 'idle' && (
        <button type="button" onClick={openCamera}
          className="w-full py-2.5 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition">
          📷 {label}
        </button>
      )}

      {/* Kamera & pratinjau full-screen -- sebelumnya inline di dalam kartu (max-w-2xl + rasio
          4:3 dipaksa), jadi area previewnya kecil & kepotong buat HP portrait, menyulitkan motret
          barang yang banyak/tinggi susunannya. Sekarang nutup seluruh layar, video/foto mengisi
          penuh tinggi layar, tombol aksi melayang di bawah (pola sama dgn PhotoLightbox). */}
      {(step === 'camera' || step === 'preview') && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-4 pb-3 bg-gradient-to-b from-black/70 to-transparent"
            style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
            <p className="text-white text-sm font-semibold truncate">{label}</p>
          </div>

          {error && (
            <p className="absolute left-4 right-4 z-10 text-xs text-red-100 bg-red-900/80 rounded-lg px-3 py-2"
              style={{ top: 'max(3.25rem, calc(env(safe-area-inset-top) + 2.5rem))' }}>
              {error}
            </p>
          )}

          {step === 'camera' && (
            <>
              <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setCameraReady(true)}
                className="flex-1 w-full h-full min-h-0 object-cover bg-slate-900" />
              <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pt-10 bg-gradient-to-t from-black/80 to-transparent space-y-2"
                style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
                <p className="text-[11px] text-white/70 text-center">
                  Kamera tidak muncul? <button type="button" onClick={openNativeCameraFallback} className="text-blue-300 hover:underline font-medium">Pakai Kamera Bawaan HP</button>
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={cancel} className="flex-1 py-3 bg-white/10 text-white rounded-lg text-sm font-medium backdrop-blur-sm">Batal</button>
                  <button type="button" onClick={takePhoto} disabled={!cameraReady}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {cameraReady ? 'Ambil Foto' : 'Menyiapkan kamera...'}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 'preview' && capturedUrl && (
            <>
              {previewFailed ? (
                <div className="flex-1 w-full min-h-0 flex flex-col items-center justify-center text-center px-6 bg-red-950">
                  <span className="text-4xl mb-2">⚠️</span>
                  <p className="text-sm font-semibold text-red-200">Pratinjau gagal ditampilkan</p>
                  <p className="text-xs text-red-300 mt-1">Kalau foto sebelumnya memang jelas, boleh tetap dikirim -- kalau ragu, ambil ulang saja.</p>
                </div>
              ) : (
                // key berganti tiap retry supaya <img> benar-benar dipaksa mencoba muat ulang dari
                // awal (bukan cuma re-render React biasa yang tidak mengulang proses decode gambar).
                // eslint-disable-next-line @next/next/no-img-element
                <img key={previewRetry} src={capturedUrl} alt={label} className="flex-1 w-full h-full min-h-0 object-contain bg-black" onError={handlePreviewError} />
              )}
              <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pt-10 bg-gradient-to-t from-black/80 to-transparent"
                style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
                <div className="flex gap-2">
                  <button type="button" onClick={retake} className="flex-1 py-3 bg-white/10 text-white rounded-lg text-sm font-medium backdrop-blur-sm">Ambil Ulang</button>
                  <button type="button" onClick={confirmPhoto}
                    className="flex-1 py-3 bg-green-600 text-white rounded-lg text-sm font-semibold">
                    Gunakan Foto Ini
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileCaptured} />
    </div>
  )
}
