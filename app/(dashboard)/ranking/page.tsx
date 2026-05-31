'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Employee = {
  id: string
  full_name: string
  employee_code: string
  positions: { name: string } | null
  branches: { name: string } | null
}

type RankRow = {
  employee: Employee
  late_minutes: number
  izin_days: number
  sakit_days: number
  alpha_days: number
  overtime_hours: number
  score: number
  rank: number
}

type Cycle = {
  id: string
  status: string
  cycle_start_date: string
  cycle_end_date: string | null
  total_pool: number
  notes: string | null
}

type PayoutHistory = {
  id: string
  cycle_id: string
  rank_position: number
  amount: number
  total_late_minutes: number
  total_izin_days: number
  total_sakit_days: number
  total_alpha_days: number
  total_overtime_hours: number
  discipline_score: number
  paid_at: string
  employee: { full_name: string; employee_code: string } | null
  paidByEmployee: { full_name: string } | null
}

const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)
const fmtDate = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

const RANK_CONFIG: Record<number, { label: string; bg: string; text: string; pct: number }> = {
  1: { label: '🥇 Rank 1', bg: 'bg-yellow-50 border-yellow-300', text: 'text-yellow-700', pct: 50 },
  2: { label: '🥈 Rank 2', bg: 'bg-slate-50 border-slate-300', text: 'text-slate-600', pct: 30 },
  3: { label: '🥉 Rank 3', bg: 'bg-orange-50 border-orange-300', text: 'text-orange-700', pct: 20 },
}

// ── Scoring: semua kriteria bobot sama (100 poin maks per kriteria, 5 kriteria = 500 maks)
function calcScore(row: Omit<RankRow, 'score' | 'rank'>, allRows: Omit<RankRow, 'score' | 'rank'>[]): number {
  const maxLate = Math.max(...allRows.map(r => r.late_minutes), 1)
  const maxIzin = Math.max(...allRows.map(r => r.izin_days), 1)
  const maxSakit = Math.max(...allRows.map(r => r.sakit_days), 1)
  const maxAlpha = Math.max(...allRows.map(r => r.alpha_days), 1)
  const maxOt = Math.max(...allRows.map(r => r.overtime_hours), 1)

  const s1 = (1 - row.late_minutes / maxLate) * 100   // sedikit = bagus
  const s2 = (1 - row.izin_days / maxIzin) * 100
  const s3 = (1 - row.sakit_days / maxSakit) * 100
  const s4 = (1 - row.alpha_days / maxAlpha) * 100
  const s5 = (row.overtime_hours / maxOt) * 100        // banyak = bagus

  return Math.round((s1 + s2 + s3 + s4 + s5) / 5)
}

export default function RankingPage() {
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<'ranking' | 'histori'>('ranking')
  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [rankings, setRankings] = useState<RankRow[]>([])
  const [pool, setPool] = useState(0)
  const [history, setHistory] = useState<PayoutHistory[]>([])
  const [myRole, setMyRole] = useState('')
  const [myEmpId, setMyEmpId] = useState('')
  const [cairModal, setCairModal] = useState(false)
  const [cairNotes, setCairNotes] = useState('')
  const [cairSubmitting, setCairSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: me } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (me) { setMyRole(me.role); setMyEmpId(me.employee_id) }
    }
    await Promise.all([fetchCycleAndRankings(), fetchHistory()])
    setLoading(false)
  }

  async function fetchCycleAndRankings() {
    // Ambil siklus aktif
    const { data: cycleData } = await supabase
      .from('discipline_cycles')
      .select('*')
      .eq('status', 'accumulating')
      .maybeSingle()

    if (!cycleData) { setCycle(null); setRankings([]); setPool(0); return }
    setCycle(cycleData)

    const startDate = cycleData.cycle_start_date
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`

    // Ambil semua karyawan aktif
    const { data: emps } = await supabase
      .from('employees')
      .select('id, full_name, employee_code, positions(name), branches(name)')
      .eq('is_active', true)

    if (!emps || emps.length === 0) { setRankings([]); return }

    // Ambil data absensi selama periode siklus
    const { data: atts } = await supabase
      .from('attendances')
      .select('employee_id, date, status, late_minutes, overtime_hours')
      .gte('date', startDate)
      .lte('date', todayStr)

    // Generate semua tanggal dalam periode siklus (pakai format lokal, bukan toISOString)
    const allPeriodDates: string[] = []
    const cur = new Date(startDate + 'T12:00:00')
    const endD = new Date(todayStr + 'T12:00:00')
    while (cur <= endD) {
      allPeriodDates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`)
      cur.setDate(cur.getDate() + 1)
    }

    // Hitung metrik per karyawan — pakai logika yang sama dengan rekap absensi
    const raw: Omit<RankRow, 'score' | 'rank'>[] = (emps as any[]).map(emp => {
      const empAtts = (atts || []).filter((a: any) => a.employee_id === emp.id)
      const recordedDates = new Set(empAtts.map((a: any) => a.date))

      // Hitung jumlah bulan kalender dalam periode siklus → tiap bulan dapat 4 hari libur gratis
      const distinctMonths = new Set(allPeriodDates.map(d => d.substring(0, 7))).size
      const freeLiburTotal = distinctMonths * 4

      // Hari kosong → ≤ freeLiburTotal = libur gratis, sisanya = izin
      const emptyDays = allPeriodDates.filter(d => !recordedDates.has(d)).length
      const autoIzin  = Math.max(emptyDays - freeLiburTotal, 0)

      return {
        employee: emp,
        late_minutes:   empAtts.reduce((s: number, a: any) => s + Number(a.late_minutes ?? 0), 0),
        izin_days:      empAtts.filter((a: any) => a.status === 'permission').length + autoIzin,
        sakit_days:     empAtts.filter((a: any) => a.status === 'sick').length,
        alpha_days:     empAtts.filter((a: any) => a.status === 'absent').length,
        overtime_hours: empAtts.reduce((s: number, a: any) => s + Number(a.overtime_hours ?? 0), 0),
      }
    })

    // Hitung skor & ranking
    const withScore = raw.map(r => ({ ...r, score: calcScore(r, raw) }))
    withScore.sort((a, b) => b.score - a.score)
    const ranked: RankRow[] = withScore.map((r, i) => ({ ...r, rank: i + 1 }))
    setRankings(ranked)

    // Hitung pool dari payrolls selama siklus
    const { data: payrolls } = await supabase
      .from('payrolls')
      .select('late_deduction, period_month, period_year')

    // Filter payrolls yang periode-nya masuk dalam siklus
    const startObj = new Date(startDate)
    const totalPool = (payrolls || [])
      .filter((p: any) => {
        const periodStart = new Date(p.period_year, p.period_month - 2, 26)
        return periodStart >= startObj
      })
      .reduce((s: number, p: any) => s + Number(p.late_deduction ?? 0), 0)

    setPool(totalPool)

    // Update total_pool di DB
    await supabase.from('discipline_cycles').update({ total_pool: totalPool }).eq('id', cycleData.id)
  }

  async function fetchHistory() {
    const { data } = await supabase
      .from('discipline_payouts')
      .select(`
        *,
        employee:employees!discipline_payouts_employee_id_fkey(full_name, employee_code),
        paidByEmployee:employees!discipline_payouts_paid_by_fkey(full_name),
        discipline_cycles(cycle_start_date, cycle_end_date, total_pool, notes)
      `)
      .order('paid_at', { ascending: false })
    setHistory((data as any) || [])
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleCairkan(e: React.FormEvent) {
    e.preventDefault()
    if (!cycle || rankings.length < 3) { showMsg('error', 'Minimal harus ada 3 karyawan untuk dicairkan.'); return }
    setCairSubmitting(true)

    const top3 = rankings.slice(0, 3)
    const today = new Date().toISOString().split('T')[0]

    // Update cycle jadi paid
    const { error: cycleErr } = await supabase.from('discipline_cycles').update({
      status: 'paid',
      cycle_end_date: today,
      notes: cairNotes || cycle.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', cycle.id)

    if (cycleErr) { showMsg('error', 'Gagal update siklus: ' + cycleErr.message); setCairSubmitting(false); return }

    // Insert payout per karyawan
    const payouts = top3.map((r, i) => ({
      cycle_id: cycle.id,
      employee_id: r.employee.id,
      rank_position: i + 1,
      amount: Math.round(pool * (i === 0 ? 0.5 : i === 1 ? 0.3 : 0.2)),
      total_late_minutes: r.late_minutes,
      total_izin_days: r.izin_days,
      total_sakit_days: r.sakit_days,
      total_alpha_days: r.alpha_days,
      total_overtime_hours: r.overtime_hours,
      discipline_score: r.score,
      paid_at: new Date().toISOString(),
      paid_by: myEmpId || null,
    }))

    const { error: payErr } = await supabase.from('discipline_payouts').insert(payouts)
    if (payErr) { showMsg('error', 'Gagal simpan payout: ' + payErr.message); setCairSubmitting(false); return }

    // Buat siklus baru otomatis
    await supabase.from('discipline_cycles').insert({
      status: 'accumulating',
      cycle_start_date: today,
      notes: 'Siklus baru dimulai otomatis setelah pencairan',
    })

    showMsg('success', 'Berhasil dicairkan! Siklus baru dimulai otomatis.')
    setCairModal(false)
    setCairNotes('')
    await Promise.all([fetchCycleAndRankings(), fetchHistory()])
    setCairSubmitting(false)
  }

  const canApprove = ['owner', 'hr'].includes(myRole)
  const top3 = rankings.slice(0, 3)

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">🏆 Ranking Disiplin</h1>
          <p className="text-sm text-slate-500">Ranking real-time berdasarkan keterlambatan, kehadiran, dan lembur.</p>
        </div>
        {canApprove && activeTab === 'ranking' && cycle && pool > 0 && (
          <button onClick={() => setCairModal(true)}
            className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl shadow transition">
            💸 Cairkan Pool — {fmtRp(pool)}
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        {(['ranking', 'histori'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab === 'ranking' ? '📊 Ranking Saat Ini' : '📋 Histori Pencairan'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Memuat data...</div>
      ) : activeTab === 'ranking' ? (
        <div className="space-y-6">
          {/* Info Siklus + Pool */}
          {cycle && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <p className="text-xs font-medium text-blue-600 uppercase mb-1">Siklus Aktif Sejak</p>
                <p className="text-lg font-bold text-blue-800">{fmtDate(cycle.cycle_start_date)}</p>
              </div>
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                <p className="text-xs font-medium text-orange-600 uppercase mb-1">Pool Terkumpul</p>
                <p className="text-lg font-bold text-orange-700">{fmtRp(pool)}</p>
                <p className="text-xs text-orange-500 mt-0.5">Dari total potongan telat semua karyawan</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Distribusi Jika Dicairkan</p>
                <div className="space-y-1 mt-1">
                  {[1,2,3].map(r => (
                    <div key={r} className="flex justify-between text-xs">
                      <span className="text-slate-500">Rank {r} ({RANK_CONFIG[r].pct}%)</span>
                      <span className="font-semibold text-slate-700">{fmtRp(Math.round(pool * RANK_CONFIG[r].pct / 100))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Top 3 highlight */}
          {rankings.length >= 3 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {top3.map(r => {
                const cfg = RANK_CONFIG[r.rank]
                return (
                  <div key={r.employee.id} className={`rounded-xl border-2 p-4 ${cfg.bg}`}>
                    <div className={`text-sm font-bold mb-2 ${cfg.text}`}>{cfg.label}</div>
                    <div className="font-semibold text-slate-800">{r.employee.full_name}</div>
                    <div className="text-xs text-slate-500 mb-3">{r.employee.positions?.name} · {r.employee.branches?.name}</div>
                    <div className="text-2xl font-black text-slate-800 mb-1">{r.score}<span className="text-sm font-normal text-slate-400"> poin</span></div>
                    <div className={`text-sm font-bold ${cfg.text}`}>{fmtRp(Math.round(pool * cfg.pct / 100))}</div>
                    <div className="text-xs text-slate-400 mt-2 space-y-0.5">
                      <div>⏱ {r.late_minutes} mnt telat</div>
                      <div>📋 {r.izin_days} izin · {r.sakit_days} sakit · {r.alpha_days} alpha</div>
                      <div>⚡ {Number(r.overtime_hours).toFixed(1)} jam lembur</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Tabel lengkap */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <span className="text-sm font-semibold text-slate-700">Semua Karyawan</span>
              <span className="text-xs text-slate-400">{rankings.length} karyawan aktif</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white border-b border-slate-100">
                  <tr>
                    {['#', 'Karyawan', 'Telat (mnt)', 'Izin', 'Sakit', 'Alpha', 'Lembur (jam)', 'Skor'].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rankings.map(r => (
                    <tr key={r.employee.id} className={`hover:bg-slate-50 transition ${r.rank <= 3 ? 'bg-yellow-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                          r.rank === 1 ? 'bg-yellow-400 text-white' :
                          r.rank === 2 ? 'bg-slate-400 text-white' :
                          r.rank === 3 ? 'bg-orange-400 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>{r.rank}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.employee.full_name}</div>
                        <div className="text-xs text-slate-400">{r.employee.employee_code} · {r.employee.branches?.name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${r.late_minutes > 0 ? 'text-red-500' : 'text-green-600'}`}>
                          {r.late_minutes}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.izin_days}</td>
                      <td className="px-4 py-3 text-slate-600">{r.sakit_days}</td>
                      <td className="px-4 py-3">
                        <span className={r.alpha_days > 0 ? 'text-red-500 font-semibold' : 'text-slate-600'}>{r.alpha_days}</span>
                      </td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">{Number(r.overtime_hours).toFixed(1)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${r.rank <= 3 ? 'text-blue-700 text-base' : 'text-slate-700'}`}>{r.score}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Tab Histori */
        <div className="space-y-4">
          {history.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">Belum ada pencairan.</div>
          ) : (
            (() => {
              // Group by cycle_id
              const grouped: Record<string, typeof history> = {}
              history.forEach(h => {
                const key = h.cycle_id
                if (!grouped[key]) grouped[key] = []
                grouped[key].push(h)
              })
              return Object.entries(grouped).map(([cycleId, payouts]) => {
                const sorted = payouts.sort((a, b) => a.rank_position - b.rank_position)
                const totalPaid = sorted.reduce((s, p) => s + Number(p.amount), 0)
                const cycle = (sorted[0] as any)?.discipline_cycles
                return (
                  <div key={cycleId} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                      <div>
                        <span className="text-sm font-semibold text-slate-700">
                          Periode: {cycle?.cycle_start_date ? fmtDate(cycle.cycle_start_date) : '—'} → {cycle?.cycle_end_date ? fmtDate(cycle.cycle_end_date) : '—'}
                        </span>
                        {cycle?.notes && <div className="text-xs text-slate-400 mt-0.5">{cycle.notes}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-400">Total Dicairkan</div>
                        <div className="font-bold text-slate-800">{fmtRp(totalPaid)}</div>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {sorted.map(p => {
                        const cfg = RANK_CONFIG[p.rank_position]
                        return (
                          <div key={p.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                              <div>
                                <div className="font-semibold text-slate-800">{p.employee?.full_name}</div>
                                <div className="text-xs text-slate-400">{p.employee?.employee_code} · Skor: {p.discipline_score} poin</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-bold text-green-600">{fmtRp(Number(p.amount))}</div>
                              <div className="text-xs text-slate-400">
                                {p.total_late_minutes}mnt telat · {p.total_izin_days}izin · {p.total_alpha_days}alpha · {Number(p.total_overtime_hours).toFixed(1)}j lembur
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            })()
          )}
        </div>
      )}

      {/* Modal Cairkan */}
      {cairModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-bold text-slate-800 mb-1">💸 Cairkan Pool Disiplin</h2>
              <p className="text-sm text-slate-500 mb-4">Total pool: <span className="font-bold text-slate-700">{fmtRp(pool)}</span></p>

              <div className="space-y-2 mb-5">
                {top3.map(r => {
                  const cfg = RANK_CONFIG[r.rank]
                  const amt = Math.round(pool * cfg.pct / 100)
                  return (
                    <div key={r.employee.id} className={`flex justify-between items-center p-3 rounded-lg border ${cfg.bg}`}>
                      <div>
                        <span className={`text-xs font-bold ${cfg.text}`}>{cfg.label}</span>
                        <div className="font-medium text-slate-800 text-sm">{r.employee.full_name}</div>
                        <div className="text-xs text-slate-400">{r.score} poin</div>
                      </div>
                      <div className={`font-bold text-base ${cfg.text}`}>{fmtRp(amt)}</div>
                    </div>
                  )
                })}
              </div>

              <form onSubmit={handleCairkan} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Catatan (opsional)</label>
                  <input type="text" value={cairNotes} onChange={e => setCairNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                    placeholder="Contoh: Pencairan siklus 3 bulan Apr–Jun 2026" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setCairModal(false)}
                    className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                    Batal
                  </button>
                  <button type="submit" disabled={cairSubmitting}
                    className="flex-1 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg font-semibold disabled:opacity-50">
                    {cairSubmitting ? 'Memproses...' : 'Konfirmasi Cairkan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
