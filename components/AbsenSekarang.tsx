'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'
import { resolveSchedule, calcLateMinutes, calcOvertimeHours, distanceMeters, type WorkSchedule } from '@/lib/attendanceSchedule'

type Props = { employeeId: string; employeeName: string; onDone?: () => void }

type BranchGeo = { id: string; name: string; latitude: number | null; longitude: number | null; checkin_radius_meters: number }
type TodayRow = { id: string; check_in: string | null; check_out: string | null; source: string } | null

type Step = 'idle' | 'locating' | 'camera' | 'preview' | 'uploading'

// Absen mandiri lewat HP — foto WAJIB diambil langsung dari kamera di dalam halaman ini
// (getUserMedia + canvas), tidak pernah melewati galeri/file picker OS, supaya tidak bisa kirim
// foto lama/hasil edit. Radius dicek di client sebelum kamera dibuka; RLS di database cuma
// membatasi SIAPA/TANGGAL/SUMBER (lihat migrasi attendances_mobile_checkin_*) — tidak bisa
// memverifikasi keaslian koordinat GPS yang dikirim browser, itu batas wajar untuk absen berbasis web.
export default function AbsenSekarang({ employeeId, employeeName, onDone }: Props) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [branch, setBranch] = useState<BranchGeo | null>(null)
  const [today, setToday] = useState<TodayRow>(null)
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [customCheckIn, setCustomCheckIn] = useState<string | null>(null)
  const [customCheckOut, setCustomCheckOut] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [step, setStep] = useState<Step>('idle')
  const [geo, setGeo] = useState<{ lat: number; lng: number; distance: number } | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => { fetchContext() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopCamera(), [])

  async function fetchContext() {
    setLoading(true)
    const { data: emp } = await supabase
      .from('employees')
      .select('department_id, custom_check_in_time, custom_check_out_time, branches(id, name, latitude, longitude, checkin_radius_meters)')
      .eq('id', employeeId).single()
    const b = (emp as unknown as { branches: BranchGeo | null } | null)?.branches ?? null
    setBranch(b)
    setCustomCheckIn((emp as { custom_check_in_time: string | null } | null)?.custom_check_in_time ?? null)
    setCustomCheckOut((emp as { custom_check_out_time: string | null } | null)?.custom_check_out_time ?? null)

    if (emp?.department_id) {
      const { data: sched } = await supabase.from('work_schedules')
        .select('check_in_time, check_out_time, detect_until, allow_overtime, applies_to_dept')
        .eq('applies_to_dept', emp.department_id)
      setSchedules((sched as WorkSchedule[]) || [])
    }

    const { data: att } = await supabase.from('attendances')
      .select('id, check_in, check_out, source')
      .eq('employee_id', employeeId).eq('date', todayLocalStr()).maybeSingle()
    setToday(att)
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  async function startCheckin() {
    if (!branch?.latitude || !branch?.longitude) {
      showMessage('error', 'Cabang Anda belum diaktifkan untuk absen HP. Hubungi HR.')
      return
    }
    if (!navigator.geolocation) {
      showMessage('error', 'HP/browser Anda tidak mendukung deteksi lokasi.')
      return
    }
    setStep('locating')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const distance = distanceMeters(pos.coords.latitude, pos.coords.longitude, branch.latitude!, branch.longitude!)
        const radius = branch.checkin_radius_meters || 150
        if (distance > radius) {
          showMessage('error', `Anda berada ${Math.round(distance)}m dari ${branch.name} — maksimal ${radius}m untuk bisa absen. Mendekat dulu ke lokasi cabang.`)
          setStep('idle')
          return
        }
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, distance })
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
          streamRef.current = stream
          setStep('camera')
          setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream }, 0)
        } catch {
          showMessage('error', 'Tidak bisa mengakses kamera. Pastikan izin kamera diaktifkan untuk browser ini.')
          setStep('idle')
        }
      },
      () => {
        showMessage('error', 'Gagal mengambil lokasi GPS. Pastikan izin lokasi diaktifkan, lalu coba lagi.')
        setStep('idle')
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  function takePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !geo) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Watermark bukti: nama, waktu, jarak dari cabang — menempel di gambarnya sendiri.
    const now = new Date()
    const label1 = employeeName
    const label2 = `${now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} ${now.toLocaleTimeString('id-ID')}`
    const label3 = `${Math.round(geo.distance)}m dari ${branch?.name ?? 'cabang'}`
    const barHeight = Math.max(64, canvas.height * 0.12)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight)
    ctx.fillStyle = '#fff'
    const fontSize = Math.max(14, Math.round(canvas.width / 28))
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillText(label1, 12, canvas.height - barHeight + fontSize + 4)
    ctx.font = `${fontSize * 0.8}px sans-serif`
    ctx.fillText(label2, 12, canvas.height - barHeight + fontSize * 2 + 6)
    ctx.fillText(label3, 12, canvas.height - barHeight + fontSize * 3 + 8)

    canvas.toBlob(blob => {
      if (!blob) return
      setCapturedBlob(blob)
      setCapturedUrl(URL.createObjectURL(blob))
      stopCamera()
      setStep('preview')
    }, 'image/jpeg', 0.85)
  }

  function retakePhoto() {
    setCapturedBlob(null)
    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedUrl(null)
    startCheckin()
  }

  function cancelFlow() {
    stopCamera()
    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedBlob(null)
    setCapturedUrl(null)
    setGeo(null)
    setStep('idle')
  }

  async function submitCheckin() {
    if (!capturedBlob || !geo) return
    setStep('uploading')

    const isCheckOut = !!today?.check_in && !today?.check_out
    const now = new Date()
    const nowIso = now.toISOString()
    const nowTimeStr = now.toTimeString().substring(0, 5)
    const dateStr = todayLocalStr()
    const filePath = `${employeeId}/${dateStr}-${isCheckOut ? 'out' : 'in'}-${Date.now()}.jpg`

    const { error: uploadErr } = await supabase.storage.from('attendance-photos').upload(filePath, capturedBlob, { contentType: 'image/jpeg' })
    if (uploadErr) {
      showMessage('error', 'Gagal mengunggah foto: ' + uploadErr.message)
      setStep('preview')
      return
    }
    const { data: pub } = supabase.storage.from('attendance-photos').getPublicUrl(filePath)
    const photoUrl = pub.publicUrl

    if (isCheckOut && today) {
      const sched = resolveSchedule(nowTimeStr, schedules, customCheckIn, customCheckOut)
      const overtimeHours = calcOvertimeHours(nowTimeStr, sched)
      const { error } = await supabase.from('attendances').update({
        check_out: nowIso,
        overtime_hours: overtimeHours,
        check_out_photo_url: photoUrl,
        check_out_lat: geo.lat,
        check_out_lng: geo.lng,
        check_out_distance_m: Math.round(geo.distance),
      }).eq('id', today.id)
      if (error) { showMessage('error', 'Gagal mencatat absen pulang: ' + error.message); setStep('preview'); return }
      showMessage('success', `Absen pulang tercatat jam ${now.toLocaleTimeString('id-ID')}.`)
    } else {
      const sched = resolveSchedule(nowTimeStr, schedules, customCheckIn, customCheckOut)
      const lateMinutes = calcLateMinutes(nowTimeStr, sched)
      const { error } = await supabase.from('attendances').insert({
        employee_id: employeeId,
        date: dateStr,
        check_in: nowIso,
        late_minutes: lateMinutes,
        overtime_hours: 0,
        status: 'present',
        source: 'mobile',
        notes: 'Absen HP',
        check_in_photo_url: photoUrl,
        check_in_lat: geo.lat,
        check_in_lng: geo.lng,
        check_in_distance_m: Math.round(geo.distance),
      })
      if (error) { showMessage('error', 'Gagal mencatat absen masuk: ' + error.message); setStep('preview'); return }
      showMessage('success', lateMinutes > 0
        ? `Absen masuk tercatat jam ${now.toLocaleTimeString('id-ID')} — telat ${lateMinutes} menit.`
        : `Absen masuk tercatat jam ${now.toLocaleTimeString('id-ID')}.`)
    }

    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedBlob(null)
    setCapturedUrl(null)
    setGeo(null)
    setStep('idle')
    await fetchContext()
    onDone?.()
  }

  if (loading) return null
  if (!branch?.latitude || !branch?.longitude) return null // belum diaktifkan untuk cabang ini — jangan tampilkan apa-apa, fingerprint tetap jalan seperti biasa

  const alreadyDoneToday = !!today?.check_in && !!today?.check_out
  const blockedByOtherSource = !!today && today.source !== 'mobile' && !alreadyDoneToday
  const nextAction: 'in' | 'out' | null = alreadyDoneToday || blockedByOtherSource ? null : today?.check_in ? 'out' : 'in'

  return (
    <div className="bg-white rounded-xl shadow-sm border-2 border-blue-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-slate-800">📍 Absen Sekarang (Test Drive)</h2>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">via HP</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Radius {branch.checkin_radius_meters}m dari {branch.name}. Foto wajib diambil langsung dari kamera saat itu juga.</p>

      {message && (
        <div className={`p-3 mb-3 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {alreadyDoneToday && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">✓ Absen masuk & pulang hari ini sudah lengkap.</p>
      )}
      {blockedByOtherSource && (
        <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Absen hari ini sudah tercatat lewat {today?.source === 'fingerprint' ? 'mesin fingerprint' : 'input manual'}.</p>
      )}

      {step === 'idle' && nextAction && (
        <button onClick={startCheckin}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition">
          {nextAction === 'in' ? '📸 Absen Masuk' : '📸 Absen Pulang'}
        </button>
      )}
      {step === 'locating' && (
        <div className="text-center py-4 text-sm text-slate-500">Mendeteksi lokasi Anda...</div>
      )}
      {step === 'camera' && (
        <div className="space-y-3">
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-slate-900 aspect-[3/4] object-cover" />
          <div className="flex gap-2">
            <button onClick={cancelFlow} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
            <button onClick={takePhoto} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">Ambil Foto</button>
          </div>
        </div>
      )}
      {(step === 'preview' || step === 'uploading') && capturedUrl && (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedUrl} alt="Pratinjau foto absen" className="w-full rounded-lg aspect-[3/4] object-cover" />
          <div className="flex gap-2">
            <button onClick={retakePhoto} disabled={step === 'uploading'} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Ambil Ulang</button>
            <button onClick={submitCheckin} disabled={step === 'uploading'} className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {step === 'uploading' ? 'Mengirim...' : 'Kirim Absen'}
            </button>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
