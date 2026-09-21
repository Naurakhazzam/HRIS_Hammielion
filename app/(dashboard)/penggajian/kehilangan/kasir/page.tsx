'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'

// ── Types ──────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }
type Position = { id: string; name: string }
type Employee = { id: string; full_name: string; employee_code: string; branch_id: string; position_id: string; positions: { name: string } | null }
type CashierLossConfig = { id: string; branch_id: string; position_id: string; is_active: boolean; positions?: { name: string } }
type CashierLossEntry = { id: string; branch_id: string; entry_date: string; amount: number; period_month: number; period_year: number; notes: string | null; employee_id: string | null; employees?: { full_name: string; employee_code: string } | null }

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

export default function KerugianKasirPage() {
  const supabase = createClient()
  const today = new Date()

  // ── Konteks halaman: satu cabang + satu periode dipakai di semua seksi ──
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Setup: Jabatan Kasir
  const [positions, setPositions] = useState<Position[]>([])
  const [cashierConfigs, setCashierConfigs] = useState<CashierLossConfig[]>([])
  const [setupOpen, setSetupOpen] = useState(false)

  // Karyawan cabang (untuk dropdown assign + cek jabatan kasir)
  const [branchEmployees, setBranchEmployees] = useState<Employee[]>([])

  // Input entries periode ini
  const [entries, setEntries] = useState<CashierLossEntry[]>([])
  const [entryForm, setEntryForm] = useState({ date: today.toISOString().split('T')[0], amount: '', notes: '', employee_id: '' })
  const [entrySaving, setEntrySaving] = useState(false)
  const [editEntry, setEditEntry] = useState<CashierLossEntry | null>(null)
  const [editForm, setEditForm] = useState({ date: '', amount: '', notes: '', employee_id: '' })

  // Riwayat semua periode (cabang ini)
  const [historyEntries, setHistoryEntries] = useState<CashierLossEntry[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Preview & Apply
  const [preview, setPreview] = useState<any[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 6000)
  }

  useEffect(() => { fetchBranches(); fetchPositions() }, [])
  useEffect(() => { if (selectedBranch) { fetchBranchEmployees(); fetchCashierConfigs(); fetchHistoryEntries() } }, [selectedBranch]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedBranch) fetchEntries() }, [selectedBranch, filterMonth, filterYear])

  async function fetchBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
    if (data) { setBranches(data); if (data.length > 0) setSelectedBranch(data[0].id) }
    setLoading(false)
  }

  async function fetchPositions() {
    const { data } = await supabase.from('positions').select('id, name').order('name')
    if (data) setPositions(data)
  }

  async function fetchCashierConfigs() {
    const { data } = await supabase.from('cashier_loss_configs').select('*, positions(name)').eq('branch_id', selectedBranch).order('created_at')
    setCashierConfigs((data as unknown as CashierLossConfig[]) || [])
  }

  async function fetchBranchEmployees() {
    const { data } = await supabase.from('employees').select('id, full_name, employee_code, branch_id, position_id, positions(name)').eq('branch_id', selectedBranch).eq('is_active', true).order('full_name')
    setBranchEmployees((data || []) as unknown as Employee[])
  }

  async function fetchEntries() {
    const { data, error } = await supabase.from('cashier_loss_entries').select('*, employees!cashier_loss_entries_employee_id_fkey(full_name, employee_code)').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).order('entry_date')
    if (error) showMsg('error', 'Gagal memuat data minus kas: ' + error.message)
    else setEntries((data as unknown as CashierLossEntry[]) || [])
    setPreview([])
  }

  // Riwayat SEMUA periode (cabang ini) — supaya kelihatan kalau ada entry yang "nyasar" ke
  // periode lain (mis. salah tanggal saat input).
  async function fetchHistoryEntries() {
    setLoadingHistory(true)
    const { data } = await supabase.from('cashier_loss_entries').select('*, employees!cashier_loss_entries_employee_id_fkey(full_name, employee_code)').eq('branch_id', selectedBranch).order('entry_date', { ascending: false }).limit(50)
    setHistoryEntries((data as unknown as CashierLossEntry[]) || [])
    setLoadingHistory(false)
  }

  async function handleToggleCashierConfig(positionId: string, existingConfig: CashierLossConfig | null) {
    if (existingConfig) {
      const { error } = await supabase.from('cashier_loss_configs').update({ is_active: !existingConfig.is_active }).eq('id', existingConfig.id)
      if (error) showMsg('error', 'Gagal: ' + error.message)
      else fetchCashierConfigs()
    } else {
      const { error } = await supabase.from('cashier_loss_configs').insert({ branch_id: selectedBranch, position_id: positionId, is_active: true })
      if (error) showMsg('error', 'Gagal: ' + error.message)
      else fetchCashierConfigs()
    }
  }

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(entryForm.amount)
    if (isNaN(amt) || amt <= 0) { showMsg('error', 'Nominal harus lebih dari 0.'); return }
    setEntrySaving(true)
    const entryDateObj = new Date(entryForm.date)
    const { error } = await supabase.from('cashier_loss_entries').insert({
      branch_id: selectedBranch, entry_date: entryForm.date, amount: amt,
      period_month: entryDateObj.getMonth() + 1, period_year: entryDateObj.getFullYear(), notes: entryForm.notes || null,
      employee_id: entryForm.employee_id || null
    })
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Entry minus kas berhasil ditambahkan.'); setEntryForm({ date: today.toISOString().split('T')[0], amount: '', notes: '', employee_id: '' }); fetchEntries(); fetchHistoryEntries() }
    setEntrySaving(false)
  }

  async function handleEditEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!editEntry) return
    const amt = parseFloat(editForm.amount)
    if (isNaN(amt) || amt <= 0) { showMsg('error', 'Nominal tidak valid.'); return }
    const editDateObj = new Date(editForm.date)
    const { error } = await supabase.from('cashier_loss_entries').update({
      entry_date: editForm.date, amount: amt, notes: editForm.notes || null, employee_id: editForm.employee_id || null,
      period_month: editDateObj.getMonth() + 1, period_year: editDateObj.getFullYear(), updated_at: new Date().toISOString()
    }).eq('id', editEntry.id)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Entry berhasil diupdate.'); setEditEntry(null); fetchEntries(); fetchHistoryEntries() }
  }

  async function handleDeleteEntry(id: string) {
    if (!confirm('Hapus entry minus kas ini?')) return
    const { error } = await supabase.from('cashier_loss_entries').delete().eq('id', id)
    if (error) showMsg('error', 'Gagal: ' + error.message)
    else { showMsg('success', 'Entry berhasil dihapus.'); fetchEntries(); fetchHistoryEntries() }
  }

  // ── Preview & Apply (rumus sama persis dengan sebelumnya, cuma tanpa bagian kehilangan barang) ──
  async function handlePreview() {
    if (!selectedBranch) return
    setPreviewLoading(true)
    setPreview([])

    const { data: entriesData } = await supabase.from('cashier_loss_entries').select('*').eq('branch_id', selectedBranch).eq('period_month', filterMonth).eq('period_year', filterYear).order('entry_date')
    const { data: cashierConfigsData } = await supabase.from('cashier_loss_configs').select('*, positions(name)').eq('branch_id', selectedBranch).eq('is_active', true)
    const kasirPositionIds = (cashierConfigsData || []).map((c: any) => c.position_id)

    const { data: kasirEmps } = kasirPositionIds.length > 0
      ? await supabase.from('employees').select('id, full_name, employee_code, position_id, positions(name)').eq('branch_id', selectedBranch).eq('is_active', true).in('position_id', kasirPositionIds)
      : { data: [] }

    const allEntries: any[] = entriesData || []
    const assignedEntries = allEntries.filter((e: any) => e.employee_id)
    const unassignedEntries = allEntries.filter((e: any) => !e.employee_id)
    const totalKasirAssigned = assignedEntries.reduce((s: number, e: any) => s + Number(e.amount), 0)
    const totalKasirUnassigned = unassignedEntries.reduce((s: number, e: any) => s + Number(e.amount), 0)
    const totalKasirAll = totalKasirAssigned + totalKasirUnassigned

    const assignedByEmp: Record<string, number> = {}
    assignedEntries.forEach((e: any) => { assignedByEmp[e.employee_id] = (assignedByEmp[e.employee_id] ?? 0) + Number(e.amount) })

    const empIds = [...new Set([...(kasirEmps || []).map((e: any) => e.id), ...Object.keys(assignedByEmp)])]
    const results: any[] = []
    const kasirCount = (kasirEmps || []).length

    for (const empId of empIds) {
      const emp: any = (kasirEmps || []).find((e: any) => e.id === empId)
      if (!emp) continue

      const { data: empCheck } = await supabase.from('employees').select('id,is_active,branch_id').eq('id', empId).single()
      if (!empCheck?.is_active || empCheck.branch_id !== selectedBranch) continue

      const kasirAssignedLoss = assignedByEmp[empId] ?? 0
      const isKasir = kasirPositionIds.includes(emp.position_id)
      const kasirSplitLoss = isKasir && kasirCount > 0 ? totalKasirUnassigned / kasirCount : 0
      const kasirLoss = kasirAssignedLoss + kasirSplitLoss

      results.push({
        empId, name: emp.full_name, code: emp.employee_code, position: emp.positions?.name,
        kasirLoss: Math.round(kasirLoss), kasirAssignedLoss: Math.round(kasirAssignedLoss), kasirSplitLoss: Math.round(kasirSplitLoss),
        isKasir, kasirCount, totalKasirMonthly: totalKasirAll, totalKasirAssigned, totalKasirUnassigned, entries: allEntries,
      })
    }
    setPreview(results)
    setPreviewLoading(false)
  }

  async function handleApply() {
    if (preview.length === 0) return
    if (!confirm(`Apply potongan kerugian kasir ke ${preview.length} karyawan untuk payroll ${MONTHS[filterMonth-1]} ${filterYear}?`)) return
    setApplying(true)

    let appliedCount = 0
    let skippedCount = 0

    for (const p of preview) {
      // Ikut sertakan inventory_loss_deduction saat ini — supaya apply Kerugian Kasir di sini
      // tidak menimpa potongan Kehilangan Barang yang sudah diterapkan lebih dulu dari halaman
      // satunya (net_total dihitung ulang dari nol tiap kali salah satu di-apply).
      const { data: payroll } = await supabase.from('payrolls').select('id, status, gross_total, net_total, late_deduction, kasbon_deduction, loyalitas_deduction, absent_deduction, inventory_loss_deduction')
        .eq('employee_id', p.empId).eq('period_month', filterMonth).eq('period_year', filterYear).single()
      if (!payroll) continue
      if (payroll.status !== 'draft') { skippedCount++; continue }

      const newKasirLoss = p.kasirLoss
      const existingInvLoss = Number(payroll.inventory_loss_deduction ?? 0)
      const newNet = Number(payroll.gross_total) - Number(payroll.late_deduction) - Number(payroll.kasbon_deduction) - Number(payroll.loyalitas_deduction ?? 0) - Number(payroll.absent_deduction ?? 0) - existingInvLoss - newKasirLoss

      await supabase.from('payrolls').update({ cashier_loss_deduction: newKasirLoss, net_total: newNet }).eq('id', payroll.id)
      appliedCount++
    }

    if (skippedCount === 0) showMsg('success', `Potongan berhasil diapply ke ${appliedCount} karyawan.`)
    else showMsg('success', `Potongan diapply ke ${appliedCount} karyawan. ${skippedCount} dilewati karena slip gajinya sudah tidak berstatus draft (approved/paid) — perlu penyesuaian manual kalau perlu.`)
    setApplying(false)
  }

  const totalKasir = entries.reduce((s, e) => s + Number(e.amount), 0)
  const activeCashierPositionNames = cashierConfigs.filter(c => c.is_active).map(c => c.positions?.name).filter(Boolean)
  const yearOptions = [today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1]

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kerugian Kasir</h1>
        <p className="text-sm text-slate-500">Setup jabatan terdampak, catat minus kas per transaksi, dan terapkan ke slip gaji — semua dalam satu alur.</p>
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

      {/* 1. Setup jabatan kasir */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button onClick={() => setSetupOpen(!setupOpen)} className="w-full flex items-center justify-between px-5 py-4">
          <div className="text-left">
            <h3 className="font-semibold text-slate-800">1. Jabatan Terdampak Kerugian Kasir</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeCashierPositionNames.length > 0
                ? <>Aktif: <strong className="text-green-600">{activeCashierPositionNames.join(', ')}</strong></>
                : <span className="text-amber-600">⚠ belum ada jabatan yang ditandai</span>}
            </p>
          </div>
          <span className="text-slate-400 text-sm">{setupOpen ? '▲ Tutup' : '▼ Atur'}</span>
        </button>
        {setupOpen && (
          <div className="border-t border-slate-100 p-5">
            <p className="text-xs text-slate-500 mb-4">Kerugian minus kas yang tidak ditujukan ke karyawan tertentu akan dibagi rata ke semua karyawan aktif dengan jabatan yang dipilih di cabang ini.</p>
            <div className="space-y-2">
              {positions.map(pos => {
                const existing = cashierConfigs.find(c => c.position_id === pos.id)
                const isActive = existing?.is_active ?? false
                return (
                  <div key={pos.id} className={`flex items-center justify-between p-3 rounded-lg border transition ${isActive ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
                    <span className="text-sm font-medium text-slate-700">{pos.name}</span>
                    <button onClick={() => handleToggleCashierConfig(pos.id, existing || null)}
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

      {/* 2. Input minus kas periode ini */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h3 className="font-semibold text-slate-800">2. Catat Minus Kas</h3>
          {totalKasir > 0 && <span className="text-sm font-bold text-red-600">Total periode ini: {fmtRp(totalKasir)}</span>}
        </div>
        <div className="flex flex-wrap gap-3 mb-4 mt-3">
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {entries.length > 0 && (
          <div className="mb-4 space-y-2 max-h-56 overflow-y-auto">
            {entries.map(ent => (
              <div key={ent.id} className="flex items-center justify-between p-2.5 bg-red-50 rounded-lg border border-red-100 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-700">{new Date(ent.entry_date).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</span>
                    {ent.employees
                      ? <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">{ent.employees.full_name}</span>
                      : <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Bagi rata</span>}
                  </div>
                  {ent.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{ent.notes}</p>}
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="font-bold text-red-600">-{fmtRp(ent.amount)}</span>
                  <button onClick={() => { setEditEntry(ent); setEditForm({ date: ent.entry_date, amount: String(ent.amount), notes: ent.notes || '', employee_id: ent.employee_id || '' }) }}
                    className="px-2 py-0.5 text-xs border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition">Edit</button>
                  <button onClick={() => handleDeleteEntry(ent.id)} className="px-2 py-0.5 text-xs border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Hapus</button>
                </div>
              </div>
            ))}
          </div>
        )}

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
              <RupiahInput required value={entryForm.amount} onChange={v => setEntryForm({...entryForm, amount: v})}
                placeholder="50.000" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Tanggung Jawab Karyawan <span className="text-slate-400">(kosongkan = bagi rata ke kasir)</span></label>
            <select value={entryForm.employee_id} onChange={e => setEntryForm({...entryForm, employee_id: e.target.value})}
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 outline-none">
              <option value="">— Bagi rata ke semua kasir —</option>
              {branchEmployees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_code})</option>)}
            </select>
          </div>
          <input type="text" value={entryForm.notes} onChange={e => setEntryForm({...entryForm, notes: e.target.value})}
            placeholder="Catatan (opsional)" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          <button type="submit" disabled={entrySaving} className="w-full py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {entrySaving ? 'Menambahkan...' : '+ Tambah Entry'}
          </button>
        </form>
      </div>

      {/* 3. Riwayat semua periode */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">📜 Riwayat Minus Kas — Semua Periode</h3>
            <p className="text-xs text-slate-500 mt-0.5">{branches.find(b=>b.id===selectedBranch)?.name} · tidak dibatasi filter bulan di atas, supaya kelihatan kalau ada entry yang salah masuk periode.</p>
          </div>
          <button onClick={fetchHistoryEntries} className="text-xs text-blue-600 hover:underline shrink-0">🔄 Refresh</button>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Tanggal Input</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Periode Payroll</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase text-right">Nominal</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Catatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingHistory ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">Memuat...</td></tr>
              ) : historyEntries.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">Belum ada entry untuk cabang ini.</td></tr>
              ) : historyEntries.map(h => {
                const mismatch = h.period_month !== filterMonth || h.period_year !== filterYear
                return (
                  <tr key={h.id} className={mismatch ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-2.5 text-slate-600">{new Date(h.entry_date).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${mismatch ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{MONTHS[h.period_month - 1]} {h.period_year}</span>
                      {mismatch && <span className="ml-1 text-[10px] text-amber-600">⚠ beda dari filter di atas</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-red-600">-{fmtRp(h.amount)}</td>
                    <td className="px-4 py-2.5">
                      {h.employees
                        ? <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">{h.employees.full_name}</span>
                        : <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Bagi rata</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs max-w-[200px] truncate">{h.notes || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Preview & Terapkan */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-slate-800">4. Preview & Terapkan ke Slip Gaji</h3>
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
                    {['Karyawan','Jabatan','Potongan'].map(h => (
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
                      <td className="px-4 py-3 text-red-600 font-bold">{p.kasirLoss > 0 ? `-${fmtRp(p.kasirLoss)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview[0] && preview[0].totalKasirMonthly > 0 && (
              <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-700 mb-2">Detail Kalkulasi:</p>
                <p>💵 Total minus kas: <strong>{fmtRp(preview[0].totalKasirMonthly)}</strong></p>
                {preview[0].totalKasirAssigned > 0 && (
                  <p className="ml-2">↳ Assigned langsung: <strong className="text-orange-600">{fmtRp(preview[0].totalKasirAssigned)}</strong> (ke karyawan spesifik)</p>
                )}
                {preview[0].totalKasirUnassigned > 0 && (
                  <p className="ml-2">↳ Bagi rata: <strong>{fmtRp(preview[0].totalKasirUnassigned)}</strong> ÷ {preview[0].kasirCount} kasir = <strong>{fmtRp(preview[0].totalKasirUnassigned / Math.max(preview[0].kasirCount,1))}</strong>/orang</p>
                )}
                {preview[0].entries.length > 0 && (
                  <p className="text-slate-400">Rincian: {preview[0].entries.map((e: any) => `${new Date(e.entry_date).toLocaleDateString('id-ID',{day:'2-digit',month:'short'})} -${fmtRp(e.amount)}${e.employee_id ? ' [assigned]' : ''}`).join(' | ')}</p>
                )}
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

      {/* Modal Edit Entry */}
      {editEntry && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-slate-800 mb-4">Edit Entry Minus Kas</h3>
            <form onSubmit={handleEditEntry} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal</label>
                <input type="date" required value={editForm.date} onChange={e => setEditForm({...editForm, date: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nominal (Rp)</label>
                <RupiahInput required value={editForm.amount} onChange={v => setEditForm({...editForm, amount: v})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Assign ke Karyawan <span className="text-slate-400">(kosongkan = bagi rata)</span></label>
                <select value={editForm.employee_id} onChange={e => setEditForm({...editForm, employee_id: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">— Bagi rata ke semua kasir —</option>
                  {branchEmployees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_code})</option>)}
                </select>
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
