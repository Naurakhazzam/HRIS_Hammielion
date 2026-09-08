'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'
import { canEditCashOut, canDeleteCashOut, saveCashOutEdit } from '@/lib/finCashOut'
import RupiahInput from '@/components/RupiahInput'
import Link from 'next/link'

type Branch = { id: string; name: string }
type Category = { code: string; label: string; affects_net_profit: boolean }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_type: string }
type MyCashOut = {
  id: string
  branch_id: string
  category: string
  amount: number
  description: string | null
  transaction_date: string
  status: string
  rejection_reason: string | null
  account_id: string | null
  source_table: string | null
  source_id: string | null
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
  fin_bank_accounts: { bank_name: string; account_number: string | null; account_type: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

// Kategori yang seharusnya lahir dari slip gaji resmi (Tandai Lunas), bukan diketik bebas di sini —
// setiap kali ada input manual untuk kategori ini, riwayatnya selalu berujung salah cabang atau dobel.
const PAYROLL_CATEGORIES = ['payroll', 'gaji_', 'driver_wage', 'helper_wage', 'borongan_wage']

export default function InputKasKeluarPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [myBranchName, setMyBranchName] = useState<string>('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [recent, setRecent] = useState<MyCashOut[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [formData, setFormData] = useState({
    branch_id: '',
    category: '',
    amount: '',
    transaction_date: todayLocalStr(),
    description: '',
    account_id: '',
  })

  const [entryMode, setEntryMode] = useState<'biasa' | 'kasbon' | 'kendaraan'>('biasa')

  // Peringatan kategori "Gaji" — cegah input manual untuk karyawan yang sudah terdaftar (harus lewat Tandai Lunas)
  const [gajiConfirmed, setGajiConfirmed] = useState<'unregistered' | 'registered' | null>(null)

  // Mode "Sewa Kendaraan" — hari pemakaian disarankan otomatis dari data ritase driver
  // (delivery_trips, dihitung per hari kalender penuh 1 s.d. akhir bulan), tapi tetap bisa
  // dikoreksi manual sebelum disimpan.
  const [vehicleRates, setVehicleRates] = useState<{ id: string; vehicle_id: string; rate_per_day: number; branch_id: string; account_id: string | null; internal_to_branch_id: string | null; internal_to_account_id: string | null; vehicles: { name: string } | null }[]>([])
  const [vehicleRateId, setVehicleRateId] = useState('')
  const [vehicleMonth, setVehicleMonth] = useState(todayLocalStr().slice(0, 7))
  const [vehicleDays, setVehicleDays] = useState('')
  const [loadingVehicleDays, setLoadingVehicleDays] = useState(false)
  const [vehicleSuggestedDays, setVehicleSuggestedDays] = useState<number | null>(null)

  // Mode "Cairkan Kasbon" — cuma boleh cairkan pengajuan yang SUDAH disetujui Owner (lihat
  // /kasbon dan /keuangan/approval), bukan input bebas lagi. Nominal ikut nominal yang disetujui,
  // tidak bisa diubah di sini, supaya tidak ada lagi kasbon yang cair tanpa persetujuan.
  const [kasbonApprovedRequests, setKasbonApprovedRequests] = useState<{ id: string; employee_id: string; amount_requested: number; employees: { full_name: string; employee_code: string } | null }[]>([])
  const [kasbonRequestId, setKasbonRequestId] = useState('')
  const [activeSubTab, setActiveSubTab] = useState<'riwayat' | 'revisi'>('riwayat')

  const isSupervisor = role === 'supervisor'
  const isAdmin = ADMIN_ROLES.includes(role)

  function resetKasbonFields() {
    setKasbonRequestId('')
  }

  async function fetchKasbonApprovedRequests() {
    const { data } = await supabase.from('kasbon_requests')
      .select('id, employee_id, amount_requested, employees(full_name, employee_code)')
      .eq('status', 'approved').is('disbursed_at', null)
      .order('approved_at', { ascending: true })
    setKasbonApprovedRequests((data as unknown as { id: string; employee_id: string; amount_requested: number; employees: { full_name: string; employee_code: string } | null }[]) || [])
  }

  function resetVehicleFields() {
    setVehicleRateId('')
    setVehicleDays('')
    setVehicleSuggestedDays(null)
  }

  // Saran hari pemakaian dari data ritase driver (delivery_trips) — dihitung dari hari UNIK
  // (bukan jumlah ritase, karena 1 hari bisa lebih dari 1 kali jalan), sepanjang bulan kalender
  // penuh (tanggal 1 s.d. akhir bulan) sesuai kesepakatan, bukan periode gaji 26-25.
  useEffect(() => {
    if (!vehicleRateId || !vehicleMonth) { setVehicleSuggestedDays(null); return }
    const rate = vehicleRates.find(r => r.id === vehicleRateId)
    if (!rate) return
    setLoadingVehicleDays(true)
    const [y, m] = vehicleMonth.split('-').map(Number)
    const startDate = `${vehicleMonth}-01`
    const endDate = new Date(y, m, 0).toISOString().slice(0, 10)
    supabase.from('delivery_trips').select('trip_date').eq('vehicle_id', rate.vehicle_id).gte('trip_date', startDate).lte('trip_date', endDate)
      .then(({ data }) => {
        const uniqueDays = new Set((data || []).map(d => d.trip_date)).size
        setVehicleSuggestedDays(uniqueDays)
        setVehicleDays(String(uniqueDays))
        setLoadingVehicleDays(false)
      })
  }, [vehicleRateId, vehicleMonth, vehicleRates, supabase])


  const fetchRecent = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('fin_cash_out')
      .select('id, branch_id, category, amount, description, transaction_date, status, rejection_reason, account_id, source_table, source_id, branches(name), fin_cash_out_categories(label), fin_bank_accounts(bank_name, account_number, account_type)')
      .eq('input_by', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setRecent(data as unknown as MyCashOut[])
  }, [supabase])

  // Terpisah dari "10 Input Terakhir" — supaya entri lama yang ditolak tidak pernah "hilang" dari daftar
  const [needsRevision, setNeedsRevision] = useState<MyCashOut[]>([])
  const fetchNeedsRevision = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('fin_cash_out')
      .select('id, branch_id, category, amount, description, transaction_date, status, rejection_reason, account_id, source_table, source_id, branches(name), fin_cash_out_categories(label), fin_bank_accounts(bank_name, account_number, account_type)')
      .eq('input_by', userId)
      .eq('status', 'rejected')
      .order('transaction_date', { ascending: false })
    if (data) setNeedsRevision(data as unknown as MyCashOut[])
  }, [supabase])

  const refreshMine = useCallback(async (userId: string) => {
    await Promise.all([fetchRecent(userId), fetchNeedsRevision(userId)])
  }, [fetchRecent, fetchNeedsRevision])

  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editRowBranchId, setEditRowBranchId] = useState('')
  const [editRowCategory, setEditRowCategory] = useState('')
  const [editRowAmount, setEditRowAmount] = useState('')
  const [editRowDescription, setEditRowDescription] = useState('')
  const [editRowDate, setEditRowDate] = useState('')
  const [editRowAccountId, setEditRowAccountId] = useState('')
  const [editingRowOriginalStatus, setEditingRowOriginalStatus] = useState('')
  const [editRowSourceTable, setEditRowSourceTable] = useState<string | null>(null)
  const [editRowSourceId, setEditRowSourceId] = useState<string | null>(null)

  // Aturan siapa-boleh-apa ada di lib/finCashOut.ts, dipakai bareng dengan Riwayat Kas Keluar.
  function canEditRow(r: MyCashOut) {
    return isAdmin && canEditCashOut(r)
  }

  function canDeleteRow(r: MyCashOut) {
    return isAdmin && canDeleteCashOut(r)
  }

  function startEditRow(r: MyCashOut) {
    setEditingRowId(r.id)
    setEditingRowOriginalStatus(r.status)
    setEditRowBranchId(r.branch_id)
    setEditRowCategory(r.category)
    setEditRowAmount(String(r.amount))
    setEditRowDescription(r.description || '')
    setEditRowDate(r.transaction_date)
    setEditRowAccountId(r.account_id || '')
    setEditRowSourceTable(r.source_table)
    setEditRowSourceId(r.source_id)
  }

  async function saveEditRow(id: string) {
    if (!myUserId) return
    const amountNum = parseFloat(editRowAmount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Jumlah tidak valid.'); return }
    if (!editRowAccountId) { showMessage('error', 'Pilih rekening/kas dulu.'); return }
    if (!editRowCategory) { showMessage('error', 'Pilih kategori dulu.'); return }
    if (!editRowBranchId) { showMessage('error', 'Pilih cabang dulu.'); return }

    const result = await saveCashOutEdit(supabase, {
      id, branch_id: editRowBranchId, transaction_date: editRowDate, category: editRowCategory,
      amount: amountNum, description: editRowDescription || null, account_id: editRowAccountId,
      originalStatus: editingRowOriginalStatus, sourceTable: editRowSourceTable, sourceId: editRowSourceId,
    }, formatRupiah)

    if (!result.ok) { showMessage('error', result.error); return }
    showMessage('success', result.wasRejected ? 'Entri berhasil diperbaiki dan diajukan ulang untuk verifikasi.' : 'Entri berhasil diperbarui.')
    setEditingRowId(null); refreshMine(myUserId)
  }

  async function handleDeleteRow(r: MyCashOut) {
    if (!myUserId) return
    const ok = window.confirm(`Hapus entri kas keluar ${formatRupiah(r.amount)} tanggal ${new Date(r.transaction_date).toLocaleDateString('id-ID')}? Tindakan ini tidak bisa dibatalkan.`)
    if (!ok) return
    const { error } = await supabase.from('fin_cash_out').delete().eq('id', r.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Entri berhasil dihapus.'); refreshMine(myUserId) }
  }

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setMyUserId(user.id)

      const { data: userRow } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (userRow) {
        setRole(userRow.role)
        if (userRow.employee_id) {
          const { data: emp } = await supabase.from('employees').select('branch_id, branches(name)').eq('id', userRow.employee_id).single()
          if (emp) {
            setMyBranchId(emp.branch_id)
            setMyBranchName((emp as unknown as { branches: { name: string } | null }).branches?.name || '')
            setFormData(f => ({ ...f, branch_id: emp.branch_id }))
          }
        }
      }

      const [bRes, cRes, baRes, vRes] = await Promise.all([
        supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
        supabase.from('fin_cash_out_categories').select('code, label, affects_net_profit').eq('is_active', true).order('label'),
        supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_type').eq('is_active', true).order('account_type').order('bank_name'),
        supabase.from('fin_vehicle_rental_rates').select('id, vehicle_id, rate_per_day, branch_id, account_id, internal_to_branch_id, internal_to_account_id, vehicles(name)').eq('is_active', true),
      ])
      if (bRes.data) setBranches(bRes.data)
      if (cRes.data) setCategories(cRes.data)
      if (baRes.data) setBankAccounts(baRes.data)
      if (vRes.data) setVehicleRates(vRes.data as any)
      await fetchKasbonApprovedRequests()

      await refreshMine(user.id)
      setLoading(false)
    }
    init()
  }, [supabase, refreshMine])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId) return

    const branchId = isSupervisor ? myBranchId : formData.branch_id
    // Mode "kendaraan" tidak pakai dropdown Cabang biasa — cabang & rekeningnya sudah ditentukan
    // dari konfigurasi tarif kendaraan yang dipilih, jadi lewati pengecekan ini untuk mode itu.
    const skipBranchCheck = entryMode === 'kendaraan'
    if (!skipBranchCheck && !branchId) { showMessage('error', 'Cabang wajib dipilih.'); return }

    if (entryMode === 'kendaraan') {
      const rate = vehicleRates.find(r => r.id === vehicleRateId)
      if (!rate) { showMessage('error', 'Kendaraan wajib dipilih.'); return }
      const daysNum = parseFloat(vehicleDays)
      if (isNaN(daysNum) || daysNum <= 0) { showMessage('error', 'Jumlah hari pemakaian tidak valid.'); return }

      setSubmitting(true)
      const vehicleName = rate.vehicles?.name || 'Kendaraan'
      const total = rate.rate_per_day * daysNum
      const [y, m] = vehicleMonth.split('-').map(Number)
      const endDate = new Date(y, m, 0).toISOString().slice(0, 10)
      const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

      const { error: outErr } = await supabase.from('fin_cash_out').insert({
        branch_id: rate.branch_id, category: 'sewa', amount: total,
        description: `Sewa ${vehicleName} ${daysNum} hari (internal, ke Logistik) - ${monthLabel}`,
        transaction_date: endDate, account_id: rate.account_id,
        input_by: myUserId, status: 'pending',
      })
      if (outErr) {
        showMessage('error', 'Gagal mencatat: ' + outErr.message)
        setSubmitting(false)
        return
      }

      if (rate.internal_to_branch_id) {
        const branchName = branches.find(b => b.id === rate.branch_id)?.name || 'Cabang'
        const { error: inErr } = await supabase.from('fin_cash_in').insert({
          branch_id: rate.internal_to_branch_id, transaction_date: endDate, amount: total,
          expense_amount: 0, cash_adjustment: 0, payment_method: 'transfer',
          description: `Sewa ${vehicleName} dari ${branchName} (internal), ${daysNum} hari - ${monthLabel}`,
          account_id: rate.internal_to_account_id, input_by: myUserId, status: 'pending',
        })
        if (inErr) {
          showMessage('error', 'Pengeluaran tersimpan, tapi gagal mencatat pemasangan pemasukan internal: ' + inErr.message)
          setSubmitting(false)
          return
        }
      }

      showMessage('success', `Sewa ${vehicleName} ${monthLabel} (${daysNum} hari, ${formatRupiah(total)}) berhasil dicatat, menunggu verifikasi.`)
      resetVehicleFields()
      refreshMine(myUserId)
      setSubmitting(false)
      return
    }

    if (entryMode === 'kasbon') {
      if (!kasbonRequestId) { showMessage('error', 'Pilih pengajuan kasbon yang mau dicairkan.'); return }
      const req = kasbonApprovedRequests.find(r => r.id === kasbonRequestId)
      if (!req) { showMessage('error', 'Pengajuan tidak ditemukan, coba pilih ulang.'); return }
      if (!formData.account_id) { showMessage('error', 'Rekening/kas sumber wajib dipilih.'); return }

      setSubmitting(true)
      const empName = req.employees?.full_name || 'Karyawan'
      const { error } = await supabase.from('fin_cash_out').insert({
        branch_id: branchId, category: 'kasbon_cair', amount: req.amount_requested,
        description: `Pencairan kasbon - ${empName}${formData.description ? ' - ' + formData.description : ''}`,
        source_table: 'kasbon_requests', source_id: req.id,
        transaction_date: formData.transaction_date, account_id: formData.account_id,
        input_by: myUserId, status: 'pending',
      })
      if (error) {
        showMessage('error', 'Gagal mencatat: ' + error.message)
        setSubmitting(false)
        return
      }

      // Tandai pengajuan sudah dicairkan (RLS kasbon_req_disburse) — inilah yang jadi acuan
      // "Saldo Kasbon" & potongan gaji di Penggajian Bulanan, bukan input bebas lagi.
      const { error: disburseErr } = await supabase.from('kasbon_requests')
        .update({ disbursed_at: new Date().toISOString(), disbursed_by: myUserId })
        .eq('id', req.id)
      if (disburseErr) {
        showMessage('error', 'Pencairan tercatat di Kas Keluar, tapi gagal menandai pengajuan sebagai dicairkan: ' + disburseErr.message)
        setSubmitting(false)
        fetchKasbonApprovedRequests()
        refreshMine(myUserId)
        return
      }

      showMessage('success', `Pencairan kasbon untuk ${empName} (${formatRupiah(req.amount_requested)}) berhasil dicatat, menunggu verifikasi.`)
      setFormData(f => ({ ...f, description: '', account_id: '' }))
      resetKasbonFields()
      fetchKasbonApprovedRequests()
      refreshMine(myUserId)
      setSubmitting(false)
      return
    }

    if (entryMode === 'biasa') {
      if (!formData.category) { showMessage('error', 'Kategori wajib dipilih.'); return }
      if (PAYROLL_CATEGORIES.includes(formData.category) && gajiConfirmed !== 'unregistered') {
        showMessage('error', 'Konfirmasi dulu apakah karyawan ini terdaftar di sistem — kalau terdaftar, gajinya wajib lewat Tandai Lunas, bukan input manual di sini.')
        return
      }
      if (!formData.account_id) { showMessage('error', 'Rekening/kas sumber wajib dipilih.'); return }
      const amountNum = parseFloat(formData.amount)
      if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Jumlah tidak valid.'); return }

      setSubmitting(true)
      const { error } = await supabase.from('fin_cash_out').insert({
        branch_id: branchId,
        category: formData.category,
        amount: amountNum,
        description: formData.description || null,
        transaction_date: formData.transaction_date,
        account_id: formData.account_id,
        input_by: myUserId,
        status: 'pending',
      })

      if (error) {
        showMessage('error', 'Gagal menyimpan: ' + error.message)
      } else {
        showMessage('success', 'Kas keluar berhasil dicatat, menunggu verifikasi tim finance pusat.')
        setFormData(f => ({ ...f, amount: '', description: '', account_id: '' }))
        setGajiConfirmed(null)
        refreshMine(myUserId)
      }
      setSubmitting(false)
      return
    }

  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      revisi: 'bg-blue-100 text-blue-800',
    }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', revisi: '🔄 Revisi' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Input Kas Keluar</h1>
        <p className="text-sm text-slate-500">Catat pengeluaran manual (sewa, operasional, dll). Untuk pembayaran ke supplier, buka <Link href="/keuangan/pembelian/input" className="text-blue-600 hover:underline">Pembelian &amp; Utang Supplier</Link>. Entri akan berstatus &quot;Menunggu&quot; sampai diverifikasi tim finance pusat.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Form Kas Keluar</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {entryMode !== 'kendaraan' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
                {isSupervisor ? (
                  <div className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-600">{myBranchName || '—'}</div>
                ) : (
                  <select
                    required
                    value={formData.branch_id}
                    onChange={e => setFormData({ ...formData, branch_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">-- Pilih Cabang --</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Pengeluaran <span className="text-red-500">*</span></label>
              <div className="flex flex-wrap gap-2">
                {(['biasa', 'kasbon', 'kendaraan'] as const).map(m => (
                  <button key={m} type="button" onClick={() => { setEntryMode(m); resetKasbonFields(); resetVehicleFields() }}
                    className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition whitespace-nowrap ${
                      entryMode === m ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}>
                    {m === 'biasa' ? 'Pengeluaran Biasa' : m === 'kasbon' ? '💵 Cairkan Kasbon' : '🚚 Sewa Kendaraan'}
                  </button>
                ))}
              </div>
              <Link href="/keuangan/pembelian/input"
                className="mt-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition">
                🏭 Bayar ke Supplier — buka Pembelian &amp; Utang Supplier →
              </Link>
            </div>

            {entryMode === 'biasa' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kategori <span className="text-red-500">*</span></label>
                <select
                  required
                  value={formData.category}
                  onChange={e => { setFormData({ ...formData, category: e.target.value }); setGajiConfirmed(null) }}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="">-- Pilih Kategori --</option>
                  {categories.map(c => <option key={c.code} value={c.code}>{c.label}{!c.affects_net_profit ? ' (tidak masuk laba/rugi)' : ''}</option>)}
                </select>

                {PAYROLL_CATEGORIES.includes(formData.category) && (
                  <div className="mt-2 p-3 rounded-lg border bg-amber-50 border-amber-200">
                    <p className="text-xs font-medium text-amber-800 mb-2">⚠ Apakah karyawan ini terdaftar di sistem (staff/driver/kenek tetap)?</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setGajiConfirmed('unregistered')}
                        className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition ${gajiConfirmed === 'unregistered' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                        Tidak — freelance/lepas
                      </button>
                      <button type="button" onClick={() => setGajiConfirmed('registered')}
                        className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition ${gajiConfirmed === 'registered' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                        Ya — terdaftar
                      </button>
                    </div>
                    {gajiConfirmed === 'registered' && (
                      <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                        <p className="font-medium mb-1">Jangan input manual di sini — gajinya harus lewat Tandai Lunas supaya cabang &amp; nominalnya otomatis benar. Buka sesuai perannya:</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <Link href="/penggajian/bulanan" className="underline">Gaji Staff</Link>
                          <Link href="/penggajian/driver" className="underline">Gaji Driver</Link>
                          <Link href="/penggajian/borongan" className="underline">Gajian Bongkar Muat</Link>
                        </div>
                      </div>
                    )}
                    {gajiConfirmed === 'unregistered' && (
                      <p className="mt-2 text-xs text-green-700">Oke, boleh dilanjutkan sebagai input manual (freelance/lepas).</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {entryMode !== 'kendaraan' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal <span className="text-red-500">*</span></label>
                <input
                  type="date" required
                  value={formData.transaction_date}
                  onChange={e => setFormData({ ...formData, transaction_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            {entryMode === 'kendaraan' && (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kendaraan <span className="text-red-500">*</span></label>
                  <select required value={vehicleRateId} onChange={e => setVehicleRateId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">-- Pilih Kendaraan --</option>
                    {vehicleRates.map(r => <option key={r.id} value={r.id}>{r.vehicles?.name} ({formatRupiah(r.rate_per_day)}/hari)</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bulan <span className="text-red-500">*</span></label>
                  <input type="month" required value={vehicleMonth} onChange={e => setVehicleMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jumlah Hari Pemakaian <span className="text-red-500">*</span></label>
                  <RupiahInput required value={vehicleDays} onChange={setVehicleDays}
                    placeholder="Contoh: 22"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  <p className="text-[11px] text-slate-400 mt-1">
                    {loadingVehicleDays ? 'Menghitung dari data ritase driver...' : vehicleSuggestedDays !== null
                      ? `Saran otomatis dari data ritase driver: ${vehicleSuggestedDays} hari (1 bulan kalender penuh) — bisa dikoreksi manual kalau ada pemakaian di luar rute pengiriman.`
                      : 'Pilih kendaraan & bulan untuk melihat saran hari pemakaian otomatis.'}
                  </p>
                </div>
                {vehicleRateId && vehicleDays && !isNaN(parseFloat(vehicleDays)) && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-sm text-blue-700">
                    Total: <strong>{formatRupiah((vehicleRates.find(r => r.id === vehicleRateId)?.rate_per_day || 0) * parseFloat(vehicleDays))}</strong>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">Otomatis tercatat sebagai pengeluaran cabang pemakai <strong>dan</strong> pemasukan cabang internal (Logistik) — tidak perlu diisi manual.</p>
              </div>
            )}

            {(entryMode === 'biasa' || entryMode === 'kasbon') && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Rekening/Kas Sumber <span className="text-red-500">*</span></label>
                <select
                  value={formData.account_id}
                  onChange={e => setFormData({ ...formData, account_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="">-- Pilih Rekening/Kas --</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}`}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Dari rekening/kas mana pengeluaran ini dibayarkan.</p>
              </div>
            )}

            {entryMode === 'biasa' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Jumlah (Rp) <span className="text-red-500">*</span></label>
                <RupiahInput
                  required
                  value={formData.amount}
                  onChange={v => setFormData({ ...formData, amount: v })}
                  placeholder="Contoh: 500.000"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            {entryMode === 'kasbon' && (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Pengajuan yang Disetujui <span className="text-red-500">*</span></label>
                  {kasbonApprovedRequests.length === 0 ? (
                    <p className="text-xs text-slate-400 bg-slate-50 rounded px-2 py-1.5">Tidak ada pengajuan kasbon yang sudah disetujui dan belum dicairkan. Ajukan &amp; setujui dulu lewat <Link href="/kasbon" className="text-blue-600 hover:underline">Kasbon Karyawan</Link> / <Link href="/keuangan/approval" className="text-blue-600 hover:underline">Verifikasi Keuangan</Link>.</p>
                  ) : (
                    <select required value={kasbonRequestId} onChange={e => setKasbonRequestId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="">-- Pilih Pengajuan --</option>
                      {kasbonApprovedRequests.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.employees?.full_name} ({r.employees?.employee_code}) — {formatRupiah(r.amount_requested)}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">Nominal ikut yang sudah disetujui — tidak bisa diketik bebas lagi, supaya tidak ada kasbon cair tanpa persetujuan.</p>
                </div>
              </div>
            )}

            {(entryMode === 'biasa' || entryMode === 'kasbon') && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  placeholder="Opsional"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !myUserId}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : 'Simpan (Menunggu Verifikasi)'}
            </button>
            {isAdmin && (
              <p className="text-xs text-slate-400">Anda login sebagai {role}. Entri manual tetap berstatus &quot;Menunggu&quot; walau Anda bisa menyetujuinya sendiri di halaman Verifikasi.</p>
            )}
          </form>
        </div>

        <div className="lg:col-span-2 space-y-4">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          <button onClick={() => setActiveSubTab('riwayat')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${activeSubTab === 'riwayat' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            10 Input Terakhir
          </button>
          <button onClick={() => setActiveSubTab('revisi')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${activeSubTab === 'revisi' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            ⚠️ Perlu Direvisi {needsRevision.length > 0 && `(${needsRevision.length})`}
          </button>
        </div>
        {activeSubTab === 'revisi' && (
          <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
            <div className="p-4 border-b border-red-200 bg-red-50">
              <h2 className="font-semibold text-red-800 text-sm">⚠️ Perlu Direvisi ({needsRevision.length})</h2>
              <p className="text-xs text-red-600 mt-0.5">Semua entri kamu yang ditolak, tidak dibatasi 10 terakhir atau bulan tertentu — perbaiki di sini.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <tbody className="divide-y divide-slate-100">
                  {needsRevision.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada entri yang perlu direvisi.</td></tr>
                  ) : needsRevision.map(r => (
                    <tr key={r.id} className="hover:bg-red-50/50 transition">
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                        {editingRowId === r.id ? (
                          <input type="date" value={editRowDate} onChange={e => setEditRowDate(e.target.value)}
                            className="px-2 py-1 border border-slate-300 rounded text-sm" />
                        ) : new Date(r.transaction_date).toLocaleDateString('id-ID')}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {editingRowId === r.id ? (
                          r.source_table === 'supplier_purchases' ? (
                            <span className="text-slate-500">{r.fin_cash_out_categories?.label}</span>
                          ) : (
                            <select value={editRowCategory} onChange={e => setEditRowCategory(e.target.value)}
                              className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                              {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                            </select>
                          )
                        ) : r.fin_cash_out_categories?.label}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">
                        {editingRowId === r.id ? (
                          <RupiahInput value={editRowAmount} onChange={setEditRowAmount}
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right" />
                        ) : formatRupiah(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 max-w-[220px]">
                        {editingRowId === r.id ? (
                          <input value={editRowDescription} onChange={e => setEditRowDescription(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                        ) : (
                          <div>
                            {r.description && <div>{r.description}</div>}
                            {r.rejection_reason && <div className="text-red-600 text-xs mt-0.5">Alasan: {r.rejection_reason}</div>}
                          </div>
                        )}
                        {r.source_table === 'supplier_purchases' && (
                          <div className="text-[10px] text-blue-600 mt-0.5">🔗 Pembayaran supplier — nominal dicek ulang ke sisa utang saat disimpan.</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {editingRowId === r.id ? (
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => saveEditRow(r.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                            <button onClick={() => setEditingRowId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                          </div>
                        ) : canEditRow(r) ? (
                          <button onClick={() => startEditRow(r)} className="text-xs text-blue-600 hover:underline font-medium">Perbaiki</button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeSubTab === 'riwayat' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="font-semibold text-slate-800 text-sm">10 Input Terakhir Saya</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cabang</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Jumlah</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Rekening/Kas</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada input.</td></tr>
                ) : recent.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {editingRowId === r.id ? (
                        <input type="date" value={editRowDate} onChange={e => setEditRowDate(e.target.value)}
                          className="px-2 py-1 border border-slate-300 rounded text-sm" />
                      ) : new Date(r.transaction_date).toLocaleDateString('id-ID')}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {editingRowId === r.id ? (
                        r.source_table === 'supplier_purchases' ? (
                          <span className="text-slate-500">{r.branches?.name}</span>
                        ) : (
                          <select value={editRowBranchId} onChange={e => setEditRowBranchId(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        )
                      ) : r.branches?.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {editingRowId === r.id ? (
                        r.source_table === 'supplier_purchases' ? (
                          <span className="text-slate-500">{r.fin_cash_out_categories?.label}</span>
                        ) : (
                          <select value={editRowCategory} onChange={e => setEditRowCategory(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                            {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                          </select>
                        )
                      ) : r.fin_cash_out_categories?.label}
                      {editingRowId === r.id && r.source_table === 'supplier_purchases' && (
                        <div className="text-[10px] text-blue-600 mt-0.5">🔗 Pembayaran supplier — nominal dicek ulang ke sisa utang saat disimpan.</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">
                      {editingRowId === r.id ? (
                        <RupiahInput value={editRowAmount} onChange={setEditRowAmount}
                          className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right" />
                      ) : formatRupiah(r.amount)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {editingRowId === r.id ? (
                        r.source_table === 'supplier_purchases' ? (
                          <span className="text-slate-500">{r.fin_bank_accounts ? (r.fin_bank_accounts.account_type === 'tunai' ? r.fin_bank_accounts.bank_name : `${r.fin_bank_accounts.bank_name} — ${r.fin_bank_accounts.account_number}`) : '—'}</span>
                        ) : (
                          <select value={editRowAccountId} onChange={e => setEditRowAccountId(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                            <option value="">-- Pilih --</option>
                            {bankAccounts.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}`}
                              </option>
                            ))}
                          </select>
                        )
                      ) : r.fin_bank_accounts ? (r.fin_bank_accounts.account_type === 'tunai' ? r.fin_bank_accounts.bank_name : `${r.fin_bank_accounts.bank_name} — ${r.fin_bank_accounts.account_number}`) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {statusBadge(r.status)}
                      {r.status === 'rejected' && r.rejection_reason && (
                        <div className="text-[10px] text-red-600 mt-1 max-w-[160px] mx-auto">Alasan: {r.rejection_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editingRowId === r.id ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEditRow(r.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                          <button onClick={() => setEditingRowId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-center">
                          {canEditRow(r) && (
                            <button onClick={() => startEditRow(r)} className="text-xs text-blue-600 hover:underline font-medium">{r.status === 'rejected' ? 'Perbaiki' : 'Edit'}</button>
                          )}
                          {canDeleteRow(r) && (
                            <button onClick={() => handleDeleteRow(r)} className="text-xs text-red-600 hover:underline">Hapus</button>
                          )}
                          {!canEditRow(r) && !canDeleteRow(r) && (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
        </div>
      </div>
    </div>
  )
}
