'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient } from '@/lib/previewMode'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import { uploadReportPhotos, signedPhotoUrls, fmtDate, fmtDateTime } from '@/lib/meeting'

type Branch = { id: string; name: string }
type PromoProduct = {
  id: string; branch_id: string; product_name: string; target_qty: number
  period_month: number; period_year: number; is_active: boolean
}
type AdminRow = {
  product_id: string; branch_id: string; branch_name: string; product_name: string
  target_qty: number; total_qty: number; achievement_pct: number; is_active: boolean
}
type ReportRow = {
  id: string; employee_id: string; full_name: string; qty: number; receipt_photo_paths: string[]
  report_date: string; notes: string | null; is_invalid: boolean; invalid_reason: string | null; created_at: string
}
type MyProgress = { product_id: string; product_name: string; target_qty: number; total_qty: number; my_qty: number }

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const emptyForm = { id: null as string | null, branch_id: '', product_name: '', target_qty: '', period_month: 1, period_year: 2026, is_active: true }

export default function PenjualanPromoPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const today = new Date()
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
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
  const [invalidateFor, setInvalidateFor] = useState<ReportRow | null>(null)
  const [invalidateReason, setInvalidateReason] = useState('')

  // Employee state
  const [myProgress, setMyProgress] = useState<MyProgress[]>([])
  const [loadingMine, setLoadingMine] = useState(true)
  const [reportModal, setReportModal] = useState<{ productId: string; productName: string } | null>(null)
  const [rQty, setRQty] = useState('')
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
    const { data, error } = await supabase.rpc('get_my_promo_sales_progress')
    if (error) console.error('get_my_promo_sales_progress:', error.message)
    setMyProgress((data as MyProgress[]) || [])
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
      const admin = !!userData && ['owner', 'hr'].includes(userData.role) && !preview
      setIsAdmin(admin)
      const { data: bData } = await supabase.from('branches').select('id,name').order('name')
      setBranches((bData as Branch[]) || [])
      if (admin) await fetchAdmin()
      else await fetchMine()
      setReady(true)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (ready && isAdmin) fetchAdmin() }, [ready, isAdmin, fetchAdmin])

  function openNew() {
    setForm({ ...emptyForm, period_month: filterMonth, period_year: filterYear, branch_id: filterBranch })
    setFormError('')
    setShowForm(true)
  }

  async function openEditProduct(row: AdminRow) {
    setForm({ id: row.product_id, branch_id: row.branch_id, product_name: row.product_name, target_qty: String(row.target_qty), period_month: filterMonth, period_year: filterYear, is_active: row.is_active })
    setFormError('')
    setShowForm(true)
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!form.branch_id) { setFormError('Pilih cabang.'); return }
    if (!form.product_name.trim()) { setFormError('Nama produk wajib diisi.'); return }
    const qty = parseFloat(form.target_qty)
    if (!qty || qty <= 0) { setFormError('Target qty harus lebih dari 0.'); return }
    setSaving(true)
    const { error } = await supabase.rpc('save_promo_product', {
      p_id: form.id, p_branch_id: form.branch_id, p_product_name: form.product_name.trim(), p_target_qty: qty,
      p_period_month: form.period_month, p_period_year: form.period_year, p_is_active: form.is_active,
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

  async function confirmInvalidate() {
    if (!invalidateFor) return
    if (invalidateReason.trim().length < 3) { showMessage('error', 'Alasan wajib diisi.'); return }
    const { error } = await supabase.rpc('review_promo_sales_report', { p_report_id: invalidateFor.id, p_invalid: true, p_reason: invalidateReason.trim() })
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    setInvalidateFor(null); setInvalidateReason('')
    showMessage('success', 'Laporan ditandai tidak valid.')
    if (expanded) await loadReports(expanded)
    fetchAdmin()
  }

  async function unmarkInvalid(r: ReportRow) {
    const { error } = await supabase.rpc('review_promo_sales_report', { p_report_id: r.id, p_invalid: false })
    if (error) { showMessage('error', 'Gagal: ' + error.message); return }
    showMessage('success', 'Ditandai valid kembali.')
    if (expanded) await loadReports(expanded)
    fetchAdmin()
  }

  function openReport(productId: string, productName: string) {
    setReportModal({ productId, productName })
    setRQty(''); setRFiles([]); setRNotes(''); setRError('')
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault()
    setRError('')
    if (!reportModal) return
    const qty = parseFloat(rQty)
    if (!qty || qty <= 0) { setRError('Isi qty terjual dulu.'); return }
    if (rFiles.length === 0) { setRError('Foto struk wajib dilampirkan.'); return }
    setRSaving(true)
    try {
      const paths = await uploadReportPhotos(supabase, 'promo-' + reportModal.productId, rFiles)
      const { error } = await supabase.rpc('submit_promo_sales_report', {
        p_promo_product_id: reportModal.productId, p_qty: qty, p_photo_paths: paths, p_notes: rNotes.trim() || null,
      })
      if (error) throw new Error(error.message)
      setReportModal(null)
      showMessage('success', 'Laporan penjualan terkirim. Terima kasih!')
      fetchMine()
    } catch (err: unknown) {
      setRError(err instanceof Error ? err.message : 'Gagal mengirim laporan')
    }
    setRSaving(false)
  }

  if (!ready) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">🎯 Target Penjualan Promo</h1>
          <p className="text-sm text-slate-500">
            {isAdmin ? 'Kelola target produk promo per cabang & periode.' : 'Laporkan penjualan produk promo dengan foto struk.'}
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

      {isAdmin ? (
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

          {loadingAdmin ? (
            <div className="py-10 text-center text-slate-500">Memuat...</div>
          ) : adminRows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada produk promo untuk periode ini. Klik &quot;Produk Baru&quot; untuk mulai.</div>
          ) : (
            <div className="space-y-3">
              {adminRows.map(row => (
                <div key={row.product_id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className="text-sm font-semibold text-slate-800">{row.product_name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">{row.branch_name}</span>
                          {!row.is_active && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">NONAKTIF</span>}
                        </div>
                        <p className="text-xs text-slate-500">Target: {row.target_qty} · Terlapor: {row.total_qty}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold px-2 py-0.5 rounded ${row.achievement_pct >= 80 ? 'bg-green-100 text-green-700' : row.achievement_pct >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>{row.achievement_pct}%</span>
                        <button onClick={() => openEditProduct(row)} className="text-xs px-2.5 py-1 rounded border font-medium text-blue-600 border-blue-200 hover:bg-blue-50">Edit</button>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
                      <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, row.achievement_pct)}%` }} />
                    </div>
                    <button onClick={() => toggleExpand(row)} className="mt-3 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 transition">
                      {expanded === row.product_id ? 'Tutup Laporan ▲' : 'Lihat Laporan ▼'}
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
                            <div key={r.id} className={`rounded-lg border px-3 py-2 ${r.is_invalid ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">{r.full_name} <span className="font-normal text-slate-500">-- qty {r.qty}</span></p>
                                  <p className="text-[11px] text-slate-400">{fmtDateTime(r.created_at)}{r.is_invalid && <span className="ml-1.5 font-semibold text-red-600">TIDAK VALID</span>}</p>
                                  {r.notes && <p className="text-xs text-slate-600 mt-1">{r.notes}</p>}
                                  {r.is_invalid && r.invalid_reason && <p className="text-xs text-red-600 mt-1">Alasan: {r.invalid_reason}</p>}
                                </div>
                                {r.is_invalid ? (
                                  <button onClick={() => unmarkInvalid(r)} className="text-xs text-blue-600 hover:underline shrink-0">Tandai valid lagi</button>
                                ) : (
                                  <button onClick={() => setInvalidateFor(r)} className="text-xs text-red-600 hover:underline shrink-0">Tandai tidak valid</button>
                                )}
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
              ))}
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
            {myProgress.map(p => (
              <div key={p.product_id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <h2 className="text-lg font-semibold text-slate-800">{p.product_name}</h2>
                <p className="text-xs text-slate-500 mt-1">Laporan Anda sendiri: <strong>{p.my_qty}</strong> qty</p>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-semibold text-slate-700">Progres cabang (semua karyawan)</span>
                    <span className="font-bold text-slate-800">{p.total_qty}/{p.target_qty}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${p.target_qty > 0 ? Math.min(100, (p.total_qty / p.target_qty) * 100) : 0}%` }} />
                  </div>
                </div>
                <button onClick={() => openReport(p.product_id, p.product_name)}
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
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <form onSubmit={saveProduct} className="space-y-4">
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
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Qty <span className="text-red-500">*</span></label>
                <input type="number" min="1" value={form.target_qty} onChange={e => setForm({ ...form, target_qty: e.target.value })}
                  className="w-32 px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
                <div className="flex gap-2">
                  <select value={form.period_month} onChange={e => setForm({ ...form, period_month: +e.target.value })} className="px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <input type="number" value={form.period_year} onChange={e => setForm({ ...form, period_year: +e.target.value })} className="w-24 px-3 py-2 border border-slate-300 rounded text-sm" />
                </div>
              </div>
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
                <p className="text-sm text-slate-500 mt-0.5">{reportModal.productName}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Qty terjual <span className="text-red-500">*</span></label>
                <input type="number" min="1" value={rQty} onChange={e => setRQty(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">📷 Foto Struk <span className="text-red-500">* wajib</span></label>
                <input type="file" accept="image/*" multiple
                  onChange={e => setRFiles(Array.from(e.target.files ?? []).slice(0, 3))}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium" />
                {rFiles.length > 0 && <p className="text-xs text-slate-500 mt-1">{rFiles.length} foto dipilih</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Catatan (opsional)</label>
                <textarea value={rNotes} onChange={e => setRNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
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

      {invalidateFor && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-800">Tandai laporan tidak valid</h2>
            <p className="text-sm text-slate-500 mb-3">{invalidateFor.full_name} -- qty {invalidateFor.qty}</p>
            <textarea value={invalidateReason} onChange={e => setInvalidateReason(e.target.value)} rows={3} placeholder="Kenapa laporan ini tidak valid?"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setInvalidateFor(null); setInvalidateReason('') }} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Batal</button>
              <button disabled={invalidateReason.trim().length < 3} onClick={confirmInvalidate}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">Tandai Tidak Valid</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
