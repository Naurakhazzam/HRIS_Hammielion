'use client'

// Buku Piutang konsumen (migrasi 087, lihat docs/RENCANA-NOTA-CABANG.md bagian 5b no. 4-9).
// Nota dihitung langsung dari pengiriman (Nota Gudang = kunjungan driver, nota cabang = Laporan
// Muat) mulai 10 Okt 2026. Piutang resmi setelah finance verifikasi (tempo langsung resmi).
// Pelunasan dicatat finance, dipakai ke nota paling lama dulu; kelebihan jadi saldo konsumen.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import { todayLocalStr } from '@/lib/date'

type Receivable = {
  source_type: 'gudang' | 'cabang'
  source_id: string
  store_id: string
  branch_id: string | null
  nota_date: string
  due_date: string | null
  payment_method: string
  nota_amount: number
  paid_at_delivery: number
  is_official: boolean
  allocated: number
  outstanding: number
  cut_amount: number // potong nota yang disetujui Finance (migrasi 092)
}
type CreditEntry = { store_id: string; kind: 'lebih_bayar' | 'sisa_setoran' | 'dipakai'; ref_id: string; entry_date: string; amount: number }
type Payment = {
  id: string; store_id: string; kind: 'setoran' | 'saldo'; amount: number; method: 'cash' | 'transfer' | null
  account_id: string | null; paid_date: string; note: string | null; created_at: string
  creator: { full_name: string } | null
  allocations: { source_type: string; source_id: string; amount: number }[]
}
type Store = { id: string; name: string; kind: string; phone: string | null }
type Account = { id: string; bank_name: string; account_number: string | null; account_type: string }

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const fmtD = (s: string | null) => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
const METHOD: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit', tempo: 'Tempo' }
const CREDIT_LABEL: Record<CreditEntry['kind'], string> = { lebih_bayar: 'Lebih bayar saat kirim', sisa_setoran: 'Sisa setoran pelunasan', dipakai: 'Dipakai menutup piutang' }

export default function BukuPiutangPage() {
  const supabase = createClient()
  const [role, setRole] = useState('')
  const [roleLoading, setRoleLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Receivable[]>([])
  const [credits, setCredits] = useState<CreditEntry[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [stores, setStores] = useState<Record<string, Store>>({})
  const [branches, setBranches] = useState<Record<string, string>>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  const [search, setSearch] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [openStore, setOpenStore] = useState<string | null>(null)
  const [showPaid, setShowPaid] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const today = todayLocalStr()

  // Form pelunasan (untuk konsumen yang sedang dibuka)
  const [payKind, setPayKind] = useState<'setoran' | 'saldo'>('setoran')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer'>('cash')
  const [payAccount, setPayAccount] = useState('')
  const [payDate, setPayDate] = useState(today)
  const [payNote, setPayNote] = useState('')
  const [saving, setSaving] = useState(false)

  const canAccess = ['owner', 'hr', 'finance'].includes(role)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (data) setRole(data.role)
      }
      setRoleLoading(false)
    }
    init()
  }, [supabase])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [rRes, cRes, pRes, bRes, aRes] = await Promise.all([
      supabase.from('fin_receivables').select('*').order('nota_date'),
      supabase.from('fin_customer_credit_entries').select('*').order('entry_date'),
      supabase.from('fin_receivable_payments')
        .select('id, store_id, kind, amount, method, account_id, paid_date, note, created_at, creator:employees!fin_receivable_payments_created_by_fkey(full_name), allocations:fin_receivable_allocations(source_type, source_id, amount)')
        .order('paid_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('branches').select('id, name'),
      supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_type').eq('is_active', true).order('bank_name'),
    ])
    const err = rRes.error || cRes.error || pRes.error
    if (err) { showMessage('error', 'Gagal memuat: ' + err.message); setLoading(false); return }
    const recv = (rRes.data as Receivable[]) || []
    const cred = (cRes.data as CreditEntry[]) || []
    const pays = (pRes.data as unknown as Payment[]) || []
    setRows(recv); setCredits(cred); setPayments(pays)
    setBranches(Object.fromEntries(((bRes.data as { id: string; name: string }[]) || []).map(b => [b.id, b.name])))
    setAccounts((aRes.data as Account[]) || [])
    const ids = [...new Set([...recv.map(r => r.store_id), ...cred.map(c => c.store_id), ...pays.map(p => p.store_id)])]
    if (ids.length > 0) {
      const { data: sData } = await supabase.from('logistics_stores').select('id, name, kind, phone').in('id', ids)
      setStores(Object.fromEntries(((sData as Store[]) || []).map(s => [s.id, s])))
    } else setStores({})
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function run() { if (canAccess) await fetchAll() }
    run()
  }, [canAccess, fetchAll])

  // Ringkasan per konsumen
  const summary = useMemo(() => {
    const map: Record<string, { official: number; pending: number; overdue: number; credit: number; byBranch: Record<string, number> }> = {}
    const get = (id: string) => (map[id] ??= { official: 0, pending: 0, overdue: 0, credit: 0, byBranch: {} })
    for (const r of rows) {
      const s = get(r.store_id)
      if (r.outstanding <= 0) continue
      if (!r.is_official) { s.pending += Number(r.outstanding); continue }
      s.official += Number(r.outstanding)
      const b = r.branch_id ? branches[r.branch_id] ?? 'Cabang' : 'Cabang'
      s.byBranch[b] = (s.byBranch[b] ?? 0) + Number(r.outstanding)
      if (r.due_date && r.due_date < today) s.overdue += Number(r.outstanding)
    }
    for (const c of credits) get(c.store_id).credit += Number(c.amount)
    return map
  }, [rows, credits, branches, today])

  const storeIds = Object.keys(summary)
    .filter(id => !onlyOpen || summary[id].official > 0 || summary[id].pending > 0 || summary[id].credit > 0)
    .filter(id => (stores[id]?.name ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => summary[b].overdue - summary[a].overdue || summary[b].official - summary[a].official)

  const totals = Object.values(summary).reduce((t, s) => ({
    official: t.official + s.official, pending: t.pending + s.pending, overdue: t.overdue + s.overdue, credit: t.credit + Math.max(0, s.credit),
  }), { official: 0, pending: 0, overdue: 0, credit: 0 })

  const accName = (id: string | null) => {
    const a = accounts.find(x => x.id === id)
    return a ? `${a.bank_name}${a.account_number ? ` (${a.account_number})` : ''}` : '-'
  }
  const kasTunaiId = accounts.find(a => a.account_type === 'tunai')?.id ?? ''

  function openDetail(id: string) {
    setOpenStore(openStore === id ? null : id)
    setPayKind('setoran'); setPayAmount(''); setPayMethod('cash'); setPayAccount(''); setPayDate(today); setPayNote(''); setShowPaid(false)
  }

  // Pratinjau pembagian: nota resmi paling lama dulu (sama dengan server).
  function preview(storeId: string, amount: number) {
    const open = rows.filter(r => r.store_id === storeId && r.is_official && r.outstanding > 0)
      .sort((a, b) => a.nota_date.localeCompare(b.nota_date) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
        || b.source_type.localeCompare(a.source_type) || a.source_id.localeCompare(b.source_id))
    let left = amount
    const out: { r: Receivable; amt: number }[] = []
    for (const r of open) { if (left <= 0) break; const a = Math.min(left, Number(r.outstanding)); out.push({ r, amt: a }); left -= a }
    return { out, left }
  }

  async function submitPayment(storeId: string) {
    const amount = Number(payAmount)
    if (!(amount > 0)) { showMessage('error', 'Isi nominal pelunasan.'); return }
    const account = payKind === 'setoran' ? (payAccount || (payMethod === 'cash' ? kasTunaiId : '')) : ''
    if (payKind === 'setoran' && payMethod === 'transfer' && !account) { showMessage('error', 'Pilih rekening tujuan transfer.'); return }
    if (!confirm(`Catat pelunasan ${fmtRp(amount)} untuk ${stores[storeId]?.name}?`)) return
    setSaving(true)
    const { error } = await supabase.rpc('record_receivable_payment', {
      p_store_id: storeId, p_amount: amount, p_kind: payKind,
      p_method: payKind === 'setoran' ? payMethod : null, p_account_id: account || null,
      p_paid_date: payDate, p_note: payNote,
    })
    setSaving(false)
    if (error) { showMessage('error', 'Gagal mencatat: ' + error.message); return }
    showMessage('success', 'Pelunasan tercatat.')
    setPayAmount(''); setPayNote('')
    await fetchAll()
  }

  async function cancelPayment(p: Payment) {
    if (!confirm(`Batalkan pelunasan ${fmtRp(p.amount)} tanggal ${fmtD(p.paid_date)}?`)) return
    const { error } = await supabase.rpc('cancel_receivable_payment', { p_payment_id: p.id })
    if (error) { showMessage('error', 'Gagal membatalkan: ' + error.message); return }
    showMessage('success', 'Pelunasan dibatalkan.')
    await fetchAll()
  }

  if (roleLoading) return <div className="text-center py-12 text-slate-500">Memuat...</div>
  if (!canAccess) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Buku Piutang hanya untuk Owner & Finance.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Buku Piutang</h1>
        <p className="text-sm text-slate-500">Piutang konsumen dari pengiriman (Nota Gudang & nota cabang) sejak 10 Okt 2026. Pelunasan dipakai ke nota paling lama dulu.</p>
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Piutang resmi', value: totals.official, tone: 'text-orange-700 border-orange-200' },
          { label: 'Lewat jatuh tempo', value: totals.overdue, tone: 'text-red-700 border-red-200' },
          { label: 'Menunggu verifikasi', value: totals.pending, tone: 'text-slate-600 border-slate-200' },
          { label: 'Saldo konsumen', value: totals.credit, tone: 'text-sky-700 border-sky-200' },
        ].map(c => (
          <div key={c.label} className={`bg-white border rounded-xl px-4 py-3 ${c.tone}`}>
            <p className="text-lg font-bold">{fmtRp(c.value)}</p>
            <p className="text-xs font-medium">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama konsumen..."
          className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
          Hanya yang masih ada piutang / saldo
        </label>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-500 text-sm">Memuat...</div>
      ) : storeIds.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada piutang.</div>
      ) : (
        <div className="space-y-3">
          {storeIds.map(id => {
            const s = summary[id]
            const st = stores[id]
            const isOpen = openStore === id
            const notas = rows.filter(r => r.store_id === id).filter(r => showPaid || r.outstanding > 0)
              .sort((a, b) => a.nota_date.localeCompare(b.nota_date))
            const storePays = payments.filter(p => p.store_id === id)
            const storeCredits = credits.filter(c => c.store_id === id)
            const amountNum = Number(payAmount) || 0
            const pv = isOpen && amountNum > 0 ? preview(id, amountNum) : null
            return (
              <div key={id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={() => openDetail(id)} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">
                      {st?.name ?? 'Konsumen'}
                      {st?.kind === 'pelanggan' && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 align-middle">Pelanggan</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {Object.entries(s.byBranch).map(([b, v]) => `${b} ${fmtRp(v)}`).join(' · ') || 'Tidak ada piutang resmi'}
                      {s.pending > 0 && ` · menunggu verifikasi ${fmtRp(s.pending)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.overdue > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">Lewat tempo {fmtRp(s.overdue)}</span>}
                    {s.credit > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-sky-100 text-sky-700">Saldo {fmtRp(s.credit)}</span>}
                    <span className="text-sm font-bold text-orange-700">{fmtRp(s.official)}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 p-4 space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-bold text-slate-700">🧾 Nota</p>
                        <label className="flex items-center gap-1.5 text-xs text-slate-500">
                          <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} /> Tampilkan yang lunas
                        </label>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-slate-500 text-left">
                            <tr>
                              <th className="py-1 pr-2">Tanggal</th><th className="py-1 pr-2">Cabang</th><th className="py-1 pr-2 text-right">Nota</th>
                              <th className="py-1 pr-2 text-right">Bayar saat kirim</th><th className="py-1 pr-2 text-right">Dilunasi</th>
                              <th className="py-1 pr-2 text-right">Sisa</th><th className="py-1 pr-2">Jatuh tempo</th><th className="py-1">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {notas.length === 0 ? (
                              <tr><td colSpan={8} className="py-3 text-center text-slate-400">Tidak ada nota yang belum lunas.</td></tr>
                            ) : notas.map(r => {
                              const overdue = r.is_official && r.outstanding > 0 && !!r.due_date && r.due_date < today
                              return (
                                <tr key={r.source_type + r.source_id}>
                                  <td className="py-1.5 pr-2">{fmtD(r.nota_date)}</td>
                                  <td className="py-1.5 pr-2">{r.branch_id ? branches[r.branch_id] ?? '-' : '-'}</td>
                                  <td className="py-1.5 pr-2 text-right">
                                    {fmtRp(r.nota_amount)}
                                    {Number(r.cut_amount) > 0 && <span className="block text-rose-700">✂️ −{fmtRp(Number(r.cut_amount))}</span>}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right">{r.paid_at_delivery > 0 ? `${fmtRp(r.paid_at_delivery)} (${METHOD[r.payment_method] ?? r.payment_method})` : METHOD[r.payment_method] ?? '-'}</td>
                                  <td className="py-1.5 pr-2 text-right">{r.allocated > 0 ? fmtRp(r.allocated) : '-'}</td>
                                  <td className="py-1.5 pr-2 text-right font-semibold">{fmtRp(r.outstanding)}</td>
                                  <td className={`py-1.5 pr-2 ${overdue ? 'text-red-700 font-semibold' : ''}`}>{fmtD(r.due_date)}</td>
                                  <td className="py-1.5">
                                    {r.outstanding <= 0 ? <span className="text-green-700">Lunas</span>
                                      : !r.is_official ? <span className="text-slate-500">Menunggu verifikasi</span>
                                      : overdue ? <span className="text-red-700 font-semibold">Lewat tempo</span>
                                      : <span className="text-orange-700">Belum lunas</span>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
                      <p className="text-sm font-bold text-slate-700">💰 Catat Pelunasan</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setPayKind('setoran')}
                          className={`px-3 py-1.5 rounded-lg border text-sm ${payKind === 'setoran' ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-300 bg-white'}`}>
                          Setoran baru
                        </button>
                        <button type="button" onClick={() => setPayKind('saldo')} disabled={s.credit <= 0}
                          className={`px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 ${payKind === 'saldo' ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-300 bg-white'}`}>
                          Pakai saldo konsumen ({fmtRp(Math.max(0, s.credit))})
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <RupiahInput value={payAmount} onChange={setPayAmount} placeholder="Nominal"
                          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                        <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                        {payKind === 'setoran' && (
                          <>
                            <select value={payMethod} onChange={e => { setPayMethod(e.target.value as 'cash' | 'transfer'); setPayAccount('') }}
                              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                              <option value="cash">Cash</option>
                              <option value="transfer">Transfer</option>
                            </select>
                            <select value={payAccount || (payMethod === 'cash' ? kasTunaiId : '')} onChange={e => setPayAccount(e.target.value)}
                              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                              {payMethod === 'transfer' && <option value="">-- Pilih rekening tujuan --</option>}
                              {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name}{a.account_number ? ` (${a.account_number})` : ''}</option>)}
                            </select>
                          </>
                        )}
                        <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Catatan (opsional)"
                          className="sm:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                      </div>
                      {pv && (
                        <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg p-2 space-y-0.5">
                          <p className="font-semibold">Akan dipakai untuk:</p>
                          {pv.out.length === 0 && <p>Belum ada piutang resmi.</p>}
                          {pv.out.map(({ r, amt }) => (
                            <p key={r.source_type + r.source_id}>• {fmtD(r.nota_date)} · {r.branch_id ? branches[r.branch_id] : '-'} — {fmtRp(amt)}{amt >= r.outstanding ? ' (lunas)' : ''}</p>
                          ))}
                          {pv.left > 0 && <p className={payKind === 'saldo' ? 'text-red-700' : 'text-sky-700'}>
                            {payKind === 'saldo' ? `Melebihi piutang ${fmtRp(pv.left)} — kurangi nominalnya.` : `Sisa ${fmtRp(pv.left)} jadi saldo konsumen.`}
                          </p>}
                        </div>
                      )}
                      <button onClick={() => submitPayment(id)} disabled={saving || !(amountNum > 0)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                        {saving ? 'Menyimpan...' : 'Simpan Pelunasan'}
                      </button>
                    </div>

                    {storePays.length > 0 && (
                      <div>
                        <p className="text-sm font-bold text-slate-700 mb-2">📒 Riwayat Pelunasan</p>
                        <ul className="space-y-1.5">
                          {storePays.map(p => (
                            <li key={p.id} className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                              <span>
                                {fmtD(p.paid_date)} · <b>{fmtRp(p.amount)}</b> · {p.kind === 'saldo' ? 'pakai saldo konsumen' : `${METHOD[p.method ?? ''] ?? ''} → ${accName(p.account_id)}`}
                                {p.creator ? ` · oleh ${p.creator.full_name}` : ''}{p.note ? ` · "${p.note}"` : ''}
                                {' '}· dipakai {fmtRp(p.allocations.reduce((t, a) => t + Number(a.amount), 0))}
                              </span>
                              <button onClick={() => cancelPayment(p)} className="text-red-600 hover:underline">Batalkan</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {storeCredits.length > 0 && (
                      <div>
                        <p className="text-sm font-bold text-slate-700 mb-2">💳 Mutasi Saldo Konsumen</p>
                        <ul className="space-y-1">
                          {storeCredits.map((c, i) => (
                            <li key={i} className="text-xs text-slate-600">
                              {fmtD(c.entry_date)} · {CREDIT_LABEL[c.kind]} · <b className={c.amount < 0 ? 'text-red-700' : 'text-sky-700'}>{c.amount < 0 ? '-' : '+'}{fmtRp(Math.abs(c.amount))}</b>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
