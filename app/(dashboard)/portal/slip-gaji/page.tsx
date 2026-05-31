'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Payroll = {
  id: string
  period_month: number
  period_year: number
  base_salary: number
  position_allowance: number
  meal_allowance: number
  overtime_total: number
  kpi_bonus: number
  conditional_bonus: number
  late_deduction: number
  kasbon_deduction: number
  loyalitas_deduction: number
  inventory_loss_deduction: number
  cashier_loss_deduction: number
  gross_total: number
  net_total: number
  status: string
  created_at: string
  employees: { full_name: string; positions: { name: string } | null; branches: { name: string } | null } | null
}

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

function getPeriodLabel(m: number, y: number) {
  const start = new Date(y, m - 2, 26)
  const end = new Date(y, m - 1, 25)
  const s = start.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })
  const e = end.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  return `${s} – ${e}`
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:            { label: 'Draft',            color: 'bg-slate-100 text-slate-600' },
  pending_approval: { label: 'Menunggu Approval', color: 'bg-yellow-100 text-yellow-700' },
  approved:         { label: 'Disetujui',         color: 'bg-blue-100 text-blue-700' },
  paid:             { label: 'Lunas',             color: 'bg-green-100 text-green-700' },
}

export default function PortalSlipGajiPage() {
  const supabase = createClient()
  const router = useRouter()
  const [payrolls, setPayrolls] = useState<Payroll[]>([])
  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | null>(null)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())

  useEffect(() => { init() }, [])
  useEffect(() => { if (myEmployeeId) fetchPayrolls() }, [myEmployeeId, filterYear])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users').select('role, employee_id, employees(full_name)').eq('id', user.id).single()
    if (!userData) return

    // Redirect jika bukan employee/supervisor
    if (!['employee', 'supervisor'].includes(userData.role)) {
      router.push('/dashboard')
      return
    }

    setMyEmployeeId(userData.employee_id)
    setMyName((userData as any).employees?.full_name || '')
  }

  async function fetchPayrolls() {
    setLoading(true)
    const { data } = await supabase
      .from('payrolls')
      .select(`
        id, period_month, period_year,
        base_salary, position_allowance, meal_allowance,
        overtime_total, kpi_bonus, conditional_bonus,
        late_deduction, kasbon_deduction, loyalitas_deduction,
        inventory_loss_deduction, cashier_loss_deduction,
        gross_total, net_total, status, created_at,
        employees!payrolls_employee_id_fkey(full_name, positions(name), branches(name))
      `)
      .eq('employee_id', myEmployeeId)
      .eq('period_year', filterYear)
      .order('period_month', { ascending: false })

    setPayrolls((data as unknown as Payroll[]) || [])
    setLoading(false)
  }

  const yearOptions = [new Date().getFullYear() - 1, new Date().getFullYear()]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Slip Gaji Saya</h1>
        <p className="text-sm text-slate-500">Halo, <strong>{myName}</strong>. Berikut riwayat slip gaji Anda.</p>
      </div>

      {/* Filter Tahun */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6 flex items-center gap-4">
        <label className="text-sm font-medium text-slate-600">Tahun:</label>
        <div className="flex gap-2">
          {yearOptions.map(y => (
            <button key={y} onClick={() => setFilterYear(y)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${filterYear === y ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Memuat slip gaji...</div>
      ) : payrolls.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-500">
          <div className="text-4xl mb-3">📄</div>
          <p>Belum ada slip gaji untuk tahun {filterYear}.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {payrolls.map(p => {
            const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.draft
            return (
              <div key={p.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition cursor-pointer"
                onClick={() => setSelectedPayroll(p)}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-slate-800">{MONTHS[p.period_month - 1]} {p.period_year}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{getPeriodLabel(p.period_month, p.period_year)}</p>
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500">Gaji Bersih</span>
                    <span className="text-lg font-bold text-blue-600">{fmtRp(p.net_total)}</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-xs text-slate-400">Gaji Kotor</span>
                    <span className="text-xs text-slate-600">{fmtRp(p.gross_total)}</span>
                  </div>
                </div>
                <button className="mt-3 w-full py-1.5 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 text-xs font-medium rounded-lg border border-slate-200 hover:border-blue-200 transition">
                  Lihat Detail →
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Detail Slip */}
      {selectedPayroll && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/50 overflow-y-auto"
          onClick={e => { if (e.target === e.currentTarget) setSelectedPayroll(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-700">Detail Slip Gaji</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium rounded-lg">
                  🖨️ Cetak
                </button>
                <button onClick={() => setSelectedPayroll(null)}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">✕ Tutup</button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Header */}
              <div className="text-center pb-4 border-b border-slate-200">
                <h1 className="text-xl font-bold text-slate-800 tracking-wide">HAMMIELION MANAGEMENT</h1>
                <p className="text-sm text-slate-500 mt-0.5">Slip Gaji Karyawan</p>
                <span className={`inline-flex mt-2 px-3 py-1 rounded-full text-xs font-semibold ${STATUS_CONFIG[selectedPayroll.status]?.color}`}>
                  {STATUS_CONFIG[selectedPayroll.status]?.label}
                </span>
              </div>

              {/* Info Karyawan */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ['Nama',    myName],
                  ['Jabatan', selectedPayroll.employees?.positions?.name || '—'],
                  ['Cabang',  selectedPayroll.employees?.branches?.name || '—'],
                  ['Periode', getPeriodLabel(selectedPayroll.period_month, selectedPayroll.period_year)],
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
                    <tr className="bg-emerald-50/50">
                      <td colSpan={2} className="px-4 py-1.5 text-xs font-bold text-emerald-700 uppercase">Pendapatan</td>
                    </tr>
                    {[
                      ['Gaji Pokok',         selectedPayroll.base_salary],
                      ['Tunjangan Jabatan',  selectedPayroll.position_allowance],
                      ['Tunjangan Makan',    selectedPayroll.meal_allowance],
                      ['Upah Lembur',        selectedPayroll.overtime_total],
                      ['Bonus KPI',          selectedPayroll.kpi_bonus],
                      ['Bonus Kondisional',  selectedPayroll.conditional_bonus ?? 0],
                    ].map(([label, val]) => (
                      <tr key={String(label)}>
                        <td className="px-4 py-2.5 text-slate-700">{label}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                          {Number(val) > 0 ? fmtRp(Number(val)) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-red-50/50">
                      <td colSpan={2} className="px-4 py-1.5 text-xs font-bold text-red-600 uppercase">Potongan</td>
                    </tr>
                    {[
                      ['Keterlambatan',       selectedPayroll.late_deduction],
                      ['Kasbon',              selectedPayroll.kasbon_deduction],
                      ['Tunjangan Loyalitas', selectedPayroll.loyalitas_deduction ?? 0],
                      ['Kehilangan Barang',   selectedPayroll.inventory_loss_deduction ?? 0],
                      ['Kerugian Kasir',      selectedPayroll.cashier_loss_deduction ?? 0],
                    ].map(([label, val]) => (
                      <tr key={String(label)}>
                        <td className="px-4 py-2.5 text-slate-700">{label}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-red-500">
                          {Number(val) > 0 ? `-${fmtRp(Number(val))}` : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-4 py-2.5 text-sm font-semibold text-slate-700">Total Kotor</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmtRp(selectedPayroll.gross_total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Gaji Bersih */}
              <div className="flex items-center justify-between bg-blue-600 text-white rounded-xl px-5 py-4">
                <span className="font-bold text-base">Gaji Bersih Diterima</span>
                <span className="font-bold text-xl">{fmtRp(selectedPayroll.net_total)}</span>
              </div>

              <p className="text-xs text-slate-400 text-center">
                Slip ini digenerate otomatis oleh sistem HRIS Hammielion Management.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
