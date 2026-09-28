'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'
import { ANNUAL_LEAVE_QUOTA_DAYS, MIN_TENURE_DAYS_FOR_ANNUAL_LEAVE, tenureDays, isEligibleForAnnualLeave, getCurrentLeaveYear, toDateStr } from '@/lib/leaveQuota'
import { chargeableLateMinutes } from '@/lib/lateTolerance'
import { getUpcomingRosterPeriod, rosterPeriodLabel } from '@/lib/rosterPeriod'
import { localDateStr } from '@/lib/date'
import { fetchAlphaAlerts as fetchAlphaAlertsShared, type AlphaAlertItem } from '@/lib/alphaDetection'
import { fetchIncompleteCheckouts as fetchIncompleteCheckoutsShared, type IncompleteCheckoutItem } from '@/lib/checkoutClarification'
import { fetchOvertimeClaimAlerts as fetchOvertimeClaimAlertsShared, type OvertimeClaimAlertItem } from '@/lib/overtimeClaim'

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const DAYS_AHEAD = 30

const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

type Payroll = {
  period_month: number
  period_year: number
  base_salary: number
  position_allowance: number
  meal_allowance: number
  special_allowance: number
  overtime_total: number
  kpi_bonus: number
  conditional_bonus: number
  extra_bonus_total: number | null
  loyalitas_auto_release: number | null
  late_deduction: number
  kasbon_deduction: number
  loyalitas_deduction: number
  inventory_loss_deduction: number
  cashier_loss_deduction: number
  absent_deduction: number | null
  gross_total: number
  net_total: number
  status: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:            { label: 'Draft',            color: 'bg-slate-100 text-slate-600' },
  pending_approval: { label: 'Menunggu Approval', color: 'bg-yellow-100 text-yellow-700' },
  approved:         { label: 'Disetujui',         color: 'bg-blue-100 text-blue-700' },
  paid:             { label: 'Lunas',             color: 'bg-green-100 text-green-700' },
}

export default function PortalDashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const today = new Date()

  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')

  const [payroll, setPayroll] = useState<Payroll | null>(null)
  const [attSummary, setAttSummary] = useState({ hadir: 0, telat: 0, izin: 0, sakit: 0, alpha: 0 })
  const [upcomingOff, setUpcomingOff] = useState<string[]>([])
  const [leaveInfo, setLeaveInfo] = useState<{ joinDate: string | null; usedDays: number }>({ joinDate: null, usedDays: 0 })
  const [kasbonSaldo, setKasbonSaldo] = useState(0)
  const [estPotongan, setEstPotongan] = useState({ keterlambatan: 0, kasbon: 0 })
  const [quotaLibur, setQuotaLibur] = useState<{ submitted: number; draft: number; label: string; daysUntil: number } | null>(null)

  // Hari yang otomatis ditandai Alpha karena tidak ada absen sama sekali (lihat
  // lib/alphaDetection.ts) -- karyawan bisa klarifikasi di sini kalau sebenarnya sakit/izin,
  // karena potongan Alpha jauh lebih besar dari sakit/izin biasa. Batas waktu klarifikasi H+2
  // dari tanggal Alpha (ditegakkan di database, lihat computed "actionable"/"deadline").
  const [alphaAlerts, setAlphaAlerts] = useState<AlphaAlertItem[]>([])
  const [clarifyModal, setClarifyModal] = useState<AlphaAlertItem | null>(null)
  const [clarifyType, setClarifyType] = useState<'sick' | 'sick_doc' | 'permission' | 'lupa_absen'>('sick')
  const [clarifyReason, setClarifyReason] = useState('')
  const [clarifyFile, setClarifyFile] = useState<File | null>(null)
  const [clarifyError, setClarifyError] = useState('')
  const [clarifySubmitting, setClarifySubmitting] = useState(false)

  // "Lupa Absen Pulang" -- sudah absen masuk tapi belum absen pulang (lihat
  // lib/checkoutClarification.ts). Beda dari Alpha, jadi state & modal terpisah.
  const [incompleteCheckouts, setIncompleteCheckouts] = useState<IncompleteCheckoutItem[]>([])
  const [checkoutModal, setCheckoutModal] = useState<IncompleteCheckoutItem | null>(null)
  const [checkoutReason, setCheckoutReason] = useState('')
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false)

  // Klaim Lembur -- lembur terdeteksi otomatis TIDAK langsung terhitung, wajib upload foto
  // kertas lembur dalam 3 hari untuk disetujui Owner (lihat lib/overtimeClaim.ts).
  const [overtimeAlerts, setOvertimeAlerts] = useState<OvertimeClaimAlertItem[]>([])
  const [overtimeModal, setOvertimeModal] = useState<OvertimeClaimAlertItem | null>(null)
  const [overtimeFile, setOvertimeFile] = useState<File | null>(null)
  const [overtimeError, setOvertimeError] = useState('')
  const [overtimeSubmitting, setOvertimeSubmitting] = useState(false)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users').select('role, employee_id, employees(full_name, join_date)').eq('id', user.id).single()
    if (!userData) { setLoading(false); return }

    // Preview Tampilan Karyawan: sama seperti halaman Portal Saya lain, tampilkan data contoh
    // nyata (bukan akun admin sendiri) supaya Owner/HR bisa cek tampilan karyawan biasa.
    const previewing = ['owner', 'hr', 'finance'].includes(userData.role) && isPreviewModeClient()
    const emp = previewing
      ? (await supabase.from('employees').select('full_name, join_date').eq('id', PREVIEW_EMPLOYEE_ID).single()).data
      : (userData as any).employees
    const effectiveId = previewing ? PREVIEW_EMPLOYEE_ID : userData.employee_id
    if (!effectiveId) { setLoading(false); return }

    setMyEmployeeId(effectiveId)
    setMyName(emp?.full_name || '')

    await Promise.all([
      fetchLatestPayroll(effectiveId),
      fetchAttendanceSummary(effectiveId),
      fetchUpcomingOff(effectiveId),
      fetchKasbonSaldo(effectiveId),
      fetchEstimasiPotongan(effectiveId),
      fetchQuotaLibur(effectiveId),
      fetchAlphaAlerts(effectiveId),
      fetchIncompleteCheckouts(effectiveId),
      fetchOvertimeAlerts(effectiveId),
      emp?.join_date ? fetchLeaveInfo(effectiveId, emp.join_date) : Promise.resolve(),
    ])
    setLoading(false)
  }

  // Slip gaji TERBARU yang tersedia, apapun periodenya -- bulan berjalan belum tentu sudah
  // dibuatkan slipnya oleh Finance, jadi lebih jujur tampilkan yang terakhir ada (dengan label
  // periodenya jelas) daripada berasumsi "bulan ini" pasti sudah ada datanya.
  async function fetchLatestPayroll(employeeId: string) {
    const { data } = await supabase
      .from('payrolls')
      .select(`period_month, period_year, base_salary, position_allowance, meal_allowance, special_allowance,
        overtime_total, kpi_bonus, conditional_bonus, extra_bonus_total, loyalitas_auto_release,
        late_deduction, kasbon_deduction, loyalitas_deduction, inventory_loss_deduction, cashier_loss_deduction,
        absent_deduction, gross_total, net_total, status`)
      .eq('employee_id', employeeId)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
      .limit(1)
      .maybeSingle()
    setPayroll((data as unknown as Payroll) || null)
  }

  async function fetchAttendanceSummary(employeeId: string) {
    const y = today.getFullYear(), m = today.getMonth() + 1
    const pad = (n: number) => String(n).padStart(2, '0')
    const firstDay = `${y}-${pad(m)}-01`
    const lastDay = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`
    const { data } = await supabase.from('attendances').select('status').eq('employee_id', employeeId).gte('date', firstDay).lte('date', lastDay)
    const rows = data || []
    setAttSummary({
      hadir: rows.filter(r => r.status === 'present').length,
      telat: 0, // dihitung terpisah di bawah dari late_minutes, bukan status
      izin: rows.filter(r => r.status === 'permission').length,
      sakit: rows.filter(r => r.status === 'sick' || r.status === 'sick_doc').length,
      alpha: rows.filter(r => r.status === 'absent').length,
    })
    const { data: lateRows } = await supabase.from('attendances').select('id').eq('employee_id', employeeId).gte('date', firstDay).lte('date', lastDay).gt('late_minutes', 0)
    setAttSummary(prev => ({ ...prev, telat: lateRows?.length || 0 }))
  }

  async function fetchUpcomingOff(employeeId: string) {
    const start = new Date()
    const end = new Date()
    end.setDate(end.getDate() + DAYS_AHEAD)
    const { data } = await supabase.from('employee_roster')
      .select('date')
      .eq('employee_id', employeeId).eq('is_day_off', true)
      .gte('date', toDateStr(start)).lte('date', toDateStr(end))
      .order('date')
    setUpcomingOff((data || []).map((r: any) => r.date))
  }

  async function fetchLeaveInfo(employeeId: string, joinDate: string) {
    const { start, end } = getCurrentLeaveYear(joinDate)
    const { data: reqs } = await supabase
      .from('leave_requests')
      .select('total_days')
      .eq('employee_id', employeeId)
      .eq('leave_type', 'annual')
      .in('status', ['pending', 'approved'])
      .gte('start_date', toDateStr(start))
      .lte('start_date', toDateStr(end))
    const usedDays = (reqs || []).reduce((s, r) => s + Number(r.total_days), 0)
    setLeaveInfo({ joinDate, usedDays })
  }

  // Perkiraan potongan BULAN BERJALAN (bukan bulan lalu yang sudah final di slip gaji) --
  // cuma komponen yang bisa dihitung akurat & sederhana tanpa duplikasi logika kompleks
  // Penggajian Bulanan (kelompok eskalasi izin/alpha/sakit sengaja tidak ditiru di sini, biar
  // tidak berisiko beda hasil dengan slip gaji asli): Keterlambatan (rumus sama persis dengan
  // Slip Gaji, termasuk toleransi QR) + cicilan Kasbon yang sudah dijadwalkan Finance untuk
  // bulan ini (dari kasbon_deductions, bukan re-hitung manual).
  async function fetchEstimasiPotongan(employeeId: string) {
    const y = today.getFullYear(), m = today.getMonth() + 1
    const pad = (n: number) => String(n).padStart(2, '0')
    const firstDay = `${y}-${pad(m)}-01`
    const lastDay = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`

    const [{ data: lateDef }, { data: atts }, { data: kasbonDed }] = await Promise.all([
      supabase.from('salary_defaults').select('late_penalty_per_minute').limit(1).maybeSingle(),
      supabase.from('attendances').select('late_minutes, source').eq('employee_id', employeeId).gte('date', firstDay).lte('date', lastDay).gt('late_minutes', 0),
      supabase.from('kasbon_deductions').select('amount').eq('employee_id', employeeId).eq('deduction_month', m).eq('deduction_year', y).eq('status', 'pending'),
    ])
    const rate = Number(lateDef?.late_penalty_per_minute ?? 0)
    const keterlambatan = (atts || []).reduce((s, a: any) => s + chargeableLateMinutes(Number(a.late_minutes), a.source) * rate, 0)
    const kasbon = (kasbonDed || []).reduce((s, d: any) => s + Number(d.amount), 0)
    setEstPotongan({ keterlambatan, kasbon })
  }

  // Jatah libur 4 tanggal untuk periode roster BERIKUTNYA -- selalu diperingatkan sampai
  // terpenuhi. RPC mengembalikan semua karyawan kalau yang login Owner (preview), jadi difilter.
  async function fetchQuotaLibur(employeeId: string) {
    const period = getUpcomingRosterPeriod()
    const { data } = await supabase.rpc('get_dayoff_quota_status', { p_period_start: localDateStr(period.start) })
    const mine = ((data || []) as { employee_id: string; approved_count: number; pending_count: number; draft_count: number }[])
      .find(r => r.employee_id === employeeId)
    if (!mine) { setQuotaLibur(null); return }
    setQuotaLibur({
      submitted: mine.approved_count + mine.pending_count, draft: mine.draft_count,
      label: rosterPeriodLabel(period.start, period.end),
      daysUntil: Math.ceil((period.start.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000),
    })
  }

  // Hari-hari yang otomatis ditandai Alpha (tidak ada absen sama sekali) yang masih berstatus
  // absent -- kalau sudah pernah diklarifikasi & di-ACC HR, statusnya sudah berubah jadi
  // sakit/izin dan otomatis tidak muncul lagi di sini.
  async function fetchAlphaAlerts(employeeId: string) {
    setAlphaAlerts(await fetchAlphaAlertsShared(supabase, employeeId))
  }

  function openClarifyModal(alert: AlphaAlertItem) {
    setClarifyModal(alert)
    setClarifyType('sick')
    setClarifyReason('')
    setClarifyFile(null)
    setClarifyError('')
  }

  async function fetchIncompleteCheckouts(employeeId: string) {
    setIncompleteCheckouts(await fetchIncompleteCheckoutsShared(supabase, employeeId))
  }

  function openCheckoutModal(item: IncompleteCheckoutItem) {
    setCheckoutModal(item)
    setCheckoutReason('')
    setCheckoutError('')
  }

  async function submitCheckoutClarification() {
    if (!checkoutModal) return
    if (!checkoutReason.trim()) { setCheckoutError('Keterangan wajib diisi -- jelaskan alasannya.'); return }
    setCheckoutSubmitting(true)
    setCheckoutError('')
    const { error } = await supabase.rpc('submit_checkout_clarification', {
      p_attendance_id: checkoutModal.attendanceId,
      p_reason: checkoutReason.trim(),
    })
    if (error) {
      setCheckoutError(error.message)
    } else {
      setCheckoutModal(null)
      await fetchIncompleteCheckouts(myEmployeeId)
    }
    setCheckoutSubmitting(false)
  }

  async function fetchOvertimeAlerts(employeeId: string) {
    setOvertimeAlerts(await fetchOvertimeClaimAlertsShared(supabase, employeeId))
  }

  function openOvertimeModal(item: OvertimeClaimAlertItem) {
    setOvertimeModal(item)
    setOvertimeFile(null)
    setOvertimeError('')
  }

  async function submitOvertimeClaim() {
    if (!overtimeModal) return
    if (!overtimeFile) { setOvertimeError('Foto kertas lembur wajib diunggah.'); return }
    setOvertimeSubmitting(true)
    setOvertimeError('')

    const fileExt = overtimeFile.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
    const filePath = `lembur_klaim/${fileName}`
    const { error: upErr } = await supabase.storage.from('documents').upload(filePath, overtimeFile)
    if (upErr) { setOvertimeError('Gagal unggah foto: ' + upErr.message); setOvertimeSubmitting(false); return }
    const photoUrl = supabase.storage.from('documents').getPublicUrl(filePath).data.publicUrl

    const { error } = await supabase.rpc('submit_overtime_claim', {
      p_attendance_id: overtimeModal.attendanceId,
      p_photo_url: photoUrl,
    })
    if (error) {
      setOvertimeError(error.message)
    } else {
      setOvertimeModal(null)
      await fetchOvertimeAlerts(myEmployeeId)
    }
    setOvertimeSubmitting(false)
  }

  async function submitClarification() {
    if (!clarifyModal) return
    if (!clarifyReason.trim()) { setClarifyError('Keterangan wajib diisi -- jelaskan alasannya.'); return }
    if (clarifyType === 'sick_doc' && !clarifyFile) { setClarifyError('Sakit dengan surat dokter wajib lampirkan foto/scan surat.'); return }
    setClarifySubmitting(true)
    setClarifyError('')

    let documentUrl: string | null = null
    if (clarifyFile) {
      const fileExt = clarifyFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `alpha_klarifikasi/${fileName}`
      const { error: upErr } = await supabase.storage.from('documents').upload(filePath, clarifyFile)
      if (upErr) { setClarifyError('Gagal unggah bukti: ' + upErr.message); setClarifySubmitting(false); return }
      documentUrl = supabase.storage.from('documents').getPublicUrl(filePath).data.publicUrl
    }

    const { error } = await supabase.rpc('submit_alpha_clarification', {
      p_attendance_id: clarifyModal.attendanceId,
      p_requested_type: clarifyType,
      p_reason: clarifyReason.trim(),
      p_document_url: documentUrl,
    })
    if (error) {
      setClarifyError(error.message)
    } else {
      setClarifyModal(null)
      await fetchAlphaAlerts(myEmployeeId)
    }
    setClarifySubmitting(false)
  }

  // Sisa saldo kasbon aktif -- rumus sama persis dengan yang dipakai halaman Kasbon (Tab
  // Limit): jumlah (amount_requested - total_deducted) dari kasbon_requests yang sudah
  // disetujui & dicairkan, bukan dari kasbon_limits yang sudah tidak sinkron.
  async function fetchKasbonSaldo(employeeId: string) {
    const { data } = await supabase.from('kasbon_requests')
      .select('amount_requested, total_deducted')
      .eq('employee_id', employeeId).eq('status', 'approved').not('disbursed_at', 'is', null)
    const saldo = (data || []).reduce((s, r: any) => s + Math.max(0, Number(r.amount_requested) - Number(r.total_deducted)), 0)
    setKasbonSaldo(saldo)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat dashboard...</div>

  const totalPotongan = payroll
    ? Number(payroll.late_deduction || 0) + Number(payroll.kasbon_deduction || 0) + Number(payroll.loyalitas_deduction || 0)
      + Number(payroll.inventory_loss_deduction || 0) + Number(payroll.cashier_loss_deduction || 0) + Number(payroll.absent_deduction || 0)
    : 0
  // Sengaja tidak menghitung bonus (kpi_bonus, conditional_bonus, extra_bonus_total,
  // loyalitas_auto_release) di sini -- Owner minta dashboard tidak menampilkan komponen bonus
  // sama sekali, walau nominalnya sudah benar-benar dibayarkan di slip aslinya.
  const totalLembur = payroll ? Number(payroll.overtime_total || 0) : 0
  const totalGajiTetap = payroll
    ? Number(payroll.base_salary || 0) + Number(payroll.position_allowance || 0) + Number(payroll.meal_allowance || 0)
      + Number(payroll.special_allowance || 0) + totalLembur
    : 0

  const eligible = leaveInfo.joinDate ? isEligibleForAnnualLeave(leaveInfo.joinDate) : false
  const remainingLeave = Math.max(0, ANNUAL_LEAVE_QUOTA_DAYS - leaveInfo.usedDays)

  return (
    <>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Halo, {myName}! 👋</h1>
        <p className="text-sm text-slate-500">{today.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} — ringkasan singkat untuk Anda.</p>
      </div>

      {alphaAlerts.length > 0 && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4">
          <p className="text-base font-bold text-red-800">🔴 Ada {alphaAlerts.length} hari tidak absen — tercatat ALPHA (potongan gaji BESAR)</p>
          <p className="text-sm text-red-700 mt-1">Kalau ini karena sakit atau izin, segera klarifikasi di bawah ini supaya tidak salah potong gaji Anda.</p>
          <div className="mt-3 space-y-2">
            {alphaAlerts.map(a => {
              const deadlineLabel = new Date(a.deadline + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })
              const isPending = a.clarification?.status === 'pending'
              return (
                <div key={a.attendanceId} className="bg-white border border-red-200 rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {new Date(a.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                    {isPending ? (
                      <span className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-medium">⏳ Menunggu review HR</span>
                    ) : a.actionable ? (
                      <button onClick={() => openClarifyModal(a)} className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold">
                        {a.clarification ? 'Klarifikasi Lagi' : 'Klarifikasi Sekarang'}
                      </button>
                    ) : (
                      <span className="text-xs px-3 py-1.5 bg-slate-200 text-slate-600 rounded-lg font-medium">🔒 Batas waktu lewat</span>
                    )}
                  </div>
                  {!isPending && a.clarification?.status === 'rejected' && (
                    <p className="text-xs text-slate-500 mt-1.5">Klarifikasi sebelumnya ditolak{a.clarification.rejection_note ? `: ${a.clarification.rejection_note}` : ''}.</p>
                  )}
                  {a.actionable && !isPending && (
                    <p className="text-xs text-red-600 font-medium mt-1.5">⏰ Batas waktu klarifikasi: paling lambat {deadlineLabel} (2 hari setelah tanggal Alpha)</p>
                  )}
                  {!a.actionable && !isPending && (
                    <p className="text-xs text-slate-400 mt-1.5">Sudah lewat dari batas waktu {deadlineLabel} — status Alpha tidak bisa diubah lagi.</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {incompleteCheckouts.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-4">
          <p className="text-base font-bold text-amber-800">🟡 Ada {incompleteCheckouts.length} hari absen pulang belum lengkap</p>
          <p className="text-sm text-amber-700 mt-1">Sudah absen masuk, tapi belum absen pulang. Kalau memang lupa scan pulang, ajukan klarifikasi di bawah ini (kena denda administratif Rp5.000 per kejadian, maksimal 4x per periode).</p>
          <div className="mt-3 space-y-2">
            {incompleteCheckouts.map(c => {
              const isPending = c.clarification?.status === 'pending'
              return (
                <div key={c.attendanceId} className="bg-white border border-amber-200 rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {new Date(c.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                      <span className="text-slate-400 font-normal"> — masuk {new Date(c.checkIn).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                    </p>
                    {isPending ? (
                      <span className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-medium">⏳ Menunggu review HR</span>
                    ) : c.actionable ? (
                      <button onClick={() => openCheckoutModal(c)} className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold">
                        {c.clarification ? 'Klarifikasi Lagi' : 'Klarifikasi Lupa Pulang'}
                      </button>
                    ) : null}
                  </div>
                  {!isPending && c.clarification?.status === 'rejected' && (
                    <p className="text-xs text-slate-500 mt-1.5">Klarifikasi sebelumnya ditolak{c.clarification.rejection_note ? `: ${c.clarification.rejection_note}` : ''}.</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {overtimeAlerts.filter(a => a.actionable || a.expired).length > 0 && (
        <div className="bg-purple-50 border-2 border-purple-400 rounded-xl p-4">
          <p className="text-base font-bold text-purple-800">🕗 Lembur terdeteksi — wajib klaim + foto kertas lembur dalam 3 hari</p>
          <p className="text-sm text-purple-700 mt-1">Lembur TIDAK otomatis dibayar. Upload foto kertas lembur untuk disetujui Owner, atau hangus kalau lewat batas waktu.</p>
          <div className="mt-3 space-y-2">
            {overtimeAlerts.filter(a => a.actionable || a.expired).map(a => {
              const deadlineLabel = new Date(a.deadline + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })
              const isPending = a.claim?.status === 'pending'
              return (
                <div key={a.attendanceId} className="bg-white border border-purple-200 rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {new Date(a.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                      <span className="text-slate-400 font-normal"> — {a.hoursDetected} jam terdeteksi</span>
                    </p>
                    {isPending ? (
                      <span className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-medium">⏳ Menunggu review Owner</span>
                    ) : a.actionable ? (
                      <button onClick={() => openOvertimeModal(a)} className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold">
                        {a.claim ? 'Ajukan Lagi' : 'Upload Foto Lembur'}
                      </button>
                    ) : (
                      <span className="text-xs px-3 py-1.5 bg-slate-200 text-slate-600 rounded-lg font-medium">🔒 Hangus, lewat batas</span>
                    )}
                  </div>
                  {!isPending && a.claim?.status === 'rejected' && (
                    <p className="text-xs text-slate-500 mt-1.5">Klaim sebelumnya ditolak{a.claim.rejection_note ? `: ${a.claim.rejection_note}` : ''}.</p>
                  )}
                  {a.actionable && !isPending && (
                    <p className="text-xs text-purple-600 font-medium mt-1.5">⏰ Batas klaim: paling lambat {deadlineLabel} (3 hari setelah tanggal lembur)</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {quotaLibur && quotaLibur.submitted < 4 && (
        <Link href="/portal/ajukan-libur" className="block bg-amber-50 border-2 border-amber-400 rounded-xl p-4 hover:bg-amber-100 transition">
          <p className="text-base font-bold text-amber-800">⚠️ Jatah libur Anda belum diambil!</p>
          <p className="text-sm text-amber-700 mt-1">
            Baru <strong>{quotaLibur.submitted} dari 4</strong> tanggal libur terkirim untuk periode {quotaLibur.label}
            {quotaLibur.draft > 0 ? ` (${quotaLibur.draft} masih draf, belum dikirim ke HR)` : ''}.
            {quotaLibur.daysUntil > 0 ? ` Periode mulai ${quotaLibur.daysUntil} hari lagi.` : ''}
          </p>
          <p className="text-sm font-semibold text-amber-800 mt-2">Ketuk di sini untuk memilih tanggal libur →</p>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Ringkasan Gaji */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-slate-700">💰 Gaji Terakhir</h2>
            {payroll && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_CONFIG[payroll.status]?.color ?? 'bg-slate-100 text-slate-600'}`}>
                {STATUS_CONFIG[payroll.status]?.label ?? payroll.status}
              </span>
            )}
          </div>
          {!payroll ? (
            <p className="text-sm text-slate-400 italic py-4">Belum ada slip gaji tercatat.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-2">Periode {MONTHS[payroll.period_month - 1]} {payroll.period_year}</p>
              <p className="text-3xl font-bold text-blue-600">{fmtRp(payroll.net_total)}</p>
              <p className="text-xs text-slate-400 mt-0.5">Gaji bersih diterima</p>
              <div className="flex justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
                <span className="text-emerald-600">+ {fmtRp(totalLembur)} lembur</span>
                <span className="text-red-500">- {fmtRp(totalPotongan)} potongan</span>
              </div>
            </>
          )}
          <Link href="/portal/slip-gaji" className="block mt-3 text-center py-2 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 text-xs font-medium rounded-lg border border-slate-200 hover:border-blue-200 transition">
            Lihat Semua Slip Gaji →
          </Link>
        </div>

        {/* Rincian Pendapatan (Gaji Pokok, Tunjangan, dst) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-1">💵 Rincian Pendapatan</h2>
          {!payroll ? (
            <p className="text-sm text-slate-400 italic py-4">Belum ada data.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-2">Periode {MONTHS[payroll.period_month - 1]} {payroll.period_year}</p>
              <p className="text-3xl font-bold text-emerald-600">{fmtRp(totalGajiTetap)}</p>
              <p className="text-xs text-slate-400 mt-0.5">Gaji pokok, tunjangan &amp; lembur (di luar bonus)</p>
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-600">
                <div className="flex justify-between"><span>Gaji Pokok</span><span className="font-medium">{fmtRp(Number(payroll.base_salary))}</span></div>
                {Number(payroll.position_allowance) > 0 && <div className="flex justify-between"><span>Tunjangan Jabatan</span><span className="font-medium">{fmtRp(Number(payroll.position_allowance))}</span></div>}
                {Number(payroll.meal_allowance) > 0 && <div className="flex justify-between"><span>Tunjangan Tetap</span><span className="font-medium">{fmtRp(Number(payroll.meal_allowance))}</span></div>}
                {Number(payroll.special_allowance) > 0 && <div className="flex justify-between"><span>Tunjangan Khusus</span><span className="font-medium">{fmtRp(Number(payroll.special_allowance))}</span></div>}
                {Number(payroll.overtime_total) > 0 && <div className="flex justify-between"><span>Upah Lembur</span><span className="font-medium text-emerald-600">+{fmtRp(Number(payroll.overtime_total))}</span></div>}
              </div>
            </>
          )}
        </div>

        {/* Perkiraan Potongan Bulan Berjalan (bukan potongan bulan lalu yang sudah final) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-1">📉 Perkiraan Potongan Bulan Ini</h2>
          <p className="text-xs text-slate-400 mb-2">Periode {MONTHS[today.getMonth()]} {today.getFullYear()}, berjalan</p>
          <p className="text-3xl font-bold text-red-500">{fmtRp(estPotongan.keterlambatan + estPotongan.kasbon)}</p>
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-600">
            {estPotongan.keterlambatan > 0 && <div className="flex justify-between"><span>Keterlambatan</span><span className="text-red-500">-{fmtRp(estPotongan.keterlambatan)}</span></div>}
            {estPotongan.kasbon > 0 && <div className="flex justify-between"><span>Cicilan Kasbon</span><span className="text-red-500">-{fmtRp(estPotongan.kasbon)}</span></div>}
            {estPotongan.keterlambatan === 0 && estPotongan.kasbon === 0 && <p className="text-slate-300 italic">Belum ada potongan tercatat bulan ini 🎉</p>}
          </div>
          <p className="text-[10px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
            Perkiraan sementara, berjalan sepanjang bulan. Potongan lain (sakit/izin/alpha, kehilangan barang, dll) baru dihitung final saat slip gaji diproses Finance.
          </p>
        </div>

        {/* Ringkasan Absensi Bulan Ini */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3">📅 Absensi Bulan Ini</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-green-50 rounded-lg py-2">
              <p className="text-lg font-bold text-green-700">{attSummary.hadir}</p>
              <p className="text-[10px] text-green-600 uppercase">Hadir</p>
            </div>
            <div className="bg-orange-50 rounded-lg py-2">
              <p className="text-lg font-bold text-orange-700">{attSummary.telat}</p>
              <p className="text-[10px] text-orange-600 uppercase">Telat</p>
            </div>
            <div className="bg-red-50 rounded-lg py-2">
              <p className="text-lg font-bold text-red-700">{attSummary.alpha}</p>
              <p className="text-[10px] text-red-600 uppercase">Alpha</p>
            </div>
            <div className="bg-purple-50 rounded-lg py-2">
              <p className="text-lg font-bold text-purple-700">{attSummary.izin}</p>
              <p className="text-[10px] text-purple-600 uppercase">Izin</p>
            </div>
            <div className="bg-amber-50 rounded-lg py-2">
              <p className="text-lg font-bold text-amber-700">{attSummary.sakit}</p>
              <p className="text-[10px] text-amber-600 uppercase">Sakit</p>
            </div>
            <Link href="/portal/absensi" className="flex items-center justify-center bg-slate-50 hover:bg-blue-50 rounded-lg py-2 text-[10px] font-medium text-slate-500 hover:text-blue-600 transition">
              Detail →
            </Link>
          </div>
        </div>

        {/* Libur Terdekat */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3">🗓️ Libur Terdekat ({DAYS_AHEAD} Hari ke Depan)</h2>
          {upcomingOff.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-2">Belum ada jadwal libur ditentukan.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {upcomingOff.slice(0, 8).map(d => (
                <span key={d} className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">
                  {new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' })}
                </span>
              ))}
              {upcomingOff.length > 8 && <span className="px-2.5 py-1 text-xs text-slate-400">+{upcomingOff.length - 8} lagi</span>}
            </div>
          )}
          <Link href="/portal/jadwal" className="block mt-3 text-center py-2 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 text-xs font-medium rounded-lg border border-slate-200 hover:border-blue-200 transition">
            Lihat Jadwal Lengkap →
          </Link>
        </div>

        {/* Sisa Cuti Tahunan */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-2">🌴 Jatah Cuti Tahunan</h2>
          {!leaveInfo.joinDate ? (
            <p className="text-sm text-slate-400 italic py-2">Data masa kerja belum tersedia.</p>
          ) : !eligible ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Masa kerja ±{Math.floor(tenureDays(leaveInfo.joinDate) / 30)} bulan. Cuti Tahunan bisa diajukan setelah genap {MIN_TENURE_DAYS_FOR_ANNUAL_LEAVE} hari (1 tahun).
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold text-blue-600">{remainingLeave}</span>
              <span className="text-sm text-slate-500">dari {ANNUAL_LEAVE_QUOTA_DAYS} hari/tahun tersisa</span>
            </div>
          )}
        </div>

        {/* Kasbon Aktif */}
        {kasbonSaldo > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-2">🏦 Kasbon Aktif</h2>
            <p className="text-3xl font-bold text-amber-600">{fmtRp(kasbonSaldo)}</p>
            <p className="text-xs text-slate-400 mt-0.5">Sisa yang masih dicicil dari gaji</p>
            <Link href="/kasbon" className="block mt-3 text-center py-2 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 text-xs font-medium rounded-lg border border-slate-200 hover:border-blue-200 transition">
              Lihat Detail Kasbon →
            </Link>
          </div>
        )}
      </div>
    </div>

    {clarifyModal && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-5">
          <h3 className="text-lg font-bold text-slate-800 mb-1">Klarifikasi Alpha</h3>
          <p className="text-sm text-slate-500 mb-4">
            {new Date(clarifyModal.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            {' — batas waktu klarifikasi '}
            {new Date(clarifyModal.deadline + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })}
          </p>
          {clarifyError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{clarifyError}</p>}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Sebenarnya kenapa?</label>
              <select value={clarifyType} onChange={e => setClarifyType(e.target.value as 'sick' | 'sick_doc' | 'permission' | 'lupa_absen')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none bg-white">
                <option value="sick">Sakit (tanpa surat dokter)</option>
                <option value="sick_doc">Sakit (dengan surat dokter)</option>
                <option value="permission">Izin</option>
                <option value="lupa_absen">Lupa Absen (sebenarnya masuk kerja)</option>
              </select>
              {clarifyType === 'lupa_absen' && (
                <p className="text-xs text-amber-600 mt-1">Kalau disetujui HR, dianggap hadir (bukan Alpha/Izin) tapi tetap kena denda administratif Rp15.000. Maksimal 4x per periode gajian.</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Keterangan *</label>
              <textarea value={clarifyReason} onChange={e => setClarifyReason(e.target.value)} rows={3}
                placeholder="Jelaskan alasannya..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
            </div>
            {clarifyType === 'sick_doc' && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Foto/Scan Surat Dokter *</label>
                <input type="file" accept="image/*,.pdf" onChange={e => setClarifyFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => setClarifyModal(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
            <button onClick={submitClarification} disabled={clarifySubmitting}
              className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {clarifySubmitting ? 'Mengirim...' : 'Kirim Klarifikasi'}
            </button>
          </div>
        </div>
      </div>
    )}

    {checkoutModal && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-5">
          <h3 className="text-lg font-bold text-slate-800 mb-1">Klarifikasi Lupa Absen Pulang</h3>
          <p className="text-sm text-slate-500 mb-4">
            {new Date(checkoutModal.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Kalau disetujui HR, kena denda administratif <strong>Rp5.000</strong> untuk kejadian ini.</p>
          {checkoutError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{checkoutError}</p>}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Keterangan *</label>
            <textarea value={checkoutReason} onChange={e => setCheckoutReason(e.target.value)} rows={3}
              placeholder="Jelaskan alasannya, misal: lupa scan pulang, sudah kerja sampai jam biasa..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => setCheckoutModal(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
            <button onClick={submitCheckoutClarification} disabled={checkoutSubmitting}
              className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {checkoutSubmitting ? 'Mengirim...' : 'Kirim Klarifikasi'}
            </button>
          </div>
        </div>
      </div>
    )}

    {overtimeModal && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-5">
          <h3 className="text-lg font-bold text-slate-800 mb-1">Klaim Lembur</h3>
          <p className="text-sm text-slate-500 mb-4">
            {new Date(overtimeModal.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            {' — '}{overtimeModal.hoursDetected} jam terdeteksi
          </p>
          <p className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3">Wajib lampirkan foto kertas lembur yang sudah ditandatangani. Owner akan meninjau sebelum lembur ini dibayarkan.</p>
          {overtimeError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{overtimeError}</p>}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Foto Kertas Lembur *</label>
            <input type="file" accept="image/*,.pdf" onChange={e => setOvertimeFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => setOvertimeModal(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
            <button onClick={submitOvertimeClaim} disabled={overtimeSubmitting}
              className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {overtimeSubmitting ? 'Mengirim...' : 'Kirim Klaim'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
