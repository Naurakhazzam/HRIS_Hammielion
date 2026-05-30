'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── Types ──────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }
type Position = { id: string; name: string }
type Employee = { id: string; full_name: string; employee_code: string; branch_id: string; position_id: string; positions: { name: string } | null }

type BranchLossConfig = { id: string; branch_id: string; company_coverage_percent: number; effective_date: string; notes: string | null; created_at: string }
type LossEmployeeShare = { id: string; employee_id: string; branch_id: string; share_percent: number; effective_date: string; is_active: boolean; notes: string | null; created_at: string; employees?: { full_name: string; employee_code: string; positions?: { name: string } | null } }
type LossMonthlyInput = { id: string; branch_id: string; period_month: number; period_year: number; total_loss_amount: number; notes: string | null }
type CashierLossConfig = { id: string; branch_id: string; position_id: string; is_active: boolean; positions?: { name: string } }
type CashierLossEntry = { id: string; branch_id: string; entry_date: string; amount: number; period_month: number; period_year: number; notes: string | null }

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

export default function KehilanganPage() {
  const [activeTab, setActiveTab] = useState<'setup' | 'input' | 'rekap'>('setup')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 6000)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kehilangan Barang & Kerugian Kasir</h1>
        <p className="text-sm text-slate-500">Kelola setup, input bulanan, dan kalkulasi potongan gaji per cabang.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        {(['setup', 'input', 'rekap'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab === 'setup' ? '⚙️ Setup' : tab === 'input' ? '📝 Input Bulanan' : '📊 Rekap & Apply'}
          </button>
        ))}
      </div>

      {activeTab === 'setup' && <TabSetup showMsg={showMsg} />}
      {activeTab === 'input' && <TabInput showMsg={showMsg} />}
      {activeTab === 'rekap' && <TabRekap showMsg={showMsg} />}
    </div>
  )
}

// ── Tab Setup ──────────────────────────────────────────────────────────────────
function TabSetup({ showMsg }: { showMsg: (t: 'success'|'error', m: string) => void }) {
  const supabase = createClient()
  const [branches, setBranches] = useState<Branch[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [configs, setConfigs] = useState<BranchLossConfig[]>([])
  const [shares, setShares] = useState<LossEmployeeShare[]>([])
  const [cashierConfigs, setCashierConfigs] = useState<CashierLossConfig[]>([])
  const [loading, setLoading] = useState(true)

  const [setupTab, setSetupTab] = useState<'kantor' | 'karyawan' | 'kasir'>('kantor')
  const [selectedBranch, setSelectedBranch] = useState('')

  // Form % kantor
  const [kantorForm, setKantorForm] = useState({ percent: '', notes: '', effective_date: new Date().toISOString().split('T')[0] })
  const [kantorSubmitting, setKantorSubmitting] = useState(false)
  const [showKantorHistory, setShowKantorHistory] = useState(false)

  // Form % karyawan
  const [shareForm, setShareForm] = useState<Record<string, { percent: string; notes: string }>>({})
  const [shareSubmitting, setShareSubmitting] = useState(false)

  useEffect(() => { fetchAll() }, [])

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

  // % kantor untuk cabang terpilih (terbaru)
  const currentKantorConfig = configs.filter(c => c.branch_id === selectedBranch).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const kantorHistory = configs.filter(c => c.branch_id === selectedBranch).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  async function handleSaveKantor(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBranch) return
    const pct = parseFloat(kantorForm.percent)
    if (isNaN(pct) || pct < 0 || pct > 100) { showMsg('error', 'Persentase harus 0–100.'); return }
    setKantorSubmitting(true)
    const { error } = await supabase.from('branch_loss_configs').insert({
      branch_id: selectedBranch,
      company_coverage_percent: pct,
      effective_date: kantorForm.effective_date,
      notes: kantorForm.notes || null
    })
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Konfigurasi % kantor berhasil disimpan.'); setKantorForm({ percent: '', notes: '', effective_date: new Date().toISOString().split('T')[0] }); fetchAll() }
    setKantorSubmitting(false)
  }

  // Karyawan di cabang terpilih + share mereka
  const branchEmployees = employees.filter(e => e.branch_id === selectedBranch)
  const getLatestShare = (empId: string) => shares.filter(s => s.employee_id === empId && s.branch_id === selectedBranch).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const totalSharePercent = branchEmployees.reduce((sum, e) => { const s = getLatestShare(e.id); return sum + (s ? Number(s.share_percent) : 0) }, 0)

  async function handleSaveShares(e: React.FormEvent) {
    e.preventDefault()
    setShareSubmitting(true)
    const today = new Date().toISOString().split('T')[0]
    const inserts = []
    for (const emp of branchEmployees) {
      const f = shareForm[emp.id]
      if (!f?.percent) continue
      const pct = parseFloat(f.percent)
      if (isNaN(pct) || pct < 0) continue
      inserts.push({
        employee_id: emp.id,
        branch_id: selectedBranch,
        share_percent: pct,
        effective_date: today,
        notes: f.notes || null,
        is_active: true
      })
    }
    if (inserts.length === 0) { showMsg('error', 'Tidak ada persentase yang diisi.'); setShareSubmitting(false); return }
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

  const employeeShareHistory = (empId: string) => shares.filter(s => s.employee_id === empId && s.branch_id === selectedBranch).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div className="space-y-6">
      {/* Branch Selector */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">Pilih Cabang</label>
        <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
          className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* Sub-tab */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit text-xs">
        {(['kantor', 'karyawan', 'kasir'] as const).map(t => (
          <button key={t} onClick={() => setSetupTab(t)}
            className={`px-4 py-1.5 rounded text-xs font-medium transition ${setupTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'kantor' ? '% Kantor' : t === 'karyawan' ? '% Karyawan' : 'Jabatan Kasir'}
          </button>
        ))}
      </div>

      {/* ── Setup % Kantor ── */}
      {setupTab === 'kantor' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-800 mb-1">% Kantor Menanggung — {branches.find(b=>b.id===selectedBranch)?.name}</h3>
            {currentKantorConfig && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                <span className="font-bold text-blue-700">{currentKantorConfig.company_coverage_percent}%</span>
                <span className="text-blue-600 ml-2">saat ini aktif</span>
                {currentKantorConfig.notes && <p className="text-xs text-blue-500 mt-1">{currentKantorConfig.notes}</p>}
              </div>
            )}
            <form onSubmit={handleSaveKantor} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">% Baru yang Ditanggung Kantor <span className="text-red-500">*</span></label>
                <input type="number" required min="0" max="100" step="0.01" value={kantorForm.percent}
                  onChange={e => setKantorForm({...kantorForm, percent: e.target.value})}
                  placeholder="Contoh: 50" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Berlaku Mulai</label>
                <input type="date" value={kantorForm.effective_date} onChange={e => setKantorForm({...kantorForm, effective_date: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Catatan (opsional)</label>
                <input type="text" value={kantorForm.notes} onChange={e => setKantorForm({...kantorForm, notes: e.target.value})}
                  placeholder="Alasan perubahan..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <button type="submit" disabled={kantorSubmitting} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {kantorSubmitting ? 'Menyimpan...' : 'Simpan (Tambah ke History)'}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">Histori Perubahan</h3>
              <button onClick={() => setShowKantorHistory(!showKantorHistory)} className="text-xs text-blue-600 hover:underline">
                {showKantorHistory ? 'Sembunyikan' : `Lihat semua (${kantorHistory.length})`}
              </button>
            </div>
            {kantorHistory.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Belum ada konfigurasi untuk cabang ini.</p>
            ) : (
              <div className="space-y-2">
                {(showKantorHistory ? kantorHistory : kantorHistory.slice(0,3)).map((c, i) => (
                  <div key={c.id} className={`p-3 rounded-lg border text-sm ${i === 0 ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-bold ${i === 0 ? 'text-blue-700' : 'text-slate-700'}`}>{c.company_coverage_percent}%</span>
                      <span className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'})}</span>
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

      {/* ── Setup % Karyawan ── */}
      {setupTab === 'karyawan' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">% Tanggung Jawab Karyawan — {branches.find(b=>b.id===selectedBranch)?.name}</h3>
            <div className={`text-sm font-semibold px-3 py-1 rounded-full ${totalSharePercent > 100 ? 'bg-red-100 text-red-700' : totalSharePercent === 100 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
              Total: {totalSharePercent.toFixed(1)}%
            </div>
          </div>
          {totalSharePercent < 100 && totalSharePercent > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              ⚠️ Sisa {(100 - totalSharePercent).toFixed(1)}% yang tidak di-assign akan otomatis dibebankan ke kantor dan ditampilkan transparan di slip gaji.
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
                          {latest && (
                            <div className="text-xs text-blue-600 mt-0.5">Saat ini: {latest.share_percent}%</div>
                          )}
                        </div>
                        <div className="flex gap-2 items-center">
                          <input type="number" min="0" max="100" step="0.01" placeholder="%" value={f.percent}
                            onChange={e => setShareForm(prev => ({...prev, [emp.id]: {...f, percent: e.target.value}}))}
                            className="w-20 px-2 py-1.5 border border-slate-300 rounded text-sm text-right focus:ring-1 focus:ring-blue-500 outline-none" />
                          <span className="text-sm text-slate-500">%</span>
                          <input type="text" placeholder="Catatan" value={f.notes}
                            onChange={e => setShareForm(prev => ({...prev, [emp.id]: {...f, notes: e.target.value}}))}
                            className="w-32 px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                        </div>
                      </div>
                      {history.length > 1 && (
                        <div className="mt-2 ml-0 text-xs text-slate-500">
                          Histori: {history.slice(0,3).map((h,i) => (
                            <span key={h.id} className={i===0?'text-blue-600 font-medium':''}>{h.share_percent}% ({new Date(h.created_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short'})}){i < Math.min(history.length,3)-1 ? ' → ' : ''}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <button type="submit" disabled={shareSubmitting} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {shareSubmitting ? 'Menyimpan...' : 'Simpan Semua % (Tambah ke History)'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ── Setup Jabatan Kasir ── */}
      {setupTab === 'kasir' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Jabatan Terdampak Kerugian Kasir — {branches.find(b=>b.id===selectedBranch)?.name}</h3>
          <p className="text-xs text-slate-500 mb-4">Pilih jabatan yang ikut menanggung kerugian minus kas. Kerugian akan dibagi rata ke semua karyawan aktif dengan jabatan tersebut di cabang ini.</p>
          <div className="space-y-2">
            {positions.map(pos => {
              const existing = cashierConfigs.find(c => c.branch_id === selectedBranch && c.position_id === pos.id)
              const isActive = existing?.is_active ?? false
              return (
                <div key={pos.id} className={`flex items-center justify-between p-3 rounded-lg border ${isActive ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
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

// ── Tab Input Bulanan ──────────────────────────────────────────────────────────
function TabInput({ showMsg }: { showMsg: (t: 'success'|'error', m: string) => void }) {
  const supabase = createClient()
  const today = new Date()
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [loading, setLoading] = useState(true)

  // Kehilangan barang
  const [lossInput, setLossInput] = useState<LossMonthlyInput | null>(null)
  const [lossForm, setLossForm] = useState({ amount: '', notes: '' })
  const [lossSaving, setLossSaving] = useState(false)

  // Kasir entries
  const [entries, setEntries] = useState<CashierLossEntry[]>([])
  const [entryForm, setEntryForm] = useState({ date: today.toISOString().split('T')[0], amount: '', notes: '' })
  const [entrySaving, setEntrySaving] = useState(false)
  const [editEntry, setEditEntry] = useState<CashierLossEntry | null>(null)
  const [editForm, setEditForm] = useState({ date: '', amount: '', notes: '' })

  useEffect(() => { fetchBranches() }, [])
  useEffect(() => { if (selectedBranch) fetchData() }, [selectedBranch, filterMonth, filterYear])

  async function fetchBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
    if (data) { setBranches(data); if (data.length > 0) setSelectedBranch(data[0].id) }
  }

  async function fetchData() {
    setLoading(true)
    const [lRes, eRes] = await Promise.all([
      supabase.from('loss_monthly_inputs').select('*').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).single(),
      supabase.from('cashier_loss_entries').select('*').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).order('entry_date')
    ])
    if (lRes.data) { setLossInput(lRes.data); setLossForm({ amount: String(lRes.data.total_loss_amount), notes: lRes.data.notes || '' }) }
    else { setLossInput(null); setLossForm({ amount: '', notes: '' }) }
    setEntries(eRes.data || [])
    setLoading(false)
  }

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
    else { showMsg('success', 'Kehilangan barang berhasil disimpan.'); fetchData() }
    setLossSaving(false)
  }

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(entryForm.amount)
    if (isNaN(amt) || amt <= 0) { showMsg('error', 'Nominal harus lebih dari 0.'); return }
    setEntrySaving(true)
    const { error } = await supabase.from('cashier_loss_entries').insert({
      branch_id: selectedBranch, entry_date: entryForm.date, amount: amt,
      period_month: filterMonth, period_year: filterYear, notes: entryForm.notes || null
    })
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Entry minus kas berhasil ditambahkan.'); setEntryForm({ date: today.toISOString().split('T')[0], amount: '', notes: '' }); fetchData() }
    setEntrySaving(false)
  }

  async function handleEditEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!editEntry) return
    const amt = parseFloat(editForm.amount)
    if (isNaN(amt) || amt <= 0) { showMsg('error', 'Nominal tidak valid.'); return }
    const { error } = await supabase.from('cashier_loss_entries').update({ entry_date: editForm.date, amount: amt, notes: editForm.notes || null, updated_at: new Date().toISOString() }).eq('id', editEntry.id)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Entry berhasil diupdate.'); setEditEntry(null); fetchData() }
  }

  async function handleDeleteEntry(id: string) {
    if (!confirm('Hapus entry minus kas ini?')) return
    const { error } = await supabase.from('cashier_loss_entries').delete().eq('id', id)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Entry berhasil dihapus.'); fetchData() }
  }

  const totalKasir = entries.reduce((s, e) => s + Number(e.amount), 0)
  const yearOptions = [today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1]

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cabang</label>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Bulan</label>
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Tahun</label>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Kehilangan Barang */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-1">📦 Kehilangan Barang</h3>
          <p className="text-xs text-slate-500 mb-4">{branches.find(b=>b.id===selectedBranch)?.name} · {MONTHS[filterMonth-1]} {filterYear}</p>
          {lossInput && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <span className="text-amber-700">Sudah ada data: </span>
              <span className="font-bold text-amber-800">{fmtRp(lossInput.total_loss_amount)}</span>
              <span className="text-amber-600 ml-1">— edit di bawah untuk update</span>
            </div>
          )}
          <form onSubmit={handleSaveLoss} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Total Kehilangan Barang (Rp) <span className="text-red-500">*</span></label>
              <input type="number" required min="0" value={lossForm.amount} onChange={e => setLossForm({...lossForm, amount: e.target.value})}
                placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Catatan</label>
              <input type="text" value={lossForm.notes} onChange={e => setLossForm({...lossForm, notes: e.target.value})}
                placeholder="Opsional" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <button type="submit" disabled={lossSaving} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {lossSaving ? 'Menyimpan...' : lossInput ? '💾 Update Data' : '💾 Simpan Data'}
            </button>
          </form>
        </div>

        {/* Minus Kas Kasir */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-slate-800">💵 Minus Kas Kasir</h3>
            {totalKasir > 0 && <span className="text-sm font-bold text-red-600">{fmtRp(totalKasir)}</span>}
          </div>
          <p className="text-xs text-slate-500 mb-4">{branches.find(b=>b.id===selectedBranch)?.name} · {MONTHS[filterMonth-1]} {filterYear}</p>

          {/* Daftar entries */}
          {entries.length > 0 && (
            <div className="mb-4 space-y-2 max-h-48 overflow-y-auto">
              {entries.map(ent => (
                <div key={ent.id} className="flex items-center justify-between p-2.5 bg-red-50 rounded-lg border border-red-100 text-sm">
                  <div>
                    <span className="font-medium text-slate-700">{new Date(ent.entry_date).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</span>
                    {ent.notes && <span className="text-xs text-slate-500 ml-2">— {ent.notes}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-red-600">-{fmtRp(ent.amount)}</span>
                    <button onClick={() => { setEditEntry(ent); setEditForm({ date: ent.entry_date, amount: String(ent.amount), notes: ent.notes || '' }) }}
                      className="px-2 py-0.5 text-xs border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition">Edit</button>
                    <button onClick={() => handleDeleteEntry(ent.id)}
                      className="px-2 py-0.5 text-xs border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Hapus</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Form tambah entry */}
          <form onSubmit={handleAddEntry} className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-600">+ Tambah Minus Kas</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Tanggal</label>
                <input type="date" required value={entryForm.date} onChange={e => setEntryForm({...entryForm, date: e.target.value})}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Nominal (Rp)</label>
                <input type="number" required min="1" value={entryForm.amount} onChange={e => setEntryForm({...entryForm, amount: e.target.value})}
                  placeholder="50000" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
              </div>
            </div>
            <input type="text" value={entryForm.notes} onChange={e => setEntryForm({...entryForm, notes: e.target.value})}
              placeholder="Catatan (opsional)" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
            <button type="submit" disabled={entrySaving} className="w-full py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {entrySaving ? 'Menambahkan...' : '+ Tambah Entry'}
            </button>
          </form>
        </div>
      </div>

      {/* Modal Edit Entry */}
      {editEntry && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95">
            <h3 className="font-semibold text-slate-800 mb-4">Edit Entry Minus Kas</h3>
            <form onSubmit={handleEditEntry} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal</label>
                <input type="date" required value={editForm.date} onChange={e => setEditForm({...editForm, date: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nominal (Rp)</label>
                <input type="number" required min="1" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Catatan</label>
                <input type="text" value={editForm.notes} onChange={e => setEditForm({...editForm, notes: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditEntry(null)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
                <button type="submit" className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab Rekap & Apply ──────────────────────────────────────────────────────────
function TabRekap({ showMsg }: { showMsg: (t: 'success'|'error', m: string) => void }) {
  const supabase = createClient()
  const today = new Date()
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [preview, setPreview] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    supabase.from('branches').select('id,name').eq('is_active',true).order('name').then(({data}) => {
      if (data) { setBranches(data); if (data.length > 0) setSelectedBranch(data[0].id) }
    })
  }, [])

  async function handlePreview() {
    if (!selectedBranch) return
    setLoading(true)
    setPreview([])

    // 1. Ambil kehilangan barang
    const { data: lossData } = await supabase.from('loss_monthly_inputs').select('*').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).single()

    // 2. Ambil % kantor terbaru
    const { data: configData } = await supabase.from('branch_loss_configs').select('*').eq('branch_id', selectedBranch).order('created_at', { ascending: false }).limit(1)
    const companyPct = configData?.[0]?.company_coverage_percent ?? 0

    // 3. Ambil % karyawan aktif di cabang
    const { data: sharesData } = await supabase.from('loss_employee_shares').select('*, employees(id, full_name, employee_code, positions(name))').eq('branch_id', selectedBranch).eq('is_active', true)

    // Ambil share terbaru per employee
    const latestShares: Record<string, any> = {}
    ;(sharesData || []).forEach((s: any) => {
      if (!latestShares[s.employee_id] || new Date(s.created_at) > new Date(latestShares[s.employee_id].created_at)) {
        latestShares[s.employee_id] = s
      }
    })

    // 4. Ambil kasir entries
    const { data: entriesData } = await supabase.from('cashier_loss_entries').select('*').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).order('entry_date')

    // 5. Ambil kasir configs (jabatan terdampak)
    const { data: cashierConfigs } = await supabase.from('cashier_loss_configs').select('*, positions(name)').eq('branch_id', selectedBranch).eq('is_active', true)
    const kasirPositionIds = (cashierConfigs || []).map((c: any) => c.position_id)

    // 6. Ambil karyawan kasir aktif di cabang
    const { data: kasirEmps } = kasirPositionIds.length > 0
      ? await supabase.from('employees').select('id, full_name, employee_code, position_id, positions(name)').eq('branch_id', selectedBranch).eq('is_active', true).in('position_id', kasirPositionIds)
      : { data: [] }

    // Kalkulasi kehilangan barang
    const totalLoss = lossData?.total_loss_amount ?? 0
    const totalKasir = (entriesData || []).reduce((s: number, e: any) => s + Number(e.amount), 0)
    const companyCoverLoss = totalLoss * (companyPct / 100)
    const employeeTotalLoss = totalLoss - companyCoverLoss
    const totalAssigned = Object.values(latestShares).reduce((s: number, sh: any) => s + Number(sh.share_percent), 0)
    const unassignedPct = Math.max(0, 100 - totalAssigned)
    const companyExtraCover = employeeTotalLoss * (unassignedPct / 100)
    const actualEmployeeLoss = employeeTotalLoss - companyExtraCover

    // Preview per karyawan
    const empIds = [...new Set([...Object.keys(latestShares), ...(kasirEmps || []).map((e: any) => e.id)])]
    const results: any[] = []

    for (const empId of empIds) {
      const share = latestShares[empId]
      const emp = share?.employees || (kasirEmps || []).find((e: any) => e.id === empId)
      if (!emp) continue

      // Cek apakah employee masih aktif di cabang
      const { data: empCheck } = await supabase.from('employees').select('id,is_active,branch_id').eq('id', empId).single()
      if (!empCheck?.is_active || empCheck.branch_id !== selectedBranch) continue

      const invLoss = share ? (Number(share.share_percent) / 100) * actualEmployeeLoss : 0
      const isKasir = kasirPositionIds.includes(emp.position_id || emp.positions?.id)
      const kasirCount = (kasirEmps || []).length
      const kasirLoss = isKasir && kasirCount > 0 ? totalKasir / kasirCount : 0

      results.push({
        empId,
        name: emp.full_name || emp.employees?.full_name,
        code: emp.employee_code || emp.employees?.employee_code,
        position: emp.positions?.name,
        sharePct: share ? Number(share.share_percent) : 0,
        invLoss: Math.round(invLoss),
        kasirLoss: Math.round(kasirLoss),
        isKasir,
        kasirCount,
        totalKasirMonthly: totalKasir,
        totalLoss,
        companyPct,
        companyCover: Math.round(companyCoverLoss + companyExtraCover),
        unassignedPct,
        entries: entriesData || []
      })
    }

    setPreview(results)
    setLoading(false)
  }

  async function handleApply() {
    if (preview.length === 0) return
    if (!confirm(`Apply potongan kehilangan ke ${preview.length} karyawan untuk payroll ${MONTHS[filterMonth-1]} ${filterYear}?`)) return
    setApplying(true)

    for (const p of preview) {
      // Cari payroll karyawan di periode ini
      const { data: payroll } = await supabase.from('payrolls').select('id, gross_total, net_total, late_deduction, kasbon_deduction, loyalitas_deduction, conditional_bonus')
        .eq('employee_id', p.empId).eq('period_month', filterMonth).eq('period_year', filterYear).single()
      if (!payroll) continue

      const newInvLoss = p.invLoss
      const newKasirLoss = p.kasirLoss
      const newNet = Number(payroll.gross_total) - Number(payroll.late_deduction) - Number(payroll.kasbon_deduction) - Number(payroll.loyalitas_deduction ?? 0) - newInvLoss - newKasirLoss

      await supabase.from('payrolls').update({
        inventory_loss_deduction: newInvLoss,
        cashier_loss_deduction: newKasirLoss,
        net_total: newNet
      }).eq('id', payroll.id)
    }

    showMsg('success', `Potongan berhasil diapply ke ${preview.length} karyawan.`)
    setApplying(false)
  }

  const yearOptions = [today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1]

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cabang</label>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Bulan</label>
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Tahun</label>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={handlePreview} disabled={loading}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
          {loading ? 'Menghitung...' : '🔍 Preview Kalkulasi'}
        </button>
      </div>

      {preview.length > 0 && (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Preview Potongan — {branches.find(b=>b.id===selectedBranch)?.name} · {MONTHS[filterMonth-1]} {filterYear}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-white border-b border-slate-200">
                  <tr>
                    {['Karyawan','Jabatan','% Tanggung','Pot. Kehilangan','Pot. Kasir','Total Potong'].map(h => (
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
                      <td className="px-4 py-3 text-red-600 font-medium">{p.invLoss > 0 ? `-${fmtRp(p.invLoss)}` : '—'}</td>
                      <td className="px-4 py-3 text-red-600 font-medium">{p.kasirLoss > 0 ? `-${fmtRp(p.kasirLoss)}` : '—'}</td>
                      <td className="px-4 py-3 font-bold text-red-700">{p.invLoss + p.kasirLoss > 0 ? `-${fmtRp(p.invLoss + p.kasirLoss)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Detail transparency */}
            {preview[0] && (
              <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-700 mb-2">Detail Kalkulasi:</p>
                <p>📦 Total kehilangan barang: <strong>{fmtRp(preview[0].totalLoss)}</strong></p>
                <p>🏢 Kantor menanggung {preview[0].companyPct}% + sisa {preview[0].unassignedPct.toFixed(1)}% = <strong className="text-blue-600">{fmtRp(preview[0].companyCover)}</strong></p>
                <p>👥 Ditanggung karyawan: <strong className="text-red-600">{fmtRp(preview[0].totalLoss - preview[0].companyCover)}</strong></p>
                {preview[0].totalKasirMonthly > 0 && (
                  <>
                    <p className="mt-2">💵 Total minus kas: <strong>{fmtRp(preview[0].totalKasirMonthly)}</strong></p>
                    <p>Dibagi rata {preview[0].kasirCount} kasir = <strong>{fmtRp(preview[0].totalKasirMonthly / preview[0].kasirCount)}</strong>/orang</p>
                    {preview[0].entries.length > 0 && (
                      <p>Rincian: {preview[0].entries.map((e: any) => `${new Date(e.entry_date).toLocaleDateString('id-ID',{day:'2-digit',month:'short'})} -${fmtRp(e.amount)}`).join(' | ')}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={handleApply} disabled={applying}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
              {applying ? 'Mengapply...' : '✅ Apply ke Slip Gaji'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
