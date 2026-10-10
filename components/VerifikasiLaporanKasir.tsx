'use client'

// Tab "Laporan Kasir" di Keuangan → Verifikasi Keuangan (Laporan Kasir Tahap 2, migrasi 097).
// Finance mencocokkan foto struk + cash setoran fisik + mutasi non-tunai. Setujui -> Kas Masuk
// otomatis (kalau tanggal laporan >= tanggal mulai di Pengaturan) + selisih ke Kerugian Kasir
// atas nama pelapor. Non-tunai yang tidak cocok -> Tolak (kasir memperbaiki).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import { localDateStr, todayLocalStr } from '@/lib/date'
import {
  CashierReport, CASHIER_REPORT_STATUS, fmtRp, reportOmzet, reportExpenseTotal, reportCashToDeposit,
  signCashierReportPhotos,
} from '@/lib/cashierReport'

type Account = { id: string; bank_name: string; account_number: string | null; account_type: string }
type MethodAccount = { branch_id: string; method_key: string; account_id: string }
type Draft = {
  cashReceived: string
  cashAccount: string
  payAccounts: Record<string, string>
  titipanOn: boolean
  titipanAmount: string
  titipanNote: string
  titipanStore: string
  rejecting: boolean
  rejectReason: string
}

const methodKey = (s: string) => s.trim().toLowerCase()
const accLabel = (a: Account) => a.account_type === 'tunai' ? a.bank_name : `${a.bank_name}${a.account_number ? ' — ' + a.account_number : ''}`
const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export default function VerifikasiLaporanKasir({ onCount }: { onCount?: (n: number) => void }) {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'belum' | 'sudah'>('belum')
  const [month, setMonth] = useState(() => todayLocalStr().slice(0, 7))
  const [pending, setPending] = useState<CashierReport[]>([])
  const [done, setDone] = useState<CashierReport[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [mapping, setMapping] = useState<MethodAccount[]>([])
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  const [startDate, setStartDate] = useState<string | null>(null)
  const [startDraft, setStartDraft] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const reload = useCallback(() => setReloadTick(t => t + 1), [])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    if (type === 'success') setTimeout(() => setMessage(null), 6000)
  }

  useEffect(() => {
    let cancelled = false
    const [y, m] = month.split('-').map(Number)
    const today = todayLocalStr()
    // Menunggu verifikasi: 6 bulan terakhir (semua cabang). Riwayat: bulan yang dipilih.
    const pendFrom = localDateStr(new Date(new Date().getFullYear(), new Date().getMonth() - 6, 1))
    Promise.all([
      supabase.rpc('list_cashier_reports', { p_branch_id: null, p_from: pendFrom, p_to: today }),
      supabase.rpc('list_cashier_reports', { p_branch_id: null, p_from: localDateStr(new Date(y, m - 1, 1)), p_to: localDateStr(new Date(y, m, 0)) }),
      supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_type').eq('is_active', true).order('account_type').order('bank_name'),
      supabase.from('cashier_method_accounts').select('branch_id, method_key, account_id'),
      supabase.from('cashier_report_settings').select('start_date').maybeSingle(),
      supabase.from('logistics_stores').select('id, name').order('name'),
    ]).then(([pRes, mRes, accRes, mapRes, setRes, storeRes]) => {
      if (cancelled) return
      if (pRes.error || mRes.error) {
        showMessage('error', 'Gagal memuat laporan kasir: ' + (pRes.error?.message || mRes.error?.message))
      }
      const pend = ((pRes.data as CashierReport[]) || []).filter(r => r.status === 'pending' || r.status === 'revisi')
        .sort((a, b) => a.report_date.localeCompare(b.report_date) || a.branch_name.localeCompare(b.branch_name) || a.shift - b.shift)
      setPending(pend)
      setDone(((mRes.data as CashierReport[]) || []).filter(r => r.status === 'approved' || r.status === 'rejected'))
      setAccounts((accRes.data as Account[]) || [])
      setMapping((mapRes.data as MethodAccount[]) || [])
      setStores((storeRes.data as { id: string; name: string }[]) || [])
      const sd = (setRes.data as { start_date: string | null } | null)?.start_date ?? null
      setStartDate(sd)
      setStartDraft(sd ?? '')
      onCount?.(pend.length)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [supabase, month, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Foto struk (bucket privat) -> signed URL.
  const allPaths = useMemo(() => [...pending, ...done].flatMap(r => r.photo_paths || []), [pending, done])
  useEffect(() => {
    const need = allPaths.filter(p => !signed[p])
    if (need.length === 0) return
    let cancelled = false
    signCashierReportPhotos(supabase, need).then(map => { if (!cancelled) setSigned(prev => ({ ...prev, ...map })) })
    return () => { cancelled = true }
  }, [allPaths]) // eslint-disable-line react-hooks/exhaustive-deps

  const kasTunai = accounts.find(a => a.account_type === 'tunai')
  const mapped = (branchId: string, key: string) => mapping.find(m => m.branch_id === branchId && m.method_key === key)?.account_id

  function draftFor(r: CashierReport): Draft {
    return drafts[r.id] ?? {
      cashReceived: String(Math.max(0, Math.round(reportCashToDeposit(r)))),
      cashAccount: mapped(r.branch_id, 'cash') ?? kasTunai?.id ?? '',
      payAccounts: Object.fromEntries(r.payments.map(p => [p.id, p.account_id ?? mapped(r.branch_id, methodKey(p.method_label)) ?? ''])),
      titipanOn: false,
      titipanAmount: '',
      titipanNote: '',
      titipanStore: '',
      rejecting: false,
      rejectReason: '',
    }
  }
  function patchDraft(r: CashierReport, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [r.id]: { ...draftFor(r), ...patch } }))
  }

  async function approve(r: CashierReport) {
    const d = draftFor(r)
    const received = parseFloat(d.cashReceived) || 0
    const titipan = d.titipanOn ? (parseFloat(d.titipanAmount) || 0) : 0
    if (Number(r.cash_amount) > 0 && !d.cashAccount) { showMessage('error', 'Pilih rekening/kas untuk cash.'); return }
    const missing = r.payments.find(p => !d.payAccounts[p.id])
    if (missing) { showMessage('error', `Pilih rekening untuk ${missing.method_label}.`); return }
    if (d.titipanOn && (titipan <= 0 || (!d.titipanNote.trim() && !d.titipanStore))) { showMessage('error', 'Isi nominal titipan dan pilih konsumen Buku Piutang / tulis nama konsumen.'); return }
    const finalDiff = (received - titipan) - (Number(r.cash_amount) - reportExpenseTotal(r))
    const willPost = !!startDate && r.report_date >= startDate
    const lines = [
      `Setujui laporan ${r.branch_name} shift ${r.shift} (${fmtDay(r.report_date)})?`,
      finalDiff !== 0 ? `Selisih kasir ${finalDiff > 0 ? '+' : '−'}${fmtRp(Math.abs(finalDiff))} atas nama ${r.reporter_name}.` : 'Tidak ada selisih kasir.',
      willPost ? 'Kas Masuk dibuat otomatis.' : 'Kas Masuk TIDAK dibuat (sebelum tanggal mulai / tanggal mulai belum diisi).',
    ]
    if (!window.confirm(lines.join('\n'))) return
    setBusyId(r.id)
    const { error } = await supabase.rpc('approve_cashier_report', {
      p_id: r.id,
      p_cash_received: received,
      p_cash_account_id: d.cashAccount || null,
      p_titipan_amount: titipan,
      p_titipan_note: d.titipanOn ? d.titipanNote : null,
      p_payments: r.payments.map(p => ({ id: p.id, account_id: d.payAccounts[p.id] })),
      p_titipan_store_id: d.titipanOn && d.titipanStore ? d.titipanStore : null,
    })
    setBusyId(null)
    if (error) { showMessage('error', 'Gagal menyetujui: ' + error.message); return }
    setDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n })
    showMessage('success', `Laporan ${r.branch_name} shift ${r.shift} disetujui.`)
    reload()
  }

  async function reject(r: CashierReport) {
    const d = draftFor(r)
    if (!d.rejectReason.trim()) { showMessage('error', 'Tulis alasan penolakan.'); return }
    setBusyId(r.id)
    const { error } = await supabase.rpc('reject_cashier_report', { p_id: r.id, p_reason: d.rejectReason })
    setBusyId(null)
    if (error) { showMessage('error', 'Gagal menolak: ' + error.message); return }
    setDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n })
    showMessage('success', 'Laporan ditolak — kasir akan melihat alasannya dan memperbaiki.')
    reload()
  }

  async function unapprove(r: CashierReport) {
    if (!window.confirm(`Batalkan persetujuan laporan ${r.branch_name} shift ${r.shift} (${fmtDay(r.report_date)})? Kas Masuk otomatisnya dihapus dan potongan selisih dihitung ulang.`)) return
    setBusyId(r.id)
    const { error } = await supabase.rpc('unapprove_cashier_report', { p_id: r.id })
    setBusyId(null)
    if (error) { showMessage('error', 'Gagal membatalkan: ' + error.message); return }
    showMessage('success', 'Persetujuan dibatalkan — laporan kembali menunggu verifikasi.')
    reload()
  }

  async function saveStartDate() {
    const { error } = await supabase.rpc('set_cashier_report_start_date', { p_date: startDraft || null })
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); return }
    showMessage('success', startDraft ? `Tanggal mulai disimpan: ${fmtDay(startDraft)}.` : 'Tanggal mulai dikosongkan — Kas Masuk otomatis nonaktif.')
    reload()
  }

  async function saveMapping(branchId: string, key: string, accountId: string) {
    const { error } = await supabase.rpc('set_cashier_method_account', { p_branch_id: branchId, p_method: key, p_account_id: accountId || null })
    if (error) { showMessage('error', 'Gagal menyimpan rekening: ' + error.message); return }
    reload()
  }

  if (loading) return <div className="py-10 text-center text-slate-500 text-sm">Memuat laporan kasir...</div>

  const accountOptions = (
    <>
      <option value="">— Pilih rekening —</option>
      {accounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
    </>
  )
  const branchesForSettings = Array.from(new Map([...pending, ...done].map(r => [r.branch_id, r.branch_name])).entries())
  const selectCls = 'px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-3 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>
      )}

      {!startDate ? (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          ⚠️ <strong>Tanggal mulai belum diisi</strong> — laporan yang disetujui hanya ditandai terverifikasi, <strong>belum</strong> membuat Kas Masuk & potongan selisih. Isi di Pengaturan setelah input omzet manual dihentikan, supaya tidak tercatat dobel.
        </div>
      ) : (
        <div className="p-3 rounded-lg border border-green-200 bg-green-50 text-sm text-green-800">
          ✅ Kas Masuk otomatis aktif untuk laporan mulai <strong>{fmtDay(startDate)}</strong>.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {(['belum', 'sudah'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {v === 'belum' ? `Menunggu (${pending.length})` : 'Riwayat'}
            </button>
          ))}
        </div>
        {view === 'sudah' && (
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        )}
        <button onClick={() => setShowSettings(s => !s)} className="ml-auto text-sm text-slate-600 hover:text-slate-800 font-medium">⚙️ Pengaturan</button>
      </div>

      {showSettings && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">Tanggal mulai Kas Masuk otomatis</h3>
            <p className="text-xs text-slate-500 mb-2">Laporan kasir dengan tanggal ini atau sesudahnya yang disetujui otomatis masuk Kas Masuk & potongan selisih kasir. Berlaku juga untuk <strong>uang pengiriman</strong> (nota kiriman / Nota Gudang) yang diverifikasi di tab Uang Pengiriman — saat tanggal ini disimpan, uang pengiriman yang sudah terverifikasi langsung disinkronkan. Sebelum tanggal ini, tetap input omzet manual seperti biasa (termasuk omzet Gudang).</p>
            <div className="flex flex-wrap gap-2 items-center">
              <input type="date" value={startDraft} onChange={e => setStartDraft(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
              <button onClick={saveStartDate} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Simpan</button>
              {startDraft && <button onClick={() => setStartDraft('')} className="text-xs text-slate-500 hover:underline">Kosongkan</button>}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">Rekening per metode bayar</h3>
            <p className="text-xs text-slate-500 mb-2">Dipakai sebagai pilihan awal saat verifikasi. Otomatis tersimpan juga setiap kali Anda menyetujui laporan.</p>
            {branchesForSettings.length === 0 ? (
              <p className="text-xs text-slate-400">Belum ada laporan kasir.</p>
            ) : (
              <div className="space-y-3">
                {branchesForSettings.map(([bid, bname]) => {
                  const keys = Array.from(new Set(['cash',
                    ...[...pending, ...done].filter(r => r.branch_id === bid).flatMap(r => r.payments.map(p => methodKey(p.method_label))),
                    ...mapping.filter(m => m.branch_id === bid).map(m => m.method_key)]))
                  return (
                    <div key={bid}>
                      <p className="text-xs font-semibold text-slate-700 mb-1">{bname}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {keys.map(k => (
                          <label key={k} className="flex items-center gap-2 text-xs">
                            <span className="w-24 shrink-0 text-slate-600 uppercase">{k}</span>
                            <select value={mapped(bid, k) ?? ''} onChange={e => saveMapping(bid, k, e.target.value)} className={selectCls + ' flex-1'}>
                              {accountOptions}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'belum' && (pending.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 py-10 text-center text-sm text-slate-500">Tidak ada laporan kasir yang menunggu verifikasi.</div>
      ) : pending.map(r => {
        const d = draftFor(r)
        const exp = reportExpenseTotal(r)
        const expected = reportCashToDeposit(r)
        const received = parseFloat(d.cashReceived) || 0
        const titipan = d.titipanOn ? (parseFloat(d.titipanAmount) || 0) : 0
        const setoranDiff = (received - titipan) - expected
        const finalDiff = Number(r.cash_diff) + setoranDiff
        const st = CASHIER_REPORT_STATUS[r.status]
        return (
          <div key={r.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-bold text-slate-800">{r.branch_name}</span>
                <span className="ml-2 text-slate-600">{fmtDay(r.report_date)}</span>
                <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-white border border-slate-200">Shift {r.shift}</span>
                <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
              </div>
              <span className="text-xs text-slate-500">Pelapor: <strong className="text-slate-700">{r.reporter_name}</strong></span>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
              <div className="flex flex-wrap lg:flex-col gap-2">
                {r.photo_paths.map(p => signed[p] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={signed[p]} alt="Struk settlement" onClick={() => openLightbox(signed[p], 'Struk settlement')}
                    className="w-28 lg:w-full max-h-72 object-contain rounded-lg border border-slate-200 bg-slate-50 cursor-zoom-in" />
                ) : <div key={p} className="w-28 lg:w-full h-40 rounded-lg bg-slate-100 animate-pulse" />)}
              </div>
              <div className="space-y-3 text-sm">
                <table className="w-full">
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-1.5 text-slate-700">Cash</td>
                      <td className="py-1.5 text-right font-semibold">{fmtRp(Number(r.cash_amount))}</td>
                      <td className="py-1.5 pl-3 w-56">
                        {Number(r.cash_amount) > 0 && (
                          <select value={d.cashAccount} onChange={e => patchDraft(r, { cashAccount: e.target.value })} className={selectCls + ' w-full'}>{accountOptions}</select>
                        )}
                      </td>
                    </tr>
                    {r.payments.map(p => (
                      <tr key={p.id}>
                        <td className="py-1.5 text-slate-700">{p.method_label} <span className="text-[10px] text-slate-400">(cek mutasi)</span></td>
                        <td className="py-1.5 text-right font-semibold">{fmtRp(Number(p.amount))}</td>
                        <td className="py-1.5 pl-3">
                          <select value={d.payAccounts[p.id] ?? ''} onChange={e => patchDraft(r, { payAccounts: { ...d.payAccounts, [p.id]: e.target.value } })} className={selectCls + ' w-full'}>{accountOptions}</select>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1.5 text-slate-700">Piutang <span className="text-[10px] text-slate-400">(bukan uang masuk)</span></td>
                      <td className="py-1.5 text-right">{fmtRp(Number(r.piutang_amount))}</td>
                      <td />
                    </tr>
                    <tr className="font-bold">
                      <td className="py-1.5">Total omset</td>
                      <td className="py-1.5 text-right text-green-700">{fmtRp(reportOmzet(r))}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>

                {r.expenses.length > 0 && (
                  <div className="text-xs text-slate-600">
                    <p className="font-semibold">Pengeluaran ({fmtRp(exp)})</p>
                    {r.expenses.map(x => <p key={x.id}>- {x.description}: {fmtRp(Number(x.amount))}</p>)}
                  </div>
                )}
                {r.notes && <p className="text-xs text-slate-600 bg-yellow-50 border border-yellow-100 rounded p-2">Keterangan kasir: {r.notes}</p>}

                <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Cash − pengeluaran {Number(r.cash_diff) !== 0 && `${Number(r.cash_diff) > 0 ? '+' : '−'} selisih kasir dilaporkan (${fmtRp(Math.abs(Number(r.cash_diff)))})`}</span>
                    <span className="font-semibold">Harus disetor {fmtRp(expected)}</span>
                  </div>
                  <label className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">Cash yang diterima finance</span>
                    <RupiahInput value={d.cashReceived} onChange={v => patchDraft(r, { cashReceived: v })}
                      className="w-40 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-right bg-white" />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={d.titipanOn} onChange={e => patchDraft(r, { titipanOn: e.target.checked })} />
                    Termasuk uang titipan pelunasan piutang (bukan bagian omzet hari ini)
                  </label>
                  {d.titipanOn && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <RupiahInput value={d.titipanAmount} onChange={v => patchDraft(r, { titipanAmount: v })} placeholder="Nominal titipan"
                          className="w-36 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-right bg-white" />
                        <select value={d.titipanStore} onChange={e => patchDraft(r, { titipanStore: e.target.value })}
                          className="flex-1 min-w-[180px] px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                          <option value="">— Konsumen di Buku Piutang (opsional) —</option>
                          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <input value={d.titipanNote} onChange={e => patchDraft(r, { titipanNote: e.target.value })}
                        placeholder={d.titipanStore ? 'Catatan (opsional)' : 'Nama konsumen (wajib kalau tidak ada di Buku Piutang)'}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
                      <p className="text-[11px] text-slate-400">Pilih konsumen → otomatis tercatat sebagai pelunasan di Buku Piutang (melunasi nota tertua). Tidak dipilih → dicatat sebagai Kas Masuk &quot;titipan pelunasan&quot; cabang ini.</p>
                    </div>
                  )}
                  <div className="flex justify-between text-xs border-t border-slate-200 pt-2">
                    <span>Selisih setoran</span>
                    <span className={setoranDiff === 0 ? 'text-slate-500' : setoranDiff > 0 ? 'text-green-700' : 'text-red-600'}>{setoranDiff > 0 ? '+' : setoranDiff < 0 ? '−' : ''}{fmtRp(Math.abs(setoranDiff))}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Selisih kasir final ({r.reporter_name})</span>
                    <span className={finalDiff === 0 ? 'text-slate-600' : finalDiff > 0 ? 'text-green-700' : 'text-red-600'}>{finalDiff > 0 ? '+' : finalDiff < 0 ? '−' : ''}{fmtRp(Math.abs(finalDiff))}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">Minus = potongan gaji pelapor. Plus hanya mengurangi minus di bulan yang sama.</p>
                </div>

                {d.rejecting ? (
                  <div className="space-y-2">
                    <textarea value={d.rejectReason} onChange={e => patchDraft(r, { rejectReason: e.target.value })} rows={2}
                      placeholder="Alasan ditolak (dilihat kasir), mis. QRIS di mutasi hanya 1.700.000"
                      className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm" />
                    <div className="flex gap-2">
                      <button disabled={busyId === r.id} onClick={() => reject(r)} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">Kirim Penolakan</button>
                      <button onClick={() => patchDraft(r, { rejecting: false })} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm">Batal</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button disabled={busyId === r.id} onClick={() => approve(r)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">✓ Setujui</button>
                    <button disabled={busyId === r.id} onClick={() => patchDraft(r, { rejecting: true })}
                      className="px-4 py-2 bg-white border border-red-300 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium disabled:opacity-50">Tolak</button>
                    <span className="text-[11px] text-slate-400 self-center">Non-tunai tidak cocok dengan mutasi? Tolak supaya kasir memperbaiki.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }))}

      {view === 'sudah' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                <th className="px-3 py-2 text-left">Tanggal</th>
                <th className="px-3 py-2 text-left">Cabang</th>
                <th className="px-3 py-2 text-left">Pelapor</th>
                <th className="px-3 py-2 text-right">Omset</th>
                <th className="px-3 py-2 text-right">Cash diterima</th>
                <th className="px-3 py-2 text-right">Selisih</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {done.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Belum ada laporan terverifikasi di bulan ini.</td></tr>
              ) : done.map(r => {
                const st = CASHIER_REPORT_STATUS[r.status]
                const diff = Number(r.final_diff ?? 0)
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.report_date)} <span className="text-xs text-slate-400">S{r.shift}</span></td>
                    <td className="px-3 py-2">{r.branch_name}</td>
                    <td className="px-3 py-2">{r.reporter_name}</td>
                    <td className="px-3 py-2 text-right">{fmtRp(reportOmzet(r))}</td>
                    <td className="px-3 py-2 text-right">{r.cash_received != null ? fmtRp(Number(r.cash_received)) : '—'}
                      {Number(r.titipan_amount) > 0 && <div className="text-[10px] text-slate-400">titipan {fmtRp(Number(r.titipan_amount))} ({[stores.find(s => s.id === r.titipan_store_id)?.name, r.titipan_note].filter(Boolean).join(" — ")}){r.titipan_payment_id ? " → Buku Piutang" : ""}</div>}
                    </td>
                    <td className={`px-3 py-2 text-right ${diff > 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {r.status === 'approved' ? `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmtRp(Math.abs(diff))}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                      {r.status === 'approved' && !r.posted && <div className="text-[10px] text-amber-600 mt-0.5">tanpa Kas Masuk</div>}
                      {r.status === 'rejected' && r.rejection_reason && <div className="text-[10px] text-red-600 mt-0.5 max-w-[180px] mx-auto">{r.rejection_reason}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'approved' && (
                        <button disabled={busyId === r.id} onClick={() => unapprove(r)} className="text-xs text-red-600 hover:underline disabled:opacity-50">Batalkan</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
