'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr, localDateStr } from '@/lib/date'
import { resolveSchedule, matchSchedule, calcLateMinutes, calcOvertimeHours, distanceMeters, type WorkSchedule } from '@/lib/attendanceSchedule'

type Props = { employeeId: string; employeeName: string; onDone?: () => void; mode?: 'gps' | 'qr' }

type BranchGeo = { id: string; name: string; latitude: number | null; longitude: number | null; checkin_radius_meters: number }
type TodayRow = { id: string; check_in: string | null; check_out: string | null; source: string } | null
type WorkScheduleRow = WorkSchedule & { id: string }

type Step = 'idle' | 'locating' | 'camera' | 'preview' | 'uploading' | 'confirm-swap' | 'pick-date'

// Absen mandiri lewat HP — foto WAJIB diambil langsung dari kamera di dalam halaman ini
// (getUserMedia + canvas), tidak pernah melewati galeri/file picker OS, supaya tidak bisa kirim
// foto lama/hasil edit. Radius dicek di client sebelum kamera dibuka; RLS di database cuma
// membatasi SIAPA/TANGGAL/SUMBER (lihat migrasi attendances_mobile_checkin_*) — tidak bisa
// memverifikasi keaslian koordinat GPS yang dikirim browser, itu batas wajar untuk absen berbasis web.
export default function AbsenSekarang({ employeeId, employeeName, onDone, mode = 'gps' }: Props) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [branch, setBranch] = useState<BranchGeo | null>(null)
  const [today, setToday] = useState<TodayRow>(null)
  const [schedules, setSchedules] = useState<WorkScheduleRow[]>([])
  const [customCheckIn, setCustomCheckIn] = useState<string | null>(null)
  const [customCheckOut, setCustomCheckOut] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // null = belum ada jadwal roster untuk hari ini (HR belum atur — biarkan absen jalan seperti biasa).
  // true/false = roster HARI INI (dibaca ulang tiap fetchContext, jadi kalau HR menggeser jadwal
  // libur ke tanggal lain, nilai ini otomatis ikut berubah tanpa perlu kode tambahan).
  const [todayIsDayOff, setTodayIsDayOff] = useState<boolean | null>(null)

  const [step, setStep] = useState<Step>('idle')
  const [geo, setGeo] = useState<{ lat: number; lng: number; distance: number } | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)

  // ── Tukar hari libur (masuk di hari libur -> pilih tanggal pengganti) ──
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [calendarLoading, setCalendarLoading] = useState(false)
  // tanggal (YYYY-MM-DD) -> nama rekan SATU CABANG yang libur di tanggal itu (dari RPC, bukan tabel langsung — employee biasa tidak punya akses baca roster orang lain)
  const [dayoffCalendar, setDayoffCalendar] = useState<Record<string, string>>({})
  const [ownFutureDayOff, setOwnFutureDayOff] = useState<Set<string>>(new Set())
  const [selectedReplacementDate, setSelectedReplacementDate] = useState<string | null>(null)
  const [swapSubmitting, setSwapSubmitting] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)

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
        .select('id, check_in_time, check_out_time, detect_until, allow_overtime, applies_to_dept')
        .eq('applies_to_dept', emp.department_id)
      setSchedules((sched as WorkScheduleRow[]) || [])
    }

    const { data: att } = await supabase.from('attendances')
      .select('id, check_in, check_out, source')
      .eq('employee_id', employeeId).eq('date', todayLocalStr()).maybeSingle()
    setToday(att)

    const { data: roster } = await supabase.from('employee_roster')
      .select('is_day_off')
      .eq('employee_id', employeeId).eq('date', todayLocalStr()).maybeSingle()
    setTodayIsDayOff(roster ? roster.is_day_off : null)

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

  function startCheckin() {
    if (todayIsDayOff && !today?.check_in) {
      setStep('confirm-swap')
      return
    }
    proceedToGeoCheckin()
  }

  // Dipisah dari startCheckin() supaya confirmSwap() bisa lanjut langsung ke GPS/kamera
  // begitu tukar libur berhasil, tanpa kena cek todayIsDayOff lagi (closure state di situ
  // masih nilai lama sesaat sebelum re-render, jadi cek ulang akan salah menganggap masih libur).
  async function proceedToGeoCheckin() {
    if (mode === 'qr') {
      // Absen QR: sudah pasti di cabang yang benar (dicek oleh halaman /absen-qr sebelum
      // komponen ini dirender), jadi tidak perlu GPS — langsung buka kamera.
      setGeo(null)
      await openCamera()
      return
    }

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
        await openCamera()
      },
      () => {
        showMessage('error', 'Gagal mengambil lokasi GPS. Pastikan izin lokasi diaktifkan, lalu coba lagi.')
        setStep('idle')
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      streamRef.current = stream
      setStep('camera')
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream }, 0)
    } catch {
      showMessage('error', 'Tidak bisa mengakses kamera. Pastikan izin kamera diaktifkan untuk browser ini.')
      setStep('idle')
    }
  }

  function takePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (mode === 'gps' && !geo) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Watermark bukti: nama, waktu, (jarak dari cabang kalau mode GPS) — menempel di gambarnya sendiri.
    const now = new Date()
    const label1 = employeeName
    const label2 = `${now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} ${now.toLocaleTimeString('id-ID')}`
    const label3 = geo ? `${Math.round(geo.distance)}m dari ${branch?.name ?? 'cabang'}` : `QR Absen — ${branch?.name ?? 'cabang'}`
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
    proceedToGeoCheckin()
  }

  function cancelFlow() {
    stopCamera()
    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedBlob(null)
    setCapturedUrl(null)
    setGeo(null)
    setStep('idle')
  }

  function cancelSwapFlow() {
    setSelectedReplacementDate(null)
    setSwapError(null)
    setStep('idle')
  }

  async function openDatePicker() {
    setStep('pick-date')
    setSelectedReplacementDate(null)
    setSwapError(null)
    await loadCalendarMonth(calendarMonth)
  }

  async function loadCalendarMonth(monthDate: Date) {
    setCalendarLoading(true)
    const from = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
    const to = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
    const fromStr = localDateStr(from)
    const toStr = localDateStr(to)

    // Jadwal libur rekan SATU CABANG SAJA — lewat RPC, karena employee biasa tidak punya
    // akses baca roster karyawan lain (lihat migrasi get_branch_dayoff_calendar_rpc).
    const [{ data: branchOff }, { data: ownOff }] = await Promise.all([
      supabase.rpc('get_branch_dayoff_calendar', { p_from: fromStr, p_to: toStr }),
      supabase.from('employee_roster').select('date')
        .eq('employee_id', employeeId).eq('is_day_off', true)
        .gte('date', fromStr).lte('date', toStr),
    ])

    const map: Record<string, string> = {}
    ;(branchOff as { off_date: string; employee_names: string }[] | null)?.forEach(r => { map[r.off_date] = r.employee_names })
    setDayoffCalendar(map)
    setOwnFutureDayOff(new Set((ownOff || []).map((r: { date: string }) => r.date)))
    setCalendarLoading(false)
  }

  function changeCalendarMonth(delta: number) {
    const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1)
    setCalendarMonth(next)
    setSelectedReplacementDate(null)
    loadCalendarMonth(next)
  }

  async function confirmSwap() {
    if (!selectedReplacementDate) return
    setSwapSubmitting(true)
    setSwapError(null)

    const nowTimeStr = new Date().toTimeString().substring(0, 5)
    const sched = matchSchedule(nowTimeStr, schedules)
    if (!sched) {
      setSwapError('Jadwal kerja departemen Anda belum diatur, hubungi HR dulu.')
      setSwapSubmitting(false)
      return
    }

    const { error } = await supabase.rpc('request_day_off_swap', {
      p_employee_id: employeeId,
      p_schedule_id: sched.id,
      p_replacement_date: selectedReplacementDate,
    })
    if (error) {
      setSwapError(error.message)
      setSwapSubmitting(false)
      return
    }

    setSwapSubmitting(false)
    setSelectedReplacementDate(null)
    await fetchContext()
    proceedToGeoCheckin()
  }

  async function submitCheckin() {
    if (!capturedBlob) return
    if (mode === 'gps' && !geo) return
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
        check_out_lat: geo?.lat ?? null,
        check_out_lng: geo?.lng ?? null,
        check_out_distance_m: geo ? Math.round(geo.distance) : null,
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
        source: mode === 'qr' ? 'qr' : 'mobile',
        notes: mode === 'qr' ? 'Absen QR' : 'Absen HP',
        check_in_photo_url: photoUrl,
        check_in_lat: geo?.lat ?? null,
        check_in_lng: geo?.lng ?? null,
        check_in_distance_m: geo ? Math.round(geo.distance) : null,
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
  // Mode GPS: kalau cabang belum diaktifkan (belum ada lat/lng), jangan tampilkan apa-apa —
  // fingerprint tetap jalan seperti biasa. Mode QR tidak butuh lat/lng sama sekali.
  if (mode === 'gps' && (!branch?.latitude || !branch?.longitude)) return null

  const ownSource = mode === 'qr' ? 'qr' : 'mobile'
  const alreadyDoneToday = !!today?.check_in && !!today?.check_out
  const blockedByOtherSource = !!today && today.source !== ownSource && !alreadyDoneToday
  const isDayOffToday = !!todayIsDayOff && !today?.check_in
  const nextAction: 'in' | 'out' | null = alreadyDoneToday || blockedByOtherSource ? null : today?.check_in ? 'out' : 'in'

  // Kalender bulan yang sedang dilihat, dirender jadi grid Minggu—Sabtu.
  const calYear = calendarMonth.getFullYear()
  const calMonthIdx = calendarMonth.getMonth()
  const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate()
  const firstWeekday = new Date(calYear, calMonthIdx, 1).getDay()
  const calCells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const now0 = new Date()
  const atOrBeforeCurrentMonth = calYear < now0.getFullYear() || (calYear === now0.getFullYear() && calMonthIdx <= now0.getMonth())

  return (
    <div className="bg-white rounded-xl shadow-sm border-2 border-blue-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-slate-800">{mode === 'qr' ? '📷 Absen QR' : '📍 Absen Sekarang'}</h2>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{mode === 'qr' ? `Cabang ${branch?.name ?? ''}` : 'via HP'}</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        {mode === 'qr'
          ? 'Foto wajib diambil langsung dari kamera saat itu juga.'
          : `Radius ${branch?.checkin_radius_meters}m dari ${branch?.name}. Foto wajib diambil langsung dari kamera saat itu juga.`}
      </p>

      {message && (
        <div className={`p-3 mb-3 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {alreadyDoneToday && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">✓ Absen masuk & pulang hari ini sudah lengkap.</p>
      )}
      {blockedByOtherSource && (
        <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Absen hari ini sudah tercatat lewat {
            today?.source === 'fingerprint' ? 'mesin fingerprint'
            : today?.source === 'manual' ? 'input manual'
            : today?.source === 'qr' ? 'Absen QR'
            : 'Absen HP'
          }.
        </p>
      )}
      {isDayOffToday && step === 'idle' && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          ℹ️ Hari ini terjadwal <strong>LIBUR</strong> menurut jadwal Anda. Kalau tetap absen masuk, Anda akan diminta memilih tanggal pengganti.
        </p>
      )}

      {step === 'idle' && nextAction && (
        <button onClick={startCheckin}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition">
          {nextAction === 'in' ? '📸 Absen Masuk' : '📸 Absen Pulang'}
        </button>
      )}
      {step === 'confirm-swap' && (
        <div className="space-y-3">
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            🛑 Hari ini terjadwal <strong>LIBUR</strong> sesuai jadwal Anda. Yakin ingin tetap masuk kerja hari ini? Kalau lanjut, Anda perlu pilih tanggal pengganti untuk libur Anda.
          </p>
          <div className="flex gap-2">
            <button onClick={cancelSwapFlow} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal, Tetap Libur</button>
            <button onClick={openDatePicker} className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold">Ya, Saya Masuk</button>
          </div>
        </div>
      )}
      {step === 'pick-date' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Pilih tanggal pengganti untuk libur Anda hari ini. Tanggal dengan tanda menunjukkan rekan satu cabang yang sudah libur di hari itu.</p>
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => changeCalendarMonth(-1)} disabled={atOrBeforeCurrentMonth}
              className="px-2 py-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">◀</button>
            <span className="text-sm font-semibold text-slate-700">
              {calendarMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
            </span>
            <button type="button" onClick={() => changeCalendarMonth(1)} className="px-2 py-1 text-slate-500 hover:text-slate-800">▶</button>
          </div>
          {calendarLoading ? (
            <div className="text-center py-6 text-sm text-slate-400">Memuat kalender...</div>
          ) : (
            <div className="grid grid-cols-7 gap-1 text-center">
              {['M','S','S','R','K','J','S'].map((d, i) => (
                <div key={i} className="text-[10px] font-semibold text-slate-400 py-1">{d}</div>
              ))}
              {calCells.map((day, i) => {
                if (day === null) return <div key={`b${i}`} />
                const dateStr = localDateStr(new Date(calYear, calMonthIdx, day))
                const isPast = dateStr <= todayLocalStr()
                const isOwnOff = ownFutureDayOff.has(dateStr)
                const colleagueNames = dayoffCalendar[dateStr]
                const isSelected = selectedReplacementDate === dateStr
                const disabled = isPast || isOwnOff
                return (
                  <button key={dateStr} type="button" disabled={disabled}
                    onClick={() => setSelectedReplacementDate(dateStr)}
                    title={colleagueNames ? `Libur: ${colleagueNames}` : undefined}
                    className={`relative aspect-square rounded-lg text-xs flex items-center justify-center transition
                      ${disabled ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-blue-50 text-slate-700'}
                      ${isSelected ? 'bg-blue-600 text-white hover:bg-blue-600 font-semibold' : ''}
                      ${isOwnOff ? 'bg-slate-100' : ''}`}>
                    {day}
                    {colleagueNames && !isSelected && (
                      <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {selectedReplacementDate && (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Tanggal pengganti: <strong>{new Date(selectedReplacementDate + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long' })}</strong>
              {dayoffCalendar[selectedReplacementDate] ? <> — rekan yang sudah libur: {dayoffCalendar[selectedReplacementDate]}</> : ' — belum ada rekan cabang yang libur di tanggal ini'}
            </p>
          )}
          {swapError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{swapError}</p>}
          <div className="flex gap-2">
            <button onClick={cancelSwapFlow} disabled={swapSubmitting} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Batal</button>
            <button onClick={confirmSwap} disabled={!selectedReplacementDate || swapSubmitting}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {swapSubmitting ? 'Menyimpan...' : 'Pilih & Lanjut Absen'}
            </button>
          </div>
        </div>
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
