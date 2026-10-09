'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { localDateStr, todayLocalStr } from '@/lib/date'
import RupiahInput from '@/components/RupiahInput'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import {
  CashierReport, CASHIER_REPORT_STATUS, PAYMENT_METHOD_SUGGESTIONS, fmtRp,
  reportOmzet, reportExpenseTotal, reportCashToDeposit,
  uploadCashierReportPhotos, signCashierReportPhotos,
} from '@/lib/cashierReport'

// Laporan Kasir (settlement shift) -- pengganti laporan omzet di grup WA. Bentuk form sengaja
// dibuat sama dengan format WA yang sudah biasa dipakai kasir (lihat docs/RENCANA-LAPORAN-KASIR.md):
// Cash, non-tunai per metode, Piutang -> total omzet otomatis; daftar pengeluaran; selisih kasir.

type Branch = { branch_id: string; branch_name: string }
type PayRow = { key: number; label: string; amount: string }
type ExpRow = { key: number; description: string; amount: string }

let rowKey = 0
const nextKey = () => ++rowKey

const emptyPayments = (): PayRow[] => [{ key: nextKey(), label: 'QRIS', amount: '' }]

export default function LaporanKasirPage() {
  const supabase = createClient()
  const router = useRouter()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Form ──
  const today = todayLocalStr()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [branchId, setBranchId] = useState('')
  const [reportDate, setReportDate] = useState(today)
  const [shift, setShift] = useState<1 | 2>(1)
  const [existingPhotos, setExistingPhotos] = useState<string[]>([])
  const [newPhotos, setNewPhotos] = useState<File[]>([])
  const [cash, setCash] = useState('')
  const [payments, setPayments] = useState<PayRow[]>(emptyPayments)
  const [piutang, setPiutang] = useState('')
  const [expenses, setExpenses] = useState<ExpRow[]>([])
  const [diffType, setDiffType] = useState<'none' | 'plus' | 'minus'>('none')
  const [diffAmount, setDiffAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Riwayat ──
  const [reports, setReports] = useState<CashierReport[]>([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [historyMonth, setHistoryMonth] = useState(today.slice(0, 7))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (type === 'success') setTimeout(() => setMessage(null), 6000)
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: userRow } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      setMyEmployeeId(userRow?.employee_id ?? null)
      setIsAdmin(['owner', 'hr', 'finance'].includes(userRow?.role ?? ''))
      const { data: br } = await supabase.rpc('get_my_cashier_report_branches')
      const list = (br as Branch[] | null) || []
      setBranches(list)
      // Karyawan toko: cabangnya sendiri. Admin: biasanya mengisi Gudang.
      const gudang = list.find(b => b.branch_name === 'Gudang')
      setBranchId(list.length === 1 ? list[0].branch_id : (gudang?.branch_id ?? list[0]?.branch_id ?? ''))
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Muat ulang riwayat: naikkan reloadTick. Respons lama yang datang terlambat (filter sudah
  // diganti) diabaikan lewat flag cancelled.
  const [reloadTick, setReloadTick] = useState(0)
  const fetchReports = useCallback(() => setReloadTick(t => t + 1), [])
  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    const [y, m] = historyMonth.split('-').map(Number)
    // Ambil juga 7 hari sebelum awal bulan, dan tanggal yang dipilih di form, supaya status
    // shift tanggal itu (bisa sampai 7 hari ke belakang) selalu ketahuan.
    const from = localDateStr(new Date(y, m - 1, 1 - 7))
    const to = localDateStr(new Date(y, m, 0))
    supabase.rpc('list_cashier_reports', {
      p_branch_id: branchId,
      p_from: reportDate < from ? reportDate : from,
      p_to: reportDate > to ? reportDate : to,
    }).then(({ data, error }) => {
      if (cancelled) return
      if (error) showMessage('error', 'Gagal memuat riwayat: ' + error.message)
      else setReports((data as CashierReport[]) || [])
      setLoadingReports(false)
    })
    return () => { cancelled = true }
  }, [supabase, branchId, historyMonth, reportDate, reloadTick])

  // Pratinjau foto baru
  const newPhotoUrls = useMemo(() => newPhotos.map(f => URL.createObjectURL(f)), [newPhotos])
  useEffect(() => () => newPhotoUrls.forEach(u => URL.revokeObjectURL(u)), [newPhotoUrls])

  // Foto yang sudah tersimpan (form edit + riwayat yang dibuka) ditandatangani dulu (bucket privat).
  useEffect(() => {
    const expanded = reports.find(r => r.id === expandedId)
    const need = [...existingPhotos, ...(expanded?.photo_paths || [])].filter(p => !signedUrls[p])
    if (need.length === 0) return
    signCashierReportPhotos(supabase, need).then(map => setSignedUrls(prev => ({ ...prev, ...map })))
  }, [existingPhotos, expandedId, reports]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hitungan form ──
  const num = (s: string) => parseFloat(s) || 0
  const nonCashTotal = payments.reduce((s, p) => s + num(p.amount), 0)
  const omzetTotal = num(cash) + nonCashTotal + num(piutang)
  const expenseTotal = expenses.reduce((s, e) => s + num(e.amount), 0)
  const diffValue = diffType === 'plus' ? num(diffAmount) : diffType === 'minus' ? -num(diffAmount) : 0
  const cashToDeposit = num(cash) - expenseTotal + diffValue

  const takenShifts = reports.filter(r => r.report_date === reportDate && r.id !== editingId).map(r => r.shift)
  const myBranchName = branches.find(b => b.branch_id === branchId)?.branch_name ?? ''
  // Shift 1 tanggal itu sudah dilaporkan -> otomatis Shift 2 (dan sebaliknya).
  const otherShift: 1 | 2 = shift === 1 ? 2 : 1
  const activeShift: 1 | 2 = takenShifts.includes(shift) && !takenShifts.includes(otherShift) ? otherShift : shift

  function resetForm() {
    setEditingId(null)
    setReportDate(today)
    setShift(1)
    setExistingPhotos([])
    setNewPhotos([])
    setCash('')
    setPayments(emptyPayments())
    setPiutang('')
    setExpenses([])
    setDiffType('none')
    setDiffAmount('')
    setNotes('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startEdit(r: CashierReport) {
    setEditingId(r.id)
    setBranchId(r.branch_id)
    setReportDate(r.report_date)
    setShift(r.shift === 2 ? 2 : 1)
    setExistingPhotos(r.photo_paths || [])
    setNewPhotos([])
    setCash(String(Math.round(Number(r.cash_amount))))
    setPayments(r.payments.length > 0
      ? r.payments.map(p => ({ key: nextKey(), label: p.method_label, amount: String(Math.round(Number(p.amount))) }))
      : [])
    setPiutang(Number(r.piutang_amount) > 0 ? String(Math.round(Number(r.piutang_amount))) : '')
    setExpenses(r.expenses.map(e => ({ key: nextKey(), description: e.description, amount: String(Math.round(Number(e.amount))) })))
    const d = Number(r.cash_diff)
    setDiffType(d > 0 ? 'plus' : d < 0 ? 'minus' : 'none')
    setDiffAmount(d !== 0 ? String(Math.abs(Math.round(d))) : '')
    setNotes(r.notes || '')
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onPickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) setNewPhotos(prev => [...prev, ...files].slice(0, 6))
    e.target.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setMessage(null)
    if (!myEmployeeId) { showMessage('error', 'Akun Anda belum terhubung ke data karyawan — hubungi HR.'); return }
    if (!branchId) { showMessage('error', 'Pilih cabang.'); return }
    if (takenShifts.includes(activeShift)) { showMessage('error', `Laporan shift ${activeShift} tanggal ini sudah ada. Edit dari riwayat di bawah.`); return }
    if (existingPhotos.length + newPhotos.length === 0) { showMessage('error', 'Foto struk settlement wajib diisi.'); return }
    if (cash === '') { showMessage('error', 'Isi nominal Cash (tulis 0 kalau tidak ada).'); return }
    const payRows = payments.filter(p => p.label.trim() !== '' || p.amount !== '')
    if (payRows.some(p => p.label.trim() === '')) { showMessage('error', 'Nama metode bayar (QRIS / Trf BCA / ...) wajib diisi.'); return }
    if (payRows.some(p => num(p.amount) <= 0)) { showMessage('error', 'Hapus baris metode bayar yang nominalnya kosong / 0.'); return }
    const expRows = expenses.filter(x => x.description.trim() !== '' || x.amount !== '')
    if (expRows.some(x => x.description.trim() === '')) { showMessage('error', 'Keterangan pengeluaran wajib diisi.'); return }
    if (expRows.some(x => num(x.amount) <= 0)) { showMessage('error', 'Nominal pengeluaran tidak boleh kosong / 0.'); return }
    if (diffType !== 'none' && num(diffAmount) <= 0) { showMessage('error', 'Isi nominal selisih kasir, atau pilih "Tidak Ada".'); return }
    if (omzetTotal <= 0) { showMessage('error', 'Total omzet tidak boleh 0.'); return }

    setSubmitting(true)
    try {
      const uploaded = newPhotos.length > 0 ? await uploadCashierReportPhotos(supabase, branchId, newPhotos) : []
      // Foto yang sudah terunggah dipindah ke "tersimpan" -- kalau simpan di bawah gagal (mis.
      // sinyal putus), kirim ulang tidak perlu mengunggah foto yang sama lagi.
      const photoPaths = [...existingPhotos, ...uploaded]
      if (uploaded.length > 0) { setExistingPhotos(photoPaths); setNewPhotos([]) }
      const { error } = await supabase.rpc('save_cashier_report', {
        p_id: editingId,
        p_branch_id: branchId,
        p_report_date: reportDate,
        p_shift: activeShift,
        p_photo_paths: photoPaths,
        p_cash: num(cash),
        p_piutang: num(piutang),
        p_cash_diff: diffValue,
        p_notes: notes,
        p_payments: payRows.map(p => ({ label: p.label.trim(), amount: num(p.amount) })),
        p_expenses: expRows.map(x => ({ description: x.description.trim(), amount: num(x.amount) })),
      })
      if (error) throw new Error(error.message)
      showMessage('success', editingId
        ? 'Laporan berhasil diperbarui.'
        : `Laporan shift ${activeShift} tanggal ${new Date(reportDate + 'T00:00:00').toLocaleDateString('id-ID')} terkirim — menunggu verifikasi finance.`)
      const keepDate = reportDate
      resetForm()
      setReportDate(keepDate)
      fetchReports()
    } catch (err) {
      showMessage('error', 'Gagal menyimpan: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(r: CashierReport) {
    if (!window.confirm(`Hapus laporan shift ${r.shift} tanggal ${new Date(r.report_date + 'T00:00:00').toLocaleDateString('id-ID')}? Tindakan ini tidak bisa dibatalkan.`)) return
    const { error } = await supabase.rpc('delete_cashier_report', { p_id: r.id })
    if (error) { showMessage('error', 'Gagal menghapus: ' + error.message); return }
    if (editingId === r.id) resetForm()
    showMessage('success', 'Laporan dihapus.')
    fetchReports()
  }

  const canModify = (r: CashierReport) => r.status !== 'approved' && (isAdmin || r.reported_by === myEmployeeId)

  if (loading) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  if (branches.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">🧾 Laporan Kasir</h1>
        <p className="text-sm text-slate-500">Halaman ini khusus karyawan cabang toko (selain Driver, Kepala Gudang, dan Helper).</p>
      </div>
    )
  }

  const historyRows = reports.filter(r => r.report_date.slice(0, 7) === historyMonth)
  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">🧾 Laporan Kasir</h1>
        <p className="text-sm text-slate-500">Diisi oleh yang menutup kasir setiap selesai shift — pengganti laporan omzet di grup WA. Maksimal 2 laporan per hari (Shift 1 & Shift 2).</p>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white p-4 sm:p-5 rounded-xl shadow-sm border border-slate-200 space-y-5">
        <div className="flex items-center justify-between border-b pb-2">
          <h2 className="text-lg font-bold text-slate-800">{editingId ? '✏️ Edit Laporan' : 'Laporan Baru'}</h2>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-xs text-slate-500 hover:underline">Batal edit</button>
          )}
        </div>

        {/* Cabang, tanggal, shift */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Cabang</label>
            {branches.length === 1 ? (
              <div className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-700">{myBranchName}</div>
            ) : (
              <select value={branchId} onChange={e => setBranchId(e.target.value)} disabled={!!editingId} className={inputCls}>
                {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
            <input type="date" required value={reportDate} max={today} onChange={e => setReportDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Shift</label>
            <div className="flex gap-2">
              {([1, 2] as const).map(s => {
                const taken = takenShifts.includes(s)
                return (
                  <button key={s} type="button" disabled={taken} onClick={() => setShift(s)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${
                      taken ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through'
                        : activeShift === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                    Shift {s}
                  </button>
                )
              })}
            </div>
            {takenShifts.length > 0 && <p className="text-[11px] text-slate-400 mt-1">Shift yang dicoret sudah dilaporkan.</p>}
          </div>
        </div>

        {/* Foto struk */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">📷 Foto Struk Settlement <span className="text-red-500">*</span></label>
          <p className="text-[11px] text-slate-400 mb-2">Boleh lebih dari 1 foto (mis. struk sistem lama + sistem baru). Bisa foto langsung atau pilih screenshot.</p>
          <div className="flex flex-wrap gap-2">
            {existingPhotos.map(p => (
              <div key={p} className="relative w-20 h-20 rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                {signedUrls[p] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signedUrls[p]} alt="Struk" className="w-full h-full object-cover cursor-zoom-in" onClick={() => openLightbox(signedUrls[p], 'Struk settlement')} />
                )}
                <button type="button" onClick={() => setExistingPhotos(prev => prev.filter(x => x !== p))}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs leading-5">×</button>
              </div>
            ))}
            {newPhotoUrls.map((u, i) => (
              <div key={u} className="relative w-20 h-20 rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="Struk baru" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setNewPhotos(prev => prev.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs leading-5">×</button>
              </div>
            ))}
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 text-slate-500 text-xs hover:bg-slate-50 flex flex-col items-center justify-center">
              <span className="text-xl">＋</span>Tambah
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickPhotos} />
          </div>
        </div>

        {/* Laporan omset */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-700">Laporan Omset</h3>
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="text-sm text-slate-700">Cash</label>
            <RupiahInput value={cash} onChange={setCash} placeholder="0" className={inputCls + ' text-right'} />
          </div>

          {payments.map((p, i) => (
            <div key={p.key} className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
              <input list="cashier-methods" value={p.label} placeholder="QRIS / Trf BCA"
                onChange={e => setPayments(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                className="w-full px-2 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <RupiahInput value={p.amount} placeholder="0"
                onChange={v => setPayments(prev => prev.map((x, j) => j === i ? { ...x, amount: v } : x))}
                className={inputCls + ' text-right'} />
              <button type="button" onClick={() => setPayments(prev => prev.filter((_, j) => j !== i))}
                className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 text-lg" title="Hapus metode">×</button>
            </div>
          ))}
          <datalist id="cashier-methods">
            {PAYMENT_METHOD_SUGGESTIONS.map(m => <option key={m} value={m} />)}
          </datalist>
          <button type="button" onClick={() => setPayments(prev => [...prev, { key: nextKey(), label: '', amount: '' }])}
            className="text-xs text-blue-600 hover:underline font-medium">+ Tambah metode bayar (Trf BCA, dll)</button>

          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="text-sm text-slate-700">Piutang</label>
            <RupiahInput value={piutang} onChange={setPiutang} placeholder="0" className={inputCls + ' text-right'} />
          </div>
          <p className="text-[11px] text-slate-400 -mt-1">Piutang = &quot;Hutang&quot; di struk (termasuk nota kiriman). Tulis apa adanya, tidak perlu dikurangi.</p>

          <div className="grid grid-cols-[110px_1fr] items-center gap-2 pt-2 border-t border-slate-200">
            <span className="text-sm font-bold text-slate-800">Total Omset</span>
            <span className="text-right text-lg font-bold text-green-700 pr-3">{fmtRp(omzetTotal)}</span>
          </div>
        </div>

        {/* Pengeluaran */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <h3 className="text-sm font-bold text-slate-700">Pengeluaran</h3>
          {expenses.length === 0 && <p className="text-xs text-slate-400">Tidak ada pengeluaran.</p>}
          {expenses.map((x, i) => (
            <div key={x.key} className="grid grid-cols-[1fr_130px_auto] items-center gap-2">
              <input value={x.description} placeholder="mis. konsumsi"
                onChange={e => setExpenses(prev => prev.map((y, j) => j === i ? { ...y, description: e.target.value } : y))}
                className="w-full px-2 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <RupiahInput value={x.amount} placeholder="0"
                onChange={v => setExpenses(prev => prev.map((y, j) => j === i ? { ...y, amount: v } : y))}
                className={inputCls + ' text-right'} />
              <button type="button" onClick={() => setExpenses(prev => prev.filter((_, j) => j !== i))}
                className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 text-lg" title="Hapus">×</button>
            </div>
          ))}
          <button type="button" onClick={() => setExpenses(prev => [...prev, { key: nextKey(), description: '', amount: '' }])}
            className="text-xs text-blue-600 hover:underline font-medium">+ Tambah pengeluaran</button>
        </div>

        {/* Selisih kasir & keterangan */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <h3 className="text-sm font-bold text-slate-700">Selisih Kasir</h3>
          <div className="flex gap-2">
            {(['none', 'plus', 'minus'] as const).map(t => (
              <button key={t} type="button" onClick={() => { setDiffType(t); if (t === 'none') setDiffAmount('') }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition ${
                  diffType === t
                    ? t === 'plus' ? 'bg-green-600 text-white border-green-600' : t === 'minus' ? 'bg-red-600 text-white border-red-600' : 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {t === 'none' ? 'Tidak Ada' : t === 'plus' ? '(+) Lebih' : '(−) Kurang'}
              </button>
            ))}
          </div>
          {diffType !== 'none' && (
            <RupiahInput value={diffAmount} onChange={setDiffAmount} placeholder="Nominal selisih" className={inputCls} />
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1 mt-2">Keterangan</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Opsional — mis. ada uang titipan pelunasan dari konsumen ..." className={inputCls} />
          </div>
        </div>

        {/* Ringkasan */}
        <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Total omset</span><span className="font-semibold">{fmtRp(omzetTotal)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Pengeluaran</span><span className="font-semibold text-red-600">−{fmtRp(expenseTotal)}</span></div>
          {diffValue !== 0 && (
            <div className="flex justify-between"><span className="text-slate-500">Selisih kasir</span>
              <span className={`font-semibold ${diffValue > 0 ? 'text-green-700' : 'text-red-600'}`}>{diffValue > 0 ? '+' : '−'}{fmtRp(Math.abs(diffValue))}</span></div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1"><span className="text-slate-700 font-medium">Uang cash yang disetor</span>
            <span className={`font-bold ${cashToDeposit < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtRp(cashToDeposit)}</span></div>
          <p className="text-[11px] text-slate-400">Pelapor: akun Anda yang sedang login.</p>
        </div>

        <button type="submit" disabled={submitting}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
          {submitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Kirim Laporan'}
        </button>
      </form>

      {/* Riwayat */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-800">Riwayat Laporan{myBranchName ? ` — ${myBranchName}` : ''}</h2>
            <p className="text-xs text-slate-500">Bisa diedit/dihapus oleh pelapor selama belum disetujui finance.</p>
          </div>
          <input type="month" value={historyMonth} onChange={e => setHistoryMonth(e.target.value)}
            className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm outline-none bg-white" />
        </div>
        {loadingReports ? (
          <div className="py-8 text-center text-slate-500 text-sm">Memuat...</div>
        ) : historyRows.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-sm">Belum ada laporan di bulan ini.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {historyRows.map(r => {
              const st = CASHIER_REPORT_STATUS[r.status]
              const open = expandedId === r.id
              return (
                <li key={r.id} className="p-4">
                  <button type="button" onClick={() => setExpandedId(open ? null : r.id)} className="w-full text-left">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-800">{new Date(r.report_date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                        <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">Shift {r.shift}</span>
                        <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                      </div>
                      <span className="font-bold text-slate-800">{fmtRp(reportOmzet(r))}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Pelapor: {r.reporter_name}</p>
                    {r.status === 'rejected' && r.rejection_reason && (
                      <p className="text-xs text-red-600 mt-1">Alasan ditolak: {r.rejection_reason}</p>
                    )}
                  </button>
                  {open && (
                    <div className="mt-3 text-sm space-y-2">
                      <div className="bg-slate-50 rounded-lg p-3 space-y-1">
                        <div className="flex justify-between"><span>Cash</span><span>{fmtRp(Number(r.cash_amount))}</span></div>
                        {r.payments.map(p => (
                          <div key={p.id} className="flex justify-between"><span>{p.method_label}</span><span>{fmtRp(Number(p.amount))}</span></div>
                        ))}
                        <div className="flex justify-between"><span>Piutang</span><span>{fmtRp(Number(r.piutang_amount))}</span></div>
                        <div className="flex justify-between font-bold border-t border-slate-200 pt-1"><span>Total omset</span><span>{fmtRp(reportOmzet(r))}</span></div>
                        {r.expenses.length > 0 && (
                          <div className="pt-1">
                            <p className="text-xs font-semibold text-slate-600">Pengeluaran ({fmtRp(reportExpenseTotal(r))})</p>
                            {r.expenses.map(x => (
                              <div key={x.id} className="flex justify-between text-xs text-slate-600"><span>- {x.description}</span><span>{fmtRp(Number(x.amount))}</span></div>
                            ))}
                          </div>
                        )}
                        {Number(r.cash_diff) !== 0 && (
                          <div className="flex justify-between text-xs"><span>Selisih kasir</span>
                            <span className={Number(r.cash_diff) > 0 ? 'text-green-700' : 'text-red-600'}>{Number(r.cash_diff) > 0 ? '(+)' : '(−)'} {fmtRp(Math.abs(Number(r.cash_diff)))}</span></div>
                        )}
                        <div className="flex justify-between text-xs font-semibold"><span>Uang cash disetor</span><span>{fmtRp(reportCashToDeposit(r))}</span></div>
                        {r.notes && <p className="text-xs text-slate-500 pt-1">Keterangan: {r.notes}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {r.photo_paths.map(p => signedUrls[p] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={p} src={signedUrls[p]} alt="Struk" onClick={() => openLightbox(signedUrls[p], 'Struk settlement')}
                            className="w-20 h-20 object-cover rounded-lg border border-slate-200 cursor-zoom-in" />
                        ) : <div key={p} className="w-20 h-20 rounded-lg bg-slate-100 animate-pulse" />)}
                      </div>
                      {r.verified_at && (
                        <p className="text-xs text-slate-500">Diverifikasi {r.verifier_name ?? ''} — {new Date(r.verified_at).toLocaleString('id-ID')}</p>
                      )}
                      {r.status === 'approved' && r.cash_received != null && (
                        <div className="text-xs bg-green-50 border border-green-100 rounded-lg p-2 space-y-0.5">
                          <div className="flex justify-between"><span>Cash diterima finance</span><span className="font-semibold">{fmtRp(Number(r.cash_received))}</span></div>
                          {Number(r.titipan_amount) > 0 && (
                            <div className="flex justify-between text-slate-500"><span>termasuk titipan pelunasan ({r.titipan_note})</span><span>{fmtRp(Number(r.titipan_amount))}</span></div>
                          )}
                          <div className="flex justify-between font-semibold">
                            <span>Selisih kasir final</span>
                            <span className={Number(r.final_diff) > 0 ? 'text-green-700' : Number(r.final_diff) < 0 ? 'text-red-600' : ''}>
                              {Number(r.final_diff) > 0 ? '(+) ' : Number(r.final_diff) < 0 ? '(−) ' : ''}{fmtRp(Math.abs(Number(r.final_diff ?? 0)))}
                            </span>
                          </div>
                        </div>
                      )}
                      {canModify(r) && (
                        <div className="flex gap-3 pt-1">
                          <button type="button" onClick={() => startEdit(r)} className="text-xs font-medium text-blue-600 hover:underline">
                            {r.status === 'rejected' ? 'Perbaiki' : 'Edit'}
                          </button>
                          <button type="button" onClick={() => handleDelete(r)} className="text-xs font-medium text-red-600 hover:underline">Hapus</button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
