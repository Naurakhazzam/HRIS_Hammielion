'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Branch = { id: string; name: string }

type Payroll = {
  id: string
  employee_id: string
  period_month: number
  period_year: number
  base_salary: number
  position_allowance: number
  meal_allowance: number
  overtime_total: number
  kpi_bonus: number
  late_deduction: number
  kasbon_deduction: number
  loyalitas_deduction: number
  conditional_bonus: number
  inventory_loss_deduction: number
  cashier_loss_deduction: number
  absent_days: number
  absent_deduction: number
  gross_total: number
  net_total: number
  status: 'draft' | 'pending_approval' | 'approved' | 'paid'
  approved_by: string | null
  created_at: string
  employee: {
    full_name: string
    employee_type: string
    branch_id: string
    branches: { name: string } | null
    positions: { name: string } | null
  } | null
  approver: { full_name: string } | null
}

type BonusCriteria = {
  id: string
  criteria_name: string
  nominal_amount: number
  is_active: boolean
}

type BonusAssessment = {
  id: string
  criteria_id: string
  is_achieved: boolean
  notes: string | null
}

type CurrentUser = {
  employee_id: string
  role: string
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Satu fungsi terpusat untuk hitung gaji bersih.
 *  Semua tempat yang update net_total harus pakai ini. */
function calcNet(p: {
  gross_total: number | string
  late_deduction: number | string
  kasbon_deduction: number | string
  loyalitas_deduction?: number | string | null
  inventory_loss_deduction?: number | string | null
  cashier_loss_deduction?: number | string | null
  absent_deduction?: number | string | null
}): number {
  return (
    Number(p.gross_total)
    - Number(p.late_deduction)
    - Number(p.kasbon_deduction)
    - Number(p.loyalitas_deduction ?? 0)
    - Number(p.inventory_loss_deduction ?? 0)
    - Number(p.cashier_loss_deduction ?? 0)
    - Number(p.absent_deduction ?? 0)
  )
}

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

function formatRupiah(angka: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(angka)
}

function getLabelBulan(month: number, year: number) {
  return `${MONTHS[month - 1]} ${year}`
}

function getPeriodLabel(month: number, year: number) {
  const endDate = new Date(year, month - 1, 25)
  const startDate = new Date(year, month - 2, 26)
  const startLabel = startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })
  const endLabel = endDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  return `${startLabel} – ${endLabel}`
}

// Badge konfigurasi per status
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:            { label: 'Draft',            className: 'bg-slate-100 text-slate-600' },
  pending_approval: { label: 'Menunggu Approval', className: 'bg-yellow-100 text-yellow-700' },
  approved:         { label: 'Disetujui',         className: 'bg-blue-100 text-blue-700' },
  paid:             { label: 'Lunas',             className: 'bg-green-100 text-green-700' },
}

// ─── Komponen Utama ───────────────────────────────────────────────────────────

export default function PenggajianBulananPage() {
  const supabase = createClient()

  // ── State: filter ──
  const today = new Date()
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1) // 1-12
  const [filterYear, setFilterYear]   = useState(today.getFullYear())
  const [filterBranch, setFilterBranch] = useState('') // '' = semua cabang

  // ── State: data ──
  const [payrolls, setPayrolls] = useState<Payroll[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [kasbonSaldoMap, setKasbonSaldoMap] = useState<Record<string, number>>({})

  // ── State: UI ──
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── State: kasbon inline edit (Part 3) ──
  const [kasbonEdit, setKasbonEdit]     = useState<Record<string, string>>({})
  const [kasbonSaving, setKasbonSaving] = useState<Record<string, boolean>>({})

  // ── State: approval action (Part 4) ──
  const [submitting, setSubmitting] = useState<string | null>(null)

  // ── State: modal detail slip (Part 5) ──
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | null>(null)
  const [lateDetails, setLateDetails] = useState<{ date: string; late_minutes: number; deduction: number }[]>([])
  const [lateRate, setLateRate] = useState(0)
  const [loadingLate, setLoadingLate] = useState(false)

  // ── State: detail kehilangan barang di slip ──
  type LossDetail = {
    totalLoss: number
    companyPct: number
    employeeSharePct: number
    unassignedPct: number
    companyTotalCover: number
    employeeDeduction: number
  }
  const [lossDetail, setLossDetail] = useState<LossDetail | null>(null)
  const [loadingLoss, setLoadingLoss] = useState(false)

  // ── State: detail lembur per hari ──
  const [otDetails, setOtDetails] = useState<{ date: string; hours: number; earning: number }[]>([])
  const [loadingOt, setLoadingOt] = useState(false)

  // ── State: breakdown potongan tidak hadir di modal detail ──
  type AbsentBreakdownDetail = {
    dailyRate: number; izinDays: number; alphaDays: number
    sickDays: number; sick1Free: number; sick23Half: number; sick4Full: number; autoIzin: number
  }
  const [absentBreakdownDetail, setAbsentBreakdownDetail] = useState<AbsentBreakdownDetail | null>(null)

  // ── State: buat slip per karyawan (stepper) ──
  type SlipPreview = {
    employeeId: string; employeeName: string; employeeCode: string
    positionName: string; branchName: string
    base: number; pos: number; meal: number; otTotal: number; kpiBonus: number
    conditionalBonus: number
    loyalitasDed: number; latDed: number; latMinutes: number; latRate: number
    kasbonSaldo: number; kasbonDed: number
    absentDays: number; absentDed: number; absentRatePerDay: number
    absentBreakdown: { dailyRate: number; nonHadirDays: number; freeDays: number; deductedDays: number; alphaDays: number; izinDays: number; liburExtraDays: number; sickDays: number; sick1Free: number; sick23Half: number; sick4Full: number } | null
    invLoss: number; cashierLoss: number
    loyAutoRelease: number; loyBalSaldo: number; loyDurasi: number
    gross: number; net: number
  }
  const [createModal, setCreateModal]       = useState(false)
  const [createStep, setCreateStep]         = useState<1|2|3>(1)
  const [availableEmps, setAvailableEmps]   = useState<{id:string;full_name:string;employee_code:string;positions:{name:string}|null;branches:{name:string}|null}[]>([])
  const [selectedEmpId, setSelectedEmpId]   = useState('')
  const [unclassifiedDays, setUnclassifiedDays] = useState<{missing_date: string}[]>([])
  const [checkingUnclassified, setCheckingUnclassified] = useState(false)
  const [createKasbon, setCreateKasbon]     = useState(0)
  const [slipPreview, setSlipPreview]       = useState<SlipPreview | null>(null)
  const [buildingPreview, setBuildingPreview] = useState(false)
  const [finalizing, setFinalizing]         = useState(false)

  // ── State: bonus kondisional saat buat slip ──
  const [createBonusCriteria, setCreateBonusCriteria]       = useState<BonusCriteria[]>([])
  const [createBonusChecked, setCreateBonusChecked]         = useState<Record<string, boolean>>({})

  // ── State: modal bonus kondisional ──
  const [bonusModal, setBonusModal] = useState<Payroll | null>(null)
  const [bonusCriteria, setBonusCriteria] = useState<BonusCriteria[]>([])
  const [bonusAssessments, setBonusAssessments] = useState<Record<string, boolean>>({})
  const [bonusNotes, setBonusNotes] = useState<Record<string, string>>({})
  const [bonusSaving, setBonusSaving] = useState(false)

  // ── Inisialisasi ──
  useEffect(() => {
    fetchCurrentUser()
    fetchBranches()
  }, [])

  // Fetch payrolls setiap filter berubah
  useEffect(() => {
    fetchPayrolls()
  }, [filterMonth, filterYear, filterBranch])

  // Cek hari belum terklasifikasi saat karyawan dipilih di modal buat slip
  // Menggunakan logika yang sama dengan Rekap Absensi:
  // hari kosong → otomatis Libur (maks 4) atau Izin (sisanya) → semua sudah terklasifikasi
  useEffect(() => {
    if (!selectedEmpId || !createModal) { setUnclassifiedDays([]); return }
    setCheckingUnclassified(true)
    const { firstDay, lastDay } = getFirstLastDay(filterMonth, filterYear)
    supabase
      .from('attendances')
      .select('date')
      .eq('employee_id', selectedEmpId)
      .gte('date', firstDay)
      .lte('date', lastDay)
      .then(({ data }) => {
        // Semua hari dalam periode yang punya record = sudah terklasifikasi
        // Hari kosong = otomatis Libur/Izin sesuai aturan rekap → juga dianggap terklasifikasi
        // Maka unclassifiedDays selalu kosong
        const recordedDates = new Set((data || []).map((a: any) => a.date))
        // Hanya flag sebagai unclassified jika tidak ada record DAN tidak ada aturan auto
        // Karena aturan auto (kosong = libur/izin) berlaku untuk semua hari kosong,
        // tidak ada hari yang benar-benar unclassified
        setUnclassifiedDays([])
        setCheckingUnclassified(false)
      })
  }, [selectedEmpId, createModal])

  // Fetch kriteria bonus kondisional saat karyawan dipilih di modal buat slip
  useEffect(() => {
    if (!selectedEmpId || !createModal) { setCreateBonusCriteria([]); setCreateBonusChecked({}); return }
    supabase
      .from('employee_bonus_criteria')
      .select('*')
      .eq('employee_id', selectedEmpId)
      .eq('is_active', true)
      .order('created_at')
      .then(({ data }) => {
        const criteria = (data as BonusCriteria[]) || []
        setCreateBonusCriteria(criteria)
        // Cek apakah sudah ada assessment bulan ini (edit slip case)
        const initChecked: Record<string, boolean> = {}
        criteria.forEach(c => { initChecked[c.id] = false })
        setCreateBonusChecked(initChecked)
      })
  }, [selectedEmpId, createModal])

  // ─── Fetch functions ───────────────────────────────────────────────────────

  async function fetchCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('users')
      .select('employee_id, role')
      .eq('id', user.id)
      .single()
    if (data) setCurrentUser(data)
  }

  async function fetchBranches() {
    const { data } = await supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
    if (data) setBranches(data)
  }

  async function fetchPayrolls() {
    setLoading(true)

    let query = supabase
      .from('payrolls')
      .select(`
        id, employee_id, period_month, period_year,
        base_salary, position_allowance, meal_allowance,
        overtime_total, kpi_bonus, late_deduction,
        kasbon_deduction, loyalitas_deduction, conditional_bonus,
        inventory_loss_deduction, cashier_loss_deduction,
        absent_days, absent_deduction,
        gross_total, net_total,
        status, approved_by, created_at,
        employee:employees!payrolls_employee_id_fkey(
          full_name, employee_type, branch_id, join_date,
          branches(name),
          positions(name)
        ),
        approver:employees!payrolls_approved_by_fkey(full_name)
      `)
      .eq('period_month', filterMonth)
      .eq('period_year', filterYear)
      .order('created_at', { ascending: false })

    const { data, error } = await query

    if (error) {
      console.error('Detail:', JSON.stringify(error, null, 2))
      setPayrolls([])
      setLoading(false)
      return
    }

    // Cast
    let result = (data as unknown as Payroll[]) || []

    // Filter: hanya karyawan permanent
    result = result.filter(p => p.employee?.employee_type === 'permanent')

    // Filter cabang (client-side karena relasi nested)
    if (filterBranch) {
      result = result.filter(p => {
        const emp = p.employee as any
        return emp?.branch_id === filterBranch
      })
    }

    setPayrolls(result)

    // Init kasbon edit state (Part 3)
    const initKasbon: Record<string, string> = {}
    result.forEach(p => { initKasbon[p.id] = String(p.kasbon_deduction ?? 0) })
    setKasbonEdit(initKasbon)

    // Fetch saldo kasbon aktif per karyawan
    if (result.length > 0) {
      const empIds = result.map(p => p.employee_id)
      const { data: kasbonData } = await supabase
        .from('kasbon_requests')
        .select('employee_id, amount_requested, total_deducted')
        .in('employee_id', empIds)
        .eq('status', 'approved')
      const saldoMap: Record<string, number> = {}
      ;(kasbonData || []).forEach((k: any) => {
        const saldo = Number(k.amount_requested) - Number(k.total_deducted)
        saldoMap[k.employee_id] = (saldoMap[k.employee_id] || 0) + Math.max(0, saldo)
      })
      setKasbonSaldoMap(saldoMap)
    }

    setLoading(false)
  }

  async function handleDeletePayroll(payrollId: string, employeeName: string, employeeId: string, kasbonDed: number) {
    if (!confirm(`Hapus slip gaji "${employeeName}"?\n\nData slip akan dihapus permanen. Jika ada potongan kasbon, saldo kasbon akan dikembalikan otomatis.`)) return
    setSubmitting(payrollId)

    // Kasbon reversal: kembalikan saldo jika ada potongan kasbon
    if (kasbonDed > 0) {
      const { data: kl } = await supabase
        .from('kasbon_limits')
        .select('id, current_balance')
        .eq('employee_id', employeeId)
        .single()
      if (kl) {
        await supabase.from('kasbon_limits')
          .update({ current_balance: Number(kl.current_balance) + kasbonDed, updated_at: new Date().toISOString() })
          .eq('id', kl.id)
      }
    }

    const { error } = await supabase.from('payrolls').delete().eq('id', payrollId)
    if (error) {
      showMessage('error', 'Gagal menghapus slip: ' + error.message)
    } else {
      showMessage('success', `Slip gaji ${employeeName} berhasil dihapus.${kasbonDed > 0 ? ` Saldo kasbon ${formatRupiah(kasbonDed)} dikembalikan.` : ''}`)
      fetchPayrolls()
    }
    setSubmitting(null)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 6000)
  }

  // ─── Part 2: Generate Slip Gaji ────────────────────────────────────────────

  function getFirstLastDay(m: number, y: number) {
    // Periode 26 bulan lalu – 25 bulan ini
    // Gunakan format manual agar tidak kena timezone offset (toISOString() convert ke UTC)
    const pad = (n: number) => String(n).padStart(2, '0')
    const startM = m === 1 ? 12 : m - 1
    const startY = m === 1 ? y - 1 : y
    const firstDay = `${startY}-${pad(startM)}-26`
    const lastDay  = `${y}-${pad(m)}-25`
    return { firstDay, lastDay }
  }

  // Pembulatan lembur per hari: < 60 menit = 0, lalu floor per jam
  function roundOvertimeHours(rawHours: number): number {
    const minutes = rawHours * 60
    if (minutes < 60) return 0
    return Math.floor(minutes / 60) // kembalikan dalam jam bulat
  }

  // ─── Buat Slip Per Karyawan ────────────────────────────────────────────────────

  async function openCreateModal() {
    setCreateStep(1); setSelectedEmpId(''); setUnclassifiedDays([]); setCreateKasbon(0); setSlipPreview(null)
    // Ambil karyawan permanent aktif yang belum punya slip bulan ini
    const { data: emps } = await supabase
      .from('employees')
      .select('id, full_name, employee_code, positions(name), branches(name)')
      .eq('employee_type', 'permanent').eq('is_active', true)
    const { data: existing } = await supabase
      .from('payrolls').select('employee_id')
      .eq('period_month', filterMonth).eq('period_year', filterYear)
    const existSet = new Set((existing || []).map((p: any) => p.employee_id))
    setAvailableEmps(((emps || []) as any[]).filter(e => !existSet.has(e.id)))
    setCreateModal(true)
  }

  async function buildSlipPreview(empId: string, kasbonDed: number) {
    setBuildingPreview(true)
    try {
    const { firstDay, lastDay } = getFirstLastDay(filterMonth, filterYear)

    const [scRes, attRes, kpiRes, klRes, empRes, loyBalRes] = await Promise.all([
      supabase.from('salary_components').select('*').eq('employee_id', empId).lte('effective_date', firstDay).order('effective_date', { ascending: false }).limit(1),
      supabase.from('attendances').select('date, status, overtime_hours, late_minutes').eq('employee_id', empId).gte('date', firstDay).lte('date', lastDay),
      supabase.from('kpi_evaluations').select('bonus_cair').eq('employee_id', empId).eq('period_month', filterMonth).eq('period_year', filterYear).limit(1),
      supabase.from('kasbon_limits').select('current_balance').eq('employee_id', empId).maybeSingle(),
      supabase.from('employees').select('full_name, employee_code, loyalitas_per_month, loyalitas_duration_months, branch_id, position_id, positions(name), branches(name)').eq('id', empId).single(),
      supabase.from('loyalitas_balances').select('*').eq('employee_id', empId).eq('status', 'active').maybeSingle(),
    ])

    const sc   = scRes.data?.[0]
    const emp  = empRes.data as any
    const atts = attRes.data || []

    if (scRes.error) { showMessage('error', 'Gagal ambil komponen gaji: ' + scRes.error.message); setBuildingPreview(false); return null }
    if (empRes.error) { showMessage('error', 'Gagal ambil data karyawan: ' + empRes.error.message); setBuildingPreview(false); return null }
    if (!sc) { showMessage('error', 'Komponen gaji belum diisi untuk karyawan ini. Isi dulu di menu Penggajian → Komponen Gaji.'); setBuildingPreview(false); return null }
    if (!emp) { showMessage('error', 'Data karyawan tidak ditemukan.'); setBuildingPreview(false); return null }

    // ── Hitung kehilangan barang & kerugian kasir dari sumber asli ──
    const branchId = emp.branch_id
    const positionId = emp.position_id

    const [lossRes, shareRes, cashierEntryRes, cashierConfigRes] = await Promise.all([
      supabase.from('loss_monthly_inputs').select('total_loss_amount').eq('branch_id', branchId).eq('period_month', filterMonth).eq('period_year', filterYear).maybeSingle(),
      supabase.from('loss_employee_shares').select('employee_id, share_percent').eq('branch_id', branchId).eq('employee_id', empId).eq('is_active', true).order('created_at', { ascending: false }).limit(1),
      supabase.from('cashier_loss_entries').select('amount').eq('branch_id', branchId).eq('period_month', filterMonth).eq('period_year', filterYear),
      supabase.from('cashier_loss_configs').select('position_id').eq('branch_id', branchId).eq('is_active', true),
    ])
    const [lossConfigRes, kasirCountRes] = await Promise.all([
      supabase.from('branch_loss_configs').select('company_coverage_percent').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(1),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('is_active', true).in('position_id', (cashierConfigRes.data || []).map((c: any) => c.position_id)),
    ])

    const totalLoss        = Number(lossRes.data?.total_loss_amount ?? 0)
    const companyPct       = Number(lossConfigRes.data?.[0]?.company_coverage_percent ?? 0)
    const sharePct         = Number(shareRes.data?.[0]?.share_percent ?? 0)
    const companyCover     = totalLoss * (companyPct / 100)
    const employeeTotalLoss = totalLoss - companyCover
    const invLoss          = Math.round((sharePct / 100) * employeeTotalLoss)

    const kasirPositionIds = (cashierConfigRes.data || []).map((c: any) => c.position_id)
    const isKasir          = kasirPositionIds.includes(positionId)
    const totalKasir       = (cashierEntryRes.data || []).reduce((s: number, e: any) => s + Number(e.amount), 0)
    const kasirCount       = kasirCountRes.count ?? 1
    const cashLoss         = isKasir && kasirCount > 0 ? Math.round(totalKasir / kasirCount) : 0

    const base     = Number(sc.base_salary ?? 0)
    const pos      = Number(sc.position_allowance ?? 0)
    const meal     = Number(sc.meal_allowance ?? 0)
    const otRate   = Number(sc.overtime_rate_per_hour ?? 0)
    const latRate  = Number(sc.late_penalty_per_minute ?? 0)
    const joinDateVal = (emp as any).join_date ?? null
    const otHours  = (atts as any[]).filter((a: any) => !joinDateVal || a.date >= joinDateVal).reduce((s: number, a: any) => s + roundOvertimeHours(Number(a.overtime_hours ?? 0)), 0)
    const latMins  = (atts as any[]).filter((a: any) => !joinDateVal || a.date >= joinDateVal).reduce((s: number, a: any) => s + Number(a.late_minutes ?? 0), 0)
    const otTotal  = otHours * otRate
    const latDed   = latMins * latRate
    const kpi      = Number(kpiRes.data?.[0]?.bonus_cair ?? 0)
    const loyalitas = Number((emp as any).loyalitas_per_month ?? 0)
    const loyDurasi = Number((emp as any).loyalitas_duration_months ?? 0)
    const saldo    = Number(klRes.data?.current_balance ?? 0)

    // ── Cek auto-cairkan tabungan loyalitas ──────────────────────────────────
    const loyBal = loyBalRes.data as any
    const loyBalSaldo = Number(loyBal?.total_withheld ?? 0)
    let loyAutoRelease = 0  // bonus masuk ke pendapatan jika bulan pencairan
    if (loyBal && loyDurasi > 0 && loyBal.start_month && loyBal.start_year) {
      const monthsElapsed = (filterYear - loyBal.start_year) * 12 + (filterMonth - loyBal.start_month) + 1
      // +1 karena bulan ini adalah bulan ke-N setelah dipotong
      if (monthsElapsed >= loyDurasi) {
        loyAutoRelease = loyBalSaldo + loyalitas  // saldo lama + potongan bulan ini
      }
    }

    // ── Hitung potongan tidak hadir (frontend, rumus baku) ──────────────────
    // Daily rate = total semua komponen ÷ 26
    const dailyRate = Math.round((base + pos + meal) / 26)

    // Pisahkan status dari data attendance
    // Exclude hari sebelum bergabung dan record "Belum Masuk (Training)" lama
    const validAtts = atts.filter((a: any) => {
      if (joinDateVal && a.date < joinDateVal) return false
      if (a.status === 'absent' && a.notes === 'Belum Masuk (Training)') return false
      return true
    })
    const recordedDates = new Set(validAtts.map((a: any) => a.date))
    const izinRecs  = validAtts.filter((a: any) => a.status === 'permission')
    const sickRecs  = validAtts.filter((a: any) => a.status === 'sick')
    const alphaRecs = validAtts.filter((a: any) => a.status === 'absent')

    // Hari kosong (tidak ada record) → auto-libur (≤4 gratis, sisanya izin)
    const allPeriodDates: string[] = []
    const cur = new Date(firstDay + 'T00:00:00')
    const endD = new Date(lastDay + 'T00:00:00')
    const pad = (n: number) => String(n).padStart(2, '0')
    while (cur <= endD) {
      allPeriodDates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`)
      cur.setDate(cur.getDate()+1)
    }
    const emptyDays   = allPeriodDates.filter(d => {
      if (joinDateVal && d < joinDateVal) return false  // sebelum bergabung — diabaikan
      return !recordedDates.has(d)
    }).length
    const autoIzin    = Math.max(emptyDays - 4, 0)  // kosong >4 jadi izin

    // Izin: 1× per hari
    const izinCount = izinRecs.length + autoIzin
    const izinDed   = izinCount * dailyRate

    // Alpha: 1.5× per hari
    const alphaCount = alphaRecs.length
    const alphaDed   = Math.round(alphaCount * dailyRate * 1.5)

    // Sakit: hari ke-1 gratis, hari ke-2&3 = 0.5×, hari ke-4+ = 1×
    const sickCount   = sickRecs.length
    const sick1Free   = Math.min(sickCount, 1)
    const sick23Half  = Math.max(0, Math.min(sickCount - 1, 2))
    const sick4Full   = Math.max(0, sickCount - 3)
    const sickDed     = Math.round(sick23Half * dailyRate * 0.5 + sick4Full * dailyRate)

    const absentDed        = izinDed + alphaDed + sickDed
    const absentDays       = izinCount + alphaCount + sickCount  // include autoIzin
    const absentRatePerDay = dailyRate
    const absentBreakdown  = {
      dailyRate,
      nonHadirDays:   absentDays,
      freeDays:       sick1Free,
      deductedDays:   izinCount + alphaCount + sick23Half + sick4Full,
      alphaDays:      alphaCount,
      izinDays:       izinCount,
      liburExtraDays: autoIzin,
      sickDays:       sickCount,
      sick1Free,
      sick23Half,
      sick4Full,
    }

    // Bonus kondisional — hitung dari state checklist di step 1
    const conditionalBonus = createBonusCriteria
      .filter(c => createBonusChecked[c.id])
      .reduce((s, c) => s + Number(c.nominal_amount), 0)

    const gross = base + pos + meal + otTotal + kpi + loyAutoRelease + conditionalBonus
    const net   = calcNet({ gross_total: gross, late_deduction: latDed, kasbon_deduction: kasbonDed, loyalitas_deduction: loyAutoRelease > 0 ? 0 : loyalitas, inventory_loss_deduction: invLoss, cashier_loss_deduction: cashLoss, absent_deduction: absentDed })

    const preview: SlipPreview = {
      employeeId: empId, employeeName: emp.full_name, employeeCode: emp.employee_code,
      positionName: (emp.positions as any)?.name ?? '—', branchName: (emp.branches as any)?.name ?? '—',
      base, pos, meal, otTotal, kpiBonus: kpi,
      loyalitasDed: loyalitas, latDed, latMinutes: latMins, latRate,
      kasbonSaldo: saldo, kasbonDed,
      absentDays, absentDed, absentRatePerDay, absentBreakdown,
      invLoss, cashierLoss: cashLoss,
      loyAutoRelease, loyBalSaldo, loyDurasi,
      conditionalBonus,
      gross, net,
    }
    setSlipPreview(preview)
    setBuildingPreview(false)
    return preview
    } catch (err: any) {
      showMessage('error', 'Terjadi kesalahan: ' + (err.message || 'Unknown error'))
      setBuildingPreview(false)
      return null
    }
  }

  async function handleFinalizeSlip() {
    if (!slipPreview) return
    setFinalizing(true)
    const p = slipPreview

    // Update kasbon saldo jika ada potongan
    if (p.kasbonDed > 0) {
      const { data: kl } = await supabase.from('kasbon_limits').select('id, current_balance').eq('employee_id', p.employeeId).single()
      if (kl) {
        const newBal = Math.max(0, Number(kl.current_balance) - p.kasbonDed)
        await supabase.from('kasbon_limits').update({ current_balance: newBal, updated_at: new Date().toISOString() }).eq('id', kl.id)
      }
    }

    const { data: insertedPayroll, error } = await supabase.from('payrolls').insert({
      employee_id: p.employeeId, period_month: filterMonth, period_year: filterYear,
      base_salary: p.base, position_allowance: p.pos, meal_allowance: p.meal,
      overtime_total: p.otTotal, kpi_bonus: p.kpiBonus,
      conditional_bonus: p.conditionalBonus,
      late_deduction: p.latDed, kasbon_deduction: p.kasbonDed,
      loyalitas_deduction: p.loyAutoRelease > 0 ? 0 : p.loyalitasDed,
      loyalitas_auto_release: p.loyAutoRelease,
      absent_days: p.absentDays, absent_deduction: p.absentDed,
      inventory_loss_deduction: p.invLoss, cashier_loss_deduction: p.cashierLoss,
      gross_total: p.gross, net_total: p.net, status: 'draft', approved_by: null,
    }).select('id').single()

    if (error) {
      showMessage('error', 'Gagal simpan slip: ' + error.message)
    } else {
      // Simpan assessments bonus kondisional jika ada
      if (insertedPayroll && createBonusCriteria.length > 0) {
        const currentUser = await supabase.auth.getUser()
        const userId = currentUser.data.user?.id
        const assessPayloads = createBonusCriteria.map(c => ({
          payroll_id: insertedPayroll.id,
          criteria_id: c.id,
          employee_id: p.employeeId,
          period_month: filterMonth,
          period_year: filterYear,
          is_achieved: createBonusChecked[c.id] ?? false,
          assessed_by: userId || null,
          notes: null,
        }))
        await supabase.from('payroll_bonus_assessments').upsert(assessPayloads, { onConflict: 'payroll_id,criteria_id' })
      }
      showMessage('success', `Slip gaji ${p.employeeName} berhasil dibuat.`)
      setCreateModal(false)
      setCreateBonusCriteria([])
      setCreateBonusChecked({})
      fetchPayrolls()
    }
    setFinalizing(false)
  }

  // ─── Part 3: Edit Kasbon Deduction ──────────────────────────────────────────────────

  async function handleSaveKasbon(p: Payroll) {
    const rawVal = kasbonEdit[p.id] ?? '0'
    const newKasbon = parseFloat(rawVal)
    if (isNaN(newKasbon) || newKasbon < 0) {
      showMessage('error', 'Nilai potongan kasbon tidak valid.')
      return
    }
    setKasbonSaving(prev => ({ ...prev, [p.id]: true }))

    // Recalculate net_total — pakai calcNet agar semua potongan ikut terhitung
    const newNet = calcNet({ ...p, kasbon_deduction: newKasbon })

    const { error } = await supabase
      .from('payrolls')
      .update({ kasbon_deduction: newKasbon, net_total: newNet })
      .eq('id', p.id)

    if (error) {
      console.error('Detail:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal menyimpan kasbon: ' + error.message)
    } else {
      // Update local state tanpa re-fetch
      setPayrolls(prev => prev.map(x =>
        x.id === p.id ? { ...x, kasbon_deduction: newKasbon, net_total: newNet } : x
      ))
    }
    setKasbonSaving(prev => ({ ...prev, [p.id]: false }))
  }

  // ─── Part 4: Alur Approval ──────────────────────────────────────────────────────

  // Role helpers
  const canAjukan  = () => ['finance', 'hr', 'owner'].includes(currentUser?.role ?? '')
  const canApprove = () => ['hr', 'owner'].includes(currentUser?.role ?? '')
  const canPaid    = () => currentUser?.role === 'owner'

  async function handleStatusChange(p: Payroll, action: 'ajukan' | 'approve' | 'paid') {
    if (!currentUser) return

    const confirmMap: Record<string, string> = {
      ajukan:  `Ajukan slip gaji ${p.employee?.full_name} ke status Menunggu Approval?`,
      approve: `Setujui slip gaji ${p.employee?.full_name}?`,
      paid:    `Tandai slip gaji ${p.employee?.full_name} sebagai LUNAS?\n\nSaldo kasbon karyawan akan dikurangi otomatis jika ada potongan kasbon.`,
    }
    if (!confirm(confirmMap[action])) return

    setSubmitting(p.id)

    // Tentukan data update
    const updates: Record<string, any> =
      action === 'ajukan'  ? { status: 'pending_approval' } :
      action === 'approve' ? { status: 'approved', approved_by: currentUser.employee_id } :
                             { status: 'paid' }

    const { error } = await supabase
      .from('payrolls')
      .update(updates)
      .eq('id', p.id)

    if (error) {
      console.error('Detail:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal memperbarui status: ' + error.message)
      setSubmitting(null)
      return
    }

    // Jika paid: kurangi kasbon + tambah saldo loyalitas
    if (action === 'paid') {
      // Kasbon
      if (Number(p.kasbon_deduction) > 0) {
        const { data: kl, error: klErr } = await supabase
          .from('kasbon_limits')
          .select('id, current_balance')
          .eq('employee_id', p.employee_id)
          .single()
        if (!klErr && kl) {
          const newBalance = Math.max(0, Number(kl.current_balance) - Number(p.kasbon_deduction))
          await supabase.from('kasbon_limits')
            .update({ current_balance: newBalance, updated_at: new Date().toISOString() })
            .eq('id', kl.id)
        }
      }
      // Tabungan Loyalitas
      const loyalitasDed    = Number((p as any).loyalitas_deduction ?? 0)
      const loyalitasRelease = Number((p as any).loyalitas_auto_release ?? 0)

      if (loyalitasRelease > 0) {
        // Bulan pencairan otomatis — release balance lama, buat siklus baru
        const { data: oldBal } = await supabase.from('loyalitas_balances').select('id').eq('employee_id', p.employee_id).eq('status', 'active').maybeSingle()
        if (oldBal) {
          await supabase.from('loyalitas_balances').update({ status: 'released', released_at: new Date().toISOString(), notes: `Auto-cair bulan ${p.period_month}/${p.period_year}`, updated_at: new Date().toISOString() }).eq('id', oldBal.id)
        }
        await supabase.from('loyalitas_transactions').insert({ employee_id: p.employee_id, payroll_id: p.id, type: 'auto_release', amount: loyalitasRelease, notes: `Pencairan otomatis bulan ${p.period_month}/${p.period_year}` })
        // Mulai siklus baru
        await supabase.from('loyalitas_balances').insert({ employee_id: p.employee_id, total_withheld: 0, status: 'active', start_month: p.period_month, start_year: p.period_year, cycle_number: (oldBal ? 2 : 1) })
      } else if (loyalitasDed > 0) {
        // Bulan normal — tambah ke saldo
        const { data: existBal } = await supabase.from('loyalitas_balances').select('id, total_withheld, start_month, start_year').eq('employee_id', p.employee_id).eq('status', 'active').maybeSingle()
        if (existBal) {
          const updates: any = { total_withheld: Number(existBal.total_withheld) + loyalitasDed, updated_at: new Date().toISOString() }
          if (!existBal.start_month) { updates.start_month = p.period_month; updates.start_year = p.period_year }
          await supabase.from('loyalitas_balances').update(updates).eq('id', existBal.id)
        } else {
          await supabase.from('loyalitas_balances').insert({ employee_id: p.employee_id, total_withheld: loyalitasDed, status: 'active', start_month: p.period_month, start_year: p.period_year, cycle_number: 1 })
        }
        await supabase.from('loyalitas_transactions').insert({ employee_id: p.employee_id, payroll_id: p.id, type: 'deduction', amount: loyalitasDed, notes: `Tabung bulan ${p.period_month}/${p.period_year}` })
      }
    }

    showMessage('success', 'Status berhasil diperbarui.')
    setSubmitting(null)
    await fetchPayrolls()
  }

  // ─── Fetch Detail Keterlambatan ────────────────────────────────────────────
  async function fetchLateDetails(p: Payroll) {
    setLoadingLate(true)
    setLateDetails([])
    setLateRate(0)

    // Periode 26 bulan lalu - 25 bulan ini (pakai format lokal, bukan toISOString)
    const pad = (n: number) => String(n).padStart(2, '0')
    const sm = p.period_month === 1 ? 12 : p.period_month - 1
    const sy = p.period_month === 1 ? p.period_year - 1 : p.period_year
    const firstDay = `${sy}-${pad(sm)}-26`
    const lastDay  = `${p.period_year}-${pad(p.period_month)}-25`

    // Ambil tarif potongan per menit dari salary_components
    const { data: salComp } = await supabase
      .from('salary_components')
      .select('late_penalty_per_minute')
      .eq('employee_id', p.employee_id)
      .lte('effective_date', firstDay)
      .order('effective_date', { ascending: false })
      .limit(1)
      .single()

    const rate = Number(salComp?.late_penalty_per_minute ?? 0)
    setLateRate(rate)

    // Ambil hari-hari yang terlambat
    const { data: atts } = await supabase
      .from('attendances')
      .select('date, late_minutes')
      .eq('employee_id', p.employee_id)
      .gte('date', firstDay)
      .lte('date', lastDay)
      .gt('late_minutes', 0)
      .order('date')

    const details = (atts || []).map(a => ({
      date: a.date,
      late_minutes: Number(a.late_minutes),
      deduction: Number(a.late_minutes) * rate
    }))

    setLateDetails(details)
    setLoadingLate(false)
  }

  // ─── Fetch Detail Kehilangan Barang ────────────────────────────────────────
  async function fetchLossDetail(p: Payroll) {
    setLoadingLoss(true)
    setLossDetail(null)

    const branchId = p.employee?.branch_id
    if (!branchId) { setLoadingLoss(false); return }

    const [lossRes, configRes, shareRes] = await Promise.all([
      // Total kehilangan bulan ini di cabang karyawan
      supabase.from('loss_monthly_inputs')
        .select('total_loss_amount')
        .eq('branch_id', branchId)
        .eq('period_month', p.period_month)
        .eq('period_year', p.period_year)
        .single(),
      // % kantor terbaru untuk cabang ini
      supabase.from('branch_loss_configs')
        .select('company_coverage_percent')
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      // % tanggung jawab karyawan ini
      supabase.from('loss_employee_shares')
        .select('share_percent')
        .eq('employee_id', p.employee_id)
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
    ])

    if (!lossRes.data) { setLoadingLoss(false); return }

    const totalLoss = Number(lossRes.data.total_loss_amount)
    const companyPct = Number(configRes.data?.company_coverage_percent ?? 0)
    const employeeSharePct = Number(shareRes.data?.share_percent ?? 0)

    // Hitung total % yang sudah di-assign ke karyawan di cabang ini
    const { data: allShares } = await supabase
      .from('loss_employee_shares')
      .select('employee_id, share_percent, created_at')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    // Ambil share terbaru per employee
    const latestMap: Record<string, number> = {}
    ;(allShares || []).forEach((s: any) => {
      if (latestMap[s.employee_id] === undefined) latestMap[s.employee_id] = Number(s.share_percent)
    })
    const totalAssigned = Object.values(latestMap).reduce((a, b) => a + b, 0)
    // Hard cap: total % kantor + % karyawan tidak boleh > 100
    const effectiveCompanyPct  = Math.min(companyPct, 100)
    const effectiveTotalAssigned = Math.min(totalAssigned, Math.max(0, 100 - effectiveCompanyPct))
    const unassignedPct = Math.max(0, 100 - effectiveCompanyPct - effectiveTotalAssigned)
    const companyTotalCover = totalLoss * ((effectiveCompanyPct + unassignedPct) / 100)
    const employeeTotalShare = totalLoss * (effectiveTotalAssigned / 100)
    const employeeDeduction = employeeTotalShare * (employeeSharePct / (effectiveTotalAssigned || 1))

    setLossDetail({ totalLoss, companyPct: effectiveCompanyPct, employeeSharePct, unassignedPct, companyTotalCover, employeeDeduction: Math.round(employeeDeduction) })
    setLoadingLoss(false)
  }

  // ─── Fetch Detail Lembur ──────────────────────────────────────────────────
  async function fetchOtDetails(p: Payroll) {
    setLoadingOt(true)
    setOtDetails([])
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const sm2 = p.period_month === 1 ? 12 : p.period_month - 1
    const sy2 = p.period_month === 1 ? p.period_year - 1 : p.period_year
    const firstDay = `${sy2}-${pad2(sm2)}-26`
    const lastDay  = `${p.period_year}-${pad2(p.period_month)}-25`

    const { data: sc } = await supabase.from('salary_components').select('overtime_rate_per_hour').eq('employee_id', p.employee_id).lte('effective_date', firstDay).order('effective_date', { ascending: false }).limit(1)
    const otRate = Number(sc?.[0]?.overtime_rate_per_hour ?? 0)

    const { data: atts } = await supabase.from('attendances').select('date, overtime_hours').eq('employee_id', p.employee_id).gte('date', firstDay).lte('date', lastDay).gt('overtime_hours', 0).order('date')

    const details = (atts || []).map(a => {
      const rawHours = Number(a.overtime_hours)
      const mins = rawHours * 60
      const roundedHours = mins < 60 ? 0 : Math.floor(mins / 60)
      return { date: a.date, hours: roundedHours, raw: rawHours, earning: roundedHours * otRate }
    }).filter(d => d.hours > 0)

    setOtDetails(details)
    setLoadingOt(false)
  }

  // ─── Fetch Breakdown Potongan Tidak Hadir (modal detail) ─────────────────
  async function fetchAbsentBreakdown(p: Payroll) {
    setAbsentBreakdownDetail(null)
    const pad = (n: number) => String(n).padStart(2, '0')
    const sm = p.period_month === 1 ? 12 : p.period_month - 1
    const sy = p.period_month === 1 ? p.period_year - 1 : p.period_year
    const firstDay = `${sy}-${pad(sm)}-26`
    const lastDay  = `${p.period_year}-${pad(p.period_month)}-25`

    const [scRes, attRes] = await Promise.all([
      supabase.from('salary_components').select('base_salary, position_allowance, meal_allowance').eq('employee_id', p.employee_id).lte('effective_date', firstDay).order('effective_date', { ascending: false }).limit(1),
      supabase.from('attendances').select('date, status').eq('employee_id', p.employee_id).gte('date', firstDay).lte('date', lastDay),
    ])

    const sc = scRes.data?.[0]
    const atts = attRes.data || []
    const dailyRate = sc ? Math.round((Number(sc.base_salary)+Number(sc.position_allowance)+Number(sc.meal_allowance))/26) : 0

    const recordedDates = new Set(atts.map((a: any) => a.date))
    const allDates: string[] = []
    const cur = new Date(firstDay + 'T12:00:00')
    const endD = new Date(lastDay + 'T12:00:00')
    while (cur <= endD) { allDates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`); cur.setDate(cur.getDate()+1) }

    const emptyDays  = allDates.filter(d => !recordedDates.has(d)).length
    const autoIzin   = Math.max(emptyDays - 4, 0)
    const izinDays   = atts.filter((a: any) => a.status === 'permission').length
    const alphaDays  = atts.filter((a: any) => a.status === 'absent').length
    const sickDays   = atts.filter((a: any) => a.status === 'sick').length
    const sick1Free  = Math.min(sickDays, 1)
    const sick23Half = Math.max(0, Math.min(sickDays - 1, 2))
    const sick4Full  = Math.max(0, sickDays - 3)

    setAbsentBreakdownDetail({ dailyRate, izinDays: izinDays + autoIzin, alphaDays, sickDays, sick1Free, sick23Half, sick4Full, autoIzin })
  }

  // ─── Bonus Kondisional Modal ───────────────────────────────────────────────

  async function openBonusModal(p: Payroll) {
    setBonusModal(p)
    // Ambil kriteria aktif karyawan
    const { data: crit } = await supabase
      .from('employee_bonus_criteria')
      .select('*')
      .eq('employee_id', p.employee_id)
      .eq('is_active', true)
    setBonusCriteria((crit as BonusCriteria[]) || [])

    // Ambil assessment yang sudah ada
    const { data: assess } = await supabase
      .from('payroll_bonus_assessments')
      .select('*')
      .eq('payroll_id', p.id)
    const achMap: Record<string, boolean> = {}
    const notesMap: Record<string, string> = {}
    ;(assess || []).forEach((a: BonusAssessment) => {
      achMap[a.criteria_id] = a.is_achieved
      notesMap[a.criteria_id] = a.notes || ''
    })
    setBonusAssessments(achMap)
    setBonusNotes(notesMap)
  }

  async function handleSaveBonus() {
    if (!bonusModal || !currentUser) return
    setBonusSaving(true)

    // Upsert semua assessment
    const upserts = bonusCriteria.map(c => ({
      payroll_id: bonusModal.id,
      criteria_id: c.id,
      employee_id: bonusModal.employee_id,
      period_month: bonusModal.period_month,
      period_year: bonusModal.period_year,
      is_achieved: bonusAssessments[c.id] ?? false,
      notes: bonusNotes[c.id] || null,
      assessed_by: currentUser.employee_id
    }))

    if (upserts.length > 0) {
      const { error } = await supabase
        .from('payroll_bonus_assessments')
        .upsert(upserts, { onConflict: 'payroll_id,criteria_id' })
      if (error) { showMessage('error', 'Gagal menyimpan penilaian: ' + error.message); setBonusSaving(false); return }
    }

    // Hitung total bonus kondisional
    const totalBonus = bonusCriteria.reduce((sum, c) => {
      return sum + (bonusAssessments[c.id] ? Number(c.nominal_amount) : 0)
    }, 0)

    // Update payroll: conditional_bonus + recalc gross & net
    const p = bonusModal
    const newGross = Number(p.base_salary) + Number(p.position_allowance) + Number(p.meal_allowance) + Number(p.overtime_total) + Number(p.kpi_bonus) + totalBonus
    const newNet = calcNet({ ...p, gross_total: newGross })

    const { error: updateErr } = await supabase
      .from('payrolls')
      .update({ conditional_bonus: totalBonus, gross_total: newGross, net_total: newNet })
      .eq('id', p.id)

    if (updateErr) showMessage('error', 'Gagal update payroll: ' + updateErr.message)
    else {
      showMessage('success', 'Penilaian bonus berhasil disimpan.')
      setBonusModal(null)
      await fetchPayrolls()
    }
    setBonusSaving(false)
  }

  // ─── Summary kalkulasi ─────────────────────────────────────────────────────

  const totalGross   = payrolls.reduce((sum, p) => sum + Number(p.gross_total), 0)
  const totalNet     = payrolls.reduce((sum, p) => sum + Number(p.net_total), 0)
  const countDraft   = payrolls.filter(p => p.status === 'draft').length
  const countPending = payrolls.filter(p => p.status === 'pending_approval').length
  const countApproved= payrolls.filter(p => p.status === 'approved').length
  const countPaid    = payrolls.filter(p => p.status === 'paid').length

  // ─── Generate tahun pilihan (3 tahun ke belakang) ─────────────────────────
  const yearOptions = Array.from({ length: 4 }, (_, i) => today.getFullYear() - i)

  // ─── Print Slip ke jendela baru ───────────────────────────────────────────
  function printSlip(p: typeof selectedPayroll) {
    if (!p) return
    const fmtR = (n: number) => n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 })
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
    const statusLabel = STATUS_CONFIG[p.status]?.label ?? p.status

    // Detail lembur
    const otTotal = Number(p.overtime_total)
    const otRate  = otDetails.length > 0 && otDetails[0].hours > 0 ? Math.round(otDetails[0].earning / otDetails[0].hours) : 0
    const otDetailHtml = otDetails.length > 0
      ? `<div class="detail-block">
          ${otDetails.map(d => `<div class="detail-row"><span>${fmtDate(d.date)}</span><span>${d.hours} jam × ${fmtR(otRate)}/jam = <span class="earn">${fmtR(d.earning)}</span></span></div>`).join('')}
          <div class="detail-total">Total: ${otDetails.reduce((s,d)=>s+d.hours,0)} jam</div>
         </div>` : ''

    // Detail keterlambatan
    const lateDed = Number(p.late_deduction)
    const lateDetailHtml = lateDetails.length > 0
      ? `<div class="detail-block">
          ${lateDetails.map(d => `<div class="detail-row"><span>${fmtDate(d.date)}</span><span>${d.late_minutes} mnt × ${fmtR(lateRate)}/mnt = <span class="ded-detail">${fmtR(d.deduction)}</span></span></div>`).join('')}
          <div class="detail-total">Total: ${lateDetails.reduce((s,d)=>s+d.late_minutes,0)} menit</div>
         </div>` : ''

    // Detail kehilangan barang
    const invLoss = Number(p.inventory_loss_deduction ?? 0)
    const lossDetailHtml = lossDetail && lossDetail.totalLoss > 0
      ? `<div class="detail-block">
          <div class="detail-row"><span>Total kehilangan cabang</span><span>${fmtR(lossDetail.totalLoss)}</span></div>
          <div class="detail-row"><span>Kantor menanggung (${lossDetail.companyPct + lossDetail.unassignedPct}%)</span><span class="earn">${fmtR(lossDetail.companyTotalCover)}</span></div>
          <div class="detail-row"><span>Tanggungan Anda (${lossDetail.employeeSharePct}%)</span><span class="ded-detail">${fmtR(lossDetail.employeeDeduction)}</span></div>
         </div>` : ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Slip Gaji - ${p.employee?.full_name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; background: white; }
  .wrap { width: 680px; margin: 0 auto; padding: 32px 40px; }
  .kop { text-align: center; border-bottom: 2px solid #1e293b; padding-bottom: 14px; margin-bottom: 18px; }
  .kop h1 { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
  .kop p { font-size: 11px; color: #64748b; margin-top: 2px; }
  .status-badge { display: inline-block; margin-top: 6px; padding: 2px 12px; border-radius: 99px; font-size: 10px; font-weight: 700; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 20px; font-size: 11.5px; }
  .info-grid .row { display: flex; gap: 6px; }
  .info-grid .lbl { color: #64748b; width: 70px; flex-shrink: 0; }
  .info-grid .val { font-weight: 600; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11.5px; }
  th { background: #f8fafc; padding: 7px 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  th:last-child { text-align: right; }
  td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: top; }
  td:last-child { text-align: right; font-weight: 600; }
  .section-label td { background: #f0fdf4; color: #16a34a; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; padding: 5px 12px; }
  .section-label.ded td { background: #fff5f5; color: #dc2626; }
  .zero { color: #cbd5e1 !important; font-weight: 400 !important; }
  .ded-val { color: #dc2626 !important; }
  .bruto-row td { background: #f8fafc; font-weight: 700; font-size: 12px; border-top: 2px solid #e2e8f0; }
  .bersih-row { background: #1d4ed8; color: white; border-radius: 10px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
  .bersih-row .label { font-size: 13px; font-weight: 700; }
  .bersih-row .val { font-size: 18px; font-weight: 800; }
  .footer { margin-top: 24px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 10px; }
  .detail-block { margin-top: 4px; padding: 4px 0 2px 10px; border-left: 2px solid #e2e8f0; }
  .detail-row { display: flex; justify-content: space-between; font-size: 10px; color: #64748b; padding: 1px 0; }
  .detail-total { font-size: 10px; font-weight: 700; color: #475569; margin-top: 3px; border-top: 1px solid #f1f5f9; padding-top: 2px; }
  .earn { color: #16a34a; }
  .ded-detail { color: #dc2626; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="wrap">
  <div class="kop">
    <h1>HAMMIELION MANAGEMENT</h1>
    <p>Slip Gaji Karyawan Tetap</p>
    <span class="status-badge">${statusLabel}</span>
  </div>
  <div class="info-grid">
    <div class="row"><span class="lbl">Nama</span><span class="val">: ${p.employee?.full_name ?? '—'}</span></div>
    <div class="row"><span class="lbl">Jabatan</span><span class="val">: ${p.employee?.positions?.name ?? '—'}</span></div>
    <div class="row"><span class="lbl">Cabang</span><span class="val">: ${p.employee?.branches?.name ?? '—'}</span></div>
    <div class="row"><span class="lbl">Periode</span><span class="val">: ${getPeriodLabel(p.period_month, p.period_year)}</span></div>
    ${(() => {
      const jd = (p.employee as any)?.join_date
      if (!jd) return ''
      const join = new Date(jd)
      const now  = new Date()
      let y = now.getFullYear() - join.getFullYear()
      let mo = now.getMonth() - join.getMonth()
      if (mo < 0) { y--; mo += 12 }
      const lama = y === 0 ? `${mo} bulan` : mo > 0 ? `${y} tahun ${mo} bulan` : `${y} tahun`
      const joinLabel = join.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      return `<div class="row"><span class="lbl">Tgl Bergabung</span><span class="val">: ${joinLabel}</span></div>
              <div class="row"><span class="lbl">Lama Bekerja</span><span class="val">: ${lama}</span></div>`
    })()}
  </div>
  <table>
    <thead><tr><th>Komponen</th><th>Jumlah</th></tr></thead>
    <tbody>
      <tr class="section-label"><td colspan="2">Pendapatan</td></tr>
      <tr><td>Gaji Pokok</td><td>${Number(p.base_salary)>0?fmtR(Number(p.base_salary)):'<span class="zero">—</span>'}</td></tr>
      <tr><td>Tunjangan Jabatan</td><td>${Number(p.position_allowance)>0?fmtR(Number(p.position_allowance)):'<span class="zero">—</span>'}</td></tr>
      <tr><td>Tunjangan Tetap</td><td>${Number(p.meal_allowance)>0?fmtR(Number(p.meal_allowance)):'<span class="zero">—</span>'}</td></tr>
      <tr><td>Upah Lembur${otDetailHtml}</td><td>${otTotal>0?fmtR(otTotal):'<span class="zero">—</span>'}</td></tr>
      <tr><td>Bonus KPI</td><td>${Number(p.kpi_bonus)>0?fmtR(Number(p.kpi_bonus)):'<span class="zero">—</span>'}</td></tr>
      <tr><td>Bonus Kondisional</td><td>${Number((p as any).conditional_bonus??0)>0?fmtR(Number((p as any).conditional_bonus)):'<span class="zero">—</span>'}</td></tr>
      <tr class="section-label ded"><td colspan="2">Potongan</td></tr>
      <tr><td>Potongan Keterlambatan${lateDetailHtml}</td><td>${lateDed>0?'-'+fmtR(lateDed):'<span class="zero">—</span>'}</td></tr>
      <tr><td>Potongan Kasbon</td><td class="${Number(p.kasbon_deduction)>0?'ded-val':'zero'}">${Number(p.kasbon_deduction)>0?'-'+fmtR(Number(p.kasbon_deduction)):'—'}</td></tr>
      <tr><td>Tabungan Loyalitas</td><td class="${Number(p.loyalitas_deduction??0)>0?'ded-val':'zero'}">${Number(p.loyalitas_deduction??0)>0?'-'+fmtR(Number(p.loyalitas_deduction??0)):'—'}</td></tr>
      <tr><td>Kerugian Kasir</td><td class="${Number(p.cashier_loss_deduction??0)>0?'ded-val':'zero'}">${Number(p.cashier_loss_deduction??0)>0?'-'+fmtR(Number(p.cashier_loss_deduction??0)):'—'}</td></tr>
      <tr><td>Kehilangan Barang${lossDetailHtml}</td><td>${invLoss>0?'-'+fmtR(invLoss):'<span class="zero">—</span>'}</td></tr>
      <tr><td>Tidak Hadir (${p.absent_days??0} hari)</td><td class="${Number(p.absent_deduction??0)>0?'ded-val':'zero'}">${Number(p.absent_deduction??0)>0?'-'+fmtR(Number(p.absent_deduction??0)):'—'}</td></tr>
      <tr class="bruto-row"><td>Total Bruto</td><td>${fmtR(Number(p.gross_total))}</td></tr>
    </tbody>
  </table>
  <div class="bersih-row">
    <span class="label">Gaji Bersih</span>
    <span class="val">${fmtR(Number(p.net_total))}</span>
  </div>
  <div class="footer">
    <span>Digenerate: ${new Date(p.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
    ${p.approved_by && (p as any).approver?.full_name ? `<span>Disetujui: <strong>${(p as any).approver.full_name}</strong></span>` : ''}
  </div>
</div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
</body></html>`
    const win = window.open('', '_blank', 'width=780,height=900')
    if (win) { win.document.write(html); win.document.close() }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
    <div>
      {/* ── Header ── */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex-1 flex justify-between items-start w-full">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-1">Penggajian Bulanan</h1>
            <p className="text-sm text-slate-500">
              Kelola slip gaji karyawan tetap — {getPeriodLabel(filterMonth, filterYear)}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition print-hide"
          >
            🖨️ Cetak Rekap
          </button>
        </div>

        {/* Tombol Buat Slip Per Karyawan */}
        <button
          onClick={openCreateModal}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
        >
          ✨ Buat Slip Karyawan
        </button>
      </div>

      {/* ── Alert message ── */}
      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${
          message.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {/* ── Filter Bar ── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-5 print-hide">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          {/* Filter Bulan */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Bulan</label>
            <select
              value={filterMonth}
              onChange={e => setFilterMonth(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[130px]"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          {/* Filter Tahun */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tahun</label>
            <select
              value={filterYear}
              onChange={e => setFilterYear(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[90px]"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Filter Cabang */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Cabang</label>
            <select
              value={filterBranch}
              onChange={e => setFilterBranch(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[160px]"
            >
              <option value="">Semua Cabang</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Tombol Refresh */}
          <button
            onClick={fetchPayrolls}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-medium transition"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">Total Slip</p>
          <p className="text-xl font-bold text-slate-800">{payrolls.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">Total Bruto</p>
          <p className="text-lg font-bold text-slate-700 leading-tight">{formatRupiah(totalGross)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase mb-1">Total Bersih</p>
          <p className="text-lg font-bold text-blue-600 leading-tight">{formatRupiah(totalNet)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-400 uppercase mb-1.5">Draft</p>
          <p className="text-xl font-bold text-slate-500">{countDraft}</p>
        </div>
        <div className="bg-yellow-50 rounded-xl border border-yellow-100 p-4 shadow-sm">
          <p className="text-xs font-medium text-yellow-600 uppercase mb-1.5">Menunggu</p>
          <p className="text-xl font-bold text-yellow-700">{countPending}</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-4 shadow-sm">
          <p className="text-xs font-medium text-green-600 uppercase mb-1.5">Lunas</p>
          <p className="text-xl font-bold text-green-700">{countPaid}</p>
        </div>
      </div>

      {/* ── Tabel Daftar Slip Gaji ── */}
      <div id="rekap-print-area" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        
        {/* Kop Surat Print Rekap */}
        <div className="hidden print:block text-center mt-6 mb-4 pb-4 border-b-2 border-slate-800 mx-6">
          <h1 className="text-xl font-bold text-slate-900 uppercase tracking-wider">HAMMIELION MANAGEMENT</h1>
          <p className="text-sm text-slate-600 mt-1">Rekap Penggajian Karyawan Tetap</p>
          <p className="text-sm text-slate-600">Periode: {getPeriodLabel(filterMonth, filterYear)}</p>
          <p className="text-xs text-slate-400 mt-1">Dicetak: {new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>

        {/* Tabel header info */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">
            Daftar Slip — {getPeriodLabel(filterMonth, filterYear)}
            {filterBranch && branches.find(b => b.id === filterBranch)
              ? ` · ${branches.find(b => b.id === filterBranch)!.name}`
              : ''}
          </span>
          <span className="text-xs text-slate-400">{payrolls.length} slip ditemukan</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">Periode</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Gaji Pokok</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Total Tunjangan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Lembur</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Bonus KPI</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Pot. Kasbon</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Pot. Telat</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right whitespace-nowrap">Total Bersih</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center whitespace-nowrap print-hide">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      <span className="text-sm">Memuat data slip gaji...</span>
                    </div>
                  </td>
                </tr>
              ) : payrolls.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                      <span className="text-4xl">📄</span>
                      <div>
                        <p className="text-sm font-medium text-slate-500">Belum ada slip gaji</p>
                        <p className="text-xs mt-1">
                          Klik <span className="font-semibold text-blue-600">Generate Slip Bulan Ini</span> untuk membuat slip otomatis.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                payrolls.map(p => {
                  const totalTunjangan = Number(p.position_allowance) + Number(p.meal_allowance)
                  const statusCfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.draft

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Karyawan */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 whitespace-nowrap">
                          {p.employee?.full_name ?? '—'}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {p.employee?.positions?.name ?? ''}
                          {p.employee?.branches?.name ? ` · ${p.employee.branches.name}` : ''}
                        </div>
                      </td>

                      {/* Periode */}
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {getPeriodLabel(p.period_month, p.period_year)}
                      </td>

                      {/* Gaji Pokok */}
                      <td className="px-4 py-3 text-right font-medium text-slate-700 whitespace-nowrap">
                        {formatRupiah(p.base_salary)}
                      </td>

                      {/* Total Tunjangan */}
                      <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">
                        {formatRupiah(totalTunjangan)}
                      </td>

                      {/* Lembur */}
                      <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">
                        {Number(p.overtime_total) > 0
                          ? <span className="text-emerald-600 font-medium">{formatRupiah(p.overtime_total)}</span>
                          : <span className="text-slate-300">—</span>
                        }
                      </td>

                      {/* Bonus KPI */}
                      <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">
                        {Number(p.kpi_bonus) > 0
                          ? <span className="text-purple-600 font-medium">{formatRupiah(p.kpi_bonus)}</span>
                          : <span className="text-slate-300">—</span>
                        }
                      </td>

                      {/* Potongan Kasbon — dengan info saldo */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {p.status === 'draft' ? (
                          <div className="flex flex-col items-end gap-1 print-hide">
                            {/* Info saldo aktif */}
                            {(kasbonSaldoMap[p.employee_id] ?? 0) > 0 && (
                              <div className="text-xs text-amber-600 font-medium">
                                Saldo: {formatRupiah(kasbonSaldoMap[p.employee_id])}
                              </div>
                            )}
                            {/* Input potongan */}
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                step="1000"
                                value={kasbonEdit[p.id] ?? '0'}
                                onChange={e => setKasbonEdit(prev => ({ ...prev, [p.id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && handleSaveKasbon(p)}
                                className="w-28 px-2 py-1 border border-slate-300 rounded text-xs text-right focus:ring-1 focus:ring-blue-400 outline-none"
                              />
                              <button
                                onClick={() => handleSaveKasbon(p)}
                                disabled={kasbonSaving[p.id]}
                                title="Simpan kasbon"
                                className="px-1.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition disabled:opacity-50"
                              >
                                {kasbonSaving[p.id] ? '...' : '✓'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-0.5">
                            {Number(p.kasbon_deduction) > 0
                              ? <span className="text-red-500 font-medium">-{formatRupiah(p.kasbon_deduction)}</span>
                              : <span className="text-slate-300">—</span>
                            }
                            {(kasbonSaldoMap[p.employee_id] ?? 0) > 0 && p.status !== 'paid' && (
                              <span className="text-xs text-amber-500">Sisa: {formatRupiah(kasbonSaldoMap[p.employee_id])}</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Potongan Telat */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {Number(p.late_deduction) > 0
                          ? <span className="text-orange-500 font-medium">-{formatRupiah(p.late_deduction)}</span>
                          : <span className="text-slate-300">—</span>
                        }
                      </td>

                      {/* Total Bersih */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="font-bold text-slate-900">{formatRupiah(p.net_total)}</span>
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusCfg.className}`}>
                          {statusCfg.label}
                        </span>
                        {p.approved_by && p.approver?.full_name && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            oleh {p.approver.full_name}
                          </div>
                        )}
                      </td>

                      {/* Aksi — Part 4 aktif */}
                      <td className="px-4 py-3 text-center whitespace-nowrap print-hide">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => { setSelectedPayroll(p); fetchLateDetails(p); fetchLossDetail(p); fetchOtDetails(p); fetchAbsentBreakdown(p) }}
                            className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition"
                          >
                            Lihat
                          </button>
                          {p.status === 'draft' && (
                            <button
                              onClick={() => openBonusModal(p)}
                              className="px-2.5 py-1.5 text-xs font-medium bg-purple-50 border border-purple-200 rounded-lg text-purple-700 hover:bg-purple-100 transition"
                            >
                              Input Bonus
                            </button>
                          )}

                          {p.status === 'draft' && (
                            <button
                              onClick={() => handleDeletePayroll(p.id, p.employee?.full_name ?? '', p.employee_id, Number(p.kasbon_deduction))}
                              disabled={submitting === p.id}
                              className="px-2.5 py-1.5 text-xs font-medium bg-white border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition disabled:opacity-50"
                            >
                              Hapus
                            </button>
                          )}

                          {/* Ajukan: draft → pending_approval */}
                          {p.status === 'draft' && canAjukan() && (
                            <button
                              onClick={() => handleStatusChange(p, 'ajukan')}
                              disabled={submitting === p.id}
                              className="px-2.5 py-1.5 text-xs font-medium bg-yellow-50 border border-yellow-300 rounded-lg text-yellow-700 hover:bg-yellow-100 transition disabled:opacity-50"
                            >
                              {submitting === p.id ? '...' : 'Ajukan'}
                            </button>
                          )}

                          {/* Approve: pending_approval → approved */}
                          {p.status === 'pending_approval' && canApprove() && (
                            <button
                              onClick={() => handleStatusChange(p, 'approve')}
                              disabled={submitting === p.id}
                              className="px-2.5 py-1.5 text-xs font-medium bg-blue-50 border border-blue-300 rounded-lg text-blue-700 hover:bg-blue-100 transition disabled:opacity-50"
                            >
                              {submitting === p.id ? '...' : 'Approve'}
                            </button>
                          )}

                          {/* Tandai Lunas: approved → paid */}
                          {p.status === 'approved' && canPaid() && (
                            <button
                              onClick={() => handleStatusChange(p, 'paid')}
                              disabled={submitting === p.id}
                              className="px-2.5 py-1.5 text-xs font-medium bg-green-50 border border-green-300 rounded-lg text-green-700 hover:bg-green-100 transition disabled:opacity-50"
                            >
                              {submitting === p.id ? '...' : 'Tandai Lunas'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        {!loading && payrolls.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs text-slate-500">
            <span>
              {payrolls.length} karyawan tetap terdaftar periode {getPeriodLabel(filterMonth, filterYear)}
            </span>
            <div className="flex gap-4">
              <span>Bruto: <strong className="text-slate-700">{formatRupiah(totalGross)}</strong></span>
              <span>Bersih: <strong className="text-blue-600">{formatRupiah(totalNet)}</strong></span>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* ─── Part 5: Modal Detail Slip Gaji ───────────────────────────────────── */}
    {selectedPayroll && (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/50 overflow-y-auto"
        onClick={e => { if (e.target === e.currentTarget) setSelectedPayroll(null) }}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4" id="slip-print-area">

          {/* Header Modal */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-700">Detail Slip Gaji</h2>
            <div className="flex gap-2">
              <button
                onClick={() => printSlip(selectedPayroll)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition"
              >
                🖨️ Cetak
              </button>
              <button
                onClick={() => setSelectedPayroll(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition"
              >
                ✕ Tutup
              </button>
            </div>
          </div>

          {/* Konten Slip */}
          <div className="px-6 py-5 space-y-5">

            {/* Kop Slip */}
            <div className="text-center pb-4 border-b border-slate-200">
              <h1 className="text-xl font-bold text-slate-800 tracking-wide">HAMMIELION MANAGEMENT</h1>
              <p className="text-sm text-slate-500 mt-0.5">Slip Gaji Karyawan Tetap</p>
              <div className={`inline-flex items-center mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
                STATUS_CONFIG[selectedPayroll.status]?.className ?? 'bg-slate-100 text-slate-600'
              }`}>
                {STATUS_CONFIG[selectedPayroll.status]?.label ?? selectedPayroll.status}
              </div>
            </div>

            {/* Info Karyawan */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {(() => {
                const joinDate = (selectedPayroll.employee as any)?.join_date
                const joinLabel = joinDate ? new Date(joinDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
                const lamaKerja = (() => {
                  if (!joinDate) return '—'
                  const join = new Date(joinDate)
                  const now  = new Date()
                  let years  = now.getFullYear() - join.getFullYear()
                  let months = now.getMonth() - join.getMonth()
                  if (months < 0) { years--; months += 12 }
                  if (years === 0) return `${months} bulan`
                  return months > 0 ? `${years} tahun ${months} bulan` : `${years} tahun`
                })()
                return [
                  ['Nama',              selectedPayroll.employee?.full_name ?? '—'],
                  ['Jabatan',           selectedPayroll.employee?.positions?.name ?? '—'],
                  ['Cabang',            selectedPayroll.employee?.branches?.name  ?? '—'],
                  ['Periode',           getPeriodLabel(selectedPayroll.period_month, selectedPayroll.period_year)],
                  ['Tgl Bergabung',     joinLabel],
                  ['Lama Bekerja',      lamaKerja],
                ].map(([label, val]) => (
                  <div key={label} className="flex gap-2">
                    <span className="text-slate-500 w-28 shrink-0">{label}</span>
                    <span className="font-medium text-slate-800">: {val}</span>
                  </div>
                ))
              })()}
            </div>

            {/* Tabel Komponen */}
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Komponen</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Jumlah</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* Pendapatan */}
                  <tr className="bg-emerald-50/50">
                    <td colSpan={2} className="px-4 py-1.5 text-xs font-bold text-emerald-700 uppercase tracking-wide">Pendapatan</td>
                  </tr>
                  {[
                    ['Gaji Pokok',           selectedPayroll.base_salary],
                    ['Tunjangan Jabatan',    selectedPayroll.position_allowance],
                    ['Tunjangan Tetap',      selectedPayroll.meal_allowance],
                  ].map(([label, val]) => (
                    <tr key={String(label)} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-700">{label}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                        {Number(val) > 0 ? formatRupiah(Number(val)) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                  {/* Upah Lembur dengan detail per hari */}
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700">
                      <div>Upah Lembur</div>
                      {loadingOt && <div className="text-xs text-slate-400 mt-0.5">Memuat detail...</div>}
                      {!loadingOt && otDetails.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {otDetails.map(d => (
                            <div key={d.date} className="text-xs text-slate-400 flex gap-2">
                              <span>└</span>
                              <span>{new Date(d.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</span>
                              <span>{d.hours} jam × {formatRupiah((d.earning / d.hours) || 0)}/jam = <span className="text-emerald-500">{formatRupiah(d.earning)}</span></span>
                            </div>
                          ))}
                          <div className="text-xs text-slate-500 font-semibold flex gap-2 mt-1 pt-1 border-t border-slate-100">
                            <span>└</span>
                            <span>Total: {otDetails.reduce((s, d) => s + d.hours, 0)} jam</span>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-800 align-top">
                      {Number(selectedPayroll.overtime_total) > 0 ? formatRupiah(Number(selectedPayroll.overtime_total)) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {[
                    ['Bonus KPI',            selectedPayroll.kpi_bonus],
                    ['Bonus Kondisional',    (selectedPayroll as any).conditional_bonus ?? 0],
                  ].map(([label, val]) => (
                    <tr key={String(label)} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-700">{label}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                        {Number(val) > 0 ? formatRupiah(Number(val)) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}

                  {/* Potongan */}
                  <tr className="bg-red-50/50">
                    <td colSpan={2} className="px-4 py-1.5 text-xs font-bold text-red-600 uppercase tracking-wide">Potongan</td>
                  </tr>
                  {/* Keterlambatan dengan detail */}
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700">
                      <div>Potongan Keterlambatan</div>
                      {loadingLate && <div className="text-xs text-slate-400 mt-0.5">Memuat detail...</div>}
                      {!loadingLate && lateDetails.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {lateDetails.map(d => (
                            <div key={d.date} className="text-xs text-slate-400 flex gap-2">
                              <span>└</span>
                              <span>{new Date(d.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</span>
                              <span>{d.late_minutes} mnt</span>
                              {lateRate > 0 && <span>× {formatRupiah(lateRate)}/mnt = <span className="text-red-400">{formatRupiah(d.deduction)}</span></span>}
                            </div>
                          ))}
                          <div className="text-xs text-slate-500 font-semibold flex gap-2 mt-1 pt-1 border-t border-slate-100">
                            <span>└</span>
                            <span>Total: {lateDetails.reduce((s, d) => s + d.late_minutes, 0)} menit</span>
                          </div>
                        </div>
                      )}
                      {!loadingLate && lateDetails.length === 0 && Number(selectedPayroll.late_deduction) > 0 && (
                        <div className="text-xs text-slate-400 mt-0.5">└ Tidak ada rincian tersimpan</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-red-500 align-top">
                      {Number(selectedPayroll.late_deduction) > 0 ? `-${formatRupiah(Number(selectedPayroll.late_deduction))}` : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {/* Kasbon dengan info saldo */}
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700">
                      <div>Potongan Kasbon</div>
                      {(kasbonSaldoMap[selectedPayroll.employee_id] ?? 0) > 0 && (
                        <div className="text-xs text-amber-600 mt-0.5">
                          └ Saldo kasbon aktif: {formatRupiah(kasbonSaldoMap[selectedPayroll.employee_id])}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-red-500 align-top">
                      {Number(selectedPayroll.kasbon_deduction) > 0
                        ? `-${formatRupiah(Number(selectedPayroll.kasbon_deduction))}`
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {/* Potongan lainnya */}
                  {[
                    ['Tabungan Loyalitas', selectedPayroll.loyalitas_deduction ?? 0],
                    ['Kerugian Kasir',      selectedPayroll.cashier_loss_deduction ?? 0],
                  ].map(([label, val]) => (
                    <tr key={String(label)} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-700">{label}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-red-500">
                        {Number(val) > 0 ? `-${formatRupiah(Number(val))}` : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                  {/* Tidak Hadir dengan breakdown */}
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700 align-top">
                      <div>Tidak Hadir ({selectedPayroll.absent_days ?? 0} hari)</div>
                      {absentBreakdownDetail && (
                        <div className="mt-1 space-y-0.5">
                          <div className="text-xs text-slate-400">└ Gaji harian (total komponen ÷ 26): <span className="font-medium text-slate-600">{formatRupiah(absentBreakdownDetail.dailyRate)}</span></div>
                          {absentBreakdownDetail.izinDays > 0 && (
                            <div className="text-xs text-orange-500">
                              └ Izin{absentBreakdownDetail.autoIzin > 0 ? ` (${absentBreakdownDetail.izinDays - absentBreakdownDetail.autoIzin} eksplisit + ${absentBreakdownDetail.autoIzin} hari kosong)` : ''}: {absentBreakdownDetail.izinDays} hari × 1× = {formatRupiah(absentBreakdownDetail.izinDays * absentBreakdownDetail.dailyRate)}
                            </div>
                          )}
                          {absentBreakdownDetail.alphaDays > 0 && (
                            <div className="text-xs text-red-400">└ Alpha: {absentBreakdownDetail.alphaDays} hari × 1.5× = {formatRupiah(Math.round(absentBreakdownDetail.alphaDays * absentBreakdownDetail.dailyRate * 1.5))}</div>
                          )}
                          {absentBreakdownDetail.sickDays > 0 && (
                            <div className="text-xs text-blue-400">
                              └ Sakit: {absentBreakdownDetail.sickDays} hari
                              {absentBreakdownDetail.sick1Free > 0 && <span> · hari ke-1 gratis</span>}
                              {absentBreakdownDetail.sick23Half > 0 && <span> · hari ke-{1+absentBreakdownDetail.sick1Free}–{1+absentBreakdownDetail.sick1Free+absentBreakdownDetail.sick23Half-1} = {formatRupiah(Math.round(absentBreakdownDetail.sick23Half * absentBreakdownDetail.dailyRate * 0.5))}</span>}
                              {absentBreakdownDetail.sick4Full > 0 && <span> · hari ke-4+ = {formatRupiah(absentBreakdownDetail.sick4Full * absentBreakdownDetail.dailyRate)}</span>}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-red-500 align-top">
                      {Number(selectedPayroll.absent_deduction ?? 0) > 0 ? `-${formatRupiah(Number(selectedPayroll.absent_deduction))}` : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {/* Kehilangan Barang dengan detail */}
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700">
                      <div>Kehilangan Barang</div>
                      {loadingLoss && <div className="text-xs text-slate-400 mt-0.5">Memuat detail...</div>}
                      {!loadingLoss && lossDetail && lossDetail.totalLoss > 0 && (
                        <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                          <div>└ Total kehilangan cabang : <span className="text-slate-600">{formatRupiah(lossDetail.totalLoss)}</span></div>
                          <div>
                            └ Kantor menanggung ({lossDetail.companyPct + lossDetail.unassignedPct}%)
                            {lossDetail.unassignedPct > 0 && <span className="text-slate-400"> (termasuk sisa {lossDetail.unassignedPct}% tak ter-assign)</span>}
                            <span className="ml-1">: <span className="text-blue-500">{formatRupiah(lossDetail.companyTotalCover)}</span></span>
                          </div>
                          <div>└ Tanggungan Anda ({lossDetail.employeeSharePct}%) : <span className="text-red-400">{formatRupiah(lossDetail.employeeDeduction)}</span></div>
                        </div>
                      )}
                      {!loadingLoss && !lossDetail && Number(selectedPayroll.inventory_loss_deduction) > 0 && (
                        <div className="text-xs text-slate-400 mt-0.5">└ Tidak ada data kehilangan bulan ini</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-red-500 align-top">
                      {Number(selectedPayroll.inventory_loss_deduction) > 0
                        ? `-${formatRupiah(Number(selectedPayroll.inventory_loss_deduction))}`
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>

                  {/* Total Bruto */}
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td className="px-4 py-2.5 text-sm font-semibold text-slate-700">Total Bruto</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                      {formatRupiah(selectedPayroll.gross_total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Total Bersih */}
            <div className="flex items-center justify-between bg-blue-600 text-white rounded-xl px-5 py-4">
              <span className="font-bold text-base">Total Gaji Bersih</span>
              <span className="font-bold text-xl">{formatRupiah(selectedPayroll.net_total)}</span>
            </div>

            {/* Footer Slip */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2 border-t border-slate-100 text-xs text-slate-400">
              <span>Digenerate: {new Date(selectedPayroll.created_at).toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}</span>
              {selectedPayroll.approved_by && selectedPayroll.approver?.full_name && (
                <span>Disetujui oleh: <strong className="text-slate-600">{selectedPayroll.approver.full_name}</strong></span>
              )}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ─── Modal Bonus Kondisional ─── */}
    {bonusModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={e => { if (e.target === e.currentTarget) setBonusModal(null) }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-700">Input Bonus Kondisional</h2>
              <p className="text-sm text-slate-500">{bonusModal.employee?.full_name} — {MONTHS[bonusModal.period_month-1]} {bonusModal.period_year}</p>
            </div>
            <button onClick={() => setBonusModal(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg">✕ Tutup</button>
          </div>
          <div className="px-6 py-5 space-y-4">
            {bonusCriteria.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <p className="text-sm">Karyawan ini belum memiliki kriteria bonus kondisional.</p>
                <p className="text-xs mt-1 text-slate-400">Setup di menu Setup → Bonus Kondisional</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-500">Centang kriteria yang terpenuhi bulan ini:</p>
                <div className="space-y-3">
                  {bonusCriteria.map(c => (
                    <div key={c.id} className={`p-4 rounded-xl border transition ${bonusAssessments[c.id] ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
                      <div className="flex items-center gap-3">
                        <input type="checkbox" id={`crit-${c.id}`}
                          checked={bonusAssessments[c.id] ?? false}
                          onChange={e => setBonusAssessments(prev => ({ ...prev, [c.id]: e.target.checked }))}
                          className="w-5 h-5 rounded text-green-600 cursor-pointer"
                        />
                        <label htmlFor={`crit-${c.id}`} className="flex-1 cursor-pointer">
                          <div className="text-sm font-medium text-slate-800">{c.criteria_name}</div>
                          <div className={`text-xs font-bold ${bonusAssessments[c.id] ? 'text-green-600' : 'text-slate-400'}`}>
                            {bonusAssessments[c.id] ? `✓ +${formatRupiah(c.nominal_amount)}` : formatRupiah(c.nominal_amount)}
                          </div>
                        </label>
                      </div>
                      <div className="mt-2 ml-8">
                        <input type="text" placeholder="Catatan (opsional)"
                          value={bonusNotes[c.id] || ''}
                          onChange={e => setBonusNotes(prev => ({ ...prev, [c.id]: e.target.value }))}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-xs text-slate-600 focus:ring-1 focus:ring-blue-400 outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Total */}
                <div className="flex items-center justify-between bg-blue-600 text-white rounded-xl px-4 py-3">
                  <span className="font-semibold text-sm">Total Bonus Kondisional</span>
                  <span className="font-bold text-lg">
                    {formatRupiah(bonusCriteria.reduce((s, c) => s + (bonusAssessments[c.id] ? Number(c.nominal_amount) : 0), 0))}
                  </span>
                </div>
              </>
            )}
            {bonusCriteria.length > 0 && (
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setBonusModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">Batal</button>
                <button onClick={handleSaveBonus} disabled={bonusSaving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                  {bonusSaving ? 'Menyimpan...' : 'Simpan Penilaian'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* ─── Modal Buat Slip Per Karyawan ─── */}
    {createModal && (
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/50 overflow-y-auto"
        onClick={e => { if (e.target === e.currentTarget) setCreateModal(false) }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4">

          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-700">Buat Slip Gaji</h2>
              <p className="text-xs text-slate-500 mt-0.5">{getPeriodLabel(filterMonth, filterYear)}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Step indicator */}
              <div className="flex items-center gap-1 text-xs text-slate-400">
                {[1,2,3].map(s => (
                  <span key={s} className={`w-6 h-6 rounded-full flex items-center justify-center font-semibold text-xs transition ${createStep === s ? 'bg-blue-600 text-white' : createStep > s ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>{createStep > s ? '✓' : s}</span>
                ))}
              </div>
              <button onClick={() => setCreateModal(false)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-lg">✕</button>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">

            {/* ── Step 1: Pilih Karyawan + Validasi ── */}
            {createStep === 1 && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Pilih Karyawan <span className="text-red-500">*</span></label>
                  {availableEmps.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">Semua karyawan tetap sudah punya slip untuk periode ini.</p>
                  ) : (
                    <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">-- Pilih karyawan --</option>
                      {availableEmps.map(e => (
                        <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code}) — {(e.positions as any)?.name ?? '—'}</option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedEmpId && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Checklist Validasi</p>

                    {/* Cek hari belum terklasifikasi */}
                    {checkingUnclassified ? (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-400 text-center">
                        Memeriksa rekap absensi...
                      </div>
                    ) : unclassifiedDays.length > 0 ? (
                      <div className="p-3 bg-red-50 border border-red-300 rounded-lg space-y-2">
                        <p className="text-sm font-semibold text-red-700">🚫 Ada {unclassifiedDays.length} hari belum diklasifikasi</p>
                        <p className="text-xs text-red-600">Slip tidak bisa dibuat. Isi dulu keterangan hari-hari berikut di menu <strong>Rekap Absensi</strong>:</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {unclassifiedDays.map(d => (
                            <span key={d.missing_date} className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                              {new Date(d.missing_date + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm font-medium text-green-700">✅ Semua hari sudah terklasifikasi</p>
                        <p className="text-xs text-green-600 mt-0.5">Potongan tidak hadir akan dihitung otomatis (4 hari gratis, sakit bertingkat, alpha 1.5×).</p>
                      </div>
                    )}

                    {/* Kasbon */}
                    <div className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-slate-700">⚠️ Potongan Kasbon Bulan Ini</p>
                        <p className="text-xs text-slate-500">Cek saldo kasbon karyawan sebelum mengisi</p>
                      </div>
                      <input type="number" min="0" step="50000" value={createKasbon}
                        onChange={e => setCreateKasbon(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-28 px-2 py-1.5 border border-orange-300 rounded text-sm text-right focus:ring-2 focus:ring-orange-400 outline-none" />
                    </div>

                    {/* Bonus Kondisional */}
                    {createBonusCriteria.length > 0 && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                        <p className="text-sm font-semibold text-blue-700">🎯 Bonus Kondisional</p>
                        <p className="text-xs text-blue-500">Centang kriteria yang terpenuhi bulan ini</p>
                        <div className="space-y-2 mt-1">
                          {createBonusCriteria.map(c => (
                            <label key={c.id} className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition ${createBonusChecked[c.id] ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200 hover:border-blue-200'}`}>
                              <div className="flex items-center gap-2">
                                <input type="checkbox" checked={createBonusChecked[c.id] ?? false}
                                  onChange={e => setCreateBonusChecked(prev => ({ ...prev, [c.id]: e.target.checked }))}
                                  className="w-4 h-4 accent-green-500" />
                                <span className="text-sm text-slate-700">{c.criteria_name}</span>
                              </div>
                              <span className={`text-sm font-semibold ${createBonusChecked[c.id] ? 'text-green-600' : 'text-slate-400'}`}>
                                {createBonusChecked[c.id] ? '+' : ''}{formatRupiah(Number(c.nominal_amount))}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-blue-200">
                          <span className="text-xs text-blue-600 font-medium">Total bonus kondisional:</span>
                          <span className="text-sm font-bold text-green-600">
                            {formatRupiah(createBonusCriteria.filter(c => createBonusChecked[c.id]).reduce((s, c) => s + Number(c.nominal_amount), 0))}
                          </span>
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-slate-400">KPI, lembur, keterlambatan, kehilangan barang akan diambil otomatis dari data yang sudah ada.</p>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setCreateModal(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
                  <button disabled={!selectedEmpId || buildingPreview || checkingUnclassified || unclassifiedDays.length > 0}
                    onClick={async () => {
                      const preview = await buildSlipPreview(selectedEmpId, createKasbon)
                      if (preview) setCreateStep(2)
                    }}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                    {buildingPreview ? 'Memuat...' : 'Preview Slip →'}
                  </button>
                </div>
              </>
            )}

            {/* ── Step 2: Preview Slip ── */}
            {createStep === 2 && slipPreview && (
              <>
                <div className="text-center pb-3 border-b border-slate-100">
                  <p className="font-bold text-slate-800">{slipPreview.employeeName}</p>
                  <p className="text-xs text-slate-500">{slipPreview.positionName} · {slipPreview.branchName}</p>
                </div>

                <div className="rounded-xl overflow-hidden border border-slate-200 text-sm">
                  <div className="bg-emerald-50 px-4 py-1.5 text-xs font-bold text-emerald-700 uppercase">Pendapatan</div>
                  {[
                    ['Gaji Pokok', slipPreview.base],
                    ['Tunjangan Jabatan', slipPreview.pos],
                    ['Tunjangan Tetap', slipPreview.meal],
                    ['Upah Lembur', slipPreview.otTotal],
                    ['Bonus KPI', slipPreview.kpiBonus],
                    ...(slipPreview.conditionalBonus > 0 ? [['Bonus Kondisional', slipPreview.conditionalBonus]] : []),
                    ...(slipPreview.loyAutoRelease > 0 ? [[`✅ Cair Tabungan Loyalitas (${slipPreview.loyDurasi} bln)`, slipPreview.loyAutoRelease]] : []),
                  ].map(([l, v]) => Number(v) > 0 && (
                    <div key={String(l)} className="flex justify-between px-4 py-2 border-t border-slate-100">
                      <span className="text-slate-600">{l}</span>
                      <span className="font-medium">{formatRupiah(Number(v))}</span>
                    </div>
                  ))}
                  <div className="flex justify-between px-4 py-2 border-t border-slate-200 bg-slate-50 font-semibold">
                    <span>Total Bruto</span><span>{formatRupiah(slipPreview.gross)}</span>
                  </div>

                  <div className="bg-red-50 px-4 py-1.5 text-xs font-bold text-red-600 uppercase">Potongan</div>
                  {[
                    ['Keterlambatan', slipPreview.latDed],
                    ['Kasbon', slipPreview.kasbonDed],
                    ...(slipPreview.loyAutoRelease === 0 ? [[`Tabungan Loyalitas (saldo: ${formatRupiah(slipPreview.loyBalSaldo + slipPreview.loyalitasDed)})`, slipPreview.loyalitasDed]] : []),
                    ['Kehilangan Barang', slipPreview.invLoss],
                    ['Kerugian Kasir', slipPreview.cashierLoss],
                    [`Tidak Hadir (${slipPreview.absentDays} hari)`, slipPreview.absentDed],
                  ].map(([l, v]) => Number(v) > 0 && (
                    <div key={String(l)} className="flex justify-between px-4 py-2 border-t border-slate-100">
                      <span className="text-slate-600">{l}</span>
                      <span className="text-red-500 font-medium">-{formatRupiah(Number(v))}</span>
                    </div>
                  ))}
                  {slipPreview.absentBreakdown && (slipPreview.absentBreakdown.nonHadirDays > 0 || slipPreview.absentBreakdown.liburExtraDays > 0) && (
                    <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-400 space-y-0.5">
                      <div>└ Gaji harian (total komponen ÷ 26): <span className="text-slate-600 font-medium">{formatRupiah(slipPreview.absentBreakdown.dailyRate)}</span></div>
                      {slipPreview.absentBreakdown.izinDays > 0 && <div>└ Izin: <span className="text-orange-500">{slipPreview.absentBreakdown.izinDays} hari × 1× = {formatRupiah(slipPreview.absentBreakdown.izinDays * slipPreview.absentBreakdown.dailyRate)}</span></div>}
                      {slipPreview.absentBreakdown.alphaDays > 0 && <div className="text-red-400">└ Alpha: {slipPreview.absentBreakdown.alphaDays} hari × 1.5× = {formatRupiah(Math.round(slipPreview.absentBreakdown.alphaDays * slipPreview.absentBreakdown.dailyRate * 1.5))}</div>}
                      {slipPreview.absentBreakdown.sickDays > 0 && (
                        <div>└ Sakit: {slipPreview.absentBreakdown.sickDays} hari
                          {slipPreview.absentBreakdown.sick1Free > 0 && <span> · hari ke-1 gratis</span>}
                          {slipPreview.absentBreakdown.sick23Half > 0 && <span> · hari ke-{1+slipPreview.absentBreakdown.sick1Free}–{1+slipPreview.absentBreakdown.sick1Free+slipPreview.absentBreakdown.sick23Half-1} = {formatRupiah(Math.round(slipPreview.absentBreakdown.sick23Half * slipPreview.absentBreakdown.dailyRate * 0.5))}</span>}
                          {slipPreview.absentBreakdown.sick4Full > 0 && <span> · hari ke-4+ = {formatRupiah(slipPreview.absentBreakdown.sick4Full * slipPreview.absentBreakdown.dailyRate)}</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between bg-blue-600 text-white rounded-xl px-5 py-3">
                  <span className="font-bold">Gaji Bersih</span>
                  <span className="font-bold text-lg">{formatRupiah(slipPreview.net)}</span>
                </div>

                <div className="flex justify-between gap-3 pt-1">
                  <button onClick={() => setCreateStep(1)} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">← Kembali</button>
                  <button onClick={() => setCreateStep(3)} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">Lanjut Finalisasi →</button>
                </div>
              </>
            )}

            {/* ── Step 3: Konfirmasi Finalisasi ── */}
            {createStep === 3 && slipPreview && (
              <>
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm space-y-2">
                  <p className="font-semibold text-blue-800">Konfirmasi Finalisasi Slip</p>
                  <p className="text-blue-700">Karyawan: <strong>{slipPreview.employeeName}</strong></p>
                  <p className="text-blue-700">Periode: <strong>{getPeriodLabel(filterMonth, filterYear)}</strong></p>
                  <p className="text-blue-700">Gaji Bersih: <strong>{formatRupiah(slipPreview.net)}</strong></p>
                  {slipPreview.kasbonDed > 0 && (
                    <p className="text-amber-700 text-xs">⚠️ Saldo kasbon akan berkurang {formatRupiah(slipPreview.kasbonDed)} otomatis.</p>
                  )}
                </div>
                <p className="text-xs text-slate-500 text-center">Slip disimpan dengan status <strong>Draft</strong>. Masih bisa dihapus jika ada kesalahan.</p>
                <div className="flex justify-between gap-3">
                  <button onClick={() => setCreateStep(2)} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">← Kembali</button>
                  <button onClick={handleFinalizeSlip} disabled={finalizing}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                    {finalizing ? 'Menyimpan...' : '✓ Finalisasi Slip'}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    )}

    {/* Print styles — hanya untuk rekap tabel */}
    <style>{`
      @media print {
        nav, aside { display: none !important; }
        main { padding: 0 !important; overflow: visible !important; }
        .max-w-6xl { max-width: none !important; }
        .print-hide { display: none !important; }
        #rekap-print-area { display: block !important; }
      }
    `}</style>
    </>
  )
}
