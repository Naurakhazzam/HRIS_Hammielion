'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'
import RupiahInput from '@/components/RupiahInput'
import { paidApprovedFor, paidPendingFor, remainingFor, unrequestedFor } from '@/lib/supplierPurchases'
import Link from 'next/link'

type Branch = { id: string; name: string }
type BankAccount = { id: string; bank_name: string; account_number: string | null; account_type: string }
type Supplier = { id: string; name: string }
type Purchase = {
  id: string
  supplier_id: string
  branch_id: string
  purchase_date: string
  total_amount: number
  description: string | null
  invoice_number: string | null
  sj_number: string | null
  branches: { name: string } | null
}
type PaymentRow = { id: string; source_id: string; amount: number; status: string; transaction_date: string }

const ADMIN_ROLES = ['owner', 'hr', 'finance']
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  approved: { label: '✅ Disetujui', cls: 'text-green-700' },
  pending: { label: '⏳ Pending', cls: 'text-amber-600' },
  revisi: { label: '🔄 Revisi', cls: 'text-amber-600' },
  rejected: { label: '❌ Ditolak', cls: 'text-red-600' },
}

// Rujukan nota ditampilkan sebagai "Invoice / SJ" kalau keduanya/salah satunya diisi,
// fallback ke keterangan bebas (data lama sebelum kolom ini ada), lalu "—" kalau kosong semua.
function noteRefOf(p: { invoice_number: string | null; sj_number: string | null; description: string | null }) {
  const parts = [p.invoice_number, p.sj_number].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  return p.description || '—'
}

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
  const [filterBranch, setFilterBranch] = useState('')

  const isSupervisor = role === 'supervisor'
  const isAdmin = ADMIN_ROLES.includes(role)

  // ── Detail per supplier (satu-satunya pintu masuk tambah belanja & bayar hutang) ──
  const [detailSupplierId, setDetailSupplierId] = useState<string | null>(null)

  // ── Tambah Belanja ──
  const [showNewPurchaseModal, setShowNewPurchaseModal] = useState(false)
  const [form, setForm] = useState({
    branch_id: '', purchase_date: today, total_amount: '', invoice_number: '', sj_number: '', description: '',
    pay_now: false, pay_now_amount: '', account_id: '',
  })

  // ── Edit Belanja (dari baris ledger) ──
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null)
  const [editForm, setEditForm] = useState({ branch_id: '', purchase_date: '', total_amount: '', invoice_number: '', sj_number: '', description: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)

  // ── Bayar Hutang: hybrid FIFO (default) + pilih manual nota mana saja ──
  const [showPayModal, setShowPayModal] = useState(false)
  const [payQuickAmount, setPayQuickAmount] = useState('')
  const [paySelections, setPaySelections] = useState<Record<string, string>>({})
  const [payMeta, setPayMeta] = useState({ payment_date: today, account_id: '', notes: '' })
  const [paySubmitting, setPaySubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let pQuery = supabase
      .from('supplier_purchases')
      .select('id, supplier_id, branch_id, purchase_date, total_amount, description, invoice_number, sj_number, branches(name)')
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

  function paidApproved(purchaseId: string) { return paidApprovedFor(purchaseId, payments) }
  function paidPending(purchaseId: string) { return paidPendingFor(purchaseId, payments) }
  function remainingOf(pur: Purchase) { return remainingFor(pur.total_amount, pur.id, payments) }
  function unrequestedOf(pur: Purchase) { return unrequestedFor(pur.total_amount, pur.id, payments) }

  const purchasesThisMonth = purchases.filter(p => p.purchase_date.slice(0, 7) === thisMonth)
  const totalPembelianBulanIni = purchasesThisMonth.reduce((s, p) => s + Number(p.total_amount), 0)
  const totalSisaUtang = purchases.reduce((s, p) => s + Math.max(0, remainingOf(p)), 0)
  const totalPendingVerifikasi = payments.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0)

  // Rekap per supplier — SEMUA supplier aktif ditampilkan (bukan cuma yang punya sisa hutang),
  // supaya supplier baru tanpa transaksi tetap kelihatan & bisa diklik untuk belanja pertamanya.
  const supplierSummaries = suppliers
    .map(s => {
      const rows = purchases.filter(p => p.supplier_id === s.id)
      const totalUtang = rows.reduce((sum, p) => sum + Number(p.total_amount), 0)
      const totalDibayar = rows.reduce((sum, p) => sum + paidApproved(p.id), 0)
      const totalPending = rows.reduce((sum, p) => sum + paidPending(p.id), 0)
      const totalUnrequested = rows.reduce((sum, p) => sum + unrequestedOf(p), 0)
      const sisaUtang = totalUtang - totalDibayar
      return { supplierId: s.id, supplierName: s.name, jumlahTransaksi: rows.length, totalUtang, totalDibayar, totalPending, totalUnrequested, sisaUtang }
    })
    .sort((a, b) => b.sisaUtang - a.sisaUtang || a.supplierName.localeCompare(b.supplierName))

  const detailSummary = detailSupplierId ? supplierSummaries.find(s => s.supplierId === detailSupplierId) || null : null
  const detailPurchases = detailSupplierId
    ? purchases.filter(p => p.supplier_id === detailSupplierId).sort((a, b) => b.purchase_date.localeCompare(a.purchase_date))
    : []
  const detailPurchaseIds = new Set(detailPurchases.map(p => p.id))
  const detailPayments = payments.filter(pay => detailPurchaseIds.has(pay.source_id))

  type LedgerRow = {
    key: string; date: string; noteRef: string
    pembelian: number | null; pembayaran: number | null; status: string | null
  }
  const ledgerRows: LedgerRow[] = [
    ...detailPurchases.map(p => ({
      key: `beli-${p.id}`, date: p.purchase_date, noteRef: noteRefOf(p),
      pembelian: Number(p.total_amount), pembayaran: null, status: null,
    })),
    ...detailPayments.map(pay => {
      const p = detailPurchases.find(x => x.id === pay.source_id)
      return {
        key: `bayar-${pay.id}`, date: pay.transaction_date, noteRef: p ? noteRefOf(p) : '—',
        pembelian: null, pembayaran: Number(pay.amount), status: pay.status,
      }
    }),
  ].sort((a, b) => b.date.localeCompare(a.date))

  // Nota yang masih ada sisa belum diajukan — tertua duluan, dipakai baik untuk default FIFO
  // maupun daftar centang manual di modal Bayar Hutang.
  const outstandingForPay = [...detailPurchases]
    .filter(p => unrequestedOf(p) > 0)
    .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date))

  function openDetail(supplierId: string) { setDetailSupplierId(supplierId) }
  function closeDetail() {
    setDetailSupplierId(null)
    setShowNewPurchaseModal(false)
    setShowPayModal(false)
  }

  function openNewPurchaseModal() {
    setForm(f => ({
      ...f, purchase_date: today, total_amount: '', invoice_number: '', sj_number: '', description: '',
      pay_now: false, pay_now_amount: '', account_id: '',
    }))
    setShowNewPurchaseModal(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId || !detailSupplierId) return
    const branchId = isSupervisor ? myBranchId : form.branch_id
    if (!branchId) { showMessage('error', 'Cabang wajib dipilih.'); return }
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
      supplier_id: detailSupplierId, branch_id: branchId, purchase_date: form.purchase_date,
      total_amount: totalNum, invoice_number: form.invoice_number.trim() || null, sj_number: form.sj_number.trim() || null,
      description: form.description || null, input_by: myUserId,
    }).select('id').single()

    if (error || !purchaseData) {
      showMessage('error', 'Gagal mencatat pembelian: ' + error?.message)
      setSubmitting(false)
      return
    }

    if (form.pay_now && payNowNum > 0) {
      const supplierName = detailSummary?.supplierName || 'Supplier'
      const noteRef = [form.invoice_number, form.sj_number].filter(Boolean).join(' / ')
      const { error: payErr } = await supabase.from('fin_cash_out').insert({
        branch_id: branchId, category: 'pembayaran_supplier', amount: payNowNum,
        description: `Bayar ke ${supplierName}${noteRef ? ' - ' + noteRef : ''}`,
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
    setShowNewPurchaseModal(false)
    fetchData()
    setSubmitting(false)
  }

  function openEditModal(p: Purchase) {
    setEditPurchase(p)
    setEditForm({
      branch_id: p.branch_id, purchase_date: p.purchase_date, total_amount: String(p.total_amount),
      invoice_number: p.invoice_number || '', sj_number: p.sj_number || '', description: p.description || '',
    })
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editPurchase) return
    const totalNum = parseFloat(editForm.total_amount)
    if (isNaN(totalNum) || totalNum <= 0) { showMessage('error', 'Total tagihan tidak valid.'); return }
    setEditSubmitting(true)
    const { error } = await supabase.from('supplier_purchases').update({
      branch_id: editForm.branch_id, purchase_date: editForm.purchase_date,
      total_amount: totalNum, invoice_number: editForm.invoice_number.trim() || null, sj_number: editForm.sj_number.trim() || null,
      description: editForm.description || null,
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
    const ok = window.confirm(`Hapus pembelian ${noteRefOf(p)} sebesar ${formatRupiah(p.total_amount)}?`)
    if (!ok) return
    const { error } = await supabase.from('supplier_purchases').delete().eq('id', p.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Pembelian berhasil dihapus.'); fetchData() }
  }

  // ── Bayar Hutang ──
  function openPayModal() {
    setPayQuickAmount('')
    setPaySelections({})
    setPayMeta({ payment_date: today, account_id: '', notes: '' })
    setShowPayModal(true)
  }

  // Default cepat: isi nominal total, otomatis dicentang dari nota TERTUA dulu (FIFO) sampai
  // nominalnya terpenuhi. Tetap bisa diubah manual sesudahnya (centang/bongkar sendiri).
  function applyQuickAmount(value: string) {
    setPayQuickAmount(value)
    const amountNum = parseFloat(value)
    if (isNaN(amountNum) || amountNum <= 0) { setPaySelections({}); return }
    let sisa = amountNum
    const next: Record<string, string> = {}
    for (const p of outstandingForPay) {
      if (sisa <= 0) break
      const portion = Math.min(sisa, unrequestedOf(p))
      next[p.id] = String(portion)
      sisa -= portion
    }
    setPaySelections(next)
  }

  function toggleNota(p: Purchase) {
    setPaySelections(prev => {
      const next = { ...prev }
      if (next[p.id] !== undefined) delete next[p.id]
      else next[p.id] = String(unrequestedOf(p))
      return next
    })
  }

  function setNotaAmount(purchaseId: string, value: string) {
    setPaySelections(prev => ({ ...prev, [purchaseId]: value }))
  }

  const paySelectedTotal = Object.values(paySelections).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  async function handlePaySubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId || !detailSupplierId) return
    if (!payMeta.account_id) { showMessage('error', 'Pilih rekening/kas.'); return }

    const entries = Object.entries(paySelections).filter(([, v]) => (parseFloat(v) || 0) > 0)
    if (entries.length === 0) { showMessage('error', 'Pilih minimal satu nota dan isi nominalnya.'); return }

    for (const [purchaseId, v] of entries) {
      const p = detailPurchases.find(x => x.id === purchaseId)
      if (!p) continue
      if (parseFloat(v) > unrequestedOf(p)) {
        showMessage('error', `Nominal untuk ${noteRefOf(p)} melebihi sisa yang belum diajukan (${formatRupiah(unrequestedOf(p))}).`)
        return
      }
    }

    const supplierName = detailSummary?.supplierName || 'Supplier'
    const rows = entries.map(([purchaseId, v]) => {
      const p = detailPurchases.find(x => x.id === purchaseId)!
      return {
        branch_id: p.branch_id, category: 'pembayaran_supplier', amount: parseFloat(v),
        description: `Bayar ke ${supplierName} - ${noteRefOf(p)}${payMeta.notes ? ' (' + payMeta.notes + ')' : ''}`,
        source_table: 'supplier_purchases', source_id: p.id,
        transaction_date: payMeta.payment_date, account_id: payMeta.account_id,
        input_by: myUserId, status: 'pending',
      }
    })

    setPaySubmitting(true)
    const { error } = await supabase.from('fin_cash_out').insert(rows)
    if (error) {
      showMessage('error', 'Gagal mencatat pembayaran: ' + error.message)
    } else {
      showMessage('success', `Pembayaran dicatat ke ${rows.length} nota, menunggu verifikasi.`)
      setShowPayModal(false)
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
          <p className="text-sm text-slate-500">Klik supplier untuk lihat riwayat lengkap, tambah belanja, atau bayar hutang. Ini bukan biaya operasional — hanya perputaran modal jadi barang.</p>
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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

      {isAdmin && (
        <div className="mb-4">
          <label className="block text-xs text-slate-500 mb-1">Cabang</label>
          <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
            className="w-48 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white">
            <option value="">Semua Cabang</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <span className="text-sm font-semibold text-slate-700">Daftar Supplier</span>
          <p className="text-xs text-slate-400 mt-0.5">Klik &quot;Detail&quot; untuk lihat riwayat lengkap, tambah belanja, atau bayar hutang per supplier.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Supplier</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Jml Transaksi</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Utang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Dibayar</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Menunggu Verifikasi</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Sisa Utang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplierSummaries.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada supplier aktif. Tambah dulu lewat Master Supplier.</td></tr>
              ) : supplierSummaries.map(s => (
                <tr key={s.supplierId} className="hover:bg-slate-50 transition cursor-pointer" onClick={() => openDetail(s.supplierId)}>
                  <td className="px-4 py-3 font-medium text-slate-800">{s.supplierName}</td>
                  <td className="px-4 py-3 text-center text-slate-500">{s.jumlahTransaksi}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatRupiah(s.totalUtang)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatRupiah(s.totalDibayar)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{s.totalPending > 0 ? formatRupiah(s.totalPending) : '—'}</td>
                  <td className={`px-4 py-3 text-right font-bold ${s.sisaUtang > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatRupiah(s.sisaUtang)}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={e => { e.stopPropagation(); openDetail(s.supplierId) }}
                      className="text-xs px-2.5 py-1 rounded border font-medium transition text-blue-600 border-blue-200 hover:bg-blue-50">
                      Detail →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════════ Modal Detail Supplier ══════════ */}
      {detailSupplierId && detailSummary && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4 pb-3 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-800">{detailSummary.supplierName}</h2>
                <button onClick={closeDetail} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                <button onClick={openNewPurchaseModal}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition">
                  <span className="text-base leading-none">+</span> Tambah Belanja
                </button>
                <button onClick={openPayModal} disabled={outstandingForPay.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
                  💰 Bayar Hutang
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-[11px] text-slate-500 font-medium uppercase mb-1">Total Belanja</p>
                  <p className="text-base font-bold text-slate-800">{formatRupiah(detailSummary.totalUtang)}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-[11px] text-slate-500 font-medium uppercase mb-1">Total Pembayaran</p>
                  <p className="text-base font-bold text-green-700">{formatRupiah(detailSummary.totalDibayar)}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-[11px] text-slate-500 font-medium uppercase mb-1">Total Sisa Hutang</p>
                  <p className={`text-base font-bold ${detailSummary.sisaUtang > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatRupiah(detailSummary.sisaUtang)}</p>
                </div>
              </div>
              {detailSummary.totalPending > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                  ⏳ {formatRupiah(detailSummary.totalPending)} pembayaran masih menunggu verifikasi Finance — belum ikut mengurangi Sisa Hutang di atas.
                </p>
              )}

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Nota / SJ</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Pembelian</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Pembayaran</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerRows.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400 text-sm">Belum ada transaksi.</td></tr>
                    ) : ledgerRows.map(r => (
                      <tr key={r.key} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{new Date(r.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                        <td className="px-3 py-2 text-slate-700">{r.noteRef}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">{r.pembelian !== null ? formatRupiah(r.pembelian) : '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">{r.pembayaran !== null ? formatRupiah(r.pembayaran) : '—'}</td>
                        <td className="px-3 py-2">
                          {r.status ? (
                            <span className={`text-xs font-medium ${STATUS_LABEL[r.status]?.cls || 'text-slate-500'}`}>{STATUS_LABEL[r.status]?.label || r.status}</span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detailPurchases.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-slate-500 mb-2">Kelola pembelian (edit/hapus nota tertentu):</p>
                  <div className="flex flex-wrap gap-2">
                    {detailPurchases.map(p => (
                      <div key={p.id} className="flex items-center gap-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                        <span className="text-slate-600">{noteRefOf(p)}</span>
                        <button onClick={() => openEditModal(p)} className="text-blue-600 hover:underline ml-1">Edit</button>
                        <button onClick={() => handleDeletePurchase(p)} className="text-red-600 hover:underline">Hapus</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah Belanja */}
      {showNewPurchaseModal && detailSupplierId && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Tambah Belanja</h2>
              <p className="text-xs text-slate-500 mb-4 pb-2 border-b border-slate-100">untuk {detailSummary?.supplierName}</p>
              <form onSubmit={handleSubmit} className="space-y-4">
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Invoice</label>
                    <input type="text" value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })}
                      placeholder="Contoh: INV-0123"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nomor SJ</label>
                    <input type="text" value={form.sj_number} onChange={e => setForm({ ...form, sj_number: e.target.value })}
                      placeholder="Contoh: SJ-0456"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Total Tagihan (Rp) <span className="text-red-500">*</span></label>
                  <RupiahInput required value={form.total_amount} onChange={v => setForm({ ...form, total_amount: v })}
                    placeholder="Contoh: 5.000.000"
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
                    Sudah dibayar (sebagian/lunas) sekarang — kalau belum, biarkan tidak dicentang (tercatat sebagai utang)
                  </label>
                  {form.pay_now && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Nominal Dibayar (Rp) <span className="text-red-500">*</span></label>
                        <RupiahInput value={form.pay_now_amount} onChange={v => setForm({ ...form, pay_now_amount: v })}
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

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowNewPurchaseModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={submitting}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                    {submitting ? 'Menyimpan...' : 'Simpan Pembelian'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Pembelian */}
      {editPurchase && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Edit Pembelian</h2>
              <form onSubmit={handleEditSubmit} className="space-y-4">
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nomor Invoice</label>
                    <input type="text" value={editForm.invoice_number} onChange={e => setEditForm({ ...editForm, invoice_number: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nomor SJ</label>
                    <input type="text" value={editForm.sj_number} onChange={e => setEditForm({ ...editForm, sj_number: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total Tagihan (Rp) <span className="text-red-500">*</span></label>
                  <RupiahInput required value={editForm.total_amount} onChange={v => setEditForm({ ...editForm, total_amount: v })}
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

      {/* Modal Bayar Hutang — hybrid: isi nominal total untuk auto-centang FIFO (tertua dulu),
          atau centang/bongkar & ubah nominal manual per nota. */}
      {showPayModal && detailSupplierId && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Bayar Hutang ke {detailSummary?.supplierName}</h2>
              <p className="text-xs text-slate-500 mb-4 pb-3 border-b border-slate-100">
                Isi nominal total untuk otomatis dicentang dari nota tertua, atau centang/ubah sendiri nota mana yang mau dibayar.
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Nominal Total (opsional, buat isi cepat)</label>
                <RupiahInput value={payQuickAmount} onChange={applyQuickAmount}
                  placeholder="Isi untuk auto-centang dari nota tertua"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase w-8"></th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Nota</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Sisa</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Nominal Dibayar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {outstandingForPay.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400 text-sm">Tidak ada nota yang bisa dibayar.</td></tr>
                    ) : outstandingForPay.map(p => {
                      const checked = paySelections[p.id] !== undefined
                      return (
                        <tr key={p.id} className={checked ? 'bg-blue-50/50' : ''}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={checked} onChange={() => toggleNota(p)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {noteRefOf(p)}
                            <div className="text-[11px] text-slate-400">{new Date(p.purchase_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">{formatRupiah(unrequestedOf(p))}</td>
                          <td className="px-3 py-2 text-right">
                            {checked ? (
                              <RupiahInput value={paySelections[p.id]} onChange={v => setNotaAmount(p.id, v)}
                                className="w-32 px-2 py-1 border border-slate-300 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-sm text-slate-600 mb-4">Total dibayar: <span className="font-bold text-slate-800">{formatRupiah(paySelectedTotal)}</span></p>

              <form onSubmit={handlePaySubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Bayar <span className="text-red-500">*</span></label>
                  <input type="date" required value={payMeta.payment_date} onChange={e => setPayMeta({ ...payMeta, payment_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rekening/Kas <span className="text-red-500">*</span></label>
                  <select required value={payMeta.account_id} onChange={e => setPayMeta({ ...payMeta, account_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih Rekening/Kas --</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.account_type === 'tunai' ? a.bank_name : `${a.bank_name} — ${a.account_number}`}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">Setelah diverifikasi Finance, saldo rekening ini otomatis berkurang di Cash Flow.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Catatan</label>
                  <input type="text" value={payMeta.notes} onChange={e => setPayMeta({ ...payMeta, notes: e.target.value })}
                    placeholder="Opsional"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowPayModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
                    Batal
                  </button>
                  <button type="submit" disabled={paySubmitting || paySelectedTotal <= 0}
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
