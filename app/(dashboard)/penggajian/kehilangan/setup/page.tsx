'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Position = { id: string; name: string }
type Employee = { id: string; full_name: string; employee_code: string; branch_id: string; position_id: string; positions: { name: string } | null }
type BranchLossConfig = { id: string; branch_id: string; company_coverage_percent: number; effective_date: string; notes: string | null; created_at: string }
type LossEmployeeShare = { id: string; employee_id: string; branch_id: string; share_percent: number; effective_date: string; is_active: boolean; notes: string | null; created_at: string; employees?: { full_name: string; employee_code: string; positions?: { name: string } | null } }
type CashierLossConfig = { id: string; branch_id: string; position_id: string; is_active: boolean; positions?: { name: string } }

export default function SetupKehilanganPage() {
  const supabase = createClient()
  const [branches, setBranches] = useState<Branch[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [configs, setConfigs] = useState<BranchLossConfig[]>([])
  const [shares, setShares] = useState<LossEmployeeShare[]>([])
  const [cashierConfigs, setCashierConfigs] = useState<CashierLossConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [setupTab, setSetupTab] = useState<'kantor' | 'karyawan' | 'kasir'>('kantor')
  const [selectedBranch, setSelectedBranch] = useState('')

  const [kantorForm, setKantorForm] = useState({ percent: '', notes: '', effective_date: new Date().toISOString().split('T')[0] })
  const [kantorSubmitting, setKantorSubmitting] = useState(false)
  const [showKantorHistory, setShowKantorHistory] = useState(false)

  const [shareForm, setShareForm] = useState<Record<string, { percent: string; notes: string }>>({})
  const [shareSubmitting, setShareSubmitting] = useState(false)

  useEffect(() => { fetchAll() }, [])

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function fetchAll() {
    setLoading(true)
    const [bRes, pRes, eRes, cRes, sRes, ccRes] = await Promise.all([
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('positions').select('id, name').order('name'),
      supabase.from('employees').select('id, full_name, employee_code, branch_id, position_id, positions(name)').eq('is_active', true).eq('employee_type', 'permanent').order('full_name'),
      supabase.from('branch_loss_configs').select('*').order('created_at', { ascending: false }),
      supabase.from('loss_employee_shares').select('*, employees(full_name, employee_code, positions(name))').eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('cashier_loss_configs').select('*, positions(name)').order('created_at'),
    ])
    if (bRes.data) { setBranches(bRes.data); if (!selectedBranch && bRes.data.length > 0) setSelectedBranch(bRes.data[0].id) }
    if (pRes.data) setPositions(pRes.data)
    if (eRes.data) setEmployees(eRes.data as unknown as Employee[])
    if (cRes.data) setConfigs(cRes.data)
    if (sRes.data) setShares(sRes.data as unknown as LossEmployeeShare[])
    if (ccRes.data) setCashierConfigs(ccRes.data as unknown as CashierLossConfig[])
    setLoading(false)
  }

  const currentKantorConfig = configs.filter(c => c.branch_id === selectedBranch).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const kantorHistory = configs.filter(c => c.branch_id === selectedBranch).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const branchEmployees = employees.filter(e => e.branch_id === selectedBranch)
  const getLatestShare = (empId: string) => shares.filter(s => s.employee_id === empId && s.branch_id === selectedBranch).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const totalSharePercent = branchEmployees.reduce((sum, e) => { const s = getLatestShare(e.id); return sum + (s ? Number(s.share_percent) : 0) }, 0)
  const employeeShareHistory = (empId: string) => shares.filter(s => s.employee_id === empId && s.branch_id === selectedBranch).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

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
    else { showMsg('success', 'Konfigurasi % kantor berhasil disimpan.'); setKantorForm({ percent: '', notes: '', effective_date: new Date().toISOString().split('T')[0] }); fetchAll() }
    setKantorSubmitting(false)
  }

  async function handleSaveShares(e: React.FormEvent) {
    e.preventDefault()
    setShareSubmitting(true)
    const today = new Date().toISOString().split('T')[0]
    const inserts: any[] = []
    let newTotal = 0
    for (const emp of branchEmployees) {
      const f = shareForm[emp.id]
      if (!f?.percent) continue
      const pct = parseFloat(f.percent)
      if (isNaN(pct) || pct < 0) continue
      newTotal += pct
      inserts.push({ employee_id: emp.id, branch_id: selectedBranch, share_percent: pct, effective_date: today, notes: f.notes || null, is_active: true })
    }
    if (inserts.length === 0) { showMsg('error', 'Tidak ada persentase yang diisi.'); setShareSubmitting(false); return }
    const companyPct = Number(currentKantorConfig?.company_coverage_percent ?? 0)
    if (companyPct + newTotal > 100) {
      showMsg('error', `% Kantor (${companyPct}%) + total % karyawan baru (${newTotal.toFixed(1)}%) = ${(companyPct + newTotal).toFixed(1)}% — melebihi 100%. Sesuaikan persentasenya.`)
      setShareSubmitting(false)
      return
    }
    const { error } = await supabase.from('loss_employee_shares').insert(inserts)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', `${inserts.length} persentase karyawan berhasil disimpan.`); setShareForm({}); fetchAll() }
    setShareSubmitting(false)
  }

  async function handleToggleCashierConfig(branchId: string, positionId: string, existingConfig: CashierLossConfig | null) {
    if (existingConfig) {
      const { error } = await supabase.from('cashier_loss_configs').update({ is_active: !existingConfig.is_active }).eq('id', existingConfig.id)
      if (error) showMsg('error', 'Gagal: ' + error.message)
      else fetchAll()
    } else {
      const { error } = await supabase.from('cashier_loss_configs').insert({ branch_id: branchId, position_id: positionId, is_active: true })
      if (error) showMsg('error', 'Gagal: ' + error.message)
      else fetchAll()
    }
  }

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Kehilangan Barang & Kasir</h1>
        <p className="text-sm text-slate-500">Konfigurasi % kantor, % karyawan, dan jabatan kasir per cabang.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Branch Selector */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">Pilih Cabang</label>
        <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
          className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* Sub-tab */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-6">
        {(['kantor', 'karyawan', 'kasir'] as const).map(t => (
          <button key={t} onClick={() => setSetupTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${setupTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'kantor' ? '🏢 % Kantor' : t === 'karyawan' ? '👥 % Karyawan' : '💵 Jabatan Kasir'}
          </button>
        ))}
      </div>

      {/* % Kantor */}
      {setupTab === 'kantor' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-800 mb-1">% Kantor Menanggung — {branches.find(b => b.id === selectedBranch)?.name}</h3>
            <p className="text-xs text-slate-500 mb-4">Setiap perubahan disimpan sebagai riwayat baru. History tetap tersimpan.</p>
            {currentKantorConfig && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                <span className="font-bold text-blue-700">{currentKantorConfig.company_coverage_percent}%</span>
                <span className="text-blue-600 ml-2">aktif sekarang</span>
                {currentKantorConfig.notes && <p className="text-xs text-blue-500 mt-1">{currentKantorConfig.notes}</p>}
              </div>
            )}
            <form onSubmit={handleSaveKantor} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">% Baru Ditanggung Kantor <span className="text-red-500">*</span></label>
                <input type="number" required min="0" max="100" step="0.01" value={kantorForm.percent} onChange={e => setKantorForm({ ...kantorForm, percent: e.target.value })}
                  placeholder="Contoh: 50" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Berlaku Mulai</label>
                <input type="date" value={kantorForm.effective_date} onChange={e => setKantorForm({ ...kantorForm, effective_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Catatan / Alasan Perubahan</label>
                <input type="text" value={kantorForm.notes} onChange={e => setKantorForm({ ...kantorForm, notes: e.target.value })}
                  placeholder="Opsional" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <button type="submit" disabled={kantorSubmitting} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {kantorSubmitting ? 'Menyimpan...' : '💾 Simpan (Tambah ke History)'}
              </button>
            </form>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">📋 Histori Perubahan</h3>
              <button onClick={() => setShowKantorHistory(!showKantorHistory)} className="text-xs text-blue-600 hover:underline">
                {showKantorHistory ? 'Sembunyikan' : `Lihat semua (${kantorHistory.length})`}
              </button>
            </div>
            {kantorHistory.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Belum ada konfigurasi.</p>
            ) : (
              <div className="space-y-2">
                {(showKantorHistory ? kantorHistory : kantorHistory.slice(0, 3)).map((c, i) => (
                  <div key={c.id} className={`p-3 rounded-lg border text-sm ${i === 0 ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-bold ${i === 0 ? 'text-blue-700' : 'text-slate-700'}`}>{c.company_coverage_percent}%</span>
                      <span className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                    {c.notes && <p className="text-xs text-slate-500 mt-1">{c.notes}</p>}
                    {i === 0 && <span className="text-xs text-blue-500 font-medium">← Aktif sekarang</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* % Karyawan */}
      {setupTab === 'karyawan' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-800">% Tanggung Jawab Karyawan — {branches.find(b => b.id === selectedBranch)?.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Setiap simpan akan menambah history baru per karyawan.</p>
            </div>
            <div className={`text-sm font-semibold px-3 py-1 rounded-full ${totalSharePercent > 100 ? 'bg-red-100 text-red-700' : totalSharePercent === 100 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
              Total: {totalSharePercent.toFixed(1)}%
            </div>
          </div>
          {totalSharePercent < 100 && totalSharePercent > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              ⚠️ Sisa {(100 - totalSharePercent).toFixed(1)}% tidak di-assign → otomatis ke kantor, ditampilkan transparan di slip gaji.
            </div>
          )}
          {branchEmployees.length === 0 ? (
            <p className="text-sm text-slate-500 italic">Tidak ada karyawan tetap aktif di cabang ini.</p>
          ) : (
            <form onSubmit={handleSaveShares}>
              <div className="space-y-3 mb-4">
                {branchEmployees.map(emp => {
                  const latest = getLatestShare(emp.id)
                  const history = employeeShareHistory(emp.id)
                  const f = shareForm[emp.id] || { percent: latest ? String(latest.share_percent) : '', notes: '' }
                  return (
                    <div key={emp.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1">
                          <div className="font-medium text-slate-800 text-sm">{emp.full_name}</div>
                          <div className="text-xs text-slate-400">{emp.employee_code} · {emp.positions?.name}</div>
                          {latest && <div className="text-xs text-blue-600 mt-0.5">Saat ini: {latest.share_percent}%</div>}
                        </div>
                        <div className="flex gap-2 items-center">
                          <input type="number" min="0" max="100" step="0.01" placeholder="%" value={f.percent}
                            onChange={e => setShareForm(prev => ({ ...prev, [emp.id]: { ...f, percent: e.target.value } }))}
                            className="w-20 px-2 py-1.5 border border-slate-300 rounded text-sm text-right focus:ring-1 focus:ring-blue-500 outline-none" />
                          <span className="text-sm text-slate-500">%</span>
                          <input type="text" placeholder="Catatan" value={f.notes}
                            onChange={e => setShareForm(prev => ({ ...prev, [emp.id]: { ...f, notes: e.target.value } }))}
                            className="w-32 px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                        </div>
                      </div>
                      {history.length > 0 && (
                        <div className="mt-2 text-xs text-slate-500">
                          Histori: {history.slice(0, 3).map((h, i) => (
                            <span key={h.id} className={i === 0 ? 'text-blue-600 font-medium' : ''}>
                              {h.share_percent}% ({new Date(h.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}){i < Math.min(history.length, 3) - 1 ? ' → ' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <button type="submit" disabled={shareSubmitting} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {shareSubmitting ? 'Menyimpan...' : '💾 Simpan Semua % (Tambah ke History)'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Jabatan Kasir */}
      {setupTab === 'kasir' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Jabatan Terdampak Kerugian Kasir — {branches.find(b => b.id === selectedBranch)?.name}</h3>
          <p className="text-xs text-slate-500 mb-4">Kerugian minus kas dibagi rata ke semua karyawan aktif dengan jabatan yang dipilih di cabang ini.</p>
          <div className="space-y-2">
            {positions.map(pos => {
              const existing = cashierConfigs.find(c => c.branch_id === selectedBranch && c.position_id === pos.id)
              const isActive = existing?.is_active ?? false
              return (
                <div key={pos.id} className={`flex items-center justify-between p-3 rounded-lg border transition ${isActive ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
                  <span className="text-sm font-medium text-slate-700">{pos.name}</span>
                  <button onClick={() => handleToggleCashierConfig(selectedBranch, pos.id, existing || null)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition ${isActive ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {isActive ? '✓ Aktif' : 'Nonaktif'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
