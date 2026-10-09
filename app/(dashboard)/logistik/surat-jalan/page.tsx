'use client'

// Surat Jalan gudang (migrasi 090). Back Office / Kepala Gudang / Owner mencatat surat jalan
// (toko + nominal nota gudang, nomor opsional untuk dicocokkan dengan data kasir nanti).
// Pembuat rencana mencentang surat jalan di Rencana Pengiriman. Kirim Besok -> kembali menunggu
// (tertunda); Gagal -> "Perlu Keputusan" kantor (jadwalkan ulang / batalkan). Barang cabang
// (Laporan Muat) yang Gagal juga diputuskan di sini.

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import { todayLocalStr } from '@/lib/date'

type NoteStatus = 'menunggu' | 'dijadwalkan' | 'terkirim' | 'perlu_keputusan' | 'batal'
type NameRel = { full_name: string } | null
type Note = {
  id: string
  store_id: string
  note_number: string | null
  note_date: string
  amount: number
  notes: string | null
  status: NoteStatus
  paid_amount: number | null
  postponed_at: string | null
  postpone_count: number
  last_postpone_reason: string | null
  fail_reason: string | null
  fail_photo_url: string | null
  failed_at: string | null
  cancel_reason: string | null
  decision_note: string | null
  created_at: string
  logistics_stores: { name: string; address: string | null; kind: string } | null
  plan_store: { status: string; plan: { plan_date: string; status: string; driver: NameRel } | null } | null
}
type FailedLoading = {
  id: string
  fail_reason: string | null
  fail_photo_url: string | null
  nota_amount: number | null
  delivery_method: string
  logistics_stores: { name: string } | null
  origin: { name: string } | null
}
type Store = { id: string; name: string; kind: 'toko' | 'pelanggan'; phone: string | null }

const TABS: { key: NoteStatus; label: string }[] = [
  { key: 'menunggu', label: 'Menunggu Dijadwalkan' },
  { key: 'perlu_keputusan', label: 'Perlu Keputusan' },
  { key: 'dijadwalkan', label: 'Dalam Perjalanan' },
  { key: 'terkirim', label: 'Terkirim' },
  { key: 'batal', label: 'Batal' },
]
const LIMIT_MS = 3 * 24 * 3600 * 1000
const NOTE_SELECT: string = `id, store_id, note_number, note_date, amount, notes, status, paid_amount,
  postponed_at, postpone_count, last_postpone_reason, fail_reason, fail_photo_url, failed_at,
  cancel_reason, decision_note, created_at,
  logistics_stores(name, address, kind),
  plan_store:logistics_plan_stores!logistics_delivery_notes_plan_store_id_fkey(status,
    plan:logistics_delivery_plans!logistics_plan_stores_plan_id_fkey(plan_date, status, driver:employees!logistics_delivery_plans_driver_id_fkey(full_name)))`
const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const fmtD = (s: string) => new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
const storeLabel = (s: Store) => s.kind === 'pelanggan' ? `${s.name} · Pelanggan ${s.phone ?? ''}`.trim() : s.name

function SuratJalanContent() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const { openLightbox } = usePhotoLightbox()
  const [access, setAccess] = useState<'none' | 'view' | 'manage' | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<NoteStatus>('menunggu')
  const [notes, setNotes] = useState<Note[]>([])
  const [failedLoadings, setFailedLoadings] = useState<FailedLoading[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [month, setMonth] = useState(() => todayLocalStr().slice(0, 7))
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [now] = useState(() => Date.now())

  // Form tambah
  const [showForm, setShowForm] = useState(searchParams.get('baru') === '1')
  const [storeText, setStoreText] = useState('')
  const [amount, setAmount] = useState('')
  const [noteNumber, setNoteNumber] = useState('')
  const [noteDate, setNoteDate] = useState(todayLocalStr())
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [newStore, setNewStore] = useState<{ kind: 'toko' | 'pelanggan'; address: string; phone: string } | null>(null)

  // Ubah
  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editNumber, setEditNumber] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editNotes, setEditNotes] = useState('')

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  useEffect(() => {
    async function init() {
      const [{ data: canManage }, { data: { user } }] = await Promise.all([
        supabase.rpc('can_manage_delivery_notes'),
        supabase.auth.getUser(),
      ])
      if (canManage) { setAccess('manage'); return }
      if (user) {
        const { data: u } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (u && ['hr', 'finance'].includes(u.role)) { setAccess('view'); return }
      }
      setAccess('none')
    }
    init()
  }, [supabase])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const start = `${month}-01`
    const end = new Date(y, m, 0).getDate()
    const [openRes, histRes, loadRes, storeRes] = await Promise.all([
      supabase.from('logistics_delivery_notes').select(NOTE_SELECT)
        .in('status', ['menunggu', 'perlu_keputusan', 'dijadwalkan']).order('note_date').order('created_at'),
      supabase.from('logistics_delivery_notes').select(NOTE_SELECT)
        .in('status', ['terkirim', 'batal']).gte('note_date', start).lte('note_date', `${month}-${String(end).padStart(2, '0')}`)
        .order('note_date', { ascending: false }),
      supabase.from('logistics_central_loadings')
        .select('id, fail_reason, fail_photo_url, nota_amount, delivery_method, logistics_stores(name), origin:branches!logistics_central_loadings_origin_branch_id_fkey(name)')
        .eq('status', 'perlu_keputusan'),
      supabase.from('logistics_stores').select('id, name, kind, phone').eq('is_active', true).order('name'),
    ])
    const err = openRes.error || histRes.error
    if (err) { showMessage('error', 'Gagal memuat: ' + err.message); setLoading(false); return }
    setNotes([...((openRes.data as unknown as Note[]) || []), ...((histRes.data as unknown as Note[]) || [])])
    setFailedLoadings((loadRes.data as unknown as FailedLoading[]) || [])
    setStores((storeRes.data as Store[]) || [])
    setLoading(false)
  }, [supabase, month])

  useEffect(() => {
    async function run() { if (access === 'view' || access === 'manage') await fetchAll() }
    run()
  }, [access, fetchAll])

  const matchedStore = stores.find(s => storeLabel(s).trim().toLowerCase() === storeText.trim().toLowerCase())
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const n of notes) c[n.status] = (c[n.status] ?? 0) + 1
    c.perlu_keputusan = (c.perlu_keputusan ?? 0) + failedLoadings.length
    return c
  }, [notes, failedLoadings])

  async function handleCreate(e: React.FormEvent, again: boolean) {
    e.preventDefault()
    if (!(Number(amount) > 0)) { showMessage('error', 'Isi nominal nota.'); return }
    let storeId = matchedStore?.id
    setSaving(true)
    if (!storeId) {
      if (!newStore) { setSaving(false); showMessage('error', 'Toko tidak ditemukan. Pilih dari saran, atau tambah toko baru.'); return }
      const { data: id, error } = await supabase.rpc('quick_create_logistics_store', {
        p_name: storeText, p_address: newStore.address, p_phone: newStore.phone, p_kind: newStore.kind,
      })
      if (error || !id) { setSaving(false); showMessage('error', 'Gagal menambah toko: ' + error?.message); return }
      storeId = id as string
    }
    const { error } = await supabase.rpc('create_delivery_note', {
      p_store_id: storeId, p_amount: Number(amount), p_note_number: noteNumber, p_note_date: noteDate, p_notes: noteText,
    })
    setSaving(false)
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); return }
    showMessage('success', `Surat jalan ${storeText} ${fmtRp(Number(amount))} tersimpan.`)
    // "Simpan & tambah lagi" mempertahankan toko -- untuk surat jalan tambahan toko yang sama.
    setAmount(''); setNoteNumber(''); setNoteText(''); setNewStore(null)
    if (!again) { setStoreText(''); setShowForm(false) }
    await fetchAll()
  }

  function startEdit(n: Note) {
    setEditId(n.id); setEditAmount(String(n.amount)); setEditNumber(n.note_number ?? ''); setEditDate(n.note_date); setEditNotes(n.notes ?? '')
  }

  async function saveEdit() {
    if (!editId) return
    const { error } = await supabase.rpc('update_delivery_note', {
      p_id: editId, p_amount: Number(editAmount), p_note_number: editNumber, p_note_date: editDate, p_notes: editNotes,
    })
    if (error) { showMessage('error', error.message); return }
    showMessage('success', 'Surat jalan diperbarui.')
    setEditId(null)
    await fetchAll()
  }

  async function rpcWithPrompt(fn: string, args: Record<string, unknown>, promptText: string, okText: string, paramName = 'p_reason', required = true) {
    const text = window.prompt(promptText)
    if (text === null) return
    if (required && text.trim().length < 3) { showMessage('error', 'Wajib diisi (minimal 3 huruf).'); return }
    const { error } = await supabase.rpc(fn, { ...args, [paramName]: text.trim() })
    if (error) { showMessage('error', error.message); return }
    showMessage('success', okText)
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await fetchAll()
  }

  if (access === null) return <div className="text-center py-12 text-slate-500">Memuat...</div>
  if (access === 'none') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Surat Jalan untuk Back Office, Kepala Gudang & Owner.</p>
      </div>
    )
  }
  const manage = access === 'manage'
  const list = notes.filter(n => n.status === tab)
    .sort((a, b) => tab === 'menunggu'
      ? (a.postponed_at ? 0 : 1) - (b.postponed_at ? 0 : 1) || (a.postponed_at ?? a.created_at).localeCompare(b.postponed_at ?? b.created_at)
      : 0)
  // Dikelompokkan per toko (satu toko bisa beberapa surat jalan: pagi + tambahan).
  const groups: { storeId: string; name: string; items: Note[] }[] = []
  for (const n of list) {
    let g = groups.find(x => x.storeId === n.store_id)
    if (!g) { g = { storeId: n.store_id, name: n.logistics_stores?.name ?? '-', items: [] }; groups.push(g) }
    g.items.push(n)
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Surat Jalan</h1>
          <p className="text-sm text-slate-500">Nota gudang per toko. Pembuat rencana mencentang surat jalan yang dibawa di Rencana Pengiriman.</p>
        </div>
        {manage && (
          <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {showForm ? 'Tutup' : '+ Tambahkan Surat Jalan'}
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {showForm && manage && (
        <form onSubmit={e => handleCreate(e, false)} className="bg-white rounded-xl border border-slate-200 p-4 mb-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Toko / pelanggan *</label>
            <input list="sj-stores" value={storeText} onChange={e => setStoreText(e.target.value)} placeholder="Ketik nama toko..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            <datalist id="sj-stores">{stores.map(s => <option key={s.id} value={storeLabel(s)} />)}</datalist>
            {!matchedStore && storeText.trim().length >= 3 && !newStore && (
              <button type="button" onClick={() => setNewStore({ kind: 'toko', address: '', phone: '' })} className="mt-1 text-xs text-blue-600 hover:underline">
                &quot;{storeText.trim()}&quot; belum ada — + tambah sebagai toko baru
              </button>
            )}
            {!matchedStore && newStore && (
              <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                <div className="flex gap-2">
                  {(['toko', 'pelanggan'] as const).map(k => (
                    <button key={k} type="button" onClick={() => setNewStore({ ...newStore, kind: k })}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${newStore.kind === k ? 'border-blue-500 bg-white font-semibold' : 'border-slate-300 bg-white'}`}>
                      {k === 'toko' ? '🏪 Toko' : '👤 Pelanggan'}
                    </button>
                  ))}
                </div>
                <input value={newStore.address} onChange={e => setNewStore({ ...newStore, address: e.target.value })} placeholder="Alamat"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                <input value={newStore.phone} onChange={e => setNewStore({ ...newStore, phone: e.target.value })} placeholder={newStore.kind === 'pelanggan' ? 'No. HP (wajib)' : 'No. telepon (opsional)'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                <button type="button" onClick={() => setNewStore(null)} className="text-xs text-slate-500 hover:underline">Batal tambah toko</button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nominal nota gudang *</label>
              <RupiahInput value={amount} onChange={setAmount} placeholder="Rp" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nomor surat jalan / nota (opsional)</label>
              <input value={noteNumber} onChange={e => setNoteNumber(e.target.value)} placeholder="Untuk dicocokkan dengan kasir"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal nota</label>
              <input type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
          </div>
          <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Catatan (mis. order pagi / tambahan)"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button type="button" disabled={saving} onClick={e => handleCreate(e as unknown as React.FormEvent, true)}
              className="px-4 py-2 border border-blue-300 text-blue-700 bg-white text-sm font-semibold rounded-lg disabled:opacity-50">
              Simpan & tambah lagi (toko sama)
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium ${tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
            {t.label} ({counts[t.key] ?? 0})
          </button>
        ))}
      </div>
      {(tab === 'terkirim' || tab === 'batal') && (
        <div className="mb-3">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-slate-500 text-sm">Memuat...</div>
      ) : (
        <div className="space-y-3">
          {groups.length === 0 && !(tab === 'perlu_keputusan' && failedLoadings.length > 0) && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">Tidak ada.</div>
          )}
          {groups.map(g => (
            <div key={g.storeId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">{g.name}</p>
                <p className="text-sm text-slate-600">{g.items.length} surat jalan · <b>{fmtRp(g.items.reduce((s, n) => s + Number(n.amount), 0))}</b></p>
              </div>
              <div className="divide-y divide-slate-100">
                {g.items.map(n => {
                  const late = n.status === 'menunggu' && now - new Date(n.postponed_at ?? n.created_at).getTime() > LIMIT_MS
                  const plan = n.plan_store?.plan
                  return (
                    <div key={n.id} className="px-4 py-3 space-y-1.5">
                      {editId === n.id ? (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                          <RupiahInput value={editAmount} onChange={setEditAmount} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
                          <input value={editNumber} onChange={e => setEditNumber(e.target.value)} placeholder="Nomor (opsional)" className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
                          <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
                          <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Catatan" className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
                          <div className="sm:col-span-4 flex gap-2">
                            <button onClick={saveEdit} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg">Simpan</button>
                            <button onClick={() => setEditId(null)} className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg">Batal</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="text-sm">
                            <p><b>{fmtRp(n.amount)}</b> · {n.note_number ? `📄 ${n.note_number}` : <span className="text-slate-400">tanpa nomor</span>} · {fmtD(n.note_date)}</p>
                            {n.notes && <p className="text-xs text-slate-500">{n.notes}</p>}
                            {n.postponed_at && n.status === 'menunggu' && (
                              <p className={`text-xs font-medium ${late ? 'text-red-700' : 'text-amber-700'}`}>
                                📅 Tertunda {n.postpone_count}× sejak {fmtD(n.postponed_at.slice(0, 10))}{n.last_postpone_reason ? ` — ${n.last_postpone_reason}` : ''}
                              </p>
                            )}
                            {!n.postponed_at && late && <p className="text-xs font-medium text-red-700">⏱ Lebih dari 3 hari belum dijadwalkan</p>}
                            {n.status === 'perlu_keputusan' && (
                              <p className="text-xs text-red-700">❌ Gagal: {n.fail_reason ?? '-'}
                                {n.fail_photo_url && <> · <button onClick={() => openLightbox(n.fail_photo_url!, 'Foto toko')} className="underline">foto</button></>}
                              </p>
                            )}
                            {n.status === 'dijadwalkan' && plan && (
                              <p className="text-xs text-blue-700">🚚 {fmtD(plan.plan_date)} · {plan.driver?.full_name ?? 'driver'} · rencana {plan.status}</p>
                            )}
                            {n.status === 'terkirim' && <p className="text-xs text-green-700">✓ Terkirim{n.paid_amount != null ? ` · dibayar ${fmtRp(n.paid_amount)}` : ''}</p>}
                            {n.status === 'batal' && <p className="text-xs text-slate-500">Batal: {n.cancel_reason ?? '-'}</p>}
                          </div>
                          {manage && (
                            <div className="flex flex-wrap gap-1.5">
                              {['menunggu', 'dijadwalkan', 'perlu_keputusan'].includes(n.status) && (
                                <button onClick={() => startEdit(n)} className="text-xs px-2.5 py-1 border border-slate-300 rounded-lg bg-white">Ubah</button>
                              )}
                              {n.status === 'perlu_keputusan' && (
                                <>
                                  <button onClick={() => rpcWithPrompt('decide_failed_note', { p_id: n.id, p_decision: 'jadwal_ulang' }, 'Jadwalkan ulang surat jalan ini? Catatan (opsional):', 'Surat jalan kembali menunggu dijadwalkan.', 'p_note', false)}
                                    className="text-xs px-2.5 py-1 border border-blue-300 text-blue-700 rounded-lg bg-white">🔁 Jadwalkan ulang</button>
                                  <button onClick={() => rpcWithPrompt('decide_failed_note', { p_id: n.id, p_decision: 'batal' }, 'Batalkan surat jalan ini? Alasan:', 'Surat jalan dibatalkan.', 'p_note')}
                                    className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded-lg bg-white">🗑️ Batalkan</button>
                                </>
                              )}
                              {n.status === 'menunggu' && (
                                <button onClick={() => rpcWithPrompt('cancel_delivery_note', { p_id: n.id }, 'Batalkan surat jalan ini? Alasan:', 'Surat jalan dibatalkan.')}
                                  className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded-lg bg-white">Batalkan</button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {tab === 'perlu_keputusan' && failedLoadings.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <p className="font-semibold text-slate-800">🏪 Barang Cabang (Laporan Muat) — Gagal</p>
              </div>
              <div className="divide-y divide-slate-100">
                {failedLoadings.map(l => (
                  <div key={l.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm">
                      <p><b>{l.logistics_stores?.name ?? '-'}</b> · dari {l.origin?.name ?? '-'}{l.nota_amount != null ? ` · nota ${fmtRp(l.nota_amount)}` : ''}</p>
                      <p className="text-xs text-red-700">❌ Gagal: {l.fail_reason ?? '-'}
                        {l.fail_photo_url && <> · <button onClick={() => openLightbox(l.fail_photo_url!, 'Foto toko')} className="underline">foto</button></>}
                      </p>
                    </div>
                    {manage && (
                      <div className="flex gap-1.5">
                        <button onClick={() => rpcWithPrompt('decide_failed_loading', { p_id: l.id, p_decision: 'jadwal_ulang' }, 'Kirim ulang barang cabang ini? Catatan (opsional):', 'Barang cabang dijadwalkan ulang.', 'p_note', false)}
                          className="text-xs px-2.5 py-1 border border-blue-300 text-blue-700 rounded-lg bg-white">🔁 Jadwalkan ulang</button>
                        <button onClick={() => rpcWithPrompt('decide_failed_loading', { p_id: l.id, p_decision: 'batal' }, 'Batalkan kiriman cabang ini? Alasan:', 'Kiriman cabang dibatalkan.', 'p_note')}
                          className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded-lg bg-white">🗑️ Batalkan</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SuratJalanPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-slate-500">Memuat...</div>}>
      <SuratJalanContent />
    </Suspense>
  )
}
