'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'

// ── Types ──────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }
type Employee = { id: string; full_name: string; employee_code: string; branch_id: string; position_id: string; department_id: string | null; employee_type: string; positions: { name: string } | null; departments: { name: string } | null }
type BranchLossConfig = { id: string; branch_id: string; company_coverage_percent: number; effective_date: string; notes: string | null; created_at: string }
type LossEmployeeShare = { id: string; employee_id: string; branch_id: string; share_percent: number; effective_date: string; is_active: boolean; notes: string | null; created_at: string }
type LossMonthlyInput = { id: string; branch_id: string; period_month: number; period_year: number; total_loss_amount: number; notes: string | null }

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const EMP_TYPE_LABEL: Record<string, string> = { permanent: 'Tetap', training: 'Training', driver: 'Driver', freelance: 'Lepas' }
const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

export default function KehilanganBarangPage() {
  const supabase = createClient()
  const today = new Date()

  // ── Konteks halaman: satu cabang + satu periode dipakai di SEMUA seksi di
  // halaman ini (dulu tersebar jadi 3 selector terpisah di 3 tab/halaman berbeda) ──
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Setup: % Kantor
  const [configs, setConfigs] = useState<BranchLossConfig[]>([])
  const [kantorForm, setKantorForm] = useState({ percent: '', notes: '', effective_date: today.toISOString().split('T')[0] })
  const [kantorSubmitting, setKantorSubmitting] = useState(false)
  const [showKantorHistory, setShowKantorHistory] = useState(false)

  // Setup: % Karyawan
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shares, setShares] = useState<LossEmployeeShare[]>([])
  const [sharesHistory, setSharesHistory] = useState<LossEmployeeShare[]>([])
  const [shareForm, setShareForm] = useState<Record<string, { percent: string; notes: string }>>({})
  const [shareSubmitting, setShareSubmitting] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)

  // Input Bulanan
  const [lossInput, setLossInput] = useState<LossMonthlyInput | null>(null)
  const [lossForm, setLossForm] = useState({ amount: '', notes: '' })
  const [lossSaving, setLossSaving] = useState(false)

  // Preview & Apply
  const [preview, setPreview] = useState<any[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  // Riwayat semua cabang
  const [history, setHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 6000)
  }

  useEffect(() => { fetchBranches(); fetchHistory() }, [])
  useEffect(() => { if (selectedBranch) fetchBranchData() }, [selectedBranch])
  useEffect(() => { if (selectedBranch) fetchMonthlyInput() }, [selectedBranch, filterMonth, filterYear])

  async function fetchBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
    if (data) { setBranches(data); if (data.length > 0) setSelectedBranch(data[0].id) }
    setLoading(false)
  }

  // Data setup (% kantor + % karyawan) untuk cabang terpilih — dipanggil ulang tiap ganti cabang
  async function fetchBranchData() {
    const [cRes, eRes, sRes, sHistRes] = await Promise.all([
      supabase.from('branch_loss_configs').select('*').eq('branch_id', selectedBranch).order('created_at', { ascending: false }),
      supabase.from('employees').select('id, full_name, employee_code, branch_id, position_id, department_id, employee_type, positions(name), departments(name)').eq('branch_id', selectedBranch).eq('is_active', true).order('full_name'),
      supabase.from('loss_employee_shares').select('*').eq('branch_id', selectedBranch).eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('loss_employee_shares').select('*').eq('branch_id', selectedBranch).order('created_at', { ascending: false }),
    ])
    if (cRes.data) setConfigs(cRes.data)
    if (eRes.data) setEmployees(eRes.data as unknown as Employee[])
    if (sRes.data) setShares(sRes.data as unknown as LossEmployeeShare[])
    if (sHistRes.data) setSharesHistory(sHistRes.data as unknown as LossEmployeeShare[])
    setShareForm({})
    setPreview([])
  }

  async function fetchMonthlyInput() {
    const { data } = await supabase.from('loss_monthly_inputs').select('*').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).single()
    if (data) { setLossInput(data); setLossForm({ amount: String(data.total_loss_amount), notes: data.notes || '' }) }
    else { setLossInput(null); setLossForm({ amount: '', notes: '' }) }
    setPreview([])
  }

  async function fetchHistory() {
    setLoadingHistory(true)
    const { data } = await supabase.from('loss_monthly_inputs').select('*, branches(name)').order('period_year', { ascending: false }).order('period_month', { ascending: false }).limit(24)
    setHistory(data || [])
    setLoadingHistory(false)
  }

  // ── Turunan (sama persis rumusnya seperti sebelumnya) ─────────────────────────
  const currentKantorConfig = configs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const kantorHistory = configs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const branchEmployeesByDept = employees.reduce((acc, e) => {
    const key = e.departments?.name || 'Tanpa Departemen'
    if (!acc[key]) acc[key] = []
    acc[key].push(e)
    return acc
  }, {} as Record<string, Employee[]>)
  const getLatestShare = (empId: string) => shares.filter(s => s.employee_id === empId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const totalSharePercent = employees.reduce((sum, e) => { const s = getLatestShare(e.id); return sum + (s ? Number(s.share_percent) : 0) }, 0)
  const employeeShareHistory = (empId: string) => sharesHistory.filter(s => s.employee_id === empId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const companyPctNow = Number(currentKantorConfig?.company_coverage_percent ?? 0)
  const grandTotalPct = companyPctNow + totalSharePercent
  const isFullyConfigured = grandTotalPct >= 100 || (currentKantorConfig && shares.length > 0)

  // ── Setup: % Kantor ────────────────────────────────────────────────────────────
  async function handleSaveKantor(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBranch) return
    const pct = parseFloat(kantorForm.percent)
    if (isNaN(pct) || pct < 0 || pct > 100) { showMsg('error', 'Persentase harus 0–100.'); return }
    if (pct + totalSharePercent > 100) {
      showMsg('error', `% Kantor (${pct}%) + total % karyawan (${totalSharePercent.toFixed(1)}%) = ${(pct + totalSharePercent).toFixed(1)}% — melebihi 100%. Kurangi % karyawan terlebih dahulu.`)
      return
    }
    setKantorSubmitting(true)
    const { error } = await supabase.from('branch_loss_configs').insert({ branch_id: selectedBranch, company_coverage_percent: pct, effective_date: kantorForm.effective_date, notes: kantorForm.notes || null })
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Konfigurasi % kantor berhasil disimpan.'); setKantorForm({ percent: '', notes: '', effective_date: today.toISOString().split('T')[0] }); fetchBranchData() }
    setKantorSubmitting(false)
  }

  // ── Setup: % Karyawan ──────────────────────────────────────────────────────────
  async function handleSaveShares(e: React.FormEvent) {
    e.preventDefault()
    setShareSubmitting(true)
    const todayStr = today.toISOString().split('T')[0]
    const inserts: any[] = []
    const empIdsToDeactivate: string[] = []
    let newTotal = 0

    for (const emp of employees) {
      const f = shareForm[emp.id]
      if (f?.percent === undefined || f.percent === '') continue
      const pct = parseFloat(f.percent)
      if (isNaN(pct) || pct < 0) continue
      newTotal += pct
      empIdsToDeactivate.push(emp.id)
      inserts.push({ employee_id: emp.id, branch_id: selectedBranch, share_percent: pct, effective_date: todayStr, notes: f.notes || null, is_active: true })
    }

    if (inserts.length === 0) { showMsg('error', 'Tidak ada persentase yang diisi.'); setShareSubmitting(false); return }

    const unchangedTotal = employees.filter(emp => !empIdsToDeactivate.includes(emp.id)).reduce((sum, emp) => { const s = getLatestShare(emp.id); return sum + (s ? Number(s.share_percent) : 0) }, 0)
    const grandTotal = newTotal + unchangedTotal

    if (companyPctNow + grandTotal > 100) {
      showMsg('error', `% Kantor (${companyPctNow}%) + total % karyawan (${grandTotal.toFixed(1)}%) = ${(companyPctNow + grandTotal).toFixed(1)}% — melebihi 100%. Sesuaikan persentasenya.`)
      setShareSubmitting(false)
      return
    }

    const { error: deactError } = await supabase.from('loss_employee_shares').update({ is_active: false }).eq('branch_id', selectedBranch).eq('is_active', true).in('employee_id', empIdsToDeactivate)
    if (deactError) { showMsg('error', 'Gagal nonaktifkan record lama: ' + deactError.message); setShareSubmitting(false); return }

    const { error } = await supabase.from('loss_employee_shares').insert(inserts)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', `${inserts.length} % karyawan berhasil diperbarui (history tersimpan).`); setShareForm({}); fetchBranchData() }
    setShareSubmitting(false)
  }

  // ── Input Bulanan ──────────────────────────────────────────────────────────────
  async function handleSaveLoss(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(lossForm.amount)
    if (isNaN(amt) || amt < 0) { showMsg('error', 'Nominal tidak valid.'); return }
    setLossSaving(true)
    const payload = { branch_id: selectedBranch, period_month: filterMonth, period_year: filterYear, total_loss_amount: amt, notes: lossForm.notes || null, updated_at: new Date().toISOString() }
    const { error } = lossInput
      ? await supabase.from('loss_monthly_inputs').update(payload).eq('id', lossInput.id)
      : await supabase.from('loss_monthly_inputs').insert(payload)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Kehilangan barang berhasil disimpan.'); fetchMonthlyInput(); fetchHistory() }
    setLossSaving(false)
  }

  // ── Preview & Apply (rumus sama persis dengan sebelumnya, cuma tanpa bagian kasir) ──
  async function handlePreview() {
    if (!selectedBranch) return
    setPreviewLoading(true)
    setPreview([])

    const { data: lossData } = await supabase.from('loss_monthly_inputs').select('*').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).single()
    const { data: configData } = await supabase.from('branch_loss_configs').select('*').eq('branch_id', selectedBranch).order('created_at', { ascending: false }).limit(1)
    const companyPct = configData?.[0]?.company_coverage_percent ?? 0

    const { data: sharesData } = await supabase
      .from('loss_employee_shares')
      .select('employee_id, share_percent, created_at, is_active, employees!loss_employee_shares_employee_id_fkey(id, full_name, employee_code, position_id, positions(name))')
      .eq('branch_id', selectedBranch)
      .eq('is_active', true)

    const latestShares: Record<string, any> = {}
    ;(sharesData || []).forEach((s: any) => {
      if (!latestShares[s.employee_id] || new Date(s.created_at) > new Date(latestShares[s.employee_id].created_at)) {
        latestShares[s.employee_id] = s
      }
    })

    const totalLoss = lossData?.total_loss_amount ?? 0
    const totalAssigned = Object.values(latestShares).reduce((s: number, sh: any) => s + Number(sh.share_percent), 0)
    const effectiveCompanyPct = Math.min(companyPct, 100)
    const effectiveTotalAssigned = Math.min(totalAssigned, Math.max(0, 100 - effectiveCompanyPct))
    const unassignedPct = Math.max(0, 100 - effectiveCompanyPct - effectiveTotalAssigned)
    const companyExtraCoverLoss = totalLoss * (unassignedPct / 100)
    const companyCoverLoss = totalLoss * (effectiveCompanyPct / 100)

    const results: any[] = []
    for (const empId of Object.keys(latestShares)) {
      const share = latestShares[empId]
      const emp = share?.employees
      if (!emp) continue

      const { data: empCheck } = await supabase.from('employees').select('id,is_active,branch_id').eq('id', empId).single()
      if (!empCheck?.is_active || empCheck.branch_id !== selectedBranch) continue

      const invLoss = share ? (Number(share.share_percent) / 100) * totalLoss : 0
      results.push({
        empId, name: emp.full_name, code: emp.employee_code, position: emp.positions?.name,
        sharePct: share ? Number(share.share_percent) : 0,
        invLoss: Math.round(invLoss),
        totalLoss, companyPct, companyCover: Math.round(companyCoverLoss + companyExtraCoverLoss), unassignedPct,
      })
    }
    setPreview(results)
    setPreviewLoading(false)
  }

  async function handleApply() {
    if (preview.length === 0) return
    if (!confirm(`Apply potongan kehilangan barang ke ${preview.length} karyawan untuk payroll ${MONTHS[filterMonth-1]} ${filterYear}?`)) return
    setApplying(true)

    let appliedCount = 0
    let skippedCount = 0

    for (const p of preview) {
      // Ikut sertakan cashier_loss_deduction saat ini — kalau tidak, apply Kehilangan Barang
      // di sini bisa MENIMPA potongan Kerugian Kasir yang sudah diterapkan lebih dulu dari
      // halaman satunya (net_total dihitung ulang dari nol tiap kali salah satu di-apply).
      const { data: payroll } = await supabase.from('payrolls').select('id, status, gross_total, net_total, late_deduction, kasbon_deduction, loyalitas_deduction, absent_deduction, cashier_loss_deduction')
        .eq('employee_id', p.empId).eq('period_month', filterMonth).eq('period_year', filterYear).single()
      if (!payroll) continue
      if (payroll.status !== 'draft') { skippedCount++; continue }

      const newInvLoss = p.invLoss
      const existingKasirLoss = Number(payroll.cashier_loss_deduction ?? 0)
      const newNet = Number(payroll.gross_total) - Number(payroll.late_deduction) - Number(payroll.kasbon_deduction) - Number(payroll.loyalitas_deduction ?? 0) - Number(payroll.absent_deduction ?? 0) - newInvLoss - existingKasirLoss

      await supabase.from('payrolls').update({ inventory_loss_deduction: newInvLoss, net_total: newNet }).eq('id', payroll.id)
      appliedCount++
    }

    if (skippedCount === 0) showMsg('success', `Potongan berhasil diapply ke ${appliedCount} karyawan.`)
    else showMsg('success', `Potongan diapply ke ${appliedCount} karyawan. ${skippedCount} dilewati karena slip gajinya sudah tidak berstatus draft (approved/paid) — perlu penyesuaian manual kalau perlu.`)
    setApplying(false)
  }

  async function handleDeleteHistory(h: any) {
    if (!confirm(`Hapus data kehilangan ${h.branches?.name} ${MONTHS[h.period_month-1]} ${h.period_year}?`)) return
    await supabase.from('loss_monthly_inputs').delete().eq('id', h.id)
    fetchHistory()
    if (h.branch_id === selectedBranch && h.period_month === filterMonth && h.period_year === filterYear) fetchMonthlyInput()
  }

  const yearOptions = [today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1]

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kehilangan Barang (Ganti Rugi)</h1>
        <p className="text-sm text-slate-500">Setup pembagian tanggung jawab, input bulanan, dan terapkan ke slip gaji — semua dalam satu alur.</p>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Konteks: Cabang */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">Cabang</label>
        <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* 1. Setup pembagian tanggung jawab */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button onClick={() => setSetupOpen(!setupOpen)} className="w-full flex items-center justify-between px-5 py-4">
          <div className="text-left">
            <h3 className="font-semibold text-slate-800">1. Pengaturan Pembagian Tanggung Jawab</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Kantor: <strong className={companyPctNow > 0 ? 'text-blue-600' : 'text-slate-400'}>{companyPctNow}%</strong>
              {' · '}Karyawan: <strong className={totalSharePercent > 0 ? 'text-blue-600' : 'text-slate-400'}>{totalSharePercent.toFixed(1)}%</strong>
              {!isFullyConfigured && <span className="ml-2 text-amber-600">⚠ belum lengkap</span>}
            </p>
          </div>
          <span className="text-slate-400 text-sm">{setupOpen ? '▲ Tutup' : '▼ Atur'}</span>
        </button>

        {setupOpen && (
          <div className="border-t border-slate-100 p-5 space-y-6">
            {/* % Kantor */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-3">% Kantor Menanggung</h4>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div>
                  {currentKantorConfig && (
                    <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                      <span className="font-bold text-blue-700">{currentKantorConfig.company_coverage_percent}%</span>
                      <span className="text-blue-600 ml-2">aktif sekarang</span>
                      {currentKantorConfig.notes && <p className="text-xs text-blue-500 mt-1">{currentKantorConfig.notes}</p>}
                    </div>
                  )}
                  <form onSubmit={handleSaveKantor} className="space-y-2">
                    <div className="flex gap-2">
                      <input type="number" required min="0" max="100" step="0.01" value={kantorForm.percent} onChange={e => setKantorForm({ ...kantorForm, percent: e.target.value })}
                        placeholder="% baru" className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      <input type="date" value={kantorForm.effective_date} onChange={e => setKantorForm({ ...kantorForm, effective_date: e.target.value })}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <input type="text" value={kantorForm.notes} onChange={e => setKantorForm({ ...kantorForm, notes: e.target.value })}
                      placeholder="Catatan / alasan perubahan (opsional)" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button type="submit" disabled={kantorSubmitting} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                      {kantorSubmitting ? 'Menyimpan...' : '💾 Simpan (Tambah ke History)'}
                    </button>
                  </form>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-600">Histori Perubahan</span>
                    {kantorHistory.length > 3 && (
                      <button onClick={() => setShowKantorHistory(!showKantorHistory)} className="text-xs text-blue-600 hover:underline">
                        {showKantorHistory ? 'Sembunyikan' : `Lihat semua (${kantorHistory.length})`}
                      </button>
                    )}
                  </div>
                  {kantorHistory.length === 0 ? (
                    <p className="text-sm text-slate-400 italic">Belum ada konfigurasi.</p>
                  ) : (
                    <div className="space-y-2 max-h-52 overflow-y-auto">
                      {(showKantorHistory ? kantorHistory : kantorHistory.slice(0, 3)).map((c, i) => (
                        <div key={c.id} className={`p-2.5 rounded-lg border text-sm ${i === 0 ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className="flex items-center justify-between">
                            <span className={`font-bold ${i === 0 ? 'text-blue-700' : 'text-slate-700'}`}>{c.company_coverage_percent}%</span>
                            <span className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                          </div>
                          {c.notes && <p className="text-xs text-slate-500 mt-1">{c.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5">
              {/* % Karyawan */}
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-700">% Tanggung Jawab per Karyawan</h4>
                <div className={`text-xs font-semibold px-3 py-1 rounded-full ${
                  grandTotalPct > 100 ? 'bg-red-100 text-red-700'
                  : grandTotalPct === 100 ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-600'
                }`}>
                  Total: {grandTotalPct.toFixed(1)}%
                </div>
              </div>
              {grandTotalPct > 100 && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  ⛔ Total melebihi 100%! % Kantor ({companyPctNow}%) + % Karyawan ({totalSharePercent.toFixed(1)}%) = {grandTotalPct.toFixed(1)}%. Harap sesuaikan.
                </div>
              )}
              {grandTotalPct < 100 && grandTotalPct > 0 && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  ⚠️ Sisa {(100 - grandTotalPct).toFixed(1)}% belum di-assign — otomatis ikut ditanggung kantor saat kalkulasi.
                </div>
              )}
              {employees.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Tidak ada karyawan aktif di cabang ini.</p>
              ) : (
                <form onSubmit={handleSaveShares}>
                  <div className="space-y-4 mb-4">
                    {Object.entries(branchEmployeesByDept).sort(([a], [b]) => a.localeCompare(b)).map(([deptName, deptEmployees]) => (
                      <div key={deptName}>
                        <h5 className="text-xs font-bold text-slate-500 uppercase mb-2 pb-1 border-b border-slate-200">{deptName}</h5>
                        <div className="space-y-2">
                          {deptEmployees.map(emp => {
                            const latest = getLatestShare(emp.id)
                            const histEntries = employeeShareHistory(emp.id)
                            return (
                              <div key={emp.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                  <div className="flex-1">
                                    <div className="font-medium text-slate-800 text-sm">{emp.full_name}</div>
                                    <div className="text-xs text-slate-400">
                                      {emp.employee_code} · {emp.positions?.name}
                                      {emp.employee_type !== 'permanent' && (
                                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">{EMP_TYPE_LABEL[emp.employee_type] ?? emp.employee_type}</span>
                                      )}
                                    </div>
                                    <div className={`text-xs font-semibold mt-0.5 ${latest ? (Number(latest.share_percent) > 0 ? 'text-blue-600' : 'text-slate-400') : 'text-slate-400 italic'}`}>
                                      {latest ? `Saat ini: ${Number(latest.share_percent).toFixed(1)}%` : 'Belum dikonfigurasi'}
                                    </div>
                                  </div>
                                  <div className="flex gap-2 items-center">
                                    <input type="number" min="0" max="100" step="0.01" placeholder="% baru"
                                      value={shareForm[emp.id]?.percent ?? ''}
                                      onChange={e => setShareForm(prev => ({ ...prev, [emp.id]: { ...(prev[emp.id] || { notes: '' }), percent: e.target.value } }))}
                                      className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm text-right focus:ring-1 focus:ring-blue-500 outline-none" />
                                    <span className="text-sm text-slate-500">%</span>
                                    <input type="text" placeholder="Catatan" value={shareForm[emp.id]?.notes ?? ''}
                                      onChange={e => setShareForm(prev => ({ ...prev, [emp.id]: { ...(prev[emp.id] || { percent: '' }), notes: e.target.value } }))}
                                      className="w-28 px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                                  </div>
                                </div>
                                {histEntries.length > 0 && (
                                  <div className="mt-2 text-xs text-slate-500 border-t border-slate-100 pt-2">
                                    <span className="font-medium text-slate-600">Histori: </span>
                                    {histEntries.slice(0, 4).map((h, i) => (
                                      <span key={h.id} className={`inline-flex items-center gap-1 ${i === 0 && h.is_active ? 'text-blue-600 font-semibold' : 'text-slate-400'}`}>
                                        {Number(h.share_percent).toFixed(1)}%
                                        <span className="text-slate-300 text-[10px]">{new Date(h.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                        {i < Math.min(histEntries.length, 4) - 1 ? <span className="mx-1 text-slate-300">→</span> : null}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="submit" disabled={shareSubmitting} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                    {shareSubmitting ? 'Menyimpan...' : '💾 Simpan Semua % (Tambah ke History)'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Input Bulanan */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-800 mb-1">2. Input Total Kehilangan Bulan Ini</h3>
        <p className="text-xs text-slate-500 mb-4">{branches.find(b=>b.id===selectedBranch)?.name}</p>
        <div className="flex flex-wrap gap-3 mb-4">
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {lossInput && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
            <span className="text-amber-700">Sudah ada data: </span>
            <span className="font-bold text-amber-800">{fmtRp(lossInput.total_loss_amount)}</span>
            <span className="text-amber-600 ml-1">— edit di bawah untuk update</span>
          </div>
        )}
        <form onSubmit={handleSaveLoss} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Total Kehilangan Barang (Rp) <span className="text-red-500">*</span></label>
            <RupiahInput required value={lossForm.amount} onChange={v => setLossForm({...lossForm, amount: v})}
              placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Catatan</label>
            <input type="text" value={lossForm.notes} onChange={e => setLossForm({...lossForm, notes: e.target.value})}
              placeholder="Opsional" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <button type="submit" disabled={lossSaving} className="sm:col-span-2 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {lossSaving ? 'Menyimpan...' : lossInput ? '💾 Update Data' : '💾 Simpan Data'}
          </button>
        </form>
      </div>

      {/* 3. Preview & Terapkan */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-slate-800">3. Preview & Terapkan ke Slip Gaji</h3>
            <p className="text-xs text-slate-500 mt-0.5">Cuma berlaku ke slip gaji yang masih berstatus draft.</p>
          </div>
          <button onClick={handlePreview} disabled={previewLoading}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {previewLoading ? 'Menghitung...' : '🔍 Preview Kalkulasi'}
          </button>
        </div>

        {preview.length > 0 && (
          <>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Karyawan','Jabatan','% Tanggung','Potongan'].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map(p => (
                    <tr key={p.empId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{p.name}</div>
                        <div className="text-xs text-slate-400">{p.code}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.position}</td>
                      <td className="px-4 py-3 text-slate-600">{p.sharePct}%</td>
                      <td className="px-4 py-3 text-red-600 font-bold">{p.invLoss > 0 ? `-${fmtRp(p.invLoss)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview[0] && (
              <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-700 mb-2">Detail Kalkulasi:</p>
                <p>📦 Total kehilangan barang: <strong>{fmtRp(preview[0].totalLoss)}</strong></p>
                <p>🏢 Kantor menanggung {preview[0].companyPct}% + sisa {preview[0].unassignedPct.toFixed(1)}% = <strong className="text-blue-600">{fmtRp(preview[0].companyCover)}</strong></p>
                <p>👥 Ditanggung karyawan: <strong className="text-red-600">{fmtRp(preview[0].totalLoss - preview[0].companyCover)}</strong></p>
              </div>
            )}
            <div className="px-5 py-4 border-t border-slate-100 flex justify-end">
              <button onClick={handleApply} disabled={applying}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
                {applying ? 'Mengapply...' : '✅ Apply ke Slip Gaji'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 4. Riwayat */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">📊 Riwayat Kehilangan Barang — Semua Cabang</span>
          <button onClick={fetchHistory} className="text-xs text-blue-600 hover:underline">🔄 Refresh</button>
        </div>
        {loadingHistory ? (
          <p className="px-5 py-4 text-sm text-slate-400">Memuat...</p>
        ) : history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400 italic">Belum ada data kehilangan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Periode</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase text-right">Total Kehilangan</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Catatan</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map(h => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{(h.branches as any)?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{MONTHS[h.period_month - 1]} {h.period_year}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-red-600">{fmtRp(h.total_loss_amount)}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{h.notes ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => handleDeleteHistory(h)} className="px-2.5 py-1 text-xs font-medium bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 rounded-lg transition">Hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
