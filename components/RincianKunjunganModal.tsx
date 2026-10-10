'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePhotoLightbox } from '@/components/PhotoLightbox'

// Rincian lengkap SATU kunjungan toko (logistics_plan_stores) -- data aslinya tersebar di
// nota gudang (logistics_delivery_notes), nota cabang + isi/paket titipan (central_loadings),
// barang kejadian, baris potong nota, dan foto-foto. Di Laporan Pengiriman semua itu cuma
// tampil sebagai badge padat satu baris, jadi kasus seperti salah muat tidak bisa dibaca utuh.

export type KunjunganTrip = {
  plan_date: string
  vehicle: string | null
  route: string | null
  driver: string | null
  helper: string | null
  plannedRank?: number
  actualRank?: number
}

type Visit = {
  id: string
  status: string
  delivery_photo_urls: string[] | null
  payment_method: string | null
  invoice_amount: number | null
  payment_amount: number | null
  received_total: number | null
  overpay_amount: number | null
  payment_photo_url: string | null
  payment_due_date: string | null
  incident_type: string
  incident_photo_url: string | null
  incident_description: string | null
  failed_reason: string | null
  fail_kind: string | null
  failed_photo_url: string | null
  postpone_close_note: string | null
  resolved_at: string | null
  office_verified_amount: number | null
  office_verified_at: string | null
  cut_total: number | null
  cut_status: string | null
  cut_decision_note: string | null
  cut_decided_at: string | null
  cut_photo_url: string | null
  store: { name: string; address: string | null; phone: string | null } | null
  resolver: { full_name: string } | null
  verifier: { full_name: string } | null
  cut_decider: { full_name: string } | null
}

type GudangNota = {
  id: string
  note_number: string | null
  amount: number
  paid_amount: number | null
  cut_amount: number | null
  kasir_amount: number | null
  source: string | null
  notes: string | null
  created_at: string
  creator: { full_name: string } | null
  changes: { old_amount: number | null; new_amount: number | null; changed_at: string; changer: { full_name: string } | null }[]
}

type CabangNota = {
  id: string
  nota_amount: number | null
  nota_paid_amount: number | null
  nota_payment_method: string | null
  nota_cut_total: number | null
  created_at: string
  origin: { name: string } | null
  creator: { full_name: string } | null
  items: { id: string; photo_url: string; caption: string | null; created_at: string }[]
  packages: { id: string; photo_url: string; caption: string | null; status: string; taken_at: string | null; taker: { full_name: string } | null }[]
}

type IncidentItem = { id: string; item_name: string; ordered_item_name: string | null; disposition: string; created_at: string; owner: { name: string } | null }
type CutLine = { id: string; item_name: string; amount: number; reason: string | null; goods: string | null; owner: { name: string } | null }

const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit (DP)', tempo: 'Tempo' }
const INCIDENT_LABEL: Record<string, string> = { tidak_ada: 'Tidak Ada', salah_muat: 'Salah Muat', retur: 'Retur', barang_lebih: 'Barang Lebih' }
const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  delivered: { label: 'Terkirim', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Gagal', className: 'bg-red-100 text-red-600' },
  pending: { label: 'Belum Diproses', className: 'bg-slate-100 text-slate-600' },
}

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
const fmtJam = (ts: string) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
const fmtTgl = (ts: string) => new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })

// Nama file foto logistik berisi epoch milidetik saat diunggah (mis. "...-kirim-1791617257368.jpg"),
// jadi jam foto bisa dibaca tanpa kolom tambahan.
function photoTime(url: string): string | null {
  const m = url.match(/(\d{13})\.\w+(\?|$)/)
  return m ? new Date(Number(m[1])).toISOString() : null
}

export default function RincianKunjunganModal({ planStoreId, trip, onClose }: { planStoreId: string; trip: KunjunganTrip; onClose: () => void }) {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visit, setVisit] = useState<Visit | null>(null)
  const [gudang, setGudang] = useState<GudangNota[]>([])
  const [cabang, setCabang] = useState<CabangNota[]>([])
  const [incidentItems, setIncidentItems] = useState<IncidentItem[]>([])
  const [cutLines, setCutLines] = useState<CutLine[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [v, sj, cl, inc, cuts] = await Promise.all([
        supabase.from('logistics_plan_stores').select(`id, status, delivery_photo_urls, payment_method, invoice_amount, payment_amount,
          received_total, overpay_amount, payment_photo_url, payment_due_date, incident_type, incident_photo_url, incident_description,
          failed_reason, fail_kind, failed_photo_url, postpone_close_note, resolved_at, office_verified_amount, office_verified_at,
          cut_total, cut_status, cut_decision_note, cut_decided_at, cut_photo_url,
          store:logistics_stores(name, address, phone),
          resolver:employees!logistics_plan_stores_resolved_by_fkey(full_name),
          verifier:employees!logistics_plan_stores_office_verified_by_fkey(full_name),
          cut_decider:employees!logistics_plan_stores_cut_decided_by_fkey(full_name)`).eq('id', planStoreId).single(),
        supabase.from('logistics_delivery_notes').select(`id, note_number, amount, paid_amount, cut_amount, kasir_amount, source, notes, created_at,
          creator:employees!logistics_delivery_notes_created_by_fkey(full_name),
          changes:logistics_delivery_note_changes(old_amount, new_amount, changed_at, changer:employees(full_name))`)
          .eq('plan_store_id', planStoreId).order('created_at'),
        supabase.from('logistics_central_loadings').select(`id, nota_amount, nota_paid_amount, nota_payment_method, nota_cut_total, created_at,
          origin:branches!logistics_central_loadings_origin_branch_id_fkey(name),
          creator:employees!logistics_central_loadings_created_by_fkey(full_name),
          items:logistics_central_loading_items(id, photo_url, caption, created_at),
          packages:logistics_central_loading_packages(id, photo_url, caption, status, taken_at, taker:employees!logistics_central_loading_packages_taken_by_fkey(full_name))`)
          .eq('nota_plan_store_id', planStoreId).order('created_at'),
        supabase.from('logistics_visit_incident_items').select('id, item_name, ordered_item_name, disposition, created_at, owner:branches(name)')
          .eq('plan_store_id', planStoreId).order('created_at'),
        supabase.from('logistics_visit_cuts').select('id, item_name, amount, reason, goods, owner:branches(name)')
          .eq('plan_store_id', planStoreId).order('created_at'),
      ])
      if (cancelled) return
      const err = v.error || sj.error || cl.error || inc.error || cuts.error
      if (err) setError(err.message)
      setVisit(v.data as unknown as Visit)
      setGudang((sj.data as unknown as GudangNota[]) || [])
      setCabang((cl.data as unknown as CabangNota[]) || [])
      setIncidentItems((inc.data as unknown as IncidentItem[]) || [])
      setCutLines((cuts.data as unknown as CutLine[]) || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [planStoreId, supabase])

  const received = Number(visit?.received_total ?? visit?.payment_amount ?? 0)
  const cabangRows = cabang.map(c => ({ label: `Nota ${c.origin?.name ?? 'Cabang'}`, amount: Number(c.nota_amount ?? 0), paid: Number(c.nota_paid_amount ?? 0), cut: Number(c.nota_cut_total ?? 0) }))
  // Nota gudang: pakai baris surat jalan kalau ada, kalau tidak (data lama) jatuh ke invoice_amount
  // kunjungan -- bagian yang dibayar = uang diterima dikurangi yang sudah teralokasi ke nota cabang.
  const gudangRows = gudang.length > 0
    ? gudang.map(n => ({ label: `Nota Gudang${n.note_number ? ` #${n.note_number}` : ''}`, amount: Number(n.amount), paid: Number(n.paid_amount ?? 0), cut: Number(n.cut_amount ?? 0) }))
    : visit?.invoice_amount != null && Number(visit.invoice_amount) > 0
      ? [{ label: 'Nota Gudang', amount: Number(visit.invoice_amount), paid: Math.max(0, received - cabangRows.reduce((s, r) => s + r.paid, 0)), cut: 0 }]
      : []
  const notaRows = [...gudangRows, ...cabangRows]
  const totalNota = notaRows.reduce((s, r) => s + r.amount, 0)
  const totalCut = notaRows.reduce((s, r) => s + r.cut, 0)
  const sisa = totalNota - totalCut - received

  const photos: { url: string; label: string; at: string | null }[] = visit ? [
    ...(visit.delivery_photo_urls ?? []).map((url, i) => ({ url, label: `Bukti Kirim${(visit.delivery_photo_urls ?? []).length > 1 ? ` ${i + 1}` : ''}`, at: photoTime(url) })),
    ...(visit.incident_photo_url ? [{ url: visit.incident_photo_url, label: 'Foto Kejadian', at: photoTime(visit.incident_photo_url) }] : []),
    ...(visit.payment_photo_url ? [{ url: visit.payment_photo_url, label: 'Bukti Transfer', at: photoTime(visit.payment_photo_url) }] : []),
    ...(visit.failed_photo_url ? [{ url: visit.failed_photo_url, label: 'Foto Gagal Kirim', at: photoTime(visit.failed_photo_url) }] : []),
    ...(visit.cut_photo_url ? [{ url: visit.cut_photo_url, label: 'Foto Potong Nota', at: photoTime(visit.cut_photo_url) }] : []),
  ].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')) : []

  const st = visit ? (STATUS_LABEL[visit.status] ?? STATUS_LABEL.pending) : null
  const storeName = visit?.store?.name ?? '-'

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-800">{storeName}</h2>
              {st && <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${st.className}`}>{st.label}</span>}
              {visit && visit.incident_type !== 'tidak_ada' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">{INCIDENT_LABEL[visit.incident_type] ?? visit.incident_type}</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {new Date(trip.plan_date).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              {' · '}{trip.vehicle ?? '-'} — {trip.route ?? '-'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5 text-sm">
          {loading ? (
            <p className="text-center text-slate-500 py-8">Memuat rincian...</p>
          ) : !visit ? (
            <p className="text-center text-red-600 py-8">Gagal memuat kunjungan{error ? `: ${error}` : ''}.</p>
          ) : (
            <>
              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">Sebagian data gagal dimuat: {error}</p>}

              <Section title="Ringkasan">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  <Row k="Driver / Kenek" v={`${trip.driver ?? '-'}${trip.helper ? ` / ${trip.helper}` : ''}`} />
                  <Row k="Dilaporkan oleh" v={visit.resolver?.full_name ?? '-'} />
                  <Row k="Jam selesai" v={visit.resolved_at ? fmtJam(visit.resolved_at) : '-'} />
                  {trip.plannedRank != null && (
                    <Row k="Urutan" v={`ke-${trip.actualRank ?? '-'} dikunjungi (rencana #${trip.plannedRank})`} />
                  )}
                  {visit.store?.address && <Row k="Alamat" v={visit.store.address} />}
                  {visit.store?.phone && <Row k="Telepon" v={visit.store.phone} />}
                </dl>
              </Section>

              {visit.status === 'failed' && (
                <Section title={visit.fail_kind === 'kirim_besok' ? 'Kirim Besok' : 'Gagal Kirim'} tone="red">
                  <p className="text-slate-700 whitespace-pre-wrap">{visit.failed_reason || <span className="italic text-slate-400">Tidak ada alasan tercatat</span>}</p>
                  {visit.postpone_close_note && <p className="text-xs text-slate-500 mt-1">Catatan penutupan: {visit.postpone_close_note}</p>}
                </Section>
              )}

              {(notaRows.length > 0 || cabang.length > 0) && (
                <Section title="Nota & Pembayaran">
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 text-left">
                          <th className="px-1 py-1 font-medium">Nota</th>
                          <th className="px-1 py-1 font-medium text-right">Nominal</th>
                          {totalCut > 0 && <th className="px-1 py-1 font-medium text-right">Potong</th>}
                          <th className="px-1 py-1 font-medium text-right">Dibayar</th>
                          <th className="px-1 py-1 font-medium text-right">Sisa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {notaRows.map((r, i) => {
                          const s = r.amount - r.cut - r.paid
                          return (
                            <tr key={i}>
                              <td className="px-1 py-1.5 text-slate-700">{r.label}</td>
                              <td className="px-1 py-1.5 text-right text-slate-700">{fmtRp(r.amount)}</td>
                              {totalCut > 0 && <td className="px-1 py-1.5 text-right text-rose-600">{r.cut ? fmtRp(r.cut) : '-'}</td>}
                              <td className="px-1 py-1.5 text-right text-slate-700">{fmtRp(r.paid)}</td>
                              <td className={`px-1 py-1.5 text-right font-semibold ${s > 0 ? 'text-orange-600' : s < 0 ? 'text-sky-600' : 'text-green-600'}`}>{s === 0 ? 'Lunas' : fmtRp(s)}</td>
                            </tr>
                          )
                        })}
                        <tr className="font-semibold">
                          <td className="px-1 py-1.5 text-slate-800">Total</td>
                          <td className="px-1 py-1.5 text-right text-slate-800">{fmtRp(totalNota)}</td>
                          {totalCut > 0 && <td className="px-1 py-1.5 text-right text-rose-600">{fmtRp(totalCut)}</td>}
                          <td className="px-1 py-1.5 text-right text-slate-800">{fmtRp(received)}</td>
                          <td className={`px-1 py-1.5 text-right ${sisa > 0 ? 'text-orange-600' : sisa < 0 ? 'text-sky-600' : 'text-green-600'}`}>
                            {sisa === 0 ? 'Lunas' : sisa > 0 ? `Piutang ${fmtRp(sisa)}` : `Lebih ${fmtRp(-sisa)}`}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3">
                    <Row k="Metode bayar" v={visit.payment_method ? PAYMENT_LABEL[visit.payment_method] ?? visit.payment_method : '-'} />
                    <Row k="Uang diterima driver" v={fmtRp(received)} />
                    {visit.payment_due_date && <Row k="Jatuh tempo" v={new Date(visit.payment_due_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })} />}
                    {Number(visit.overpay_amount) > 0 && <Row k="Lebih bayar" v={fmtRp(Number(visit.overpay_amount))} />}
                    {(visit.payment_method === 'cash' || visit.payment_method === 'deposit') && (
                      <Row k="Verifikasi kantor" v={visit.office_verified_amount != null
                        ? `${fmtRp(Number(visit.office_verified_amount))}${visit.verifier ? ` oleh ${visit.verifier.full_name}` : ''}${visit.office_verified_at ? ` (${fmtTgl(visit.office_verified_at)} ${fmtJam(visit.office_verified_at)})` : ''}`
                        : '⏳ Belum diverifikasi'} />
                    )}
                  </dl>
                  {gudang.map(n => (
                    <div key={n.id} className="mt-2 text-xs text-slate-500">
                      Nota gudang dibuat {fmtTgl(n.created_at)} {fmtJam(n.created_at)}{n.creator ? ` oleh ${n.creator.full_name}` : ''}{n.source ? ` (${n.source})` : ''}
                      {n.kasir_amount != null && <> · nominal kasir {fmtRp(Number(n.kasir_amount))}{Number(n.kasir_amount) !== Number(n.amount) && <span className="text-red-600 font-medium"> (beda {fmtRp(Number(n.amount) - Number(n.kasir_amount))})</span>}</>}
                      {n.notes && <> · {n.notes}</>}
                      {n.changes.map((c, i) => (
                        <p key={i} className="text-amber-700">✏️ Nominal diubah {fmtRp(Number(c.old_amount ?? 0))} → {fmtRp(Number(c.new_amount ?? 0))}{c.changer ? ` oleh ${c.changer.full_name}` : ''} ({fmtTgl(c.changed_at)} {fmtJam(c.changed_at)})</p>
                      ))}
                    </div>
                  ))}
                </Section>
              )}

              {cabang.map(c => (
                <Section key={c.id} title={`Titipan ${c.origin?.name ?? 'Cabang'}`}>
                  <p className="text-xs text-slate-500 mb-2">
                    Disiapkan {fmtTgl(c.created_at)} {fmtJam(c.created_at)}{c.creator ? ` oleh ${c.creator.full_name}` : ''}
                    {c.nota_payment_method && <> · bayar {PAYMENT_LABEL[c.nota_payment_method] ?? c.nota_payment_method}</>}
                  </p>
                  {c.items.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-slate-600 mb-1">Isi barang</p>
                      <div className="flex flex-wrap gap-3 mb-3">
                        {c.items.map(it => (
                          <Thumb key={it.id} url={it.photo_url} label={it.caption ?? 'Barang'} onOpen={openLightbox} wide />
                        ))}
                      </div>
                    </>
                  )}
                  {c.packages.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-slate-600 mb-1">Paket</p>
                      <div className="flex flex-wrap gap-3">
                        {c.packages.map(p => (
                          <Thumb key={p.id} url={p.photo_url} onOpen={openLightbox} wide
                            label={`${p.caption ?? 'Paket'}${p.status === 'diambil' && p.taker ? ` · diambil ${p.taker.full_name}${p.taken_at ? ` ${fmtJam(p.taken_at)}` : ''}` : ` · ${p.status}`}`} />
                        ))}
                      </div>
                    </>
                  )}
                </Section>
              ))}

              {visit.incident_type !== 'tidak_ada' && (
                <Section title={`Kejadian: ${INCIDENT_LABEL[visit.incident_type] ?? visit.incident_type}`} tone="amber">
                  <p className="text-slate-700 whitespace-pre-wrap">
                    {visit.incident_description || <span className="italic text-slate-400">Tidak ada keterangan</span>}
                  </p>
                  {incidentItems.length > 0 && (
                    <div className="overflow-x-auto -mx-1 mt-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 text-left">
                            <th className="px-1 py-1 font-medium">Barang dikirim</th>
                            <th className="px-1 py-1 font-medium">Seharusnya</th>
                            <th className="px-1 py-1 font-medium">Milik</th>
                            <th className="px-1 py-1 font-medium">Penyelesaian</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100">
                          {incidentItems.map(it => (
                            <tr key={it.id}>
                              <td className="px-1 py-1.5 font-medium text-slate-800">{it.item_name}</td>
                              <td className="px-1 py-1.5 text-slate-700">{it.ordered_item_name ?? '-'}</td>
                              <td className="px-1 py-1.5 text-slate-700">{it.owner?.name ?? '-'}</td>
                              <td className="px-1 py-1.5 text-slate-700">{it.disposition === 'dibawa_pulang' ? '↩️ Dibawa pulang' : '🛒 Dibeli toko'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {incidentItems.some(it => it.disposition === 'dibeli_toko') && (
                        <p className="text-[11px] text-amber-700 mt-2">🛒 Barang &quot;dibeli toko&quot; = toko menerima varian yang salah. Stok pemilik barang perlu dikoreksi.</p>
                      )}
                    </div>
                  )}
                </Section>
              )}

              {Number(visit.cut_total) > 0 && (
                <Section title="Potong Nota" tone="red">
                  <p className="text-slate-700">
                    {fmtRp(Number(visit.cut_total))} · {visit.cut_status === 'disetujui' ? '✅ disetujui' : visit.cut_status === 'ditolak' ? '❌ ditolak (tetap piutang)' : '⏳ menunggu persetujuan Finance'}
                    {visit.cut_decider && <> oleh {visit.cut_decider.full_name}</>}
                    {visit.cut_decided_at && <> ({fmtTgl(visit.cut_decided_at)} {fmtJam(visit.cut_decided_at)})</>}
                  </p>
                  {visit.cut_decision_note && <p className="text-xs text-slate-500 mt-1">Catatan: {visit.cut_decision_note}</p>}
                  {cutLines.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {cutLines.map(l => (
                        <li key={l.id} className="text-slate-700">
                          • {l.item_name} — {fmtRp(Number(l.amount))}{l.reason ? ` · ${l.reason}` : ''}{l.goods ? ` · barang ${l.goods}` : ''}{l.owner ? ` · milik ${l.owner.name}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {photos.length > 0 && (
                <Section title={`Foto Kunjungan (${photos.length})`}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {photos.map((ph, i) => (
                      <button key={i} type="button" onClick={() => openLightbox(ph.url, `${storeName} — ${ph.label}`)} className="text-left group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ph.url} alt={ph.label} className="w-full aspect-square object-cover rounded-lg border border-slate-200 group-hover:opacity-90" />
                        <p className="text-[11px] text-slate-600 font-medium mt-1">{ph.label}</p>
                        {ph.at && <p className="text-[10px] text-slate-400">🕐 {fmtJam(ph.at)}</p>}
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone?: 'amber' | 'red'; children: React.ReactNode }) {
  const cls = tone === 'amber' ? 'bg-amber-50 border-amber-200' : tone === 'red' ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'
  const titleCls = tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-red-600' : 'text-slate-500'
  return (
    <section className={`rounded-lg border p-3 ${cls}`}>
      <h3 className={`text-xs font-semibold uppercase mb-2 ${titleCls}`}>{title}</h3>
      {children}
    </section>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="text-slate-500 shrink-0 w-32">{k}</dt>
      <dd className="text-slate-800 font-medium break-words min-w-0">{v}</dd>
    </div>
  )
}

function Thumb({ url, label, onOpen, wide }: { url: string; label: string; onOpen: (url: string, alt?: string) => void; wide?: boolean }) {
  return (
    <button type="button" onClick={() => onOpen(url, label)} className={`text-left ${wide ? 'w-28' : 'w-16'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className={`${wide ? 'w-28 h-28' : 'w-16 h-16'} object-cover rounded-lg border border-slate-200`} />
      <p className="text-[10px] text-slate-600 mt-1 leading-tight">{label}</p>
    </button>
  )
}
