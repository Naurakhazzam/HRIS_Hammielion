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
  const [generating] = useState(false) // kept for compatibility
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

  // ── State: buat slip per karyawan (stepper) ──
  type SlipPreview = {
    employeeId: string; employeeName: string; employeeCode: string
    positionName: string; branchName: string
    base: number; pos: number; meal: number; otTotal: number; kpiBonus: number
    loyalitasDed: number; latDed: number; latMinutes: number; latRate: number
    kasbonSaldo: number; kasbonDed: number
    absentDays: number; absentDed: number; absentRatePerDay: number
    invLoss: number; cashierLoss: number
    gross: number; net: number
  }
  const [createModal, setCreateModal]       = useState(false)
  const [createStep, setCreateStep]         = useState<1|2|3>(1)
  const [availableEmps, setAvailableEmps]   = useState<{id:string;full_name:string;employee_code:string;positions:{name:string}|null;branches:{name:string}|null}[]>([])
  const [selectedEmpId, setSelectedEmpId]   = useState('')
  const [createAbsent, setCreateAbsent]     = useState(0)
  const [createKasbon, setCreateKasbon]     = useState(0)
  const [slipPreview, setSlipPreview]       = useState<SlipPreview | null>(null)
  const [buildingPreview, setBuildingPreview] = useState(false)
  const [finalizing, setFinalizing]         = useState(false)

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
          full_name, employee_type, branch_id,
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
    const start = new Date(y, m - 2, 26)
    const end   = new Date(y, m - 1, 25)
    const firstDay = start.toISOString().split('T')[0]
    const lastDay  = end.toISOString().split('T')[0]
    return { firstDay, lastDay }
  }

  // Pembulatan lembur per hari: < 60 menit = 0, lalu floor per jam
  function roundOvertimeHours(rawHours: number): number {
    const minutes = rawHours * 60
    if (minutes < 60) return 0
    return Math.floor(minutes / 60) // kembalikan dalam jam bulat
  }

  async function handleGenerate() {
    if (!currentUser) return
    const label = filterBranch && branches.find(b => b.id === filterBranch)
      ? branches.find(b => b.id === filterBranch)!.name
      : 'semua cabang'
    if (!confirm(`Generate slip gaji draft untuk karyawan tetap (${label}) periode ${getPeriodLabel(filterMonth, filterYear)}?\n\nKaryawan yang sudah punya slip di periode ini akan dilewati.`)) return

    setGenerating(true)
    setMessage(null)
    const { firstDay, lastDay } = getFirstLastDay(filterMonth, filterYear)

    try {
      // 1. Ambil karyawan permanent aktif (termasuk loyalitas_per_month)
      let empQ = supabase
        .from('employees')
        .select('id, full_name, branch_id, loyalitas_per_month')
        .eq('employee_type', 'permanent')
        .eq('is_active', true)
      if (filterBranch) empQ = empQ.eq('branch_id', filterBranch)
      const { data: employees, error: empErr } = await empQ
      if (empErr) throw new Error('Gagal ambil karyawan: ' + empErr.message)
      if (!employees || employees.length === 0) {
        showMessage('error', 'Tidak ada karyawan tetap aktif untuk filter ini.')
        setGenerating(false)
        return
      }

      const allIds = employees.map(e => e.id)

      // 2. Cek slip yang sudah ada di periode ini
      const { data: existing } = await supabase
        .from('payrolls')
        .select('employee_id')
        .eq('period_month', filterMonth)
        .eq('period_year', filterYear)
        .in('employee_id', allIds)
      const existSet = new Set((existing || []).map(p => p.employee_id))
      const todo = employees.filter(e => !existSet.has(e.id))
      const skippedCount = employees.length - todo.length

      if (todo.length === 0) {
        showMessage('success', `Semua ${employees.length} karyawan sudah punya slip untuk periode ini.`)
        setGenerating(false)
        return
      }

      const todoIds = todo.map(e => e.id)

      // 3. Batch fetch salary_components — ambil terbaru per karyawan ≤ hari pertama bulan
      const { data: salComps } = await supabase
        .from('salary_components')
        .select('employee_id, base_salary, position_allowance, meal_allowance, overtime_rate_per_hour, late_penalty_per_minute, effective_date')
        .in('employee_id', todoIds)
        .lte('effective_date', firstDay)
        .order('effective_date', { ascending: false })
      const salMap: Record<string, any> = {}
      ;(salComps || []).forEach(sc => { if (!salMap[sc.employee_id]) salMap[sc.employee_id] = sc })

      // 4. Batch fetch attendances untuk periode
      const { data: atts } = await supabase
        .from('attendances')
        .select('employee_id, overtime_hours, late_minutes')
        .in('employee_id', todoIds)
        .gte('date', firstDay)
        .lte('date', lastDay)
      const attMap: Record<string, { ot: number; lat: number }> = {}
      ;(atts || []).forEach(a => {
        if (!attMap[a.employee_id]) attMap[a.employee_id] = { ot: 0, lat: 0 }
        // Pembulatan lembur per hari sebelum diakumulasi
        attMap[a.employee_id].ot  += roundOvertimeHours(Number(a.overtime_hours ?? 0))
        attMap[a.employee_id].lat += Number(a.late_minutes ?? 0)
      })

      // 5. Batch fetch kpi_evaluations untuk periode
      const { data: kpis } = await supabase
        .from('kpi_evaluations')
        .select('employee_id, bonus_cair')
        .in('employee_id', todoIds)
        .eq('period_month', filterMonth)
        .eq('period_year', filterYear)
      const kpiMap: Record<string, number> = {}
      ;(kpis || []).forEach(k => { kpiMap[k.employee_id] = Number(k.bonus_cair ?? 0) })

      // 6. Bangun array insert
      const inserts: any[] = []
      const noSalNames: string[] = []

      for (const emp of todo) {
        const sc = salMap[emp.id]
        if (!sc) { noSalNames.push(emp.full_name); continue }

        const att          = attMap[emp.id] ?? { ot: 0, lat: 0 }
        const base         = Number(sc.base_salary              ?? 0)
        const pos          = Number(sc.position_allowance       ?? 0)
        const meal         = Number(sc.meal_allowance           ?? 0)
        const otRate       = Number(sc.overtime_rate_per_hour   ?? 0)
        const latRate      = Number(sc.late_penalty_per_minute  ?? 0)
        const otTotal      = att.ot  * otRate
        const latDed       = att.lat * latRate
        const kpiBonus     = kpiMap[emp.id] ?? 0
        const loyalitasDed = Number((emp as any).loyalitas_per_month ?? 0)
        const gross        = base + pos + meal + otTotal + kpiBonus
        const net          = calcNet({ gross_total: gross, late_deduction: latDed, kasbon_deduction: 0, loyalitas_deduction: loyalitasDed, inventory_loss_deduction: 0, cashier_loss_deduction: 0 })

        inserts.push({
          employee_id:          emp.id,
          period_month:         filterMonth,
          period_year:          filterYear,
          base_salary:          base,
          position_allowance:   pos,
          meal_allowance:       meal,
          overtime_total:       otTotal,
          kpi_bonus:            kpiBonus,
          late_deduction:       latDed,
          kasbon_deduction:     0,
          loyalitas_deduction:  loyalitasDed,
          gross_total:          gross,
          net_total:            net,
          status:               'draft',
          approved_by:          null,
        })
      }

      // 7. Bulk insert
      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from('payrolls').insert(inserts)
        if (insErr) {
          console.error('Detail:', JSON.stringify(insErr, null, 2))
          throw new Error('Gagal simpan slip: ' + insErr.message)
        }
      }

      // 8. Laporan hasil
      const parts = [
        `✅ ${inserts.length} slip berhasil dibuat.`,
        skippedCount > 0 ? `${skippedCount} dilewati (sudah ada).` : '',
        noSalNames.length > 0 ? `${noSalNames.length} karyawan tanpa komponen gaji: ${noSalNames.join(', ')}.` : '',
      ].filter(Boolean).join(' ')
      showMessage(inserts.length > 0 ? 'success' : 'error', parts)
      await fetchPayrolls()

    } catch (err: any) {
      showMessage('error', err.message || 'Terjadi kesalahan saat generate.')
    } finally {
      setGenerating(false)
    }
  }

  // ─── Buat Slip Per Karyawan ────────────────────────────────────────────────────

  async function openCreateModal() {
    setCreateStep(1); setSelectedEmpId(''); setCreateAbsent(0); setCreateKasbon(0); setSlipPreview(null)
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

  async function buildSlipPreview(empId: string, absentDays: number, kasbonDed: number) {
    setBuildingPreview(true)
    const { firstDay, lastDay } = getFirstLastDay(filterMonth, filterYear)

    const [scRes, attRes, kpiRes, klRes, empRes, invRes] = await Promise.all([
      supabase.from('salary_components').select('*').eq('employee_id', empId).lte('effective_date', firstDay).order('effective_date', { ascending: false }).limit(1),
      supabase.from('attendances').select('overtime_hours, late_minutes').eq('employee_id', empId).gte('date', firstDay).lte('date', lastDay),
      supabase.from('kpi_evaluations').select('bonus_cair').eq('employee_id', empId).eq('period_month', filterMonth).eq('period_year', filterYear).limit(1),
      supabase.from('kasbon_limits').select('current_balance').eq('employee_id', empId).single(),
      supabase.from('employees').select('full_name, employee_code, loyalitas_per_month, branch_id, positions(name), branches(name)').eq('id', empId).single(),
      supabase.from('payrolls').select('inventory_loss_deduction, cashier_loss_deduction').eq('employee_id', empId).eq('period_month', filterMonth).eq('period_year', filterYear).maybeSingle(),
    ])

    const sc   = scRes.data?.[0]
    const emp  = empRes.data as any
    const atts = attRes.data || []

    if (!sc || !emp) { setBuildingPreview(false); return null }

    const base     = Number(sc.base_salary ?? 0)
    const pos      = Number(sc.position_allowance ?? 0)
    const meal     = Number(sc.meal_allowance ?? 0)
    const otRate   = Number(sc.overtime_rate_per_hour ?? 0)
    const latRate  = Number(sc.late_penalty_per_minute ?? 0)
    const otHours  = atts.reduce((s: number, a: any) => s + roundOvertimeHours(Number(a.overtime_hours ?? 0)), 0)
    const latMins  = atts.reduce((s: number, a: any) => s + Number(a.late_minutes ?? 0), 0)
    const otTotal  = otHours * otRate
    const latDed   = latMins * latRate
    const kpi      = Number(kpiRes.data?.[0]?.bonus_cair ?? 0)
    const loyalitas = Number((emp as any).loyalitas_per_month ?? 0)
    const saldo    = Number(klRes.data?.current_balance ?? 0)
    const invLoss  = Number(invRes.data?.inventory_loss_deduction ?? 0)
    const cashLoss = Number(invRes.data?.cashier_loss_deduction ?? 0)

    // Potongan tidak hadir: (base + pos + meal) ÷ 26 × absentDays
    const absentRatePerDay = Math.round((base + pos + meal) / 26)
    const absentDed = absentRatePerDay * absentDays

    const gross = base + pos + meal + otTotal + kpi
    const net   = calcNet({ gross_total: gross, late_deduction: latDed, kasbon_deduction: kasbonDed, loyalitas_deduction: loyalitas, inventory_loss_deduction: invLoss, cashier_loss_deduction: cashLoss, absent_deduction: absentDed })

    const preview: SlipPreview = {
      employeeId: empId, employeeName: emp.full_name, employeeCode: emp.employee_code,
      positionName: (emp.positions as any)?.name ?? '—', branchName: (emp.branches as any)?.name ?? '—',
      base, pos, meal, otTotal, kpiBonus: kpi,
      loyalitasDed: loyalitas, latDed, latMinutes: latMins, latRate,
      kasbonSaldo: saldo, kasbonDed,
      absentDays, absentDed, absentRatePerDay,
      invLoss, cashierLoss: cashLoss,
      gross, net,
    }
    setSlipPreview(preview)
    setBuildingPreview(false)
    return preview
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

    const { error } = await supabase.from('payrolls').insert({
      employee_id: p.employeeId, period_month: filterMonth, period_year: filterYear,
      base_salary: p.base, position_allowance: p.pos, meal_allowance: p.meal,
      overtime_total: p.otTotal, kpi_bonus: p.kpiBonus,
      late_deduction: p.latDed, kasbon_deduction: p.kasbonDed,
      loyalitas_deduction: p.loyalitasDed, absent_days: p.absentDays, absent_deduction: p.absentDed,
      inventory_loss_deduction: p.invLoss, cashier_loss_deduction: p.cashierLoss,
      gross_total: p.gross, net_total: p.net, status: 'draft', approved_by: null,
    })

    if (error) {
      showMessage('error', 'Gagal simpan slip: ' + error.message)
    } else {
      showMessage('success', `Slip gaji ${p.employeeName} berhasil dibuat.`)
      setCreateModal(false)
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
      // Tunjangan Loyalitas — tambah ke saldo
      const loyalitasDed = Number((p as any).loyalitas_deduction ?? 0)
      if (loyalitasDed > 0) {
        // Cek apakah sudah ada balance record
        const { data: existBal } = await supabase
          .from('loyalitas_balances')
          .select('id, total_withheld')
          .eq('employee_id', p.employee_id)
          .single()
        if (existBal) {
          // Update total
          await supabase.from('loyalitas_balances')
            .update({ total_withheld: Number(existBal.total_withheld) + loyalitasDed, updated_at: new Date().toISOString() })
            .eq('id', existBal.id)
        } else {
          // Insert baru
          await supabase.from('loyalitas_balances').insert({
            employee_id: p.employee_id,
            total_withheld: loyalitasDed,
            status: 'active'
          })
        }
        // Catat transaksi
        await supabase.from('loyalitas_transactions').insert({
          employee_id: p.employee_id,
          payroll_id: p.id,
          type: 'deduction',
          amount: loyalitasDed,
          notes: `Potongan bulan ${p.period_month}/${p.period_year}`
        })
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

    // Periode 26 bulan lalu - 25 bulan ini
    const start = new Date(p.period_year, p.period_month - 2, 26)
    const end   = new Date(p.period_year, p.period_month - 1, 25)
    const firstDay = start.toISOString().split('T')[0]
    const lastDay  = end.toISOString().split('T')[0]

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
                            onClick={() => { setSelectedPayroll(p); fetchLateDetails(p); fetchLossDetail(p) }}
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
                onClick={() => window.print()}
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
              {[
                ['Nama',     selectedPayroll.employee?.full_name ?? '—'],
                ['Jabatan',  selectedPayroll.employee?.positions?.name ?? '—'],
                ['Cabang',   selectedPayroll.employee?.branches?.name  ?? '—'],
                ['Periode',  getPeriodLabel(selectedPayroll.period_month, selectedPayroll.period_year)],
              ].map(([label, val]) => (
                <div key={label} className="flex gap-2">
                  <span className="text-slate-500 w-20 shrink-0">{label}</span>
                  <span className="font-medium text-slate-800">: {val}</span>
                </div>
              ))}
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
                    ['Upah Lembur',          selectedPayroll.overtime_total],
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
                    ['Tunjangan Loyalitas', selectedPayroll.loyalitas_deduction ?? 0],
                    ['Kerugian Kasir',      selectedPayroll.cashier_loss_deduction ?? 0],
                    [`Tidak Hadir (${selectedPayroll.absent_days ?? 0} hari)`, selectedPayroll.absent_deduction ?? 0],
                  ].map(([label, val]) => (
                    <tr key={String(label)} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-700">{label}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-red-500">
                        {Number(val) > 0 ? `-${formatRupiah(Number(val))}` : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
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

                    {/* Hari tidak hadir */}
                    <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-slate-700">⚠️ Hari Tidak Hadir (Alpha)</p>
                        <p className="text-xs text-slate-500">Potong = (Gaji Pokok + Tunjangan) ÷ 26 × hari</p>
                      </div>
                      <input type="number" min="0" max="26" value={createAbsent}
                        onChange={e => setCreateAbsent(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-16 px-2 py-1.5 border border-amber-300 rounded text-sm text-center font-bold focus:ring-2 focus:ring-amber-400 outline-none" />
                    </div>

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

                    <p className="text-xs text-slate-400">KPI, lembur, keterlambatan, kehilangan barang akan diambil otomatis dari data yang sudah ada.</p>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setCreateModal(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
                  <button disabled={!selectedEmpId || buildingPreview}
                    onClick={async () => {
                      const preview = await buildSlipPreview(selectedEmpId, createAbsent, createKasbon)
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
                    ['Tunjangan Loyalitas', slipPreview.loyalitasDed],
                    ['Kehilangan Barang', slipPreview.invLoss],
                    ['Kerugian Kasir', slipPreview.cashierLoss],
                    [`Tidak Hadir (${slipPreview.absentDays} hari)`, slipPreview.absentDed],
                  ].map(([l, v]) => Number(v) > 0 && (
                    <div key={String(l)} className="flex justify-between px-4 py-2 border-t border-slate-100">
                      <span className="text-slate-600">{l}</span>
                      <span className="text-red-500 font-medium">-{formatRupiah(Number(v))}</span>
                    </div>
                  ))}
                  {slipPreview.absentDays > 0 && (
                    <div className="px-4 py-1.5 text-xs text-slate-400 border-t border-slate-100">
                      └ {formatRupiah(slipPreview.absentRatePerDay)}/hari × {slipPreview.absentDays} hari
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

    {/* Print styles — sembunyikan elemen lain saat print */}
    <style>{`
      @media print {
        nav, aside { display: none !important; }
        main { padding: 0 !important; overflow: visible !important; }
        .max-w-6xl { max-width: none !important; }
        .print-hide { display: none !important; }
        #slip-print-area {
          position: fixed !important;
          inset: 0 !important;
          z-index: 9999 !important;
          background: white !important;
          overflow: auto !important;
        }
        #rekap-print-area {
          display: block !important;
        }
      }
    `}</style>
    </>
  )
}
