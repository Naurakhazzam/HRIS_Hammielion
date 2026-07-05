'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }
type Asset = {
  id: string
  branch_id: string
  name: string
  type: string
  acquisition_value: number
  acquisition_date: string | null
  status: string
  approval_status: string
  notes: string | null
  branches?: { name: string } | null
}
type Contract = {
  id: string
  asset_id: string
  contract_type: string
  start_date: string
  end_date: string | null
  rent_amount: number
  payment_cycle: string | null
  reminder_days_before_due: number
  status: string
  approval_status: string
  notes: string | null
  fin_assets?: { name: string; branch_id: string; branches?: { name: string } | null } | null
}

type Tab = 'aset' | 'kontrak'
const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function AsetKontrakPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('aset')
  const [branches, setBranches] = useState<Branch[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [assetForm, setAssetForm] = useState({
    branch_id: '', name: '', type: '', acquisition_value: '', acquisition_date: '', status: 'aktif', notes: '',
  })
  const [contractForm, setContractForm] = useState({
    asset_id: '', contract_type: '', start_date: new Date().toISOString().split('T')[0], end_date: '',
    rent_amount: '', payment_cycle: 'bulanan', reminder_days_before_due: '30', notes: '',
  })

  const isAdmin = ADMIN_ROLES.includes(role)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    let aq = supabase.from('fin_assets').select('*, branches(name)').order('created_at', { ascending: false })
    if (!isAdmin && myBranchId) aq = aq.eq('branch_id', myBranchId)
    const aRes = await aq
    if (aRes.error) console.error('Detail error aset:', JSON.stringify(aRes.error, null, 2))
    else setAssets((aRes.data as unknown as Asset[]) || [])

    const cq = supabase.from('fin_asset_contracts').select('*, fin_assets(name, branch_id, branches(name))').order('end_date', { ascending: true, nullsFirst: false })
    const cRes = await cq
    if (cRes.error) console.error('Detail error kontrak:', JSON.stringify(cRes.error, null, 2))
    else {
      let list = (cRes.data as unknown as Contract[]) || []
      if (!isAdmin && myBranchId) list = list.filter(c => c.fin_assets?.branch_id === myBranchId)
      setContracts(list)
    }
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
            setAssetForm(f => ({ ...f, branch_id: emp.branch_id }))
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

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleAddAsset(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId || !assetForm.branch_id || !assetForm.name.trim() || !assetForm.type.trim()) {
      showMessage('error', 'Cabang, nama, dan tipe aset wajib diisi.'); return
    }
    setSubmitting(true)
    const { error } = await supabase.from('fin_assets').insert({
      branch_id: assetForm.branch_id, name: assetForm.name.trim(), type: assetForm.type.trim(),
      acquisition_value: parseFloat(assetForm.acquisition_value) || 0,
      acquisition_date: assetForm.acquisition_date || null,
      status: assetForm.status, notes: assetForm.notes || null,
      input_by: myUserId, approval_status: 'pending',
    })
    if (error) {
      showMessage('error', 'Gagal menambah aset: ' + error.message)
    } else {
      showMessage('success', 'Aset berhasil dicatat, menunggu verifikasi.')
      setAssetForm(f => ({ ...f, name: '', type: '', acquisition_value: '', acquisition_date: '', notes: '' }))
      fetchAll()
    }
    setSubmitting(false)
  }

  async function handleAddContract(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId || !contractForm.asset_id || !contractForm.contract_type.trim()) {
      showMessage('error', 'Aset dan tipe kontrak wajib diisi.'); return
    }
    setSubmitting(true)
    const { error } = await supabase.from('fin_asset_contracts').insert({
      asset_id: contractForm.asset_id, contract_type: contractForm.contract_type.trim(),
      start_date: contractForm.start_date, end_date: contractForm.end_date || null,
      rent_amount: parseFloat(contractForm.rent_amount) || 0,
      payment_cycle: contractForm.payment_cycle || null,
      reminder_days_before_due: parseInt(contractForm.reminder_days_before_due) || 30,
      notes: contractForm.notes || null,
      input_by: myUserId, approval_status: 'pending',
    })
    if (error) {
      showMessage('error', 'Gagal menambah kontrak: ' + error.message)
    } else {
      showMessage('success', 'Kontrak berhasil dicatat, menunggu verifikasi.')
      setContractForm(f => ({ ...f, contract_type: '', end_date: '', rent_amount: '', notes: '' }))
      fetchAll()
    }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const approvalBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800' }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  // Reminder jatuh tempo: end_date - reminder_days_before_due <= hari ini
  function dueSoon(c: Contract): boolean {
    if (!c.end_date) return false
    const end = new Date(c.end_date)
    const reminderStart = new Date(end)
    reminderStart.setDate(reminderStart.getDate() - c.reminder_days_before_due)
    return new Date() >= reminderStart && c.status !== 'berakhir'
  }

  const dueSoonContracts = contracts.filter(dueSoon)

  if (roleLoading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Aset & Kontrak Sewa</h1>
        <p className="text-sm text-slate-500">Daftar aset tetap per cabang dan kontrak sewa/kontrak terkait, termasuk reminder jatuh tempo. Input hanya oleh owner/HR/finance, menunggu verifikasi.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {dueSoonContracts.length > 0 && (
        <div className="p-4 mb-6 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-sm">
          <strong>⚠ {dueSoonContracts.length} kontrak mendekati/lewat jatuh tempo:</strong>{' '}
          {dueSoonContracts.map(c => `${c.fin_assets?.name} (${c.end_date ? new Date(c.end_date).toLocaleDateString('id-ID') : '-'})`).join(', ')}
        </div>
      )}

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-6">
        {(['aset', 'kontrak'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'aset' ? `Daftar Aset (${assets.length})` : `Kontrak Sewa (${contracts.length})`}
          </button>
        ))}
      </div>

      {tab === 'aset' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {isAdmin && (
            <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
              <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Aset</h2>
              <form onSubmit={handleAddAsset} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
                  <select required value={assetForm.branch_id} onChange={e => setAssetForm({ ...assetForm, branch_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">-- Pilih Cabang --</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Aset <span className="text-red-500">*</span></label>
                  <input type="text" required value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })}
                    placeholder="Contoh: Motor Box Honda"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tipe <span className="text-red-500">*</span></label>
                  <input type="text" required value={assetForm.type} onChange={e => setAssetForm({ ...assetForm, type: e.target.value })}
                    placeholder="properti / kendaraan / peralatan"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nilai Perolehan (Rp)</label>
                  <input type="number" min="0" step="1" value={assetForm.acquisition_value} onChange={e => setAssetForm({ ...assetForm, acquisition_value: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Perolehan</label>
                  <input type="date" value={assetForm.acquisition_date} onChange={e => setAssetForm({ ...assetForm, acquisition_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kondisi</label>
                  <select value={assetForm.status} onChange={e => setAssetForm({ ...assetForm, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="aktif">Aktif</option>
                    <option value="nonaktif">Nonaktif</option>
                    <option value="dijual">Dijual</option>
                    <option value="rusak">Rusak</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan</label>
                  <textarea value={assetForm.notes} onChange={e => setAssetForm({ ...assetForm, notes: e.target.value })} rows={2} placeholder="Opsional"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button type="submit" disabled={submitting}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
                  {submitting ? 'Menyimpan...' : 'Tambah Aset'}
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
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tipe</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Nilai Perolehan</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kondisi</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Verifikasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat...</td></tr>
                    ) : assets.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada aset tercatat.</td></tr>
                    ) : assets.map(a => (
                      <tr key={a.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{a.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{a.branches?.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{a.type}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(a.acquisition_value)}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 capitalize">{a.status}</td>
                        <td className="px-4 py-3 text-center">{approvalBadge(a.approval_status)}</td>
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
              <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Kontrak</h2>
              <form onSubmit={handleAddContract} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Aset <span className="text-red-500">*</span></label>
                  <select required value={contractForm.asset_id} onChange={e => setContractForm({ ...contractForm, asset_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">-- Pilih Aset --</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.name} ({a.branches?.name})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tipe Kontrak <span className="text-red-500">*</span></label>
                  <input type="text" required value={contractForm.contract_type} onChange={e => setContractForm({ ...contractForm, contract_type: e.target.value })}
                    placeholder="Contoh: Sewa Gedung"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Mulai <span className="text-red-500">*</span></label>
                  <input type="date" required value={contractForm.start_date} onChange={e => setContractForm({ ...contractForm, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Berakhir</label>
                  <input type="date" value={contractForm.end_date} onChange={e => setContractForm({ ...contractForm, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nominal Sewa (Rp)</label>
                  <input type="number" min="0" step="1" value={contractForm.rent_amount} onChange={e => setContractForm({ ...contractForm, rent_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Siklus Bayar</label>
                  <select value={contractForm.payment_cycle} onChange={e => setContractForm({ ...contractForm, payment_cycle: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="bulanan">Bulanan</option>
                    <option value="tahunan">Tahunan</option>
                    <option value="sekali_bayar">Sekali Bayar</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reminder (hari sebelum jatuh tempo)</label>
                  <input type="number" min="1" step="1" value={contractForm.reminder_days_before_due} onChange={e => setContractForm({ ...contractForm, reminder_days_before_due: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan</label>
                  <textarea value={contractForm.notes} onChange={e => setContractForm({ ...contractForm, notes: e.target.value })} rows={2} placeholder="Opsional"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button type="submit" disabled={submitting}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
                  {submitting ? 'Menyimpan...' : 'Tambah Kontrak'}
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
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Aset</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tipe</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Berakhir</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Nominal</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Verifikasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat...</td></tr>
                    ) : contracts.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada kontrak tercatat.</td></tr>
                    ) : contracts.map(c => (
                      <tr key={c.id} className={`hover:bg-slate-50 transition ${dueSoon(c) ? 'bg-amber-50/60' : ''}`}>
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{c.fin_assets?.name} <span className="text-xs text-slate-400">({c.fin_assets?.branches?.name})</span></td>
                        <td className="px-4 py-3 text-sm text-slate-600">{c.contract_type}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {c.end_date ? new Date(c.end_date).toLocaleDateString('id-ID') : '—'}
                          {dueSoon(c) && <span className="ml-2 text-xs text-amber-700 font-medium">⚠ Jatuh tempo</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{formatRupiah(c.rent_amount)}</td>
                        <td className="px-4 py-3 text-center">{approvalBadge(c.approval_status)}</td>
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
