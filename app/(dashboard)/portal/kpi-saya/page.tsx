'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

type SourceType = 'manual' | 'task_completion' | 'punctuality' | 'attendance' | 'sales_target' | 'stock_shrinkage' | 'cash_variance' | 'rack_display' | 'promo_sales'

const SOURCE_LABEL: Record<SourceType, string> = {
  manual: '✍️ Manual', task_completion: '🔁 Tugas Rutin', punctuality: '⏰ Tepat Waktu', attendance: '✅ Kehadiran',
  sales_target: '🎯 Target Omset', stock_shrinkage: '📦 Akurasi Stok', cash_variance: '💵 Selisih Kas', rack_display: '🪴 Kerapian Display',
  promo_sales: '🛍️ Penjualan Promo',
}

type BreakdownRow = { criteria_id: string; title: string; source_type: SourceType; weight_percent: number; achievement_pct: number | null }

// Sama persis dengan logika save_kpi_evaluation di database: SEMUA kriteria aktif yang berlaku
// ikut jadi pembagi (walau belum ada datanya -- dianggap 0), bukan cuma yang sudah ada datanya.
function blendPct(rows: BreakdownRow[]): number {
  const usable = rows.filter(r => r.weight_percent > 0)
  const weightUsed = usable.reduce((s, r) => s + r.weight_percent, 0)
  if (weightUsed <= 0) return 0
  const weighted = usable.reduce((s, r) => s + r.weight_percent * (r.achievement_pct ?? 0), 0)
  return Math.max(0, Math.min(100, weighted / weightUsed))
}

function barColor(pct: number | null) {
  if (pct === null) return 'bg-slate-200'
  if (pct > 100) return 'bg-purple-500'
  if (pct >= 80) return 'bg-green-500'
  if (pct >= 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

function textColor(pct: number | null) {
  if (pct === null) return 'text-slate-400'
  if (pct > 100) return 'text-purple-700'
  if (pct >= 80) return 'text-green-700'
  if (pct >= 50) return 'text-yellow-700'
  return 'text-red-600'
}

export default function PortalKpiSayaPage() {
  const supabase = createClient()
  const router = useRouter()
  const today = new Date()

  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')

  // Periode gajian 26-25 yang SEDANG BERJALAN hari ini (sama seperti halaman portal lain) --
  // kalau hari ini sudah tanggal 26 ke atas, periode berjalan berakhir bulan depan.
  const defaultPeriod = (() => {
    let m = today.getMonth() + 1, y = today.getFullYear()
    if (today.getDate() >= 26) { m += 1; if (m > 12) { m = 1; y += 1 } }
    return { m, y }
  })()
  const [filterMonth, setFilterMonth] = useState(defaultPeriod.m)
  const [filterYear, setFilterYear] = useState(defaultPeriod.y)
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBreakdown = useCallback(async (employeeId: string) => {
    setLoading(true)
    const { data, error } = await supabase.rpc('get_employee_kpi_breakdown', {
      p_employee_id: employeeId, p_period_month: filterMonth, p_period_year: filterYear,
    })
    if (error) console.error('get_employee_kpi_breakdown:', error.message)
    setBreakdown((data as BreakdownRow[]) || [])
    setLoading(false)
  }, [supabase, filterMonth, filterYear])

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (myEmployeeId) fetchBreakdown(myEmployeeId) }, [myEmployeeId, fetchBreakdown])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users').select('role, employee_id, employees(full_name)').eq('id', user.id).single()
    if (!userData) { setLoading(false); return }

    // Preview Tampilan Karyawan: sama seperti halaman Portal Saya lain.
    if (['owner', 'hr', 'finance'].includes(userData.role) && isPreviewModeClient()) {
      const { data: emp } = await supabase.from('employees').select('full_name').eq('id', PREVIEW_EMPLOYEE_ID).single()
      setMyEmployeeId(PREVIEW_EMPLOYEE_ID)
      setMyName(emp?.full_name || '')
      return
    }

    setMyEmployeeId(userData.employee_id)
    setMyName((userData as any).employees?.full_name || '')
  }

  const yearOptions = Array.from(new Set([today.getFullYear() - 1, today.getFullYear(), defaultPeriod.y]))
  const overallPct = blendPct(breakdown)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">📊 Kinerja Saya</h1>
        <p className="text-sm text-slate-500">Halo, <strong>{myName}</strong>. Ini rincian penilaian kinerja Anda periode ini.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-5">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
            <div className="flex gap-2">
              <select value={filterMonth} onChange={e => setFilterMonth(+e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <select value={filterYear} onChange={e => setFilterYear(+e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white">
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400 text-sm">Memuat...</div>
      ) : breakdown.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium">Belum ada kriteria KPI yang berlaku untuk Anda periode ini.</p>
        </div>
      ) : (
        <>
          {/* Overall */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-slate-700">Keseluruhan</p>
              <span className={`text-3xl font-bold ${textColor(overallPct)}`}>{overallPct.toFixed(1)}%</span>
            </div>
            <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${barColor(overallPct)} transition-all`} style={{ width: `${Math.min(100, overallPct)}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-2">Rata-rata semua kriteria di bawah ini, sesuai bobot masing-masing.</p>
          </div>

          {/* Per kriteria */}
          <div className="space-y-4">
            {breakdown.map(r => {
              const pct = r.achievement_pct
              const displayPct = pct === null ? null : Number(pct)
              const barWidth = displayPct === null ? 0 : Math.min(100, displayPct)
              return (
                <div key={r.criteria_id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{r.title}</p>
                      <p className="text-xs text-slate-400">{SOURCE_LABEL[r.source_type]} · bobot {r.weight_percent}%</p>
                    </div>
                    <span className={`text-lg font-bold shrink-0 ${textColor(displayPct)}`}>
                      {displayPct === null ? '—' : `${displayPct}%`}
                      {displayPct !== null && displayPct > 100 && ' 🌟'}
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor(displayPct)} transition-all`} style={{ width: `${barWidth}%` }} />
                  </div>
                  {displayPct === null && <p className="text-xs text-slate-400 mt-1">Belum ada data -- dihitung 0% di nilai Keseluruhan sampai ada laporannya.</p>}
                  {displayPct !== null && displayPct > 100 && <p className="text-xs text-purple-600 mt-1">Melebihi target -- kerja ekstra tercatat 🎉</p>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
