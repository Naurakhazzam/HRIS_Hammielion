'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Baseline = {
  id: string
  branch_id: string
  baseline_date: string
  cash_amount: number
  inventory_value: number
  asset_value: number
  notes: string | null
  status: string
  branches?: { name: string } | null
}
type Snapshot = {
  id: string
  branch_id: string
  snapshot_period: string
  inventory_value: number
  asset_value: number
  notes: string | null
  status: string
  branches?: { name: string } | null
}

type Tab = 'baseline' | 'snapshot'
const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function ModalCabangPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('baseline')
  const [branches, setBranches] = useState<Branch[]>([])
  const [baselines, setBaselines] = useState<Baseline[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [existingBaseline, setExistingBaseline] = useState<Baseline | null>(null)
  const [existingSnapshot, setExistingSnapshot] = useState<Snapshot | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const thisMonth = today.slice(0, 7)

  const [baselineForm, setBaselineForm] = useState({
    branch_id: '', baseline_date: today, cash_amount: '', inventory_value: '', asset_value: '', notes: '',
  })
  const [snapshotForm, setSnapshotForm] = useState({
    branch_id: '', snapshot_period: thisMonth, inventory_value: '', asset_value: '', notes: '',
  })

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    let bq = supabase.from('fin_branch_capital_baseline').select('*, branches(name)').order('created_at', { ascending: false })
    let sq = supabase.from('fin_branch_capital_snapshot').select('*, branches(name)').order('snapshot_period', { ascending: false })
    if (!isAdmin && myBranchId) {
      bq = bq.eq('branch_id', myBranchId)
      sq = sq.eq('branch_id', myBranchId)
    }
    const [bRes, sRes] = await Promise.all([bq, sq])
    if (bRes.error) console.error('Detail error baseline:', JSON.stringify(bRes.error, null, 2))
    else setBaselines((bRes.data as unknown as Baseline[]) || [])
    if (sRes.error) console.error('Detail error snapshot:', JSON.stringify(sRes.error, null, 2))
    else setSnapshots((sRes.data as unknown as Snapshot[]) || [])
    setLoading(false)
  }, [supabase, isAdmin, myBranchId])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setRoleLoading(false); return }
      setMyUserId(user.id)
      const { data: userRow } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (userRow) {
        setRole(userRow.role)
        if (userRow.employee_id) {
          const { data: emp } = await supabase.from('employees').select('branch_id').eq('id', userRow.employee_id).single()
          if (emp) {
            setMyBranchId(emp.branch_id)
            setBaselineForm(f => ({ ...f, branch_id: emp.branch_id }))
            setSnapshotForm(f => ({ ...f, branch_id: emp.branch_id }))
          }
        }
      }
      const { data: bRes } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      if (bRes) setBranches(bRes)
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Cek baseline existing untuk cabang terpilih (unique per cabang, one-time)
  const checkExistingBaseline = useCallback(async () => {
    if (!baselineForm.branch_id) { setExistingBaseline(null); return }
    const { data } = await supabase
      .from('fin_branch_capital_baseline')
      .select('*')
      .eq('branch_id', baselineForm.branch_id)
      .maybeSingle()
    setExistingBaseline((data as unknown as Baseline) || null)
    if (data) {
      setBaselineForm(f => ({
        ...f,
        baseline_date: data.baseline_date,
        cash_amount: String(data.cash_amount),
        inventory_value: String(data.inventory_value),
        asset_value: String(data.asset_value),
        notes: data.notes || '',
      }))
    }
  }, [supabase, baselineForm.branch_id])

  useEffect(() => { checkExistingBaseline() }, [baselineForm.branch_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cek snapshot existing untuk cabang + bulan terpilih
  const checkExistingSnapshot = useCallback(async () => {
    if (!snapshotForm.branch_id || !snapshotForm.snapshot_period) { setExistingSnapshot(null); return }
    const periodDate = snapshotForm.snapshot_period + '-01'
    const { data } = await supabase
      .from('fin_branch_capital_snapshot')
      .select('*')
      .eq('branch_id', snapshotForm.branch_id)
      .eq('snapshot_period', periodDate)
      .maybeSingle()
    setExistingSnapshot((data as unknown as Snapshot) || null)
    if (data) {
      setSnapshotForm(f => ({ ...f, inventory_value: String(data.inventory_value), asset_value: String(data.asset_value), notes: data.notes || '' }))
    }
  }, [supabase, snapshotForm.branch_id, snapshotForm.snapshot_period])

  useEffect(() => { checkExistingSnapshot() }, [snapshotForm.branch_id, snapshotForm.snapshot_period]) // eslint-disable-line react-hooks/exhaustive-deps

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmitBaseline(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId || !baselineForm.branch_id) { showMessage('error', 'Cabang wajib dipilih.'); return }
    const cash = parseFloat(baselineForm.cash_amount) || 0
    const inv = parseFloat(baselineForm.inventory_value) || 0
    const ast = parseFloat(baselineForm.asset_value) || 0

    if (existingBaseline && existingBaseline.status !== 'pending') {
      showMessage('error', `Modal awal cabang ini sudah "${existingBaseline.status === 'approved' ? 'disetujui' : 'ditolak'}", tidak bisa diubah dari sini. Hubungi finance pusat untuk revisi.`)
      return
    }

    setSubmitting(true)
    if (existingBaseline) {
      const { error } = await supabase.from('fin_branch_capital_baseline')
        .update({ baseline_date: baselineForm.baseline_date, cash_amount: cash, inventory_value: inv, asset_value: ast, notes: baselineForm.notes || null })
        .eq('id', existingBaseline.id)
      if (error) showMessage('error', 'Gagal memperbarui: ' + error.message)
      else { showMessage('success', 'Modal awal berhasil diperbarui.'); fetchAll(); checkExistingBaseline() }
    } else {
      const { error } = await supabase.from('fin_branch_capital_baseline').insert({
        branch_id: baselineForm.branch_id, baseline_date: baselineForm.baseline_date,
        cash_amount: cash, inventory_value: inv, asset_value: ast, notes: baselineForm.notes || null,
        input_by: myUserId, status: 'pending',
      })
      if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
      else { showMessage('success', 'Modal awal berhasil dicatat, menunggu verifikasi.'); fetchAll(); checkExistingBaseline() }
    }
    setSubmitting(false)
  }

  async function handleSubmitSnapshot(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId || !snapshotForm.branch_id) { showMessage('error', 'Cabang wajib dipilih.'); return }
    const inv = parseFloat(snapshotForm.inventory_value) || 0
    const ast = parseFloat(snapshotForm.asset_value) || 0
    const periodDate = snapshotForm.snapshot_period + '-01'

    if (existingSnapshot && existingSnapshot.status !== 'pending') {
      showMessage('error', `Snapshot bulan ini sudah "${existingSnapshot.status === 'approved' ? 'disetujui' : 'ditolak'}", tidak bisa diubah dari sini.`)
      return
    }

    setSubmitting(true)
    if (existingSnapshot) {
      const { error } = await supabase.from('fin_branch_capital_snapshot')
        .update({ inventory_value: inv, asset_value: ast, notes: snapshotForm.notes || null })
        .eq('id', existingSnapshot.id)
      if (error) showMessage('error', 'Gagal memperbarui: ' + error.message)
      else { showMessage('success', 'Snapshot berhasil diperbarui.'); fetchAll(); checkExistingSnapshot() }
    } else {
      const { error } = await supabase.from('fin_branch_capital_snapshot').insert({
        branch_id: snapshotForm.branch_id, snapshot_period: periodDate,
        inventory_value: inv, asset_value: ast, notes: snapshotForm.notes || null,
        input_by: myUserId, status: 'pending',
      })
      if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
      else { showMessage('success', 'Snapshot berhasil dicatat, menunggu verifikasi.'); fetchAll(); checkExistingSnapshot() }
    }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800' }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Modal Cabang</h1>
        <p className="text-sm text-slate-500">Modal awal (one-time) dan snapshot modal bulanan (cash, nilai barang, nilai aset) per cabang. Input hanya oleh owner/HR/finance, menunggu verifikasi sebelum masuk laporan.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-6">
        {(['baseline', 'snapshot'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'baseline' ? 'Modal Awal (One-Time)' : 'Snapshot Bulanan'}
          </button>
        ))}
      </div>

      {tab === 'baseline' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {isAdmin && (
            <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
              <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Input Modal Awal</h2>
              {existingBaseline && (
                <div className={`mb-4 p-3 rounded-lg text-xs border ${existingBaseline.status === 'pending' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                  {existingBaseline.status === 'pending'
                    ? 'Cabang ini sudah punya baseline (menunggu). Menyimpan lagi akan memperbarui.'
                    : `Baseline cabang ini sudah "${existingBaseline.status === 'approved' ? 'disetujui' : 'ditolak'}" — tidak bisa diubah dari sini.`}
                </div>
              )}
              <form onSubmit={handleSubmitBaseline} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
                  <select required value={baselineForm.branch_id} onChange={e => setBaselineForm({ ...baselineForm, branch_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">-- Pilih Cabang --</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Baseline <span className="text-red-500">*</span></label>
                  <input type="date" required value={baselineForm.baseline_date} onChange={e => setBaselineForm({ ...baselineForm, baseline_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Modal Cash (Rp)</label>
                  <input type="number" min="0" step="1" value={baselineForm.cash_amount} onChange={e => setBaselineForm({ ...baselineForm, cash_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nilai Barang/Inventory (Rp)</label>
                  <input type="number" min="0" step="1" value={baselineForm.inventory_value} onChange={e => setBaselineForm({ ...baselineForm, inventory_value: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nilai Aset Tetap (Rp)</label>
                  <input type="number" min="0" step="1" value={baselineForm.asset_value} onChange={e => setBaselineForm({ ...baselineForm, asset_value: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan</label>
                  <textarea value={baselineForm.notes} onChange={e => setBaselineForm({ ...baselineForm, notes: e.target.value })} rows={2} placeholder="Opsional"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button type="submit" disabled={submitting || (!!existingBaseline && existingBaseline.status !== 'pending')}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
                  {submitting ? 'Menyimpan...' : existingBaseline ? 'Perbarui Baseline' : 'Simpan (Menunggu Verifikasi)'}
                </button>
              </form>
            </div>
          )}

          <div className={isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Cash</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Barang</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Aset</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat...</td></tr>
                    ) : baselines.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data.</td></tr>
                    ) : baselines.map(b => (
                      <tr key={b.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm text-slate-700">{b.branches?.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{new Date(b.baseline_date).toLocaleDateString('id-ID')}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(b.cash_amount)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(b.inventory_value)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(b.asset_value)}</td>
                        <td className="px-4 py-3 text-center">{statusBadge(b.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {isAdmin && (
            <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
              <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Input Snapshot Bulanan</h2>
              {existingSnapshot && (
                <div className={`mb-4 p-3 rounded-lg text-xs border ${existingSnapshot.status === 'pending' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                  {existingSnapshot.status === 'pending'
                    ? 'Sudah ada snapshot bulan ini (menunggu). Menyimpan lagi akan memperbarui.'
                    : `Snapshot bulan ini sudah "${existingSnapshot.status === 'approved' ? 'disetujui' : 'ditolak'}" — tidak bisa diubah dari sini.`}
                </div>
              )}
              <form onSubmit={handleSubmitSnapshot} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
                  <select required value={snapshotForm.branch_id} onChange={e => setSnapshotForm({ ...snapshotForm, branch_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">-- Pilih Cabang --</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bulan <span className="text-red-500">*</span></label>
                  <input type="month" required value={snapshotForm.snapshot_period} onChange={e => setSnapshotForm({ ...snapshotForm, snapshot_period: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nilai Barang/Inventory (Rp)</label>
                  <input type="number" min="0" step="1" value={snapshotForm.inventory_value} onChange={e => setSnapshotForm({ ...snapshotForm, inventory_value: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nilai Aset Tetap (Rp)</label>
                  <input type="number" min="0" step="1" value={snapshotForm.asset_value} onChange={e => setSnapshotForm({ ...snapshotForm, asset_value: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan</label>
                  <textarea value={snapshotForm.notes} onChange={e => setSnapshotForm({ ...snapshotForm, notes: e.target.value })} rows={2} placeholder="Opsional"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button type="submit" disabled={submitting || (!!existingSnapshot && existingSnapshot.status !== 'pending')}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
                  {submitting ? 'Menyimpan...' : existingSnapshot ? 'Perbarui Snapshot' : 'Simpan (Menunggu Verifikasi)'}
                </button>
              </form>
            </div>
          )}

          <div className={isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Bulan</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Barang</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Aset</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat...</td></tr>
                    ) : snapshots.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada data.</td></tr>
                    ) : snapshots.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm text-slate-700">{s.branches?.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{new Date(s.snapshot_period).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(s.inventory_value)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(s.asset_value)}</td>
                        <td className="px-4 py-3 text-center">{statusBadge(s.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
