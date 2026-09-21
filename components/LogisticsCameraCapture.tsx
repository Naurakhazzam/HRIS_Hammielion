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
}

export default function LogisticsCameraCapture({ label, employeeName, onCaptured, onCancel }: Props) {
  const [step, setStep] = useState<'idle' | 'camera' | 'preview'>('idle')
  const [cameraReady, setCameraReady] = useState(false)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    openCamera()
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
      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {step === 'idle' && (
        <button type="button" onClick={openCamera}
          className="w-full py-2.5 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition">
          📷 {label}
        </button>
      )}
      {step === 'camera' && (
        <div className="space-y-2">
          <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setCameraReady(true)}
            className="w-full rounded-lg bg-slate-900 aspect-[4/3] object-cover" />
          <p className="text-[11px] text-slate-400 text-center">
            Kamera tidak muncul? <button type="button" onClick={openNativeCameraFallback} className="text-blue-600 hover:underline font-medium">Pakai Kamera Bawaan HP</button>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={cancel} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
            <button type="button" onClick={takePhoto} disabled={!cameraReady}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {cameraReady ? 'Ambil Foto' : 'Menyiapkan kamera...'}
            </button>
          </div>
        </div>
      )}
      {step === 'preview' && capturedUrl && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedUrl} alt={label} className="w-full rounded-lg aspect-[4/3] object-cover" />
          <div className="flex gap-2">
            <button type="button" onClick={retake} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Ambil Ulang</button>
            <button type="button" onClick={confirmPhoto} className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold">Gunakan Foto Ini</button>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileCaptured} />
    </div>
  )
}
