'use client'

// Tab "Uang Pengiriman" di Keuangan → Verifikasi Keuangan (Tahap 3, migrasi 086).
// Dua sumber: kunjungan driver (Nota Gudang + nota cabang, diverifikasi per kunjungan) dan
// kiriman antar sendiri (satu nota cabang). Cash / transfer / deposit diverifikasi — tempo tidak
// ada uangnya. Cocok = nominal yang dilaporkan; Tidak Cocok = finance ketik nominal benar, server
// membagi ulang ke nota (nota terbesar dulu, sama -> gudang dulu).

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import { todayLocalStr } from '@/lib/date'

type Method = 'cash' | 'transfer' | 'deposit'
type NameRel = { full_name: string } | null

type Item = {
  kind: 'visit' | 'antar'
  id: string
  date: string | null
  storeName: string
  person: string
  method: Method
  notas: { label: string; amount: number }[]
  reported: number
  verified: number | null
  verifiedAt: string | null
  verifier: string | null
  accountId: string | null
  photoUrl: string | null
}

type Account = { id: string; bank_name: string; account_number: string | null; account_type: string }

const METHOD_LABEL: Record<Method, string> = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit' }
const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'

// Tipe string biasa (bukan literal) supaya TypeScript tidak mem-parse select yang panjang (TS2589).
const VISIT_SELECT: string = `id, payment_method, invoice_amount, received_total, payment_photo_url, resolved_at,
        office_verified_amount, office_verified_at, office_account_id,
        logistics_stores(name),
        plan:logistics_delivery_plans!logistics_plan_stores_plan_id_fkey(driver:employees!logistics_delivery_plans_driver_id_fkey(full_name)),
        verifier:employees!logistics_plan_stores_office_verified_by_fkey(full_name)`
const ANTAR_SELECT: string = `id, nota_amount, nota_reported_amount, nota_payment_method, nota_payment_photo_url, nota_received_at,
        nota_verified_amount, nota_verified_at, nota_account_id,
        logistics_stores(name),
        origin:branches!logistics_central_loadings_origin_branch_id_fkey(name),
        receiver:employees!logistics_central_loadings_nota_received_by_fkey(full_name),
        verifier:employees!logistics_central_loadings_nota_verified_by_fkey(full_name)`

export default function VerifikasiUangPengiriman({ onCount }: { onCount?: (n: number) => void }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [view, setView] = useState<'belum' | 'sudah'>('belum')
  const [month, setMonth] = useState(() => todayLocalStr().slice(0, 7))
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // Per item: rekening terpilih, mode "tidak cocok" + nominal ketikan finance.
  const [accDraft, setAccDraft] = useState<Record<string, string>>({})
  const [wrongDraft, setWrongDraft] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const kasTunaiId = accounts.find(a => a.account_type === 'tunai')?.id ?? ''

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const start = new Date(y, m - 1, 1).toISOString()
    const end = new Date(y, m, 1).toISOString()
    const verifiedFilter = view === 'sudah'

    const vq = supabase.from('logistics_plan_stores')
      .select(VISIT_SELECT)
      .eq('status', 'delivered').in('payment_method', ['cash', 'transfer', 'deposit'])
      .not('received_total', 'is', null)
      .gte('resolved_at', start).lt('resolved_at', end)
      .filter('office_verified_at', verifiedFilter ? 'not.is' : 'is', null)
      .order('resolved_at', { ascending: true })

    const aq = supabase.from('logistics_central_loadings')
      .select(ANTAR_SELECT)
      .is('nota_plan_store_id', null).in('nota_payment_method', ['cash', 'transfer', 'deposit'])
      .gte('nota_received_at', start).lt('nota_received_at', end)
      .filter('nota_verified_at', verifiedFilter ? 'not.is' : 'is', null)
      .order('nota_received_at', { ascending: true })

    const [vRes, aRes, accRes, cntV, cntA] = await Promise.all([
      vq, aq,
      supabase.from('fin_bank_accounts').select('id, bank_name, account_number, account_type').eq('is_active', true).order('bank_name'),
      // Jumlah yang belum diverifikasi (semua bulan) untuk angka di tab.
      supabase.from('logistics_plan_stores').select('id', { count: 'exact', head: true })
        .eq('status', 'delivered').in('payment_method', ['cash', 'transfer', 'deposit'])
        .not('received_total', 'is', null).is('office_verified_at', null),
      supabase.from('logistics_central_loadings').select('id', { count: 'exact', head: true })
        .is('nota_plan_store_id', null).in('nota_payment_method', ['cash', 'transfer', 'deposit']).is('nota_verified_at', null),
    ])
    const err = vRes.error || aRes.error || accRes.error
    if (err) { showMessage('error', 'Gagal memuat: ' + err.message); setLoading(false); return }
    onCount?.((cntV.count ?? 0) + (cntA.count ?? 0))
    setAccounts((accRes.data as Account[]) || [])

    type VisitRow = {
      id: string; payment_method: Method; invoice_amount: number | null; received_total: number; payment_photo_url: string | null
      resolved_at: string | null; office_verified_amount: number | null; office_verified_at: string | null; office_account_id: string | null
      logistics_stores: { name: string } | null; plan: { driver: NameRel } | null; verifier: NameRel
    }
    const visits = (vRes.data as unknown as VisitRow[]) || []

    // Nota cabang yang ditagih di tiap kunjungan.
    const notaByVisit: Record<string, { label: string; amount: number }[]> = {}
    if (visits.length > 0) {
      const { data: notaRows } = await supabase.from('logistics_central_loadings')
        .select('nota_amount, nota_plan_store_id, origin:branches!logistics_central_loadings_origin_branch_id_fkey(name)')
        .in('nota_plan_store_id', visits.map(v => v.id))
      type NotaRow = { nota_amount: number; nota_plan_store_id: string; origin: { name: string } | null }
      for (const n of (notaRows as unknown as NotaRow[]) || []) {
        ;(notaByVisit[n.nota_plan_store_id] ??= []).push({ label: `Nota ${n.origin?.name ?? 'Cabang'}`, amount: Number(n.nota_amount) })
      }
    }

    type AntarRow = {
      id: string; nota_amount: number; nota_reported_amount: number | null; nota_payment_method: Method; nota_payment_photo_url: string | null
      nota_received_at: string | null; nota_verified_amount: number | null; nota_verified_at: string | null; nota_account_id: string | null
      logistics_stores: { name: string } | null; origin: { name: string } | null; receiver: NameRel; verifier: NameRel
    }

    const list: Item[] = [
      ...visits.map(v => ({
        kind: 'visit' as const, id: v.id, date: v.resolved_at, storeName: v.logistics_stores?.name ?? '-',
        person: `🚚 ${v.plan?.driver?.full_name ?? 'Driver'}`, method: v.payment_method,
        notas: [
          ...(Number(v.invoice_amount) > 0 ? [{ label: 'Nota Gudang', amount: Number(v.invoice_amount) }] : []),
          ...(notaByVisit[v.id] ?? []),
        ],
        reported: Number(v.received_total), verified: v.office_verified_amount != null ? Number(v.office_verified_amount) : null,
        verifiedAt: v.office_verified_at, verifier: v.verifier?.full_name ?? null, accountId: v.office_account_id, photoUrl: v.payment_photo_url,
      })),
      ...((aRes.data as unknown as AntarRow[]) || []).map(l => ({
        kind: 'antar' as const, id: l.id, date: l.nota_received_at, storeName: l.logistics_stores?.name ?? '-',
        person: `🛵 ${l.receiver?.full_name ?? 'Pengantar'} (antar sendiri)`, method: l.nota_payment_method,
        notas: [{ label: `Nota ${l.origin?.name ?? 'Cabang'}`, amount: Number(l.nota_amount) }],
        reported: Number(l.nota_reported_amount ?? 0), verified: l.nota_verified_amount != null ? Number(l.nota_verified_amount) : null,
        verifiedAt: l.nota_verified_at, verifier: l.verifier?.full_name ?? null, accountId: l.nota_account_id, photoUrl: l.nota_payment_photo_url,
      })),
    ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    setItems(list)
    setLoading(false)
  }, [supabase, month, view, onCount])

  useEffect(() => {
    async function run() { await fetchAll() }
    run()
  }, [fetchAll])

  const accountName = (id: string | null) => {
    const a = accounts.find(x => x.id === id)
    return a ? `${a.bank_name}${a.account_number ? ` (${a.account_number})` : ''}` : '-'
  }
  const accFor = (it: Item) => accDraft[it.id] ?? (it.method === 'transfer' ? '' : kasTunaiId)

  async function verify(it: Item, amount: number) {
    const acc = accFor(it)
    if (it.method === 'transfer' && !acc) { showMessage('error', 'Pilih rekening tujuan transfer dulu.'); return }
    setBusyId(it.id)
    const { error } = it.kind === 'visit'
      ? await supabase.rpc('verify_visit_payment', { p_plan_store_id: it.id, p_amount: amount, p_account_id: acc || null })
      : await supabase.rpc('verify_nota_payment', { p_loading_id: it.id, p_amount: amount, p_account_id: acc || null })
    setBusyId(null)
    if (error) { showMessage('error', 'Gagal verifikasi: ' + error.message); return }
    showMessage('success', `${it.storeName} diverifikasi ${fmtRp(amount)}.`)
    setWrongDraft(d => { const n = { ...d }; delete n[it.id]; return n })
    await fetchAll()
  }

  async function unverify(it: Item) {
    if (!confirm(`Batalkan verifikasi ${it.storeName}? Nominal kembali ke angka yang dilaporkan.`)) return
    setBusyId(it.id)
    const { error } = it.kind === 'visit'
      ? await supabase.rpc('unverify_visit_payment', { p_plan_store_id: it.id })
      : await supabase.rpc('unverify_nota_payment', { p_loading_id: it.id })
    setBusyId(null)
    if (error) { showMessage('error', 'Gagal membatalkan: ' + error.message); return }
    showMessage('success', 'Verifikasi dibatalkan.')
    await fetchAll()
  }

  const totalReported = items.reduce((s, it) => s + it.reported, 0)
  const kurangCount = items.filter(it => it.notas.reduce((s, n) => s + n.amount, 0) > (it.verified ?? it.reported)).length

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {(['belum', 'sudah'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium ${view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
              {v === 'belum' ? 'Belum diverifikasi' : 'Sudah diverifikasi'}
            </button>
          ))}
        </div>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        <p className="text-sm text-slate-600">
          {items.length} setoran · dilaporkan {fmtRp(totalReported)}
          {kurangCount > 0 && <span className="text-amber-700 font-semibold"> · ⚠️ {kurangCount} kurang bayar</span>}
        </p>
      </div>
      <p className="text-xs text-slate-500">
        Uang cash / transfer / deposit dari driver dan pengantar. Tempo tidak perlu diverifikasi (belum ada uang).
        Pengiriman lama (sebelum sistem nota cabang) tetap diverifikasi di Logistik → Laporan Pengiriman.
      </p>

      {loading ? (
        <div className="text-center py-10 text-slate-500 text-sm">Memuat...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
          {view === 'belum' ? 'Tidak ada setoran yang menunggu verifikasi di bulan ini.' : 'Belum ada setoran yang diverifikasi di bulan ini.'}
        </div>
      ) : items.map(it => {
        const total = it.notas.reduce((s, n) => s + n.amount, 0)
        const basis = it.verified ?? it.reported
        const short = total - basis
        const wrong = wrongDraft[it.id]
        const busy = busyId === it.id
        return (
          <div key={`${it.kind}-${it.id}`} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-800">{it.storeName}</p>
                <p className="text-xs text-slate-500">{it.person} · {fmtDate(it.date)}</p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-blue-100 text-blue-700">{METHOD_LABEL[it.method]}</span>
            </div>

            <div className="text-sm space-y-1">
              {it.notas.map((n, i) => (
                <div key={i} className="flex justify-between"><span className="text-slate-600">🧾 {n.label}</span><span>{fmtRp(n.amount)}</span></div>
              ))}
              <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold"><span>Total nota</span><span>{fmtRp(total)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Dilaporkan diterima</span><span className="font-semibold">{fmtRp(it.reported)}</span></div>
              {it.verified != null && (
                <div className="flex justify-between"><span className="text-slate-600">Diverifikasi finance</span><span className="font-semibold text-green-700">{fmtRp(it.verified)}</span></div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {short > 0 && <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800 font-medium">⚠️ Kurang bayar {fmtRp(short)} (jadi piutang)</span>}
              {short < 0 && <span className="text-xs px-2 py-1 rounded bg-sky-100 text-sky-800 font-medium">Lebih bayar {fmtRp(-short)} (saldo konsumen)</span>}
              {it.verified != null && it.verified !== it.reported && (
                <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 font-medium">Selisih dari laporan: {fmtRp(it.verified - it.reported)}</span>
              )}
              {it.photoUrl && (
                <a href={it.photoUrl} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded bg-slate-100 text-blue-700 font-medium hover:underline">📎 Bukti transfer</a>
              )}
              {it.method === 'transfer' && !it.photoUrl && (
                <span className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 font-medium">Tanpa foto bukti transfer</span>
              )}
            </div>

            {it.verified == null ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold text-slate-600">Masuk ke rekening:</label>
                  <select value={accFor(it)} onChange={e => setAccDraft(d => ({ ...d, [it.id]: e.target.value }))}
                    className="flex-1 min-w-[180px] px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                    {it.method === 'transfer' && <option value="">-- Pilih rekening tujuan --</option>}
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name}{a.account_number ? ` (${a.account_number})` : ''}</option>)}
                  </select>
                </div>
                {wrong === undefined ? (
                  <div className="flex flex-wrap gap-2">
                    <button disabled={busy} onClick={() => verify(it, it.reported)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                      ✓ Cocok ({fmtRp(it.reported)})
                    </button>
                    <button disabled={busy} onClick={() => setWrongDraft(d => ({ ...d, [it.id]: '' }))}
                      className="px-4 py-2 border border-red-300 text-red-700 bg-white hover:bg-red-50 text-sm font-semibold rounded-lg disabled:opacity-50">
                      ✗ Tidak Cocok
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-600">Nominal yang benar:</span>
                    <RupiahInput value={wrong} onChange={v => setWrongDraft(d => ({ ...d, [it.id]: v }))} placeholder="Uang yang benar-benar diterima"
                      className="flex-1 min-w-[160px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                    <button disabled={busy || wrong === ''} onClick={() => verify(it, Number(wrong))}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">Simpan</button>
                    <button onClick={() => setWrongDraft(d => { const n = { ...d }; delete n[it.id]; return n })}
                      className="px-3 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg bg-white">Batal</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>✓ Diverifikasi {it.verifier ? `oleh ${it.verifier} ` : ''}· {fmtDate(it.verifiedAt)} · masuk {accountName(it.accountId)}</span>
                <button disabled={busy} onClick={() => unverify(it)} className="text-red-600 hover:underline disabled:opacity-50">Batalkan verifikasi</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
