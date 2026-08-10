'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'
import Link from 'next/link'

type Supplier = { id: string; name: string }
type Branch = { id: string; name: string }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_type: string }
type Purchase = {
  id: string
  supplier_id: string
  branch_id: string
  purchase_date: string
  total_amount: number
  description: string | null
  suppliers: { name: string } | null
  branches: { name: string } | null
}
type PaymentRow = { id: string; source_id: string; amount: number; status: string; transaction_date: string }

const ADMIN_ROLES = ['owner', 'hr', 'finance']

export default function PembelianSupplierPage() {
  const supabase = createClient()

  const [role, setRole] = useState<string>('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [myBranchName, setMyBranchName] = useState<string>('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const today = todayLocalStr()
  const thisMonth = today.slice(0, 7)
  const [filterMonth, setFilterMonth] = useState(thisMonth)
  const [filterBranch, setFilterBranch] = useState('')

  const isSupervisor = role === 'supervisor'
  const isAdmin = ADMIN_ROLES.includes(role)

  const [form, setForm] = useState({
    supplier_id: '', branch_id: '', purchase_date: today, total_amount: '', description: '',
    pay_now: false, pay_now_amount: '', account_id: '',
  })

  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null)
  const [editForm, setEditForm] = useState({ supplier_id: '', branch_id: '', purchase_date: '', total_amount: '', description: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [payPurchase, setPayPurchase] = useState<Purchase | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', payment_date: today, account_id: '', notes: '' })
  const [paySubmitting, setPaySubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let pQuery = supabase
      .from('supplier_purchases')
      .select('id, supplier_id, branch_id, purchase_date, total_amount, description, suppliers(name), branches(name)')
      .order('purchase_date', { ascending: false })
    if (!isAdmin && myBranchId) pQuery = pQuery.eq('branch_id', myBranchId)
    if (isAdmin && filterBranch) pQuery = pQuery.eq('branch_id', filterBranch)

    const { data: pData, error: pErr } = await pQuery
    if (pErr) console.error('Detail error purchases:', JSON.stringify(pErr, null, 2))
    const purchaseList = (pData as unknown as Purchase[]) || []
    setPurchases(purchaseList)

    if (purchaseList.length > 0) {
      const { data: payData, error: payErr } = await supabase
        .from('fin_cash_out')
        .select('id, source_id, amount, status, transaction_date')
        .eq('source_table', 'supplier_purchases')
        .in('source_id', purchaseList.map(p => p.id))
      if (payErr) console.error('Detail error payments:', JSON.stringify(payErr, null, 2))
      setPayments((payData as unknown as PaymentRow[]) || [])
    } else {
      setPayments([])
    }
    setLoading(false)
  }, [supabase, isAdmin, myBranchId, filterBranch])

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
            setForm(f => ({ ...f, branch_id: emp.branch_id }))
          }
        }
      }
      const { data: sRes } = await supabase.from('suppliers').select('id, name').eq('is_active', true).order('name')
      if (sRes) setSuppliers(sRes)
      const { data: bRes } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      if (bRes) setBranches(bRes)
      const { data: baRes } = await supabase
        .from('fin_bank_accounts').select('id, bank_name, account_number, account_type')
        .eq('is_active', true).order('account_type').order('bank_name')
      if (baRes) setBankAccounts(baRes)
    }
    init()
  }, [supabase])

  useEffect(() => { if (myUserId || role) fetchData() }, [myUserId, role, fetchData])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  function paidApproved(purchaseId: string) {
    return payments.filter(p => p.source_id === purchaseId && p.status === 'approved').reduce((s, p) => s + Number(p.amount), 0)
  }
  function paidPending(purchaseId: string) {
    return payments.filter(p => p.source_id === purchaseId && p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0)
  }
  function remainingOf(pur: Purchase) {
    return Number(pur.total_amount) - paidApproved(pur.id)
  }
  function statusBadge(pur: Purchase) {
    const remaining = remainingOf(pur)
    const paid = paidApproved(pur.id)
    if (remaining <= 0) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Lunas</span>
    if (paid > 0) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Dicicil Sebagian</span>
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Belum Dibayar</span>
  }

  const purchasesThisMonth = purchases.filter(p => p.purchase_date.slice(0, 7) === filterMonth)
  const totalPembelianBulanIni = purchasesThisMonth.reduce((s, p) => s + Number(p.total_amount), 0)
  const totalSisaUtang = purchases.reduce((s, p) => s + Math.max(0, remainingOf(p)), 0)
  const totalPendingVerifikasi = payments.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId) return
    const branchId = isSupervisor ? myBranchId : form.branch_id
    if (!branchId) { showMessage('error', 'Cabang wajib dipilih.'); return }
    if (!form.supplier_id) { showMessage('error', 'Supplier wajib dipilih.'); return }
    const totalNum = parseFloat(form.total_amount)
    if (isNaN(totalNum) || totalNum <= 0) { showMessage('error', 'Total tagihan tidak valid.'); return }

    let payNowNum = 0
    if (form.pay_now) {
      payNowNum = parseFloat(form.pay_now_amount)
      if (isNaN(payNowNum) || payNowNum <= 0) { showMessage('error', 'Nominal bayar sekarang tidak valid.'); return }
      if (payNowNum > totalNum) { showMessage('error', 'Nominal bayar tidak boleh lebih besar dari total tagihan.'); return }
      if (!form.account_id) { showMessage('error', 'Pilih rekening/kas untuk pembayaran.'); return }
    }

    setSubmitting(true)
    const { data: purchaseData, error } = await supabase.from('supplier_purchases').insert({
      supplier_id: form.supplier_id, branch_id: branchId, purchase_date: form.purchase_date,
      total_amount: totalNum, description: form.description || null, input_by: myUserId,
    }).select('id').single()

    if (error || !purchaseData) {
      showMessage('error', 'Gagal mencatat pembelian: ' + error?.message)
      setSubmitting(false)
      return
    }

    if (form.pay_now && payNowNum > 0) {
      const supplierName = suppliers.find(s => s.id === form.supplier_id)?.name || 'Supplier'
      const { error: payErr } = await supabase.from('fin_cash_out').insert({
        branch_id: branchId, category: 'pembayaran_supplier', amount: payNowNum,
        description: `Bayar ke ${supplierName}${form.description ? ' - ' + form.description : ''}`,
        source_table: 'supplier_purchases', source_id: purchaseData.id,
        transaction_date: form.purchase_date, account_id: form.account_id,
        input_by: myUserId, status: 'pending',
      })
      if (payErr) {
        showMessage('error', 'Pembelian tersimpan, tapi gagal mencatat pembayaran: ' + payErr.message)
        setSubmitting(false)
        fetchData()
        return
      }
    }

    showMessage('success', 'Pembelian berhasil dicatat, pembayaran (jika ada) menunggu verifikasi.')
    setForm(f => ({ ...f, total_amount: '', description: '', pay_now: false, pay_now_amount: '', account_id: '' }))
    fetchData()
    setSubmitting(false)
  }

  function openEditModal(p: Purchase) {
    setEditPurchase(p)
    setEditForm({
      supplier_id: p.supplier_id, branch_id: p.branch_id, purchase_date: p.purchase_date,
      total_amount: String(p.total_amount), description: p.description || '',
    })
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editPurchase) return
    const totalNum = parseFloat(editForm.total_amount)
    if (isNaN(totalNum) || totalNum <= 0) { showMessage('error', 'Total tagihan tidak valid.'); return }
    setEditSubmitting(true)
    const { error } = await supabase.from('supplier_purchases').update({
      supplier_id: editForm.supplier_id, branch_id: editForm.branch_id, purchase_date: editForm.purchase_date,
      total_amount: totalNum, description: editForm.description || null,
    }).eq('id', editPurchase.id)
    if (error) {
      showMessage('error', 'Gagal mengupdate pembelian: ' + error.message)
    } else {
      showMessage('success', 'Pembelian berhasil diperbarui.')
      setEditPurchase(null)
      fetchData()
    }
    setEditSubmitting(false)
  }

  async function handleDeletePurchase(p: Purchase) {
    const hasPayments = payments.some(pay => pay.source_id === p.id)
    if (hasPayments) {
      showMessage('error', 'Tidak bisa dihapus: pembelian ini sudah punya catatan pembayaran. Hapus/tolak dulu pembayarannya lewat Kas Keluar.')
      return
    }
    const ok = window.confirm(`Hapus pembelian dari ${p.suppliers?.name || 'supplier ini'} sebesar ${formatRupiah(p.total_amount)}?`)
    if (!ok) return
    const { error } = await supabase.from('supplier_purchases').delete().eq('id', p.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Pembelian berhasil dihapus.'); fetchData() }
  }

  function openPayModal(p: Purchase) {
    setPayPurchase(p)
    setPayForm({ amount: String(remainingOf(p)), payment_date: today, account_id: '', notes: '' })
  }

  async function handlePaySubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!payPurchase || !myUserId) return
    const amountNum = parseFloat(payForm.amount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Nominal tidak valid.'); return }
    const remaining = remainingOf(payPurchase)
    if (amountNum > remaining) { showMessage('error', `Nominal melebihi sisa utang (${formatRupiah(remaining)}).`); return }
    if (!payForm.account_id) { showMessage('error', 'Pilih rekening/kas.'); return }

    setPaySubmitting(true)
    const supplierName = payPurchase.suppliers?.name || 'Supplier'
    const { error } = await supabase.from('fin_cash_out').insert({
      branch_id: payPurchase.branch_id, category: 'pembayaran_supplier', amount: amountNum,
      description: `Cicilan/Bayar ke ${supplierName}${payPurchase.description ? ' - ' + payPurchase.description : ''}${payForm.notes ? ' (' + payForm.notes + ')' : ''}`,
      source_table: 'supplier_purchases', source_id: payPurchase.id,
      transaction_date: payForm.payment_date, account_id: payForm.account_id,
      input_by: myUserId, status: 'pending',
    })
    if (error) {
      showMessage('error', 'Gagal mencatat pembayaran: ' + error.message)
    } else {
      showMessage('success', 'Pembayaran berhasil dicatat, menunggu verifikasi.')
      setPayPurchase(null)
      fetchData()
    }
    setPaySubmitting(false)
  }

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Pembelian & Utang Supplier</h1>
          <p className="text-sm text-slate-500">Catat pembelian barang ke supplier (bisa lunas langsung atau dicicil). Ini bukan biaya operasional — hanya perputaran modal jadi barang.</p>
        </div>
        <Link href="/keuangan/pembelian/supplier" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
          🏭 Master Supplier
        </Link>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Catat Pembelian Baru</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier <span className="text-red-500">*</span></label>
              <select required value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">-- Pilih Supplier --</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">Belum ada di daftar? Tambah dulu lewat "Master Supplier".</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
              {isSupervisor ? (
                <div className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-600">{myBranchName || '—'}</div>
              ) : (
                <select required value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Pilih Cabang --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Pembelian <span className="text-red-500">*</span></label>
              <input type="date" required value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Total Tagihan (Rp) <span className="text-red-500">*</span></label>
              <input type="number" required min="1" step="1" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })}
                placeholder="Contoh: 5000000"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan Barang</label>
              <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Contoh: Pakan kucing 50 karung"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.pay_now} onChange={e => setForm({ ...form, pay_now: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Sudah dibayar (sebagian/lunas) sekarang
              </label>
              {form.pay_now && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nominal Dibayar (Rp) <span className="text-red-500">*</span></label>
                    <input type="number" min="1" step="1" value={form.pay_now_amount} onChange={e => setForm({ ...form, pay_now_amount: e.target.value })}
                      placeholder="Boleh sebagian saja"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Rekening/Kas <span className="text-red-500">*</span></label>
                    <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="">-- Pilih Rekening/Kas --</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <button type="submit" disabled={submitting}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
              {submitting ? 'Menyimpan...' : 'Simpan Pembelian'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Pembelian Bulan Ini</p>
              <p className="text-lg font-bold text-slate-800">{formatRupiah(totalPembelianBulanIni)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Sisa Utang Supplier (Saat Ini)</p>
              <p className={`text-lg font-bold ${totalSisaUtang > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatRupiah(totalSisaUtang)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Menunggu Verifikasi</p>
              <p className="text-lg font-bold text-yellow-700">{formatRupiah(totalPendingVerifikasi)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Bulan Pembelian</label>
                <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                  className="px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white" />
              </div>
              {isAdmin && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Cabang</label>
                  <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                    className="w-48 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white">
                    <option value="">Semua Cabang</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200 sticky top-0 z-10">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Tanggal</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Supplier</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Cabang</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white">Barang</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white">Total Tagihan</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white">Sudah Dibayar</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white">Sisa Utang</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center bg-white">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center bg-white">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchasesThisMonth.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pembelian bulan ini.</td></tr>
                  ) : purchasesThisMonth.map(p => {
                    const paid = paidApproved(p.id)
                    const pending = paidPending(p.id)
                    const remaining = remainingOf(p)
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm text-slate-600">{new Date(p.purchase_date).toLocaleDateString('id-ID')}</td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{p.suppliers?.name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{p.branches?.name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-500">{p.description || '—'}</td>
                        <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(p.total_amount)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-600">
                          {formatRupiah(paid)}
                          {pending > 0 && <div className="text-[10px] text-yellow-600">+{formatRupiah(pending)} menunggu</div>}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatRupiah(Math.max(0, remaining))}</td>
                        <td className="px-4 py-3 text-center">{statusBadge(p)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {remaining > 0 && (
                              <button onClick={() => openPayModal(p)} className="text-xs px-2.5 py-1 rounded border font-medium transition text-green-600 border-green-200 hover:bg-green-50">
                                Bayar/Cicil
                              </button>
                            )}
                            <button onClick={() => openEditModal(p)} className="text-xs px-2.5 py-1 rounded border font-medium transition text-blue-600 border-blue-200 hover:bg-blue-50">
                              Edit
                            </button>
                            <button onClick={() => handleDeletePurchase(p)} className="text-xs px-2.5 py-1 rounded border font-medium transition text-red-600 border-red-200 hover:bg-red-50">
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Edit Pembelian */}
      {editPurchase && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Pembelian</h2>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Supplier <span className="text-red-500">*</span></label>
                  <select required value={editForm.supplier_id} onChange={e => setEditForm({ ...editForm, supplier_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
                  <select required value={editForm.branch_id} onChange={e => setEditForm({ ...editForm, branch_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Pembelian <span className="text-red-500">*</span></label>
                  <input type="date" required value={editForm.purchase_date} onChange={e => setEditForm({ ...editForm, purchase_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total Tagihan (Rp) <span className="text-red-500">*</span></label>
                  <input type="number" required min="1" step="1" value={editForm.total_amount} onChange={e => setEditForm({ ...editForm, total_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {editPurchase && paidApproved(editPurchase.id) > 0 && (
                    <p className="text-[11px] text-amber-600 mt-1">Sudah ada pembayaran {formatRupiah(paidApproved(editPurchase.id))} disetujui untuk pembelian ini — pastikan total baru tidak lebih kecil dari itu.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Keterangan Barang</label>
                  <input type="text" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setEditPurchase(null)}
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

      {/* Modal Bayar/Cicil */}
      {payPurchase && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Bayar / Cicil ke {payPurchase.suppliers?.name}</h2>
              <p className="text-xs text-slate-500 mb-4 pb-3 border-b border-slate-100">
                Total tagihan {formatRupiah(payPurchase.total_amount)} — Sisa utang saat ini <span className="font-bold text-red-600">{formatRupiah(remainingOf(payPurchase))}</span>
              </p>
              <form onSubmit={handlePaySubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nominal Dibayar (Rp) <span className="text-red-500">*</span></label>
                  <input type="number" required min="1" step="1" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Bayar <span className="text-red-500">*</span></label>
                  <input type="date" required value={payForm.payment_date} onChange={e => setPayForm({ ...payForm, payment_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rekening/Kas <span className="text-red-500">*</span></label>
                  <select required value={payForm.account_id} onChange={e => setPayForm({ ...payForm, account_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih Rekening/Kas --</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Catatan</label>
                  <input type="text" value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })}
                    placeholder="Opsional"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setPayPurchase(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={paySubmitting}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                    {paySubmitting ? 'Menyimpan...' : 'Simpan Pembayaran'}
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
