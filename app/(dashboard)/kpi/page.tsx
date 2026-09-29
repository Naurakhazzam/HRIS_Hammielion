'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Employee = {
  id: string; full_name: string; branch_id: string; kpi_bonus_max: number
  branches?: { name: string }
}
type SourceType = 'manual' | 'task_completion' | 'punctuality' | 'attendance'
const SOURCE_LABEL: Record<SourceType, string> = {
  manual: '✍️ Manual', task_completion: '🔁 Tugas Rutin', punctuality: '⏰ Tepat Waktu', attendance: '✅ Kehadiran',
}
type BreakdownRow = { criteria_id: string; title: string; source_type: SourceType; weight_percent: number; achievement_pct: number | null }

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

function formatRupiah(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
}

// Rata-rata berbobot, hanya kriteria yang punya data (achievement_pct != null) yang dihitung --
// bobotnya dinormalisasi ke total bobot yang PUNYA data, supaya kriteria manual yang belum
// diisi HR tidak menjatuhkan skor sebelum sempat dinilai. Sama persis logika save_kpi_evaluation
// di database, dihitung ulang di sini untuk pratinjau langsung (real-time) sebelum disimpan.
function blendPct(rows: BreakdownRow[]): number {
  const usable = rows.filter(r => r.achievement_pct !== null && r.weight_percent > 0)
  const weightUsed = usable.reduce((s, r) => s + r.weight_percent, 0)
  if (weightUsed <= 0) return 0
  const weighted = usable.reduce((s, r) => s + r.weight_percent * (r.achievement_pct as number), 0)
  return Math.max(0, Math.min(100, weighted / weightUsed))
}

export default function KPIPage() {
  const router = useRouter()
  const supabase = createClient()
  const today = new Date()

  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [filterBranch, setFilterBranch] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [viewMode, setViewMode] = useState<'dashboard' | 'detail'>('dashboard')

  const [currentUser, setCurrentUser] = useState<{ employee_id: string; role: string; branch_id: string | null } | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  const [dashboardData, setDashboardData] = useState<{ employee: Employee; overallPct: number; bonusCair: number; isSaved: boolean }[]>([])
  const [loadingDashboard, setLoadingDashboard] = useState(false)

  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([])
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)
  const [manualDraft, setManualDraft] = useState<Record<string, string>>({})
  const [savingManual, setSavingManual] = useState<string | null>(null)
  const [savingEval, setSavingEval] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const fetchBreakdown = useCallback(async (employeeId: string) => {
    setLoadingBreakdown(true)
    const { data, error } = await supabase.rpc('get_employee_kpi_breakdown', {
      p_employee_id: employeeId, p_period_month: filterMonth, p_period_year: filterYear,
    })
    if (error) console.error('get_employee_kpi_breakdown:', error.message)
    const rows = (data as BreakdownRow[]) || []
    setBreakdown(rows)
    setManualDraft(Object.fromEntries(rows.filter(r => r.source_type === 'manual').map(r => [r.criteria_id, r.achievement_pct === null ? '' : String(r.achievement_pct)])))
    setLoadingBreakdown(false)
  }, [supabase, filterMonth, filterYear])

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (currentUser && selectedEmployeeId) fetchBreakdown(selectedEmployeeId)
  }, [selectedEmployeeId, filterMonth, filterYear, currentUser, fetchBreakdown])

  const fetchDashboardData = useCallback(async () => {
    if (!currentUser) return
    setLoadingDashboard(true)
    let empQ = supabase.from('employees')
      .select('id, full_name, branch_id, kpi_bonus_max, branches(name)')
      .in('employee_type', ['permanent', 'training']).eq('is_active', true).order('full_name')
    if (currentUser.role === 'supervisor' && currentUser.branch_id) empQ = empQ.eq('branch_id', currentUser.branch_id)
    else if (filterBranch) empQ = empQ.eq('branch_id', filterBranch)

    const { data: empData } = await empQ
    if (!empData) { setLoadingDashboard(false); return }

    const { data: allEvals } = await supabase.from('kpi_evaluations')
      .select('employee_id, overall_percentage, bonus_cair')
      .eq('period_month', filterMonth).eq('period_year', filterYear)

    const results = await Promise.all((empData as unknown as Employee[]).map(async emp => {
      const saved = (allEvals || []).find(e => e.employee_id === emp.id)
      if (saved) return { employee: emp, overallPct: Number(saved.overall_percentage), bonusCair: Number(saved.bonus_cair), isSaved: true }
      const { data } = await supabase.rpc('get_employee_kpi_breakdown', { p_employee_id: emp.id, p_period_month: filterMonth, p_period_year: filterYear })
      const rows = (data as BreakdownRow[]) || []
      const pct = blendPct(rows)
      return { employee: emp, overallPct: parseFloat(pct.toFixed(1)), bonusCair: Math.round((emp.kpi_bonus_max || 0) * pct / 100), isSaved: false }
    }))
    setDashboardData(results)
    setLoadingDashboard(false)
  }, [currentUser, filterBranch, filterMonth, filterYear, supabase])

  useEffect(() => {
    if (currentUser && viewMode === 'dashboard') fetchDashboardData()
  }, [viewMode, currentUser, fetchDashboardData])

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: userData } = await supabase.from('users').select('employee_id, role, employees(branch_id)').eq('id', user.id).single()
    if (!userData) { setLoading(false); return }
    if (userData.role === 'employee') { router.push('/dashboard'); return }

    const branch_id = (userData.employees as unknown as { branch_id: string | null } | null)?.branch_id || null
    const cu = { employee_id: userData.employee_id, role: userData.role, branch_id }
    setCurrentUser(cu)

    const { data: bData } = await supabase.from('branches').select('id, name').order('name')
    if (bData) setBranches(bData)

    let empQ = supabase.from('employees').select('id, full_name, branch_id, kpi_bonus_max, branches(name)')
      .in('employee_type', ['permanent', 'training']).eq('is_active', true).order('full_name')
    if (cu.role === 'supervisor' && branch_id) { empQ = empQ.eq('branch_id', branch_id); setFilterBranch(branch_id) }
    const { data: empData } = await empQ
    if (empData) setEmployees(empData as unknown as Employee[])

    setLoading(false)
  }

  async function saveManualScore(row: BreakdownRow) {
    const val = parseFloat(manualDraft[row.criteria_id])
    if (isNaN(val) || val < 0 || val > 100) { showMessage('error', 'Skor harus angka 0-100.'); return }
    setSavingManual(row.criteria_id)
    const { error } = await supabase.rpc('save_kpi_manual_score', {
      p_criteria_id: row.criteria_id, p_employee_id: selectedEmployeeId,
      p_period_month: filterMonth, p_period_year: filterYear, p_score_percent: val, p_notes: null,
    })
    setSavingManual(null)
    if (error) { showMessage('error', 'Gagal menyimpan skor: ' + error.message); return }
    showMessage('success', `Skor "${row.title}" tersimpan.`)
    fetchBreakdown(selectedEmployeeId)
  }

  async function handleSaveEvaluation() {
    if (!selectedEmployeeId) return
    setSavingEval(true)
    const { error } = await supabase.rpc('save_kpi_evaluation', {
      p_employee_id: selectedEmployeeId, p_period_month: filterMonth, p_period_year: filterYear, p_notes: null,
    })
    if (error) {
      showMessage('error', 'Gagal menyimpan rekap: ' + error.message)
      setSavingEval(false); return
    }
    const { data: evalRow } = await supabase.from('kpi_evaluations').select('bonus_cair')
      .eq('employee_id', selectedEmployeeId).eq('period_month', filterMonth).eq('period_year', filterYear).single()
    const bonusCair = Number(evalRow?.bonus_cair ?? 0)

    const { error: syncErr } = await supabase.from('payrolls').update({ kpi_bonus: bonusCair })
      .eq('employee_id', selectedEmployeeId).eq('period_month', filterMonth).eq('period_year', filterYear).eq('status', 'draft')

    setSavingEval(false)
    if (syncErr) showMessage('error', 'Rekap KPI tersimpan, tapi gagal sync ke penggajian: ' + syncErr.message)
    else showMessage('success', 'Rekap KPI berhasil disimpan. Kalau slip gaji periode ini statusnya masih Draft, bonus cair sudah tersync otomatis.')
  }

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  const overallPct = blendPct(breakdown)
  const bonusCair = (selectedEmployee?.kpi_bonus_max || 0) * overallPct / 100

  const filteredEmployees = currentUser?.role === 'supervisor' ? employees : filterBranch ? employees.filter(e => e.branch_id === filterBranch) : employees

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">Memuat...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">KPI & Penilaian Kinerja</h1>
          <p className="text-sm text-slate-500">Gabungan kriteria manual + otomatis (Tugas Rutin, Tepat Waktu, Kehadiran), per periode 26–25</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setViewMode('dashboard')} className={`px-3 py-1.5 text-sm rounded-lg border transition ${viewMode === 'dashboard' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>📊 Dashboard</button>
          <button onClick={() => setViewMode('detail')} className={`px-3 py-1.5 text-sm rounded-lg border transition ${viewMode === 'detail' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>🔍 Rincian</button>
          <Link href="/kpi/setup" className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition shadow-sm">⚙️ Setup Kriteria</Link>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
            <div className="flex gap-2">
              <select value={filterMonth} onChange={e => { setFilterMonth(+e.target.value); setSelectedEmployeeId('') }} className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" value={filterYear} onChange={e => { setFilterYear(+e.target.value); setSelectedEmployeeId('') }} className="w-20 px-3 py-2 border border-slate-300 rounded text-sm outline-none" />
            </div>
          </div>
          {currentUser?.role !== 'supervisor' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang</label>
              <select value={filterBranch} onChange={e => { setFilterBranch(e.target.value); setSelectedEmployeeId('') }} className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white w-44">
                <option value="">Semua Cabang</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          {viewMode === 'detail' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Karyawan</label>
              <select value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white w-52">
                <option value="">-- Pilih Karyawan --</option>
                {filteredEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.branches?.name})</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {viewMode === 'dashboard' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-700">Overview KPI — {MONTHS[filterMonth - 1]} {filterYear}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">KPI %</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Est. Bonus Cair</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingDashboard ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">Memuat data...</td></tr>
                ) : dashboardData.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">Tidak ada data karyawan.</td></tr>
                ) : (
                  dashboardData.map(d => (
                    <tr key={d.employee.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm font-semibold text-slate-800">{d.employee.full_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{d.employee.branches?.name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-bold ${d.overallPct >= 80 ? 'text-green-600' : d.overallPct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{d.overallPct}%</span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-blue-600">{formatRupiah(d.bonusCair)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${d.isSaved ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{d.isSaved ? 'Tersimpan' : 'Belum Disimpan'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => { setSelectedEmployeeId(d.employee.id); setViewMode('detail') }} className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition">Lihat Rincian</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'detail' && (
        !selectedEmployeeId ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
            <div className="text-4xl mb-3">📋</div>
            <p className="font-medium">Pilih karyawan untuk melihat rincian KPI</p>
          </div>
        ) : loadingBreakdown ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400"><p className="text-sm">Memuat rincian KPI...</p></div>
        ) : breakdown.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="font-medium">Belum ada kriteria KPI aktif untuk {selectedEmployee?.full_name}</p>
            <p className="text-sm mt-1">Silakan tambahkan di <Link href="/kpi/setup" className="text-blue-600 underline">Setup Kriteria</Link></p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Karyawan</p>
                  <p className="font-bold text-slate-800">{selectedEmployee?.full_name}</p>
                  <p className="text-xs text-slate-400">{selectedEmployee?.branches?.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Nominal Bonus Maks (Rp)</p>
                  <p className="font-semibold text-slate-800 text-sm">{formatRupiah(selectedEmployee?.kpi_bonus_max || 0)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Diatur di profil karyawan</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Overall KPI</p>
                  <p className={`font-bold text-2xl ${overallPct >= 80 ? 'text-green-600' : overallPct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>{overallPct.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Bonus Cair</p>
                  <p className="font-bold text-2xl text-blue-600">{formatRupiah(bonusCair)}</p>
                </div>
              </div>
              {currentUser?.role !== 'finance' && (
                <div className="mt-4 flex justify-end">
                  <button onClick={handleSaveEvaluation} disabled={savingEval} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                    {savingEval ? 'Menyimpan...' : '💾 Simpan Rekap Periode Ini'}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50">
                <h2 className="text-sm font-bold text-slate-700">Rincian Kriteria — {MONTHS[filterMonth - 1]} {filterYear}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kriteria</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Sumber</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Bobot</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Capaian</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {breakdown.map(r => (
                      <tr key={r.criteria_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-medium text-slate-700">{r.title}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{SOURCE_LABEL[r.source_type]}</td>
                        <td className="px-4 py-3 text-center text-sm text-slate-600">{r.weight_percent}%</td>
                        <td className="px-4 py-3 text-center">
                          {r.source_type === 'manual' ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <input type="number" min="0" max="100" value={manualDraft[r.criteria_id] ?? ''}
                                onChange={e => setManualDraft(prev => ({ ...prev, [r.criteria_id]: e.target.value }))}
                                placeholder="-" disabled={currentUser?.role === 'finance'}
                                className="w-16 px-2 py-1 border border-slate-300 rounded text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none" />
                              <span className="text-xs text-slate-400">%</span>
                              {currentUser?.role !== 'finance' && (
                                <button onClick={() => saveManualScore(r)} disabled={savingManual === r.criteria_id}
                                  className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50">
                                  {savingManual === r.criteria_id ? '...' : 'Simpan'}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className={`text-sm font-bold ${r.achievement_pct === null ? 'text-slate-300' : r.achievement_pct >= 80 ? 'text-green-600' : r.achievement_pct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                              {r.achievement_pct === null ? 'Belum ada data' : `${r.achievement_pct}%`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-slate-400">{r.achievement_pct === null ? 'diabaikan dari total' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-300">
                      <td className="px-4 py-3 text-sm font-bold text-slate-700">Overall</td>
                      <td colSpan={2} />
                      <td className={`px-4 py-3 text-center text-sm font-bold ${overallPct >= 80 ? 'text-green-600' : overallPct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{overallPct.toFixed(1)}%</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )
      )}
    </div>
  )
}
