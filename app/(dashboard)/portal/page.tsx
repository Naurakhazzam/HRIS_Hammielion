'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'
import { ANNUAL_LEAVE_QUOTA_DAYS, MIN_TENURE_DAYS_FOR_ANNUAL_LEAVE, tenureDays, isEligibleForAnnualLeave, getCurrentLeaveYear, toDateStr } from '@/lib/leaveQuota'
import { chargeableLateMinutes } from '@/lib/lateTolerance'

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Halo, {myName}! 👋</h1>
        <p className="text-sm text-slate-500">{today.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} — ringkasan singkat untuk Anda.</p>
      </div>

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
  )
}
