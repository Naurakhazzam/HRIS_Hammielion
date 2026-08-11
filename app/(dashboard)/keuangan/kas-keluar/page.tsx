'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'
import { unrequestedFor } from '@/lib/supplierPurchases'
import Link from 'next/link'

type Branch = { id: string; name: string }
type Category = { code: string; label: string; affects_net_profit: boolean }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_type: string }
type Supplier = { id: string; name: string }
type SupplierPurchaseOpt = { id: string; total_amount: number; description: string | null; purchase_date: string }
type SupplierPaymentRow = { source_id: string; amount: number; status: string }
type MyCashOut = {
  id: string
  amount: number
  description: string | null
  transaction_date: string
  status: string
  branches: { name: string } | null
  fin_cash_out_categories: { label: string } | null
  fin_bank_accounts: { bank_name: string; account_number: string | null; account_type: string } | null
}

const ADMIN_ROLES = ['owner', 'hr', 'finance']

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

  // Mode "Bayar ke Supplier" — supaya tidak perlu pindah ke halaman Pembelian & Utang Supplier untuk aktivitas harian
  const [entryMode, setEntryMode] = useState<'biasa' | 'supplier'>('biasa')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [supplierPurchases, setSupplierPurchases] = useState<SupplierPurchaseOpt[]>([])
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentRow[]>([])
  const [loadingSupplierData, setLoadingSupplierData] = useState(false)
  const [supplierSubMode, setSupplierSubMode] = useState<'existing' | 'new'>('new')
  const [selectedPurchaseId, setSelectedPurchaseId] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [newTotalAmount, setNewTotalAmount] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [payNow, setPayNow] = useState(false)
  const [payNowAmount, setPayNowAmount] = useState('')

  const isSupervisor = role === 'supervisor'
  const isAdmin = ADMIN_ROLES.includes(role)

  async function fetchSupplierOpenPurchases(sId: string) {
    setLoadingSupplierData(true)
    const { data: pData } = await supabase
      .from('supplier_purchases')
      .select('id, total_amount, description, purchase_date')
      .eq('supplier_id', sId)
      .order('purchase_date', { ascending: false })
    const list = (pData as SupplierPurchaseOpt[]) || []
    setSupplierPurchases(list)
    if (list.length > 0) {
      const { data: payData } = await supabase
        .from('fin_cash_out')
        .select('source_id, amount, status')
        .eq('source_table', 'supplier_purchases')
        .in('source_id', list.map(p => p.id))
      setSupplierPayments((payData as SupplierPaymentRow[]) || [])
    } else {
      setSupplierPayments([])
    }
    setLoadingSupplierData(false)
  }

  function resetSupplierFields() {
    setSupplierId('')
    setSupplierPurchases([])
    setSupplierPayments([])
    setSupplierSubMode('new')
    setSelectedPurchaseId('')
    setPayAmount('')
    setNewTotalAmount('')
    setNewDescription('')
    setPayNow(false)
    setPayNowAmount('')
  }

  const openPurchases = supplierPurchases.filter(p => unrequestedFor(p.total_amount, p.id, supplierPayments) > 0)

  const fetchRecent = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('fin_cash_out')
      .select('id, amount, description, transaction_date, status, branches(name), fin_cash_out_categories(label), fin_bank_accounts(bank_name, account_number, account_type)')
      .eq('input_by', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setRecent(data as unknown as MyCashOut[])
  }, [supabase])

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

      const [bRes, cRes, baRes, sRes] = await Promise.all([
        supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
        supabase.from('fin_cash_out_categories').select('code, label, affects_net_profit').eq('is_active', true).order('label'),
        supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_type').eq('is_active', true).order('account_type').order('bank_name'),
        supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
      ])
      if (bRes.data) setBranches(bRes.data)
      if (cRes.data) setCategories(cRes.data)
      if (baRes.data) setBankAccounts(baRes.data)
      if (sRes.data) setSuppliers(sRes.data)

      await fetchRecent(user.id)
      setLoading(false)
    }
    init()
  }, [supabase, fetchRecent])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId) return

    const branchId = isSupervisor ? myBranchId : formData.branch_id
    if (!branchId) { showMessage('error', 'Cabang wajib dipilih.'); return }

    if (entryMode === 'biasa') {
      if (!formData.category) { showMessage('error', 'Kategori wajib dipilih.'); return }
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
        fetchRecent(myUserId)
      }
      setSubmitting(false)
      return
    }

    // entryMode === 'supplier'
    if (!supplierId) { showMessage('error', 'Supplier wajib dipilih.'); return }
    const supplierName = suppliers.find(s => s.id === supplierId)?.name || 'Supplier'

    if (supplierSubMode === 'existing') {
      if (!selectedPurchaseId) { showMessage('error', 'Pilih tagihan yang mau dibayar.'); return }
      const purchase = supplierPurchases.find(p => p.id === selectedPurchaseId)
      if (!purchase) { showMessage('error', 'Tagihan tidak ditemukan, coba pilih ulang.'); return }
      const amountNum = parseFloat(payAmount)
      if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Nominal tidak valid.'); return }
      const unrequested = unrequestedFor(purchase.total_amount, purchase.id, supplierPayments)
      if (amountNum > unrequested) { showMessage('error', `Nominal melebihi sisa yang belum diajukan (${formatRupiah(unrequested)}).`); return }
      if (!formData.account_id) { showMessage('error', 'Rekening/kas sumber wajib dipilih.'); return }

      setSubmitting(true)
      const { error } = await supabase.from('fin_cash_out').insert({
        branch_id: branchId, category: 'pembayaran_supplier', amount: amountNum,
        description: `Cicilan/Bayar ke ${supplierName}${purchase.description ? ' - ' + purchase.description : ''}${formData.description ? ' (' + formData.description + ')' : ''}`,
        source_table: 'supplier_purchases', source_id: purchase.id,
        transaction_date: formData.transaction_date, account_id: formData.account_id,
        input_by: myUserId, status: 'pending',
      })
      if (error) {
        showMessage('error', 'Gagal menyimpan: ' + error.message)
      } else {
        showMessage('success', `Pembayaran ke ${supplierName} berhasil dicatat, menunggu verifikasi tim finance pusat.`)
        setFormData(f => ({ ...f, description: '', account_id: '' }))
        resetSupplierFields()
        fetchRecent(myUserId)
      }
      setSubmitting(false)
      return
    }

    // supplierSubMode === 'new'
    const totalNum = parseFloat(newTotalAmount)
    if (isNaN(totalNum) || totalNum <= 0) { showMessage('error', 'Total tagihan tidak valid.'); return }
    let payNowNum = 0
    if (payNow) {
      payNowNum = parseFloat(payNowAmount)
      if (isNaN(payNowNum) || payNowNum <= 0) { showMessage('error', 'Nominal bayar sekarang tidak valid.'); return }
      if (payNowNum > totalNum) { showMessage('error', 'Nominal bayar tidak boleh lebih besar dari total tagihan.'); return }
      if (!formData.account_id) { showMessage('error', 'Pilih rekening/kas untuk pembayaran.'); return }
    }

    setSubmitting(true)
    const { data: purchaseData, error } = await supabase.from('supplier_purchases').insert({
      supplier_id: supplierId, branch_id: branchId, purchase_date: formData.transaction_date,
      total_amount: totalNum, description: newDescription || null, input_by: myUserId,
    }).select('id').single()

    if (error || !purchaseData) {
      showMessage('error', 'Gagal mencatat tagihan: ' + error?.message)
      setSubmitting(false)
      return
    }

    if (payNow && payNowNum > 0) {
      const { error: payErr } = await supabase.from('fin_cash_out').insert({
        branch_id: branchId, category: 'pembayaran_supplier', amount: payNowNum,
        description: `Bayar ke ${supplierName}${newDescription ? ' - ' + newDescription : ''}`,
        source_table: 'supplier_purchases', source_id: purchaseData.id,
        transaction_date: formData.transaction_date, account_id: formData.account_id,
        input_by: myUserId, status: 'pending',
      })
      if (payErr) {
        showMessage('error', 'Tagihan tersimpan, tapi gagal mencatat pembayaran: ' + payErr.message)
        setSubmitting(false)
        return
      }
    }

    showMessage('success', `Tagihan ke ${supplierName} berhasil dicatat${payNow ? ', pembayaran menunggu verifikasi' : ' (belum dibayar)'}.`)
    setFormData(f => ({ ...f, description: '', account_id: '' }))
    resetSupplierFields()
    fetchRecent(myUserId)
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    }
    const label: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-700'}`}>{label[status] || status}</span>
  }

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Input Kas Keluar</h1>
        <p className="text-sm text-slate-500">Catat pengeluaran manual (sewa, operasional, restock, dll) atau pembayaran ke supplier. Entri akan berstatus &quot;Menunggu&quot; sampai diverifikasi tim finance pusat.</p>
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

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Pengeluaran <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                {(['biasa', 'supplier'] as const).map(m => (
                  <button key={m} type="button" onClick={() => { setEntryMode(m); resetSupplierFields() }}
                    className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition ${
                      entryMode === m ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}>
                    {m === 'biasa' ? 'Pengeluaran Biasa' : '🏭 Bayar ke Supplier'}
                  </button>
                ))}
              </div>
            </div>

            {entryMode === 'biasa' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kategori <span className="text-red-500">*</span></label>
                <select
                  required
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="">-- Pilih Kategori --</option>
                  {categories.map(c => <option key={c.code} value={c.code}>{c.label}{!c.affects_net_profit ? ' (tidak masuk laba/rugi)' : ''}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal <span className="text-red-500">*</span></label>
              <input
                type="date" required
                value={formData.transaction_date}
                onChange={e => setFormData({ ...formData, transaction_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {(entryMode === 'biasa' || supplierSubMode === 'existing' || payNow) && (
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
                <input
                  type="number" required min="1" step="1"
                  value={formData.amount}
                  onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="Contoh: 500000"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            {entryMode === 'supplier' && (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Supplier <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={supplierId}
                    onChange={e => {
                      const val = e.target.value
                      setSupplierId(val)
                      setSelectedPurchaseId('')
                      if (val) fetchSupplierOpenPurchases(val)
                      else { setSupplierPurchases([]); setSupplierPayments([]) }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">-- Pilih Supplier --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">Belum ada di daftar? Tambah dulu lewat <Link href="/keuangan/pembelian/supplier" className="text-blue-600 hover:underline">Master Supplier</Link>.</p>
                </div>

                {supplierId && (
                  <>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setSupplierSubMode('existing')} disabled={openPurchases.length === 0}
                        className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          supplierSubMode === 'existing' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}>
                        Bayar Tagihan Lama {openPurchases.length > 0 ? `(${openPurchases.length})` : ''}
                      </button>
                      <button type="button" onClick={() => setSupplierSubMode('new')}
                        className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition ${
                          supplierSubMode === 'new' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}>
                        Catat Tagihan Baru
                      </button>
                    </div>

                    {loadingSupplierData ? (
                      <p className="text-xs text-slate-400">Memuat data supplier...</p>
                    ) : supplierSubMode === 'existing' ? (
                      <>
                        {openPurchases.length === 0 ? (
                          <p className="text-xs text-slate-400">Tidak ada tagihan terbuka untuk supplier ini — pakai &quot;Catat Tagihan Baru&quot;.</p>
                        ) : (
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Tagihan yang Dibayar <span className="text-red-500">*</span></label>
                            <select
                              required
                              value={selectedPurchaseId}
                              onChange={e => {
                                const pid = e.target.value
                                setSelectedPurchaseId(pid)
                                const pur = supplierPurchases.find(p => p.id === pid)
                                if (pur) setPayAmount(String(unrequestedFor(pur.total_amount, pur.id, supplierPayments)))
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                            >
                              <option value="">-- Pilih Tagihan --</option>
                              {openPurchases.map(p => (
                                <option key={p.id} value={p.id}>
                                  {new Date(p.purchase_date).toLocaleDateString('id-ID')} — {formatRupiah(p.total_amount)}{p.description ? ` (${p.description})` : ''} — sisa {formatRupiah(unrequestedFor(p.total_amount, p.id, supplierPayments))}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {selectedPurchaseId && (
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Nominal Dibayar (Rp) <span className="text-red-500">*</span></label>
                            <input type="number" required min="1" step="1" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Total Tagihan (Rp) <span className="text-red-500">*</span></label>
                          <input type="number" required min="1" step="1" value={newTotalAmount} onChange={e => setNewTotalAmount(e.target.value)}
                            placeholder="Contoh: 5000000"
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan Barang</label>
                          <input type="text" value={newDescription} onChange={e => setNewDescription(e.target.value)}
                            placeholder="Contoh: Pakan kucing 50 karung"
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                          <input type="checkbox" checked={payNow} onChange={e => setPayNow(e.target.checked)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                          Sudah dibayar (sebagian/lunas) sekarang
                        </label>
                        {payNow && (
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Nominal Dibayar (Rp) <span className="text-red-500">*</span></label>
                            <input type="number" min="1" step="1" value={payNowAmount} onChange={e => setPayNowAmount(e.target.value)}
                              placeholder="Boleh sebagian saja"
                              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {(entryMode === 'biasa' || supplierSubMode === 'existing') && (
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

        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada input.</td></tr>
                ) : recent.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-sm text-slate-600">{new Date(r.transaction_date).toLocaleDateString('id-ID')}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{r.branches?.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{r.fin_cash_out_categories?.label}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(r.amount)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.fin_bank_accounts ? (r.fin_bank_accounts.account_type === 'tunai' ? r.fin_bank_accounts.bank_name : `${r.fin_bank_accounts.bank_name} — ${r.fin_bank_accounts.account_number}`) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
