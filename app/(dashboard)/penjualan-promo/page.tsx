'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient } from '@/lib/previewMode'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import { uploadReportPhotos, signedPhotoUrls, fmtDate, fmtDateTime } from '@/lib/meeting'

type Branch = { id: string; name: string }
type Emp = { id: string; full_name: string; branch_id: string | null }
type ReportStatus = 'pending' | 'approved' | 'rejected'
type AdminRow = {
  product_id: string; branch_id: string; branch_name: string; product_name: string
  target_qty: number | null; total_qty: number; pending_count: number; achievement_pct: number | null; is_active: boolean
  bonus_rate_reached: number | null; bonus_rate_below: number | null; target_employee_ids: string[] | null
  bonus_percent: number | null; price_options: number[] | null; max_late_days: number | null
}
type ReportRow = {
  id: string; employee_id: string; full_name: string; qty: number; receipt_photo_paths: string[]
  report_date: string; notes: string | null; status: ReportStatus; rejection_reason: string | null; created_at: string; is_late: boolean
  unit_price: number | null; original_qty: number | null; original_unit_price: number | null; edited_by_name: string | null; edited_at: string | null
}
type MyProgress = {
  product_id: string; product_name: string; target_qty: number | null; total_qty: number; my_qty: number; my_pending_qty: number
  bonus_percent: number | null; price_options: number[] | null; max_late_days: number | null
}

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const emptyForm = {
  id: null as string | null, branch_id: '', product_name: '', target_qty: '', period_month: 1, period_year: 2026, is_active: true,
  bonus_rate_reached: '', bonus_rate_below: '', restrict_employees: false, target_employee_ids: [] as string[],
  bonus_mode_percent: false, bonus_percent: '', price_options: [] as number[], max_late_days: '',
}
const PRICE_OPTION_CHOICES = [40000, 50000, 55000, 75000, 100000]
const toISODate = (d: Date) => d.toISOString().slice(0, 10)
const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

export default function PenjualanPromoPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const today = new Date()
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canReview, setCanReview] = useState(false) // owner/hr/finance -- boleh approve/reject laporan
  const [branches, setBranches] = useState<Branch[]>([])
  const [employees, setEmployees] = useState<Emp[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Admin state
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  const [filterBranch, setFilterBranch] = useState('')
  const [adminRows, setAdminRows] = useState<AdminRow[]>([])
  const [loadingAdmin, setLoadingAdmin] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [rejectFor, setRejectFor] = useState<ReportRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editFor, setEditFor] = useState<ReportRow | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editUnitPrice, setEditUnitPrice] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Sinkron bonus ke penggajian
  const [syncEmployeeId, setSyncEmployeeId] = useState('')
  const [syncPreview, setSyncPreview] = useState<number | null>(null)
  const [syncLoadingPreview, setSyncLoadingPreview] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Employee state
  const [myProgress, setMyProgress] = useState<MyProgress[]>([])
  const [myBonus, setMyBonus] = useState<number | null>(null)
  const [loadingMine, setLoadingMine] = useState(true)
  const [reportModal, setReportModal] = useState<MyProgress | null>(null)
  const [rQty, setRQty] = useState('')
  const [rDate, setRDate] = useState(() => toISODate(new Date()))
  const [rUnitPrice, setRUnitPrice] = useState('')
  const [rFiles, setRFiles] = useState<File[]>([])
  const [rNotes, setRNotes] = useState('')
  const [rSaving, setRSaving] = useState(false)
  const [rError, setRError] = useState('')

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const fetchMine = useCallback(async () => {
    setLoadingMine(true)
    const [{ data, error }, { data: periodData }] = await Promise.all([
      supabase.rpc('get_my_promo_sales_progress'),
      supabase.rpc('current_payroll_period'),
    ])
    if (error) console.error('get_my_promo_sales_progress:', error.message)
    setMyProgress((data as MyProgress[]) || [])
    const period = Array.isArray(periodData) ? periodData[0] : periodData
    if (period?.period_end) {
      const end = new Date(period.period_end)
      const { data: myEmp } = await supabase.from('users').select('employee_id').eq('id', (await supabase.auth.getUser()).data.user?.id ?? '').single()
      if (myEmp?.employee_id) {
        const { data: bonus } = await supabase.rpc('get_employee_promo_bonus', {
          p_employee_id: myEmp.employee_id, p_period_month: end.getMonth() + 1, p_period_year: end.getFullYear(),
        })
        setMyBonus(bonus == null ? null : Number(bonus))
      }
    }
    setLoadingMine(false)
  }, [supabase])

  const fetchAdmin = useCallback(async () => {
    setLoadingAdmin(true)
    const { data, error } = await supabase.rpc('get_promo_sales_admin', {
      p_period_month: filterMonth, p_period_year: filterYear, p_branch_id: filterBranch || null,
    })
    if (error) console.error('get_promo_sales_admin:', error.message)
    setAdminRows((data as AdminRow[]) || [])
    setLoadingAdmin(false)
  }, [supabase, filterMonth, filterYear, filterBranch])

  useEffect(() => {
    async function init() {
      const preview = isPreviewModeClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
      const role = userData?.role ?? ''
      const admin = ['owner', 'hr'].includes(role) && !preview
      const review = ['owner', 'hr', 'finance'].includes(role) && !preview
      setIsAdmin(admin)
      setCanReview(review)
      const { data: bData } = await supabase.from('branches').select('id,name').order('name')
      setBranches((bData as Branch[]) || [])
      if (review) {
        const { data: eData } = await supabase.from('employees').select('id,full_name,branch_id').eq('is_active', true).order('full_name')
        setEmployees((eData as Emp[]) || [])
        await fetchAdmin()
      } else {
        await fetchMine()
      }
      setReady(true)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Refetch tiap kali filter periode/cabang berubah (fetchAdmin identitasnya ikut berubah
    // karena bergantung ke filterMonth/filterYear/filterBranch) -- pola sinkron-ke-server standar,
    // bukan state lokal, jadi aman dipanggil langsung di sini.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready && canReview) fetchAdmin()
  }, [ready, canReview, fetchAdmin])

  function openNew() {
    setForm({ ...emptyForm, period_month: filterMonth, period_year: filterYear, branch_id: filterBranch })
    setFormError('')
    setShowForm(true)
  }

  async function openEditProduct(row: AdminRow) {
    setForm({
      id: row.product_id, branch_id: row.branch_id, product_name: row.product_name, target_qty: row.target_qty === null ? '' : String(row.target_qty),
      period_month: filterMonth, period_year: filterYear, is_active: row.is_active,
      bonus_rate_reached: row.bonus_rate_reached === null ? '' : String(row.bonus_rate_reached),
      bonus_rate_below: row.bonus_rate_below === null ? '' : String(row.bonus_rate_below),
      restrict_employees: !!(row.target_employee_ids && row.target_employee_ids.length > 0),
      target_employee_ids: row.target_employee_ids ?? [],
      bonus_mode_percent: row.bonus_percent !== null,
      bonus_percent: row.bonus_percent === null ? '' : String(row.bonus_percent),
      price_options: row.price_options ?? [],
      max_late_days: row.max_late_days === null ? '' : String(row.max_late_days),
    })
    setFormError('')
    setShowForm(true)
  }

  function toggleTargetEmployee(id: string) {
    setForm(f => ({
      ...f,
      target_employee_ids: f.target_employee_ids.includes(id)
        ? f.target_employee_ids.filter(x => x !== id)
        : [...f.target_employee_ids, id],
    }))
  }

  function togglePriceOption(v: number) {
    setForm(f => ({
      ...f,
      price_options: f.price_options.includes(v) ? f.price_options.filter(x => x !== v) : [...f.price_options, v].sort((a, b) => a - b),
    }))
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!form.branch_id) { setFormError('Pilih cabang.'); return }
    if (!form.product_name.trim()) { setFormError('Nama produk wajib diisi.'); return }
    if (form.restrict_employees && form.target_employee_ids.length === 0) { setFormError('Pilih minimal satu karyawan, atau matikan opsi "khusus karyawan tertentu".'); return }

    let qty: number | null = null
    let bonusPercent: number | null = null
    if (form.bonus_mode_percent) {
      bonusPercent = parseFloat(form.bonus_percent)
      if (!bonusPercent || bonusPercent <= 0 || bonusPercent > 100) { setFormError('Persentase bonus harus antara 0-100.'); return }
      if (form.price_options.length === 0) { setFormError('Pilih minimal satu opsi harga.'); return }
    } else {
      qty = parseFloat(form.target_qty)
      if (!qty || qty <= 0) { setFormError('Target qty harus lebih dari 0.'); return }
    }
    const maxLateDays = form.max_late_days.trim() ? parseInt(form.max_late_days, 10) : null

    setSaving(true)
    const { error } = await supabase.rpc('save_promo_product', {
      p_id: form.id, p_branch_id: form.branch_id, p_product_name: form.product_name.trim(), p_target_qty: qty,
      p_period_month: form.period_month, p_period_year: form.period_year, p_is_active: form.is_active,
      p_bonus_rate_reached: form.bonus_mode_percent ? null : (form.bonus_rate_reached.trim() ? parseFloat(form.bonus_rate_reached) : null),
      p_bonus_rate_below: form.bonus_mode_percent ? null : (form.bonus_rate_below.trim() ? parseFloat(form.bonus_rate_below) : null),
      p_target_employee_ids: form.restrict_employees ? form.target_employee_ids : null,
      p_bonus_percent: bonusPercent,
      p_price_options: form.bonus_mode_percent ? form.price_options : null,
      p_max_late_days: maxLateDays,
    })
    setSaving(false)
    if (error) { setFormError('Gagal menyimpan: ' + error.message); return }
    setShowForm(false)
    showMessage('success', form.id ? 'Produk diperbarui.' : 'Produk promo ditambahkan.')
    fetchAdmin()
  }

  async function loadReports(productId: string) {
    setLoadingReports(true)
    const { data, error } = await supabase.rpc('get_promo_sales_reports', { p_promo_product_id: productId })
    if (error) { showMessage('error', 'Gagal memuat laporan: ' + error.message); setLoadingReports(false); return }
    const rows = (data as ReportRow[]) || []
    setReports(rows)
    if (rows.length > 0) setPhotoUrls(await signedPhotoUrls(supabase, rows.flatMap(r => r.receipt_photo_paths)))
    setLoadingReports(false)
  }

  async function toggleExpand(row: AdminRow) {
    if (expanded === row.product_id) { setExpanded(null); return }
    setExpanded(row.product_id)
    await loadReports(row.product_id)
  }

  async function approveReport(r: ReportRow) {
    const { error } = await supabase.rpc('review_promo_sales_report', { p_report_id: r.id, p_status: 'approved', p_reason: null })
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    showMessage('success', 'Laporan disetujui.')
    if (expanded) await loadReports(expanded)
    fetchAdmin()
  }

  async function confirmReject() {
    if (!rejectFor) return
    if (rejectReason.trim().length < 3) { showMessage('error', 'Alasan wajib diisi.'); return }
    const { error } = await supabase.rpc('review_promo_sales_report', { p_report_id: rejectFor.id, p_status: 'rejected', p_reason: rejectReason.trim() })
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    setRejectFor(null); setRejectReason('')
    showMessage('success', 'Laporan ditolak.')
    if (expanded) await loadReports(expanded)
    fetchAdmin()
  }

  function openEditReport(r: ReportRow) {
    setEditFor(r)
    setEditQty(String(r.qty))
    setEditUnitPrice(r.unit_price === null ? '' : String(r.unit_price))
    setEditError('')
  }

  async function confirmEditReport() {
    if (!editFor) return
    setEditError('')
    const qty = parseFloat(editQty)
    if (!qty || qty <= 0) { setEditError('Qty harus lebih dari 0.'); return }
    setEditSaving(true)
    const { error } = await supabase.rpc('edit_promo_sales_report', {
      p_report_id: editFor.id, p_qty: qty, p_unit_price: editUnitPrice ? parseFloat(editUnitPrice) : null,
    })
    setEditSaving(false)
    if (error) { setEditError('Gagal: ' + error.message); return }
    setEditFor(null)
    showMessage('success', 'Laporan dikoreksi.')
    if (expanded) await loadReports(expanded)
    fetchAdmin()
  }

  async function resetToPending(r: ReportRow) {
    const { error } = await supabase.rpc('review_promo_sales_report', { p_report_id: r.id, p_status: 'pending', p_reason: null })
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    showMessage('success', 'Dikembalikan ke menunggu review.')
    if (expanded) await loadReports(expanded)
    fetchAdmin()
  }

  async function previewSyncBonus() {
    if (!syncEmployeeId) return
    setSyncLoadingPreview(true)
    const { data, error } = await supabase.rpc('get_employee_promo_bonus', {
      p_employee_id: syncEmployeeId, p_period_month: filterMonth, p_period_year: filterYear,
    })
    setSyncLoadingPreview(false)
    if (error) { showMessage('error', 'Gagal menghitung: ' + error.message); return }
    setSyncPreview(Number(data))
  }

  async function doSyncBonus() {
    if (!syncEmployeeId) return
    setSyncing(true)
    const { data, error } = await supabase.rpc('sync_promo_bonus_to_payroll', {
      p_employee_id: syncEmployeeId, p_period_month: filterMonth, p_period_year: filterYear,
    })
    setSyncing(false)
    if (error) { showMessage('error', 'Gagal sinkron: ' + error.message); return }
    showMessage('success', `Bonus ${fmtRp(Number(data))} tersinkron ke slip gaji draft.`)
    setSyncPreview(null)
  }

  function openReport(product: MyProgress) {
    setReportModal(product)
    setRQty(''); setRFiles([]); setRNotes(''); setRError(''); setRDate(toISODate(new Date())); setRUnitPrice('')
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault()
    setRError('')
    if (!reportModal) return
    const qty = parseFloat(rQty)
    if (!qty || qty <= 0) { setRError('Isi qty dulu.'); return }
    if (rFiles.length === 0) { setRError('Foto struk wajib dilampirkan.'); return }
    if (!rDate) { setRError('Isi tanggal struk/nota.'); return }
    if (reportModal.price_options?.length) {
      if (!rUnitPrice) { setRError('Pilih harga layanan dulu.'); return }
    }
    if (reportModal.max_late_days !== null) {
      const diffDays = Math.round((new Date(toISODate(new Date())).getTime() - new Date(rDate).getTime()) / 86400000)
      if (diffDays > reportModal.max_late_days) {
        setRError(`Tanggal struk tidak valid -- sudah ${diffDays} hari sejak tanggal nota (maks H+${reportModal.max_late_days}).`)
        return
      }
    }
    setRSaving(true)
    try {
      const paths = await uploadReportPhotos(supabase, 'promo-' + reportModal.product_id, rFiles)
      const { error } = await supabase.rpc('submit_promo_sales_report', {
        p_promo_product_id: reportModal.product_id, p_qty: qty, p_photo_paths: paths, p_notes: rNotes.trim() || null,
        p_report_date: rDate, p_unit_price: rUnitPrice ? parseFloat(rUnitPrice) : null,
      })
      if (error) throw new Error(error.message)
      setReportModal(null)
      showMessage('success', 'Laporan terkirim, menunggu verifikasi Finance.')
      fetchMine()
    } catch (err: unknown) {
      setRError(err instanceof Error ? err.message : 'Gagal mengirim laporan')
    }
    setRSaving(false)
  }

  const STATUS_BADGE: Record<ReportStatus, string> = {
    pending: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-600',
  }
  const STATUS_LABEL: Record<ReportStatus, string> = { pending: 'MENUNGGU', approved: 'DISETUJUI', rejected: 'DITOLAK' }

  if (!ready) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">🎯 Target Penjualan Promo</h1>
          <p className="text-sm text-slate-500">
            {canReview ? 'Kelola target produk promo & verifikasi laporan penjualan karyawan.' : 'Laporkan penjualan produk promo dengan foto struk.'}
          </p>
        </div>
        {isAdmin && (
          <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition shrink-0">
            <span className="text-base leading-none">+</span> Produk Baru
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>
      )}

      {canReview ? (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
                <div className="flex gap-2">
                  <select value={filterMonth} onChange={e => setFilterMonth(+e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <input type="number" value={filterYear} onChange={e => setFilterYear(+e.target.value)} className="w-20 px-3 py-2 border border-slate-300 rounded text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cabang</label>
                <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm bg-white w-44">
                  <option value="">Semua Cabang</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <h2 className="text-sm font-bold text-slate-800 mb-1">💰 Sinkron Bonus ke Penggajian</h2>
            <p className="text-xs text-slate-500 mb-3">Bonus dihitung dari laporan yang sudah <strong>disetujui</strong> saja. Sinkron hanya berhasil kalau slip gaji karyawan periode ini masih Draft.</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Karyawan</label>
                <select value={syncEmployeeId} onChange={e => { setSyncEmployeeId(e.target.value); setSyncPreview(null) }} className="px-3 py-2 border border-slate-300 rounded text-sm bg-white w-56">
                  <option value="">-- Pilih karyawan --</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <button onClick={previewSyncBonus} disabled={!syncEmployeeId || syncLoadingPreview} className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg disabled:opacity-50">
                {syncLoadingPreview ? 'Menghitung...' : 'Hitung Bonus'}
              </button>
              {syncPreview !== null && (
                <>
                  <span className="text-sm font-bold text-blue-600 px-2">{fmtRp(syncPreview)}</span>
                  <button onClick={doSyncBonus} disabled={syncing} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                    {syncing ? 'Menyinkron...' : 'Sinkron ke Slip Gaji'}
                  </button>
                </>
              )}
            </div>
          </div>

          {loadingAdmin ? (
            <div className="py-10 text-center text-slate-500">Memuat...</div>
          ) : adminRows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada produk promo untuk periode ini. {isAdmin && 'Klik "Produk Baru" untuk mulai.'}</div>
          ) : (
            <div className="space-y-3">
              {adminRows.map(row => {
                const hasBonus = row.bonus_rate_reached !== null || row.bonus_rate_below !== null
                const isPercentMode = row.bonus_percent !== null
                const targetNames = row.target_employee_ids?.length
                  ? row.target_employee_ids.map(id => employees.find(e => e.id === id)?.full_name ?? '?').join(', ')
                  : null
                return (
                  <div key={row.product_id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <span className="text-sm font-semibold text-slate-800">{row.product_name}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">{row.branch_name}</span>
                            {row.pending_count > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">{row.pending_count} MENUNGGU</span>}
                            {!row.is_active && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">NONAKTIF</span>}
                            {targetNames && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">👤 KHUSUS KARYAWAN</span>}
                          </div>
                          <p className="text-xs text-slate-500">
                            {isPercentMode ? <>Qty terlapor (disetujui): {row.total_qty} · tanpa target</> : <>Target: {row.target_qty} · Terlapor (disetujui): {row.total_qty}</>}
                          </p>
                          {targetNames && <p className="text-xs text-indigo-600 mt-0.5">Khusus untuk: {targetNames}</p>}
                          {hasBonus && (
                            <p className="text-xs text-purple-700 mt-0.5">
                              Bonus/pcs: {row.bonus_rate_reached !== null ? fmtRp(row.bonus_rate_reached) : '-'} (tercapai) / {row.bonus_rate_below !== null ? fmtRp(row.bonus_rate_below) : '-'} (belum tercapai)
                            </p>
                          )}
                          {isPercentMode && (
                            <p className="text-xs text-purple-700 mt-0.5">
                              Bonus: {row.bonus_percent}% dari harga · Pilihan harga: {row.price_options?.map(p => fmtRp(p)).join(', ')}
                              {row.max_late_days !== null && <> · Maks H+{row.max_late_days} dari tanggal nota</>}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {row.achievement_pct !== null && (
                            <span className={`text-sm font-bold px-2 py-0.5 rounded ${row.achievement_pct >= 80 ? 'bg-green-100 text-green-700' : row.achievement_pct >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>{row.achievement_pct}%</span>
                          )}
                          {isAdmin && <button onClick={() => openEditProduct(row)} className="text-xs px-2.5 py-1 rounded border font-medium text-blue-600 border-blue-200 hover:bg-blue-50">Edit</button>}
                        </div>
                      </div>
                      {row.achievement_pct !== null && (
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
                          <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, row.achievement_pct)}%` }} />
                        </div>
                      )}
                      <button onClick={() => toggleExpand(row)} className="mt-3 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 transition">
                        {expanded === row.product_id ? 'Tutup Laporan ▲' : `Lihat Laporan ▼`}
                      </button>
                    </div>
                    {expanded === row.product_id && (
                      <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                        {loadingReports ? (
                          <div className="py-4 text-center text-slate-400 text-sm">Memuat...</div>
                        ) : reports.length === 0 ? (
                          <div className="py-4 text-center text-slate-400 text-sm">Belum ada laporan.</div>
                        ) : (
                          <div className="space-y-2">
                            {reports.map(r => (
                              <div key={r.id} className={`rounded-lg border px-3 py-2 ${r.status === 'rejected' ? 'bg-red-50 border-red-200' : r.status === 'pending' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">{r.full_name} <span className="font-normal text-slate-500">-- qty {r.qty}{r.unit_price !== null && <> @ {fmtRp(r.unit_price)}</>}</span></p>
                                    <p className="text-[11px] text-slate-400">
                                      Nota: {fmtDate(r.report_date)} · dikirim {fmtDateTime(r.created_at)}
                                      <span className={`ml-1.5 font-semibold px-1.5 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                                      {r.is_late && <span className="ml-1.5 font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">⏰ TERLAMBAT (&gt;H+3)</span>}
                                    </p>
                                    {r.notes && <p className="text-xs text-slate-600 mt-1">{r.notes}</p>}
                                    {r.status === 'rejected' && r.rejection_reason && <p className="text-xs text-red-600 mt-1">Alasan: {r.rejection_reason}</p>}
                                    {r.edited_at && (
                                      <p className="text-[11px] text-orange-600 mt-1">
                                        ✏️ Dikoreksi dari qty {r.original_qty}{r.original_unit_price !== null && <> @ {fmtRp(r.original_unit_price)}</>} oleh {r.edited_by_name ?? '?'}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-1 items-end shrink-0">
                                    {r.status === 'pending' && (
                                      <>
                                        <button onClick={() => approveReport(r)} className="text-xs text-green-700 hover:underline font-medium">✓ Setujui</button>
                                        <button onClick={() => openEditReport(r)} className="text-xs text-orange-600 hover:underline">✏️ Ubah qty/harga</button>
                                        <button onClick={() => setRejectFor(r)} className="text-xs text-red-600 hover:underline">✕ Tolak</button>
                                      </>
                                    )}
                                    {r.status !== 'pending' && (
                                      <button onClick={() => resetToPending(r)} className="text-xs text-blue-600 hover:underline">Review ulang</button>
                                    )}
                                  </div>
                                </div>
                                {r.receipt_photo_paths.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mt-1.5">
                                    {r.receipt_photo_paths.map(p => photoUrls[p] && (
                                      <button key={p} type="button" onClick={() => openLightbox(photoUrls[p], 'Foto struk')}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={photoUrls[p]} alt="Foto struk" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        loadingMine ? (
          <div className="py-10 text-center text-slate-500">Memuat...</div>
        ) : myProgress.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada target penjualan promo untuk cabang Anda periode ini.</div>
        ) : (
          <div className="space-y-3">
            {myBonus !== null && myBonus > 0 && (
              <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4">
                <p className="text-sm font-semibold text-purple-800">💰 Estimasi bonus promo Anda periode ini: <span className="text-lg font-bold">{fmtRp(myBonus)}</span></p>
                <p className="text-xs text-purple-600 mt-0.5">Dihitung dari laporan yang sudah disetujui Finance. Final saat disinkron ke slip gaji.</p>
              </div>
            )}
            {myProgress.map(p => (
              <div key={p.product_id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <h2 className="text-lg font-semibold text-slate-800">{p.product_name}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Laporan Anda (disetujui): <strong>{p.my_qty}</strong> qty
                  {p.my_pending_qty > 0 && <span className="text-amber-600"> · {p.my_pending_qty} qty menunggu verifikasi</span>}
                </p>
                {p.bonus_percent !== null ? (
                  <p className="text-xs text-purple-700 mt-1">Bonus: {p.bonus_percent}% dari harga layanan yang dipilih saat lapor.</p>
                ) : p.target_qty !== null ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-slate-700">Progres cabang (semua karyawan, disetujui)</span>
                      <span className="font-bold text-slate-800">{p.total_qty}/{p.target_qty}</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${p.target_qty > 0 ? Math.min(100, (p.total_qty / p.target_qty) * 100) : 0}%` }} />
                    </div>
                  </div>
                ) : null}
                <button onClick={() => openReport(p)}
                  className="mt-4 px-5 py-3 rounded-xl text-base font-bold bg-green-600 hover:bg-green-700 text-white shadow-sm transition">
                  🧾 Lapor Penjualan
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[92vh] overflow-y-auto">
            <form onSubmit={saveProduct} className="p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800 pb-2 border-b border-slate-100">{form.id ? 'Edit Produk Promo' : 'Produk Promo Baru'}</h2>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cabang <span className="text-red-500">*</span></label>
                <select value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                  <option value="">-- Pilih cabang --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Produk <span className="text-red-500">*</span></label>
                <input value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} placeholder="Contoh: Royal Canin 1kg"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer mb-2">
                  <input type="checkbox" checked={form.bonus_mode_percent} onChange={e => setForm({ ...form, bonus_mode_percent: e.target.checked })} className="rounded" />
                  Bonus % dari harga layanan (tanpa target qty, cuma pencatatan bonus)
                </label>
                <p className="text-[11px] text-slate-400 mb-2">Untuk jasa seperti grooming: karyawan pilih harga layanan saat lapor, bonus = qty × harga × persentase.</p>
              </div>
              {form.bonus_mode_percent ? (
                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Persentase Bonus (%) <span className="text-red-500">*</span></label>
                    <input type="number" min="0" max="100" step="0.1" value={form.bonus_percent} onChange={e => setForm({ ...form, bonus_percent: e.target.value })} placeholder="10"
                      className="w-32 px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Pilihan Harga Layanan (Rp) <span className="text-red-500">*</span></label>
                    <div className="flex flex-wrap gap-2">
                      {PRICE_OPTION_CHOICES.map(v => (
                        <label key={v} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm cursor-pointer ${form.price_options.includes(v) ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-slate-300 text-slate-600'}`}>
                          <input type="checkbox" checked={form.price_options.includes(v)} onChange={() => togglePriceOption(v)} className="rounded" />
                          {fmtRp(v)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Maks Hari Sejak Tanggal Nota (opsional)</label>
                    <input type="number" min="0" value={form.max_late_days} onChange={e => setForm({ ...form, max_late_days: e.target.value })} placeholder="Contoh: 2 (kosongkan = tidak dibatasi)"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    <p className="text-[11px] text-slate-400 mt-1">Lewat batas ini, laporan ditolak otomatis saat dikirim (bukan cuma ditandai).</p>
                  </div>
                </div>
              ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Qty <span className="text-red-500">*</span></label>
                <input type="number" min="1" value={form.target_qty} onChange={e => setForm({ ...form, target_qty: e.target.value })}
                  className="w-32 px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
                <div className="flex gap-2">
                  <select value={form.period_month} onChange={e => setForm({ ...form, period_month: +e.target.value })} className="px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <input type="number" value={form.period_year} onChange={e => setForm({ ...form, period_year: +e.target.value })} className="w-24 px-3 py-2 border border-slate-300 rounded text-sm" />
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer mb-2">
                  <input type="checkbox" checked={form.restrict_employees}
                    onChange={e => setForm({ ...form, restrict_employees: e.target.checked, target_employee_ids: e.target.checked ? form.target_employee_ids : [] })}
                    className="rounded" />
                  Khusus karyawan tertentu (bukan seluruh cabang)
                </label>
                {form.restrict_employees && (
                  !form.branch_id ? (
                    <p className="text-xs text-slate-400">Pilih cabang dulu untuk memilih karyawan.</p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                      {employees.filter(e => e.branch_id === form.branch_id).length === 0 ? (
                        <p className="text-xs text-slate-400 px-1">Tidak ada karyawan aktif di cabang ini.</p>
                      ) : employees.filter(e => e.branch_id === form.branch_id).map(e => (
                        <label key={e.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer px-1 py-0.5 hover:bg-slate-50 rounded">
                          <input type="checkbox" checked={form.target_employee_ids.includes(e.id)} onChange={() => toggleTargetEmployee(e.id)} className="rounded" />
                          {e.full_name}
                        </label>
                      ))}
                    </div>
                  )
                )}
              </div>
              {!form.bonus_mode_percent && (
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-medium text-slate-700 mb-1">Bonus per Pcs (opsional)</p>
                <p className="text-[11px] text-slate-400 mb-2">Kosongkan kalau produk ini cuma dipakai untuk skor KPI, tidak ada bonus Rupiah.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Kalau target tercapai (Rp)</label>
                    <input type="number" min="0" value={form.bonus_rate_reached} onChange={e => setForm({ ...form, bonus_rate_reached: e.target.value })} placeholder="1000"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Kalau belum tercapai (Rp)</label>
                    <input type="number" min="0" value={form.bonus_rate_below} onChange={e => setForm({ ...form, bonus_rate_below: e.target.value })} placeholder="500"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
              </div>
              )}
              {form.id && (
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
                  Aktif
                </label>
              )}
              {formError && <div className="p-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{formError}</div>}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
                <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {saving ? 'Menyimpan...' : form.id ? 'Simpan' : 'Buat Produk'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reportModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md max-h-[92vh] overflow-y-auto">
            <form onSubmit={submitReport} className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">🧾 Lapor Penjualan</h2>
                <p className="text-sm text-slate-500 mt-0.5">{reportModal.product_name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Qty <span className="text-red-500">*</span></label>
                <input type="number" min="1" value={rQty} onChange={e => setRQty(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              {!!reportModal.price_options?.length && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Harga Layanan <span className="text-red-500">*</span></label>
                  <select value={rUnitPrice} onChange={e => setRUnitPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">-- Pilih harga --</option>
                    {reportModal.price_options.map(v => <option key={v} value={v}>{fmtRp(v)}</option>)}
                  </select>
                  {reportModal.bonus_percent !== null && rUnitPrice && (
                    <p className="text-xs text-purple-600 mt-1">Estimasi bonus per qty: {fmtRp(parseFloat(rUnitPrice) * reportModal.bonus_percent / 100)}</p>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal di Struk/Nota <span className="text-red-500">*</span></label>
                <input type="date" value={rDate} max={toISODate(new Date())} onChange={e => setRDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base focus:ring-2 focus:ring-blue-500 outline-none" />
                {reportModal.max_late_days !== null && (
                  <p className="text-[11px] text-slate-400 mt-1">Maks {reportModal.max_late_days} hari sejak tanggal nota, lewat itu laporan tidak valid.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">📷 Foto Struk <span className="text-red-500">* wajib</span></label>
                <input type="file" accept="image/*" multiple capture="environment"
                  onChange={e => setRFiles(Array.from(e.target.files ?? []).slice(0, 3))}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium" />
                <p className="text-[11px] text-slate-400 mt-1">Foto harus diambil langsung dari kamera, bukan dari galeri.</p>
                {rFiles.length > 0 && <p className="text-xs text-slate-500 mt-1">{rFiles.length} foto dipilih</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Catatan (opsional)</label>
                <textarea value={rNotes} onChange={e => setRNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Laporan akan menunggu verifikasi Finance sebelum dihitung ke progres & bonus.</p>
              {rError && <div className="p-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{rError}</div>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setReportModal(null)} disabled={rSaving} className="flex-1 py-3 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition">Batal</button>
                <button type="submit" disabled={rSaving} className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl shadow-sm transition disabled:opacity-50">
                  {rSaving ? 'Mengirim...' : 'Kirim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rejectFor && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-800">Tolak laporan</h2>
            <p className="text-sm text-slate-500 mb-3">{rejectFor.full_name} -- qty {rejectFor.qty}</p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="Kenapa laporan ini ditolak?"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setRejectFor(null); setRejectReason('') }} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
              <button disabled={rejectReason.trim().length < 3} onClick={confirmReject}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">Tolak Laporan</button>
            </div>
          </div>
        </div>
      )}

      {editFor && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-800">Ubah qty/harga laporan</h2>
            <p className="text-sm text-slate-500 mb-3">{editFor.full_name} -- klaim awal: qty {editFor.qty}{editFor.unit_price !== null && <> @ {fmtRp(editFor.unit_price)}</>}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Qty</label>
                <input type="number" min="1" value={editQty} onChange={e => setEditQty(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              {!!adminRows.find(r => r.product_id === expanded)?.price_options?.length && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Harga</label>
                  <select value={editUnitPrice} onChange={e => setEditUnitPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">-- Pilih harga --</option>
                    {adminRows.find(r => r.product_id === expanded)?.price_options?.map(v => <option key={v} value={v}>{fmtRp(v)}</option>)}
                  </select>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Nilai klaim awal karyawan tetap tersimpan sebagai jejak audit.</p>
            {editError && <div className="p-3 mt-2 rounded-lg border text-sm bg-red-50 border-red-200 text-red-700">{editError}</div>}
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditFor(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
              <button disabled={editSaving} onClick={confirmEditReport}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {editSaving ? 'Menyimpan...' : 'Simpan Koreksi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
