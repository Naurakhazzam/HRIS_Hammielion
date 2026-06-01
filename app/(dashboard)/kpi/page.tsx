'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Employee = {
  id: string; full_name: string; position_id: string; branch_id: string
  branches?: { name: string }; positions?: { name: string }
}
type KPITemplate = {
  id: string; position_id: string; criteria_name: string
  weight_percent: number; is_active: boolean
}
type DailyEntry = { criteria_id: string; entry_date: string; is_checked: boolean }

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember']

function getPeriodDates(month: number, year: number) {
  const end = new Date(year, month - 1, 25)
  const start = new Date(year, month - 2, 26)
  return { start, end }
}

function getDatesInPeriod(start: Date, end: Date): Date[] {
  const dates: Date[] = []
  const current = new Date(start)
  while (current <= end) {
    dates.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function toDateStr(d: Date) { return d.toISOString().split('T')[0] }

function isFuture(d: Date) {
  const today = new Date(); today.setHours(0,0,0,0)
  return d > today
}

function isToday(d: Date) {
  return d.toDateString() === new Date().toDateString()
}

function formatRupiah(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
}

export default function KPIPage() {
  const router = useRouter()
  const supabase = createClient()
  const today = new Date()

  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [filterBranch, setFilterBranch] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')

  const [viewMode, setViewMode] = useState<'dashboard' | 'checklist'>('dashboard')
  const [dashboardData, setDashboardData] = useState<{
    employee: Employee & { kpi_bonus_max: number }
    overallPct: number
    bonusCair: number
    isSaved: boolean
  }[]>([])
  const [loadingDashboard, setLoadingDashboard] = useState(false)

  const [currentUser, setCurrentUser] = useState<{employee_id: string; role: string; branch_id: string | null} | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [templates, setTemplates] = useState<KPITemplate[]>([])
  const [branches, setBranches] = useState<{id: string; name: string}[]>([])
  const [entries, setEntries] = useState<DailyEntry[]>([])
  const [nominalBonus, setNominalBonus] = useState('0')
  const [savingCell, setSavingCell] = useState<string | null>(null)
  const [savingEval, setSavingEval] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [message, setMessage] = useState<{type: 'success'|'error'; text: string} | null>(null)

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (currentUser && selectedEmployeeId) fetchEntries()
  }, [selectedEmployeeId, filterMonth, filterYear, currentUser])

  useEffect(() => {
    if (currentUser && viewMode === 'dashboard' && templates.length > 0) {
      fetchDashboardData()
    }
  }, [viewMode, filterMonth, filterYear, filterBranch, currentUser, templates])

  function showMessage(type: 'success'|'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase
      .from('users')
      .select('employee_id, role, employees(branch_id)')
      .eq('id', user.id)
      .single()

    if (!userData) { setLoading(false); return }
    if (userData.role === 'employee') { router.push('/dashboard'); return }

    const branch_id = (userData.employees as any)?.branch_id || null
    const cu = { employee_id: userData.employee_id, role: userData.role, branch_id }
    setCurrentUser(cu)

    const { data: bData } = await supabase.from('branches').select('id, name').order('name')
    if (bData) setBranches(bData)

    const { data: tData } = await supabase.from('kpi_templates').select('*').eq('is_active', true)
    if (tData) setTemplates(tData)

    // Fetch employees
    let empQ = supabase
      .from('employees')
      .select('id, full_name, position_id, branch_id, branches(name), positions(name)')
      .in('employee_type', ['permanent', 'training'])
      .eq('is_active', true)
      .order('full_name')

    if (cu.role === 'supervisor' && branch_id) {
      empQ = empQ.eq('branch_id', branch_id)
      setFilterBranch(branch_id)
    }

    const { data: empData } = await empQ
    if (empData) setEmployees(empData as unknown as Employee[])

    setLoading(false)
  }

  async function fetchEntries() {
    if (!selectedEmployeeId) return
    setLoadingEntries(true)
    const { start, end } = getPeriodDates(filterMonth, filterYear)

    // Cek apakah ada evaluasi tersimpan untuk periode ini
    const { data: evalData } = await supabase
      .from('kpi_evaluations')
      .select('kpi_bonus_amount')
      .eq('employee_id', selectedEmployeeId)
      .eq('period_month', filterMonth)
      .eq('period_year', filterYear)
      .single()

    if (evalData) {
      setNominalBonus(String(evalData.kpi_bonus_amount || 0))
    } else {
      const { data: empData } = await supabase
        .from('employees')
        .select('kpi_bonus_max')
        .eq('id', selectedEmployeeId)
        .single()
      setNominalBonus(String(empData?.kpi_bonus_max || 0))
    }

    const { data: entryData } = await supabase
      .from('kpi_daily_entries')
      .select('criteria_id, entry_date, is_checked')
      .eq('employee_id', selectedEmployeeId)
      .gte('entry_date', toDateStr(start))
      .lte('entry_date', toDateStr(end))

    setEntries((entryData || []) as DailyEntry[])
    setLoadingEntries(false)
  }

  async function fetchDashboardData() {
    if (!currentUser) return
    setLoadingDashboard(true)

    let empQ = supabase
      .from('employees')
      .select('id, full_name, position_id, branch_id, kpi_bonus_max, branches(name), positions(name)')
      .in('employee_type', ['permanent', 'training'])
      .eq('is_active', true)
      .order('full_name')

    if (currentUser.role === 'supervisor' && currentUser.branch_id) {
      empQ = empQ.eq('branch_id', currentUser.branch_id)
    } else if (filterBranch) {
      empQ = empQ.eq('branch_id', filterBranch)
    }

    const { data: empData } = await empQ
    if (!empData) { setLoadingDashboard(false); return }

    const { start, end } = getPeriodDates(filterMonth, filterYear)
    const today2 = new Date(); today2.setHours(0,0,0,0)
    const allDates = getDatesInPeriod(start, end)
    const passedDates = allDates.filter(d => {
      const d2 = new Date(d); d2.setHours(0,0,0,0); return d2 <= today2
    })

    const { data: allEntries } = await supabase
      .from('kpi_daily_entries')
      .select('employee_id, criteria_id, entry_date, is_checked')
      .gte('entry_date', toDateStr(start))
      .lte('entry_date', toDateStr(end))

    const { data: allEvals } = await supabase
      .from('kpi_evaluations')
      .select('employee_id, kpi_bonus_amount')
      .eq('period_month', filterMonth)
      .eq('period_year', filterYear)

    const result = (empData as any[]).map(emp => {
      const empTemplates = templates.filter(t => t.position_id === emp.position_id)
      const empEntries = (allEntries || []).filter(e => e.employee_id === emp.id)
      const savedEval = (allEvals || []).find(e => e.employee_id === emp.id)

      let overallPct = 0
      if (empTemplates.length > 0 && passedDates.length > 0) {
        overallPct = empTemplates.reduce((acc, t) => {
          const checked = passedDates.filter(d =>
            empEntries.some(e => e.criteria_id === t.id && e.entry_date === toDateStr(d) && e.is_checked)
          ).length
          const ach = allDates.length > 0 ? Math.round((checked / allDates.length) * 100) : 0
          return acc + (t.weight_percent * ach) / 100
        }, 0)
      }

      const nominalMax = savedEval?.kpi_bonus_amount ?? emp.kpi_bonus_max ?? 0
      const bonusCair = nominalMax * overallPct / 100

      return {
        employee: emp,
        overallPct: parseFloat(overallPct.toFixed(1)),
        bonusCair: parseFloat(bonusCair.toFixed(0)),
        isSaved: !!savedEval
      }
    })

    setDashboardData(result)
    setLoadingDashboard(false)
  }

  function isChecked(criteriaId: string, dateStr: string) {
    return entries.find(e => e.criteria_id === criteriaId && e.entry_date === dateStr)?.is_checked ?? false
  }

  async function toggleEntry(criteriaId: string, date: Date) {
    if (!selectedEmployeeId || !currentUser) return
    if (isFuture(date)) return
    if (currentUser.role === 'finance') return

    const dateStr = toDateStr(date)
    const cellKey = `${criteriaId}_${dateStr}`
    setSavingCell(cellKey)

    const currentVal = isChecked(criteriaId, dateStr)
    const { error } = await supabase
      .from('kpi_daily_entries')
      .upsert({
        employee_id: selectedEmployeeId,
        criteria_id: criteriaId,
        entry_date: dateStr,
        is_checked: !currentVal,
        entered_by: currentUser.employee_id
      }, { onConflict: 'employee_id, criteria_id, entry_date' })

    if (!error) {
      setEntries(prev => {
        const exists = prev.find(e => e.criteria_id === criteriaId && e.entry_date === dateStr)
        if (exists) return prev.map(e =>
          e.criteria_id === criteriaId && e.entry_date === dateStr ? { ...e, is_checked: !currentVal } : e
        )
        return [...prev, { criteria_id: criteriaId, entry_date: dateStr, is_checked: !currentVal }]
      })
    } else {
      console.error('Toggle error:', JSON.stringify(error, null, 2))
    }
    setSavingCell(null)
  }

  // Kalkulasi
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  const empTemplates = templates.filter(t => selectedEmployee && t.position_id === selectedEmployee.position_id)
  const { start: pStart, end: pEnd } = getPeriodDates(filterMonth, filterYear)
  const allDates = getDatesInPeriod(pStart, pEnd)
  const today2 = new Date(); today2.setHours(0,0,0,0)
  const passedDates = allDates.filter(d => { const d2 = new Date(d); d2.setHours(0,0,0,0); return d2 <= today2 })

  function getCriteriaAchievement(criteriaId: string) {
    if (allDates.length === 0) return 0
    const checked = passedDates.filter(d => isChecked(criteriaId, toDateStr(d))).length
    return Math.round((checked / allDates.length) * 100)
  }

  const overallPct = empTemplates.reduce((acc, t) => {
    return acc + (t.weight_percent * getCriteriaAchievement(t.id)) / 100
  }, 0)

  const bonusCair = (parseFloat(nominalBonus) || 0) * overallPct / 100

  async function handleSaveEvaluation() {
    if (!selectedEmployeeId || !currentUser) return
    setSavingEval(true)
    const { start, end } = getPeriodDates(filterMonth, filterYear)

    const { error } = await supabase
      .from('kpi_evaluations')
      .upsert({
        employee_id: selectedEmployeeId,
        evaluator_id: currentUser.employee_id,
        period_month: filterMonth,
        period_year: filterYear,
        period_start: toDateStr(start),
        period_end: toDateStr(end),
        kpi_bonus_amount: parseFloat(nominalBonus) || 0,
        overall_percentage: parseFloat(overallPct.toFixed(2)),
        bonus_cair: parseFloat(bonusCair.toFixed(2))
      }, { onConflict: 'employee_id, period_month, period_year' })

    if (error) {
      console.error('Save eval error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal menyimpan rekap: ' + error.message)
    } else {
      // Sync ke penggajian bulanan
      await supabase
        .from('monthly_payrolls')
        .update({ kpi_bonus: parseFloat(bonusCair.toFixed(2)) })
        .eq('employee_id', selectedEmployeeId)
        .eq('period_month', filterMonth)
        .eq('period_year', filterYear)
        .eq('status', 'draft')

      showMessage('success', 'Rekap KPI berhasil disimpan. Bonus cair sudah tersync ke penggajian.')
    }
    setSavingEval(false)
  }

  const filteredEmployees = currentUser?.role === 'supervisor'
    ? employees
    : filterBranch
      ? employees.filter(e => e.branch_id === filterBranch)
      : employees

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        <span className="text-sm">Memuat...</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">KPI & Penilaian Kinerja</h1>
          <p className="text-sm text-slate-500">Checklist harian kinerja karyawan per periode 26–25</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('dashboard')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${viewMode === 'dashboard' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            📊 Dashboard
          </button>
          <button
            onClick={() => setViewMode('checklist')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${viewMode === 'checklist' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            ✅ Checklist
          </button>
          <Link href="/kpi/setup" className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition shadow-sm">
            ⚙️ Setup Kriteria
          </Link>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
            <div className="flex gap-2">
              <select value={filterMonth} onChange={e => { setFilterMonth(+e.target.value); setSelectedEmployeeId('') }}
                className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white">
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
              <input type="number" value={filterYear} onChange={e => { setFilterYear(+e.target.value); setSelectedEmployeeId('') }}
                className="w-20 px-3 py-2 border border-slate-300 rounded text-sm outline-none" />
            </div>
          </div>
          {currentUser?.role !== 'supervisor' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang</label>
              <select value={filterBranch} onChange={e => { setFilterBranch(e.target.value); setSelectedEmployeeId('') }}
                className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white w-44">
                <option value="">Semua Cabang</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Karyawan</label>
            <select value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white w-52">
              <option value="">-- Pilih Karyawan --</option>
              {filteredEmployees.map(e => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.branches?.name})</option>
              ))}
            </select>
          </div>
        </div>
        {selectedEmployeeId && (
          <p className="mt-2 text-xs text-slate-400">
            Periode: <strong>{pStart.toLocaleDateString('id-ID', {day:'2-digit', month:'long', year:'numeric'})}</strong> s/d <strong>{pEnd.toLocaleDateString('id-ID', {day:'2-digit', month:'long', year:'numeric'})}</strong>
            {' '}({allDates.length} hari, sudah berjalan {passedDates.length} hari)
          </p>
        )}
      </div>

      {viewMode === 'dashboard' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-700">
              Overview KPI — {MONTHS[filterMonth-1]} {filterYear}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jabatan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">KPI %</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Est. Bonus Cair</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingDashboard ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">Memuat data...</td></tr>
                ) : dashboardData.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">Tidak ada data karyawan.</td></tr>
                ) : (
                  dashboardData.map(d => (
                    <tr key={d.employee.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm font-semibold text-slate-800">{d.employee.full_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{(d.employee as any).positions?.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{(d.employee as any).branches?.name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-bold ${d.overallPct >= 80 ? 'text-green-600' : d.overallPct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {d.overallPct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-blue-600">
                        {formatRupiah(d.bonusCair)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${d.isSaved ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {d.isSaved ? 'Tersimpan' : 'Belum Disimpan'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => { setSelectedEmployeeId(d.employee.id); setViewMode('checklist') }}
                          className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition"
                        >
                          Input Checklist
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'checklist' && (
        <>
          {!selectedEmployeeId ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
              <div className="text-4xl mb-3">📋</div>
              <p className="font-medium">Pilih karyawan untuk melihat checklist KPI</p>
            </div>
          ) : loadingEntries ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-sm">Memuat data checklist...</p>
        </div>
      ) : empTemplates.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="font-medium">Belum ada kriteria KPI aktif untuk jabatan <strong>{selectedEmployee?.positions?.name}</strong></p>
          <p className="text-sm mt-1">Silakan tambahkan di <Link href="/kpi/setup" className="text-blue-600 underline">Setup Kriteria</Link></p>
        </div>
      ) : (
        <>
          {/* Summary Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
              <div>
                <p className="text-xs text-slate-500 mb-1">Karyawan</p>
                <p className="font-bold text-slate-800">{selectedEmployee?.full_name}</p>
                <p className="text-xs text-slate-400">{selectedEmployee?.positions?.name} — {selectedEmployee?.branches?.name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Nominal Bonus Maks (Rp)</p>
                <p className="font-semibold text-slate-800 text-sm">
                  {formatRupiah(parseFloat(nominalBonus) || 0)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Diatur di profil karyawan
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Overall KPI</p>
                <p className={`font-bold text-2xl ${overallPct >= 80 ? 'text-green-600' : overallPct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {overallPct.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Bonus Cair</p>
                <p className="font-bold text-2xl text-blue-600">{formatRupiah(bonusCair)}</p>
              </div>
            </div>
            {currentUser?.role !== 'finance' && (
              <div className="mt-4 flex justify-end">
                <button onClick={handleSaveEvaluation} disabled={savingEval}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                  {savingEval ? 'Menyimpan...' : '💾 Simpan Rekap Periode Ini'}
                </button>
              </div>
            )}
          </div>

          {/* Grid Checklist */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h2 className="text-sm font-bold text-slate-700">
                Checklist Harian — {MONTHS[filterMonth-1]} {filterYear}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="text-left border-collapse" style={{ minWidth: 'max-content' }}>
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="sticky left-0 bg-white z-10 px-4 py-3 text-xs font-semibold text-slate-500 uppercase min-w-[200px] border-r border-slate-200">
                      Kriteria
                    </th>
                    {allDates.map(d => (
                      <th key={toDateStr(d)}
                        className={`px-1 py-3 text-center min-w-[36px] text-xs font-semibold ${
                          isToday(d) ? 'bg-blue-50 text-blue-700' :
                          isFuture(d) ? 'text-slate-300' : 'text-slate-500'
                        }`}>
                        <div>{d.getDate()}</div>
                        <div className="text-[10px] font-normal opacity-60">
                          {d.toLocaleDateString('id-ID', { month: 'short' })}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase text-right min-w-[60px] border-l border-slate-200">%</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase text-right min-w-[60px]">Bobot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {empTemplates.map(t => {
                    const ach = getCriteriaAchievement(t.id)
                    return (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="sticky left-0 bg-white z-10 px-4 py-2 text-sm font-medium text-slate-700 border-r border-slate-200">
                          {t.criteria_name}
                        </td>
                        {allDates.map(d => {
                          const dateStr = toDateStr(d)
                          const cellKey = `${t.id}_${dateStr}`
                          const checked = isChecked(t.id, dateStr)
                          const future = isFuture(d)
                          const today_ = isToday(d)
                          return (
                            <td key={dateStr}
                              className={`px-1 py-2 text-center ${today_ ? 'bg-blue-50' : ''}`}>
                              {savingCell === cellKey ? (
                                <span className="inline-block w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <button
                                  onClick={() => toggleEntry(t.id, d)}
                                  disabled={future || currentUser?.role === 'finance'}
                                  className={`w-6 h-6 rounded border flex items-center justify-center text-xs transition mx-auto ${
                                    future
                                      ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
                                      : checked
                                        ? 'bg-green-500 border-green-500 text-white hover:bg-green-600'
                                        : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50'
                                  }`}
                                >
                                  {checked && !future ? '✓' : ''}
                                </button>
                              )}
                            </td>
                          )
                        })}
                        <td className={`px-3 py-2 text-right text-sm font-bold border-l border-slate-200 ${
                          ach >= 80 ? 'text-green-600' : ach >= 50 ? 'text-yellow-600' : 'text-red-500'
                        }`}>
                          {ach}%
                        </td>
                        <td className="px-3 py-2 text-right text-sm text-slate-500">
                          {t.weight_percent}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-300">
                    <td className="sticky left-0 bg-slate-50 z-10 px-4 py-3 text-sm font-bold text-slate-700 border-r border-slate-200">
                      Overall
                    </td>
                    <td colSpan={allDates.length} />
                    <td className={`px-3 py-3 text-right text-sm font-bold border-l border-slate-200 ${
                      overallPct >= 80 ? 'text-green-600' : overallPct >= 50 ? 'text-yellow-600' : 'text-red-500'
                    }`}>
                      {overallPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-bold text-slate-600">
                      {empTemplates.reduce((a, t) => a + t.weight_percent, 0)}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
        </>
      )}
    </div>
  )
}
