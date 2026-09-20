'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type FreelanceWorker = { id: string; full_name: string }
type GudangEmployee = { id: string; full_name: string }
type Branch = { id: string; name: string }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_type: string }

type Participant = {
  freelance_worker_id: string | null
  employee_id: string | null
  share_amount: number
  freelance_workers: { full_name: string } | null
  employees: { full_name: string } | null
}

type LoadingEntry = {
  id: string
  entry_date: string
  total_kg: number
  rate_per_kg: number
  total_earning: number
  payment_status: string
  description: string | null
  branch_id: string | null
  loading_entry_participants: Participant[]
}

export default function RekapBoronganPage() {
  const [entries, setEntries] = useState<LoadingEntry[]>([])
  const [workers, setWorkers] = useState<FreelanceWorker[]>([])
  const [gudangEmployees, setGudangEmployees] = useState<GudangEmployee[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const [weekOptions, setWeekOptions] = useState<{value: string, label: string}[]>([])
  const [filterWeek, setFilterWeek] = useState('') // value: "YYYY-MM-DD|YYYY-MM-DD"
  const [filterStatus, setFilterStatus] = useState('')
  
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

  // Tandai Lunas & Catat Kas Keluar — sebelumnya "Lunasi Tagihan" cuma ubah status,
  // tidak pernah mencatat Kas Keluar sama sekali (padahal kategori borongan_wage
  // diblokir dari input manual). Sekarang wajib pilih rekening & tanggal, lalu
  // insert fin_cash_out per cabang (satu batch bisa mencakup entri lintas cabang).
  const [payBoronganOpen, setPayBoronganOpen] = useState(false)
  const [payBoronganDate, setPayBoronganDate] = useState('')
  const [payBoronganAccountId, setPayBoronganAccountId] = useState('')
  const [payBoronganSubmitting, setPayBoronganSubmitting] = useState(false)

  const supabase = createClient()

  const [formData, setFormData] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    total_kg: '',
    description: '',
    branch_id: ''
  })
  // Kunci partisipan yang dicentang, format "fw:<id>" atau "emp:<id>"
  const [selectedWorkerKeys, setSelectedWorkerKeys] = useState<string[]>([])

  const toggleWorkerKey = (key: string) => {
    setSelectedWorkerKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  // Edit modal state
  const [editEntry, setEditEntry] = useState<LoadingEntry | null>(null)
  const [editForm, setEditForm] = useState({ entry_date: '', total_kg: '', rate_per_kg: '', description: '', branch_id: '' })
  const [editSelectedWorkerKeys, setEditSelectedWorkerKeys] = useState<string[]>([])
  const [editSubmitting, setEditSubmitting] = useState(false)

  const toggleEditWorkerKey = (key: string) => {
    setEditSelectedWorkerKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  useEffect(() => {
    // Generate Weeks (Jumat - Kamis)
    const weeks = []
    const today = new Date()
    const currentDay = today.getDay()
    const diffToFriday = -((currentDay - 5 + 7) % 7)

    let currentFriday = new Date(today)
    currentFriday.setDate(today.getDate() + diffToFriday)

    for (let i = 0; i < 9; i++) {
      const friday = new Date(currentFriday)
      friday.setDate(currentFriday.getDate() - (i * 7))

      const thursday = new Date(friday)
      thursday.setDate(friday.getDate() + 6)

      const startStr = friday.toISOString().split('T')[0]
      const endStr = thursday.toISOString().split('T')[0]

      const startUI = friday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
      const endUI = thursday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

      weeks.push({
        value: `${startStr}|${endStr}`,
        label: i === 0 ? `Periode Ini (${startUI} - ${endUI})` : `${startUI} - ${endUI}`
      })
    }
    setWeekOptions(weeks)
    setFilterWeek(weeks[0].value) // Default to current week

    fetchMyUser().then(() => {
      fetchWorkers()
      fetchGudangEmployees()
    })
    fetchBranches()
    fetchBankAccounts()
  }, [])

  // Refetch entries when filter changes, but only if week is set
  useEffect(() => {
    if (filterWeek) {
      fetchEntries()
    }
  }, [filterWeek, filterStatus])

  async function fetchMyUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setMyUserId(user.id)
      const { data } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      if (data) {
        setMyEmployeeId(data.employee_id)
      }
    }
  }

  async function fetchBranches() {
    const { data } = await supabase.from('branches').select('id, name').order('name')
    if (data) setBranches(data)
  }

  async function fetchBankAccounts() {
    const { data } = await supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_type').eq('is_active', true).order('account_type').order('bank_name')
    if (data) setBankAccounts(data)
  }

  async function fetchWorkers() {
    const { data } = await supabase.from('freelance_workers').select('id, full_name').eq('is_active', true).order('full_name')
    if (data) setWorkers(data)
  }

  async function fetchGudangEmployees() {
    const { data: allPerm } = await supabase
      .from('employees')
      .select('id, full_name, departments(name)')
      .eq('is_active', true)
      .order('full_name')

    const gudangWorkers = (allPerm || []).filter((p: any) => {
      const dept = Array.isArray(p.departments) ? p.departments[0] : p.departments
      return dept?.name === 'Team Gudang'
    })
    setGudangEmployees(gudangWorkers.map((p: any) => ({ id: p.id, full_name: p.full_name })))
  }

  async function fetchEntries() {
    setLoading(true)
    let query = supabase
      .from('loading_entries')
      .select('id, entry_date, total_kg, rate_per_kg, total_earning, payment_status, description, branch_id, loading_entry_participants(freelance_worker_id, employee_id, share_amount, freelance_workers(full_name), employees(full_name))')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (filterStatus) {
      query = query.eq('payment_status', filterStatus)
    }

    if (filterWeek) {
      const [startOfWeek, endOfWeek] = filterWeek.split('|')
      query = query.gte('entry_date', startOfWeek).lte('entry_date', endOfWeek)
    }

    const { data, error } = await query

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
    } else {
      setEntries((data as unknown as LoadingEntry[]) || [])
    }
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  // Get active rate for a date
  async function getActiveRate(dateStr: string) {
    const { data, error } = await supabase
      .from('loading_rate_config')
      .select('rate_per_kg')
      .lte('effective_date', dateStr)
      .order('effective_date', { ascending: false })
      .limit(1)
      .single()
      
    if (error || !data) {
      // Return fallback
      return 20 
    }
    return data.rate_per_kg
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myEmployeeId) {
      showMessage('error', 'Sesi tidak valid.')
      return
    }

    if (selectedWorkerKeys.length === 0) {
      showMessage('error', 'Pilih minimal satu pekerja yang ikut serta.')
      return
    }

    if (!formData.branch_id) {
      showMessage('error', 'Pilih cabang dulu.')
      return
    }

    setSubmitting(true)
    setMessage(null)

    const kgNum = parseFloat(formData.total_kg)
    if (isNaN(kgNum) || kgNum <= 0) {
      showMessage('error', 'Total Kg tidak valid.')
      setSubmitting(false)
      return
    }

    // Cari tarif aktif
    const activeRate = await getActiveRate(formData.entry_date)
    const totalEarning = kgNum * activeRate

    const { data: entryData, error } = await supabase
      .from('loading_entries')
      .insert({
        entry_date: formData.entry_date,
        total_kg: kgNum,
        rate_per_kg: activeRate,
        total_earning: totalEarning,
        payment_status: 'unpaid',
        created_by: myEmployeeId,
        description: formData.description.trim(),
        branch_id: formData.branch_id
      })
      .select('id')
      .single()

    if (error || !entryData) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal mencatat bongkar muat: ' + error?.message)
      setSubmitting(false)
      return
    }

    // Bagi rata total upah ke seluruh peserta, dibulatkan ke rupiah penuh (sisa pembulatan ke orang terakhir)
    const n = selectedWorkerKeys.length
    const totalRounded = Math.round(totalEarning)
    const baseShare = Math.floor(totalRounded / n)
    const remainder = totalRounded - baseShare * n

    const participantRows = selectedWorkerKeys.map((key, idx) => {
      const [workerType, workerId] = key.split(':')
      return {
        entry_id: entryData.id,
        freelance_worker_id: workerType === 'fw' ? workerId : null,
        employee_id: workerType === 'emp' ? workerId : null,
        share_amount: baseShare + (idx === n - 1 ? remainder : 0)
      }
    })

    const { error: partError } = await supabase.from('loading_entry_participants').insert(participantRows)

    if (partError) {
      console.error('Detail error:', JSON.stringify(partError, null, 2))
      showMessage('error', 'Entri tersimpan tapi gagal menyimpan daftar peserta: ' + partError.message)
    } else {
      showMessage('success', 'Catatan bongkar muat berhasil disimpan.')
      setFormData({ ...formData, total_kg: '', description: '' }) // Reset kg & keterangan
      setSelectedWorkerKeys([])
      fetchEntries()
    }
    setSubmitting(false)
  }

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const unpaidIds = entries.filter(ent => ent.payment_status === 'unpaid').map(ent => ent.id)
      setSelectedIds(unpaidIds)
    } else {
      setSelectedIds([])
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function openPayBoronganModal() {
    if (selectedIds.length === 0) return
    setPayBoronganDate(new Date().toISOString().slice(0, 10))
    setPayBoronganAccountId('')
    setPayBoronganOpen(true)
  }

  // Tandai Lunas & Catat Kas Keluar — satu-satunya jalur resmi, supaya upah bongkar muat
  // benar-benar tercatat sebagai kas keluar (sebelumnya cuma ubah status, tidak pernah
  // insert fin_cash_out sama sekali). Dikelompokkan per cabang karena satu batch pilihan
  // bisa mencakup entri dari cabang yang berbeda.
  async function confirmPayBorongan() {
    if (selectedIds.length === 0 || !myEmployeeId) return
    if (!payBoronganAccountId) { showMessage('error', 'Pilih rekening/kas sumber dulu.'); return }
    if (!payBoronganDate) { showMessage('error', 'Tanggal wajib diisi.'); return }

    const selectedEntries = entries.filter(ent => selectedIds.includes(ent.id))
    const missingBranch = selectedEntries.find(ent => !ent.branch_id)
    if (missingBranch) {
      showMessage('error', `Entri tanggal ${new Date(missingBranch.entry_date).toLocaleDateString('id-ID')} belum ada cabangnya. Edit entri itu dulu untuk memilih cabang.`)
      return
    }

    setPayBoronganSubmitting(true)

    const totalByBranch: Record<string, number> = {}
    selectedEntries.forEach(ent => {
      const b = ent.branch_id as string
      totalByBranch[b] = (totalByBranch[b] || 0) + Number(ent.total_earning)
    })

    for (const [branchId, amount] of Object.entries(totalByBranch)) {
      const { error: coErr } = await supabase.from('fin_cash_out').insert({
        branch_id: branchId,
        category: 'borongan_wage',
        amount,
        description: `Upah Bongkar Muat (${selectedEntries.filter(e => e.branch_id === branchId).length} entri)`,
        transaction_date: payBoronganDate,
        account_id: payBoronganAccountId,
        input_by: myUserId,
        verified_by: myUserId,
        status: 'approved',
      })
      if (coErr) {
        showMessage('error', `Gagal mencatat Kas Keluar (cabang sebagian sudah tercatat): ${coErr.message}`)
        setPayBoronganSubmitting(false)
        return
      }
    }

    const { error } = await supabase
      .from('loading_entries')
      .update({
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        paid_by: myEmployeeId
      })
      .in('id', selectedIds)

    if (error) {
      showMessage('error', 'Kas Keluar sudah tercatat, tapi gagal menandai entri lunas: ' + error.message)
    } else {
      showMessage('success', `${selectedIds.length} tagihan berhasil dilunasi dan tercatat di Kas Keluar.`)
      setSelectedIds([])
      setPayBoronganOpen(false)
      fetchEntries()
    }
    setPayBoronganSubmitting(false)
  }

  function openEditModal(ent: LoadingEntry) {
    setEditEntry(ent)
    setEditForm({
      entry_date: ent.entry_date,
      total_kg: String(ent.total_kg),
      rate_per_kg: String(ent.rate_per_kg),
      description: ent.description || '',
      branch_id: ent.branch_id || ''
    })
    setEditSelectedWorkerKeys(
      ent.loading_entry_participants.map(p =>
        p.freelance_worker_id ? `fw:${p.freelance_worker_id}` : `emp:${p.employee_id}`
      )
    )
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editEntry) return

    if (editSelectedWorkerKeys.length === 0) {
      showMessage('error', 'Pilih minimal satu pekerja yang ikut serta.')
      return
    }

    if (!editForm.branch_id) {
      showMessage('error', 'Pilih cabang dulu.')
      return
    }

    const kgNum = parseFloat(editForm.total_kg)
    const rateNum = parseFloat(editForm.rate_per_kg)
    if (isNaN(kgNum) || kgNum <= 0 || isNaN(rateNum) || rateNum <= 0) {
      showMessage('error', 'Muatan (Kg) dan Tarif harus berupa angka valid.')
      return
    }

    setEditSubmitting(true)
    const totalEarning = kgNum * rateNum

    const { error: updateError } = await supabase
      .from('loading_entries')
      .update({
        entry_date: editForm.entry_date,
        total_kg: kgNum,
        rate_per_kg: rateNum,
        total_earning: totalEarning,
        description: editForm.description.trim(),
        branch_id: editForm.branch_id
      })
      .eq('id', editEntry.id)

    if (updateError) {
      console.error('Detail error:', JSON.stringify(updateError, null, 2))
      showMessage('error', 'Gagal mengupdate entri: ' + updateError.message)
      setEditSubmitting(false)
      return
    }

    // Ganti seluruh daftar peserta & bagi rata ulang
    const { error: delError } = await supabase.from('loading_entry_participants').delete().eq('entry_id', editEntry.id)
    if (delError) {
      console.error('Detail error:', JSON.stringify(delError, null, 2))
      showMessage('error', 'Gagal memperbarui daftar peserta: ' + delError.message)
      setEditSubmitting(false)
      return
    }

    const n = editSelectedWorkerKeys.length
    const totalRounded = Math.round(totalEarning)
    const baseShare = Math.floor(totalRounded / n)
    const remainder = totalRounded - baseShare * n

    const participantRows = editSelectedWorkerKeys.map((key, idx) => {
      const [workerType, workerId] = key.split(':')
      return {
        entry_id: editEntry.id,
        freelance_worker_id: workerType === 'fw' ? workerId : null,
        employee_id: workerType === 'emp' ? workerId : null,
        share_amount: baseShare + (idx === n - 1 ? remainder : 0)
      }
    })

    const { error: insError } = await supabase.from('loading_entry_participants').insert(participantRows)

    if (insError) {
      console.error('Detail error:', JSON.stringify(insError, null, 2))
      showMessage('error', 'Gagal menyimpan daftar peserta baru: ' + insError.message)
    } else {
      showMessage('success', 'Entri berhasil diperbarui.')
      setEditEntry(null)
      fetchEntries()
    }
    setEditSubmitting(false)
  }

  async function handleDeleteEntry(ent: LoadingEntry) {
    if (!confirm(`Hapus entri bongkar muat tanggal ${new Date(ent.entry_date).toLocaleDateString('id-ID')} (${formatRupiah(ent.total_earning)})? Tindakan ini tidak bisa dibatalkan.`)) return

    const { error } = await supabase.from('loading_entries').delete().eq('id', ent.id)

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal menghapus entri: ' + error.message)
    } else {
      showMessage('success', 'Entri bongkar muat berhasil dihapus.')
      setSelectedIds(prev => prev.filter(id => id !== ent.id))
      fetchEntries()
    }
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)
  }

  // Summary Calculations
  const summaryTotalKg = entries.reduce((acc, ent) => acc + Number(ent.total_kg), 0)
  const summaryTotalEarning = entries.reduce((acc, ent) => acc + Number(ent.total_earning), 0)
  const summaryPaid = entries.filter(e => e.payment_status === 'paid').length
  const summaryUnpaid = entries.length - summaryPaid

  return (
    <>
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Gajian Bongkar Muat</h1>
          <p className="text-sm text-slate-500">Catat pekerjaan harian dan proses pembayaran pekerja lepas &amp; Team Gudang.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/penggajian/borongan/pekerja" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            👥 Pekerja
          </Link>
          <Link href="/penggajian/borongan/tarif" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            ⚙️ Tarif
          </Link>
        </div>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Form Input Harian */}
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit print-hide">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Catat Bongkar Muat</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Pekerja yang Ikut Serta <span className="text-red-500">*</span>
                {selectedWorkerKeys.length > 0 && <span className="text-slate-400 font-normal"> ({selectedWorkerKeys.length} dipilih)</span>}
              </label>
              <div className="border border-slate-300 rounded max-h-48 overflow-y-auto p-2 space-y-2">
                {workers.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Pekerja Lepas</p>
                    {workers.map(w => {
                      const key = `fw:${w.id}`
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedWorkerKeys.includes(key)}
                            onChange={() => toggleWorkerKey(key)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          {w.full_name}
                        </label>
                      )
                    })}
                  </div>
                )}
                {gudangEmployees.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1 mt-1">Team Gudang</p>
                    {gudangEmployees.map(w => {
                      const key = `emp:${w.id}`
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedWorkerKeys.includes(key)}
                            onChange={() => toggleWorkerKey(key)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          {w.full_name}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Total upah akan dibagi rata ke semua yang dicentang.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
              <select
                required
                value={formData.branch_id}
                onChange={(e) => setFormData({...formData, branch_id: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">-- Pilih Cabang --</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Kerja <span className="text-red-500">*</span></label>
              <input
                type="date"
                required
                value={formData.entry_date}
                onChange={(e) => setFormData({...formData, entry_date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Total Muatan (Kg) <span className="text-red-500">*</span></label>
              <input
                type="number"
                required
                min="0.1"
                step="0.1"
                value={formData.total_kg}
                onChange={(e) => setFormData({...formData, total_kg: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan <span className="text-red-500">*</span></label>
              <input
                type="text"
                required
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="Contoh: Bongkar pupuk NPK dari Cirebon"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={submitting || !myEmployeeId || selectedWorkerKeys.length === 0}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Entri'}
              </button>
            </div>
          </form>
        </div>

        {/* Tabel Rekap */}
        <div id="rekap-print-area-borongan" className="lg:col-span-3 space-y-4">
          
          <div className="hidden" id="borongan-print-header">
            <div className="text-center mb-4 pb-4 border-b-2 border-slate-800">
              <h1 className="text-xl font-bold text-slate-900 uppercase tracking-wider">HAMMIELION MANAGEMENT</h1>
              <p className="text-sm text-slate-600 mt-1">Rekap Gajian Bongkar Muat</p>
              <p className="text-sm text-slate-600">
                Periode: {weekOptions.find(w => w.value === filterWeek)?.label ?? filterWeek}
              </p>
              <p className="text-xs text-slate-400 mt-1">Dicetak: {new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
          
          {/* Summary Widget */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Entri</p>
              <p className="text-xl font-bold text-slate-800">{entries.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Muatan</p>
              <p className="text-xl font-bold text-blue-600">{summaryTotalKg.toLocaleString('id-ID')} Kg</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Upah</p>
              <p className="text-xl font-bold text-slate-800">{formatRupiah(summaryTotalEarning)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Status Lunas</p>
              <p className="text-sm font-bold text-green-600">{summaryPaid} Lunas</p>
              <p className="text-sm font-bold text-red-500">{summaryUnpaid} Belum</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Filters & Bulk Actions */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print-hide">
              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Pilih Minggu</label>
                  <select 
                    value={filterWeek} 
                    onChange={(e) => setFilterWeek(e.target.value)}
                    className="w-full sm:w-64 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white font-medium" 
                  >
                    {weekOptions.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Status Pembayaran</label>
                  <select 
                    value={filterStatus} 
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full sm:w-40 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white font-medium"
                  >
                    <option value="">Semua Status</option>
                    <option value="unpaid">Belum Dibayar</option>
                    <option value="paid">Lunas</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {selectedIds.length > 0 && (
                  <button
                    onClick={openPayBoronganModal}
                    disabled={submitting}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition whitespace-nowrap"
                  >
                    Lunasi Tagihan Minggu Ini ({selectedIds.length})
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition"
                >
                  🖨️ Cetak Rekap
                </button>
              </div>
            </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="px-4 py-3 w-10 text-center print-hide">
                    <input 
                      type="checkbox" 
                      onChange={handleSelectAll}
                      checked={selectedIds.length > 0 && selectedIds.length === entries.filter(e => e.payment_status === 'unpaid').length}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Pekerja</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Keterangan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Muatan (Kg)</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Tarif</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Upah</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center print-hide">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada catatan bongkar muat.</td>
                  </tr>
                ) : (
                  entries.map((ent) => (
                    <tr key={ent.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-center print-hide">
                        {ent.payment_status === 'unpaid' && (
                          <input 
                            type="checkbox" 
                            checked={selectedIds.includes(ent.id)}
                            onChange={() => toggleSelect(ent.id)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <details className="group">
                          <summary className="cursor-pointer list-none flex items-center gap-1.5 text-sm font-medium text-slate-800 select-none">
                            <span className="text-slate-400 text-[10px] transition-transform group-open:rotate-90">▶</span>
                            {ent.loading_entry_participants.length} Pekerja
                          </summary>
                          <div className="mt-1.5 ml-1 pl-3 space-y-1 border-l-2 border-slate-100">
                            {ent.loading_entry_participants.map((p, i) => (
                              <div key={i} className="text-xs text-slate-600 flex items-center gap-1.5">
                                <span className="font-medium text-slate-700">{p.freelance_workers?.full_name ?? p.employees?.full_name}</span>
                                {p.employees?.full_name && (
                                  <span className="text-[9px] text-blue-600 font-semibold uppercase bg-blue-50 px-1 rounded">Gudang</span>
                                )}
                                <span className="text-slate-400">({formatRupiah(p.share_amount)})</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-600 max-w-[220px]">{ent.description || '-'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-600 capitalize">
                          {new Date(ent.entry_date).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-slate-700">{ent.total_kg} Kg</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">
                        {formatRupiah(ent.rate_per_kg)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-slate-800">{formatRupiah(ent.total_earning)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${ent.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                          {ent.payment_status === 'paid' ? 'Lunas' : 'Belum Lunas'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center print-hide">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditModal(ent)}
                            className="text-xs px-2.5 py-1 rounded border font-medium transition text-blue-600 border-blue-200 hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteEntry(ent)}
                            className="text-xs px-2.5 py-1 rounded border font-medium transition text-red-600 border-red-200 hover:bg-red-50"
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>
    </div>

    {/* Modal Edit Entri */}
    {editEntry && (
      <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Entri Bongkar Muat</h2>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Pekerja yang Ikut Serta <span className="text-red-500">*</span>
                  {editSelectedWorkerKeys.length > 0 && <span className="text-slate-400 font-normal"> ({editSelectedWorkerKeys.length} dipilih)</span>}
                </label>
                <div className="border border-slate-300 rounded-lg max-h-40 overflow-y-auto p-2 space-y-2">
                  {workers.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Pekerja Lepas</p>
                      {workers.map(w => {
                        const key = `fw:${w.id}`
                        return (
                          <label key={key} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editSelectedWorkerKeys.includes(key)}
                              onChange={() => toggleEditWorkerKey(key)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            {w.full_name}
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {gudangEmployees.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1 mt-1">Team Gudang</p>
                      {gudangEmployees.map(w => {
                        const key = `emp:${w.id}`
                        return (
                          <label key={key} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editSelectedWorkerKeys.includes(key)}
                              onChange={() => toggleEditWorkerKey(key)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            {w.full_name}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
                <select
                  required
                  value={editForm.branch_id}
                  onChange={(e) => setEditForm({ ...editForm, branch_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">-- Pilih Cabang --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Kerja <span className="text-red-500">*</span></label>
                <input
                  type="date" required
                  value={editForm.entry_date}
                  onChange={(e) => setEditForm({ ...editForm, entry_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total Muatan (Kg) <span className="text-red-500">*</span></label>
                  <input
                    type="number" required min="0.1" step="0.1"
                    value={editForm.total_kg}
                    onChange={(e) => setEditForm({ ...editForm, total_kg: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tarif / Kg <span className="text-red-500">*</span></label>
                  <input
                    type="number" required min="0.01" step="0.01"
                    value={editForm.rate_per_kg}
                    onChange={(e) => setEditForm({ ...editForm, rate_per_kg: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Keterangan <span className="text-red-500">*</span></label>
                <input
                  type="text" required
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {(() => {
                const kg = parseFloat(editForm.total_kg) || 0
                const rate = parseFloat(editForm.rate_per_kg) || 0
                return (
                  <p className="text-xs text-slate-500">
                    Total Upah: <span className="font-bold text-slate-700">{formatRupiah(kg * rate)}</span>
                    {editSelectedWorkerKeys.length > 0 && ` — dibagi rata ke ${editSelectedWorkerKeys.length} orang`}
                  </p>
                )
              })()}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditEntry(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                  Batal
                </button>
                <button type="submit" disabled={editSubmitting}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                  {editSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}

    {/* Modal Tandai Lunas & Catat Kas Keluar */}
    {payBoronganOpen && (() => {
      const selectedEntries = entries.filter(ent => selectedIds.includes(ent.id))
      const totalAmount = selectedEntries.reduce((s, e) => s + Number(e.total_earning), 0)
      const branchCount = new Set(selectedEntries.map(e => e.branch_id).filter(Boolean)).size
      return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-700">Tandai Lunas: Metode &amp; Sumber Pembayaran</h2>
              <button onClick={() => setPayBoronganOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600">{selectedEntries.length} entri belum lunas{branchCount > 1 ? ` (lintas ${branchCount} cabang)` : ''}</p>

              <div className="bg-slate-50 rounded-xl p-3 space-y-1 text-sm">
                <div className="flex justify-between font-bold text-green-700"><span>Total Kas Keluar</span><span>{formatRupiah(totalAmount)}</span></div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Pembayaran <span className="text-red-500">*</span></label>
                <input type="date" required value={payBoronganDate} onChange={e => setPayBoronganDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Rekening/Kas Sumber <span className="text-red-500">*</span></label>
                <select required value={payBoronganAccountId} onChange={e => setPayBoronganAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Pilih Rekening/Kas --</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}`}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setPayBoronganOpen(false)} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition">
                  Batal
                </button>
                <button onClick={confirmPayBorongan} disabled={payBoronganSubmitting || !payBoronganAccountId}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                  {payBoronganSubmitting ? 'Memproses...' : 'Konfirmasi Lunas'}
                </button>
              </div>
              {branchCount > 1 && (
                <p className="text-[11px] text-slate-400">Entri lintas cabang akan dicatat sebagai beberapa baris Kas Keluar — satu per cabang.</p>
              )}
            </div>
          </div>
        </div>
      )
    })()}

    <style>{`
      @media print {
        nav, aside { display: none !important; }
        main { padding: 0 !important; overflow: visible !important; }
        .max-w-6xl { max-width: none !important; }
        .print-hide { display: none !important; }
        #borongan-print-header { display: block !important; }
      }
    `}</style>
    </>
  )
}
